import { build } from 'esbuild';
import { chromium } from '/Users/wangyichuan/localissue/lab-workspace/apps/oa-export/node_modules/playwright-core/index.mjs';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const web = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const stage = await mkdtemp(join(tmpdir(), 'label-print-task102-'));
const evidence = '/Users/wangyichuan/selfapp/ProjectInbox/work/evidence/TASK-102';
await mkdir(evidence, { recursive: true });
const sampleLabel = (await readFile(join(dirname(fileURLToPath(import.meta.url)), 'fixtures/two-up-sample.png'))).toString('base64');

const customBatches = [
  { id: 1, batch_name: '已存批次-质粒样品.csv', headers: ['质粒名称', '浓度', '体积', '纯度', '保存位置', '日期', '保管人'], row_count: 2, created_at: '2026-10-23 15:30' },
];

let customItems = [
  { id: 501, batch_id: 1, 质粒名称: 'pCDNA3.1-EGFP', 浓度: '250 ng/μL', 体积: '50 μL', 纯度: 'OD 1.85', 保存位置: '-20℃ 冰箱A-3', 日期: '2026-10-23', 保管人: '张三', title: 'pCDNA3.1-EGFP' },
  { id: 502, batch_id: 1, 质粒名称: 'pX458-SpCas9', 浓度: '500 ng/μL', 体积: '100 μL', 纯度: 'OD 1.90', 保存位置: '-20℃ 冰箱B-1', 日期: '2026-10-23', 保管人: '李四', title: 'pX458-SpCas9' },
];

const printers = [
  { id: 1, printer_key: 'brady-bbp12', name: 'Brady BBP12', enabled: true, is_default: true, ready: true, jobs: 0 },
];

let browser, server;
try {
  await build({
    stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';import Page from './src/app/(app)/label-print/LabelPrintClient.tsx';import './src/app/globals.css';createRoot(document.getElementById('root')).render(<main><Page/></main>);`, loader: 'tsx', resolveDir: web },
    bundle: true, platform: 'browser', outfile: join(stage, 'app.js'), tsconfig: join(web, 'tsconfig.json'), define: { 'process.env.NODE_ENV': '"production"' },
  });

  server = createServer(async (req, res) => {
    if (req.url === '/app.js') { res.setHeader('content-type', 'text/javascript'); res.end(await readFile(join(stage, 'app.js'))); return; }
    if (req.url === '/app.css') { res.setHeader('content-type', 'text/css'); res.end(await readFile(join(stage, 'app.css')).catch(() => '')); return; }
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end('<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><link rel="stylesheet" href="/app.css"><title>TASK-102 验收测试</title></head><body><div id="root"></div><script src="/app.js"></script></body></html>');
  });
  await new Promise((resolveServer) => server.listen(0, '127.0.0.1', resolveServer));
  const origin = `http://127.0.0.1:${server.address().port}`;

  browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  const page = await context.newPage();

  let previewBody = null;
  await page.route('**/api/v1/label-print/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.pathname.endsWith('/custom-batches')) {
      if (req.method() === 'POST') {
        const body = req.postDataJSON();
        const headers = ['试剂名称', '规格型号', '品牌', '浓度', '体积', '存放位置', '入库日期', '保管人'];
        const newBatch = {
          id: 2,
          batch_name: body.batch_name || '新上传批次.csv',
          headers,
          row_count: 3,
          created_at: '2026-10-24 14:40',
        };
        customBatches.unshift(newBatch);
        customItems = [
          { id: 601, batch_id: 2, 试剂名称: 'Anti-Flag mAb', 规格型号: '100 μg', 品牌: 'Sigma', 浓度: '1 mg/mL', 体积: '200 μL', 存放位置: '-20℃ 冰箱C-2', 入库日期: '2026-10-24', 保管人: '张三', title: 'Anti-Flag mAb' },
          { id: 602, batch_id: 2, 试剂名称: 'Tris-HCl 1M pH8.0', 规格型号: '500 mL', 品牌: '自配', 浓度: '1 M', 体积: '500 mL', 存放位置: '室温试剂架2层', 入库日期: '2026-10-20', 保管人: '李四', title: 'Tris-HCl 1M pH8.0' },
          { id: 603, batch_id: 2, 试剂名称: 'PCR Buffer 10x', 规格型号: '1 mL*5', 品牌: 'Takara', 浓度: '10x', 体积: '1 mL', 存放位置: '-20℃ 冰箱A-1', 入库日期: '2026-10-22', 保管人: '王五', title: 'PCR Buffer 10x' },
        ];
        return route.fulfill({ status: 201, json: { batch: newBatch } });
      }
      return route.fulfill({ json: { batches: customBatches } });
    }
    if (url.pathname.endsWith('/items')) {
      const source = url.searchParams.get('source') || 'materials';
      if (source === 'custom') {
        const batchId = Number(url.searchParams.get('batch_id')) || customBatches[0].id;
        const b = customBatches.find((x) => x.id === batchId) || customBatches[0];
        const fields = b.headers.map((h) => ({ key: h, label: h }));
        const columns = b.headers.map((h) => ({ key: h, label: h }));
        const items = customItems.filter((x) => x.batch_id === b.id);
        return route.fulfill({ json: { source, items, total: items.length, page: 1, page_size: 20, fields, columns, batch_id: b.id } });
      }
      return route.fulfill({ json: { source, items: [], total: 0, page: 1, page_size: 20, fields: [], columns: [] } });
    }
    if (url.pathname.endsWith('/printers')) return route.fulfill({ json: { printers } });
    if (url.pathname.endsWith('/templates')) return route.fulfill({ json: { templates: [] } });
    if (url.pathname.endsWith('/media')) return route.fulfill({ json: { dpi: 300, width_mm: 59.5, height_mm: 15.1, slot_width_mm: 29.7, slot_height_mm: 15.1, columns: 2 } });
    if (url.pathname.endsWith('/preview')) {
      previewBody = req.postDataJSON();
      const count = previewBody.ids.length;
      const mediaCount = Math.ceil(count / 2);
      return route.fulfill({ json: { images: Array.from({ length: mediaCount }, () => sampleLabel), count, media_count: mediaCount, fields: previewBody.fields, template: previewBody.template, layout: 'two-up' } });
    }
    return route.fulfill({ status: 404, json: { error: 'not found' } });
  });

  // 1. 进入页面
  await page.goto(origin);
  await page.screenshot({ path: join(evidence, '01-label-print-home.png'), fullPage: true });

  // 2. 点击「自定义 CSV」来源
  await page.getByRole('button', { name: '自定义 CSV' }).click();
  await page.getByText('当前 CSV 批次').waitFor();
  await page.getByText('pCDNA3.1-EGFP', { exact: true }).waitFor();
  // 验证第1批次的全部 7 个表头列均有显示（不截断）
  for (const h of ['质粒名称', '浓度', '体积', '纯度', '保存位置', '日期', '保管人']) {
    await page.locator('th', { hasText: h }).waitFor();
  }
  await page.screenshot({ path: join(evidence, '02-custom-csv-selected.png'), fullPage: true });

  // 3. 模拟上传新的 8 列 CSV 文件
  const csvContent = `试剂名称,规格型号,品牌,浓度,体积,存放位置,入库日期,保管人
Anti-Flag mAb,100 μg,Sigma,1 mg/mL,200 μL,-20℃ 冰箱C-2,2026-10-24,张三
Tris-HCl 1M pH8.0,500 mL,自配,1 M,500 mL,室温试剂架2层,2026-10-20,李四
PCR Buffer 10x,1 mL*5,Takara,10x,1 mL,-20℃ 冰箱A-1,2026-10-22,王五`;

  const fileChooserPromise = page.waitForEvent('filechooser');
  await page.getByText('上传新 CSV').click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles({
    name: '20261024-抗体与试剂.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(csvContent, 'utf-8'),
  });

  // 4. 等待新批次加载并展示全部 8 列
  await page.getByText('Anti-Flag mAb', { exact: true }).waitFor();
  await page.getByText('Tris-HCl 1M pH8.0', { exact: true }).waitFor();
  await page.getByText('PCR Buffer 10x', { exact: true }).waitFor();
  for (const h of ['试剂名称', '规格型号', '品牌', '浓度', '体积', '存放位置', '入库日期', '保管人']) {
    await page.locator('th', { hasText: h }).waitFor();
  }
  await page.screenshot({ path: join(evidence, '03-uploaded-new-batch.png'), fullPage: true });

  // 5. 勾选记录并配置字段
  await page.getByLabel('选择 Anti-Flag mAb', { exact: true }).check();
  await page.getByLabel('选择 Tris-HCl 1M pH8.0', { exact: true }).check();
  await page.getByText(/已选 2 条/).waitFor();
  await page.screenshot({ path: join(evidence, '04-selected-items.png'), fullPage: true });

  // 6. 点击「预览」，验证双列位图画布生成
  await page.getByRole('button', { name: '预览' }).click();
  await page.getByText('共 2 个标签，1 张标签纸').waitFor();
  assert.equal(previewBody.source, 'custom');
  assert.deepEqual(previewBody.ids, [601, 602]);
  await page.screenshot({ path: join(evidence, '05-preview-rendered.png'), fullPage: true });

  console.log('TASK-102 端到端走查与截图全部顺利通过！');
} finally {
  if (browser) await browser.close();
  if (server) server.close();
  await rm(stage, { recursive: true, force: true }).catch(() => {});
}
