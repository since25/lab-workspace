import { build } from 'esbuild';
import { chromium } from '/Users/wangyichuan/localissue/lab-workspace/apps/oa-export/node_modules/playwright-core/index.mjs';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const web = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const stage = await mkdtemp(join(tmpdir(), 'label-print-task92-'));
const evidence = '/Users/wangyichuan/selfapp/ProjectInbox/work/evidence/TASK-92';
await mkdir(evidence, { recursive: true });
const sampleLabel = (await readFile(join(dirname(fileURLToPath(import.meta.url)), 'fixtures/two-up-sample.png'))).toString('base64');

const fieldsBySource = {
  materials: [
    { key: 'item_name', label: '物料名称' }, { key: 'material_code', label: '物料编码' },
    { key: 'spec_model', label: '规格型号' }, { key: 'brand', label: '品牌' },
    { key: 'department', label: '部门' }, { key: 'unit', label: '单位' },
  ],
  freezer: [
    { key: 'name', label: '样品信息' }, { key: 'project_no', label: '项目号' },
    { key: 'sample_type', label: '样品类型' }, { key: 'location', label: '位置' },
    { key: 'stored_on', label: '存入日期' }, { key: 'remarks', label: '备注' },
  ],
  assets: [
    { key: 'asset_name', label: '资产名称' }, { key: 'asset_code', label: '资产编号' },
    { key: 'spec_model', label: '规格型号' }, { key: 'location', label: '存放地点' },
    { key: 'user_name', label: '使用人' }, { key: 'department', label: '使用部门' },
  ],
  cells: [
    { key: 'cell_name', label: '细胞名称' }, { key: 'passage', label: '代次' },
    { key: 'frozen_on', label: '冻存日期' }, { key: 'location', label: '位置' },
    { key: 'depositor', label: '冻存人' }, { key: 'density', label: '细胞密度' },
    { key: 'source', label: '来源' }, { key: 'freezing_medium', label: '冻存液' },
    { key: 'tube_count', label: '管数' }, { key: 'remarks', label: '备注' },
  ],
};

const columnsBySource = {
  materials: [
    { key: 'item_name', label: '名称' }, { key: 'material_code', label: '物料编码' },
    { key: 'brand', label: '品牌' }, { key: 'spec_model', label: '规格型号' },
    { key: 'department', label: '部门' },
  ],
  freezer: [
    { key: 'name', label: '样品信息' }, { key: 'project_no', label: '项目号' },
    { key: 'sample_type', label: '样品类型' }, { key: 'location', label: '位置' },
    { key: 'stored_on', label: '存入日期' },
  ],
  assets: [
    { key: 'asset_name', label: '名称' }, { key: 'asset_code', label: '资产编号' },
    { key: 'spec_model', label: '规格型号' }, { key: 'location', label: '存放地点' },
    { key: 'user_name', label: '使用人' },
  ],
  cells: [
    { key: 'cell_name', label: '细胞名称' }, { key: 'passage', label: '代次' },
    { key: 'location', label: '位置' }, { key: 'depositor', label: '冻存人' },
    { key: 'frozen_on', label: '冻存日期' }, { key: 'tube_count', label: '管数' },
  ],
};

const rawCells = [
  { id: 101, cell_name: 'HEK293T-Cas9', passage: 'P12', location: '1号架 / 2层', depositor: '王小明', frozen_on: '2026-10-24', tube_count: 4, density: '5×10^6/mL', source: 'ATCC', freezing_medium: '90%FBS+10%DMSO', remarks: '高活性' },
  { id: 102, cell_name: 'HeLa-GFP-S1', passage: 'P8', location: '1号架 / 2层', depositor: '李四', frozen_on: '2026-10-20', tube_count: 2, density: '3×10^6/mL', source: '自建', freezing_medium: '常规', remarks: '' },
  { id: 103, cell_name: 'HeLa-GFP-S10', passage: 'P9', location: '1号架 / 2层', depositor: '李四', frozen_on: '2026-10-21', tube_count: 3, density: '4×10^6/mL', source: '自建', freezing_medium: '常规', remarks: '' },
  { id: 104, cell_name: 'HeLa-GFP-S2', passage: 'P8', location: '1号架 / 2层', depositor: '李四', frozen_on: '2026-10-20', tube_count: 1, density: '3×10^6/mL', source: '自建', freezing_medium: '常规', remarks: '' },
  { id: 105, cell_name: 'Jurkat-T', passage: 'P15', location: '2号架 / 1层', depositor: '赵六', frozen_on: '2026-09-15', tube_count: 5, density: '2×10^6/mL', source: '赠予', freezing_medium: '90%FBS+10%DMSO', remarks: '易聚团' },
];

const itemsBySource = {
  materials: [
    { id: 1, item_name: '示例耗材甲', material_code: 'EXAMPLE-M-1', brand: '示例品牌甲', spec_model: 'EXAMPLE-SPEC-1', department: '示例部门', unit: '盒' },
    { id: 2, item_name: '示例耗材乙', material_code: 'EXAMPLE-M-2', brand: '示例品牌乙', spec_model: 'EXAMPLE-SPEC-2', department: '示例部门', unit: '盒' },
  ],
  freezer: [
    { id: 11, name: '示例样品甲', project_no: 'P-001', sample_type: '细胞', location: '-80 1号（-80℃） · 第1层 · 盒子「A」', stored_on: '2026-10-01' },
  ],
  assets: [
    { id: 21, asset_name: '示例 PCR 仪', asset_code: 'EXAMPLE-CMC-1', spec_model: '示例型号', location: '示例房间', user_name: '示例使用人' },
  ],
  cells: rawCells,
};

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
    res.end('<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><link rel="stylesheet" href="/app.css"><title>TASK-92 验收测试</title></head><body><div id="root"></div><script src="/app.js"></script></body></html>');
  });
  await new Promise((resolveServer) => server.listen(0, '127.0.0.1', resolveServer));
  const origin = `http://127.0.0.1:${server.address().port}`;

  browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  const page = await context.newPage();

  let lastPreviewBody = null;
  await page.route('**/api/v1/label-print/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.pathname.endsWith('/items')) {
      const source = url.searchParams.get('source') || 'materials';
      const q = (url.searchParams.get('q') || '').trim().toLowerCase();
      let items = itemsBySource[source] || [];
      if (q) {
        items = items.filter((item) => JSON.stringify(item).toLowerCase().includes(q));
      }
      return route.fulfill({ json: { source, items, total: items.length, page: 1, page_size: 20, fields: fieldsBySource[source], columns: columnsBySource[source] } });
    }
    if (url.pathname.endsWith('/printers')) return route.fulfill({ json: { printers } });
    if (url.pathname.endsWith('/templates')) return route.fulfill({ json: { templates: [] } });
    if (url.pathname.endsWith('/media')) return route.fulfill({ json: { dpi: 300, width_mm: 59.5, height_mm: 15.1, slot_width_mm: 29.7, slot_height_mm: 15.1, columns: 2 } });
    if (url.pathname.endsWith('/preview')) {
      lastPreviewBody = req.postDataJSON();
      // 若按管数展开
      let count = lastPreviewBody.ids.length;
      if (lastPreviewBody.source === 'cells' && lastPreviewBody.by_tube_count) {
        count = lastPreviewBody.ids.reduce((sum, id) => {
          const item = rawCells.find((c) => c.id === id);
          return sum + (item?.tube_count || 1);
        }, 0);
      }
      const mediaCount = Math.ceil(count / 2);
      const images = Array.from({ length: mediaCount }, () => sampleLabel);
      return route.fulfill({ json: { images, count, media_count: mediaCount, fields: lastPreviewBody.fields, template: lastPreviewBody.template, layout: 'two-up' } });
    }
    if (url.pathname.endsWith('/print')) {
      return route.fulfill({ json: { message: '已送出', sent: 6, printer: 'Brady BBP12' } });
    }
    return route.fulfill({ status: 404, json: { error: 'not found' } });
  });

  // 1. 初始状态：部门物料
  await page.goto(origin);
  await page.getByText('示例耗材甲', { exact: true }).waitFor();
  await page.screenshot({ path: join(evidence, '01-initial-materials.png'), fullPage: true });

  // 2. 切换到「细胞冻存」来源
  await page.getByRole('button', { name: '细胞冻存' }).click();
  await page.getByText('HEK293T-Cas9', { exact: true }).waitFor();
  await page.getByText('HeLa-GFP-S10', { exact: true }).waitFor();
  await page.getByText('1号架 / 2层', { exact: false }).first().waitFor();
  await page.screenshot({ path: join(evidence, '02-cells-source.png'), fullPage: true });

  // 3. 勾选两条细胞样本
  await page.getByLabel('选择 HEK293T-Cas9', { exact: true }).check();
  await page.getByLabel('选择 HeLa-GFP-S1', { exact: true }).check();
  await page.getByText(/已选 2 条/).waitFor();

  // 4. 勾选「按在库管数打印对应张数（每管一张）」
  const tubeCheck = page.getByRole('checkbox', { name: '按在库管数打印对应张数（每管一张）' });
  await tubeCheck.check();
  // HEK293T-Cas9 为 4 管，HeLa-GFP-S1 为 2 管，共 6 管，双列纸 3 张
  await page.getByText('（共 6 管）').waitFor();
  await page.getByText('双列纸约 3 张').waitFor();
  await page.screenshot({ path: join(evidence, '03-selected-by-tube-count.png'), fullPage: true });

  // 5. 点击预览，验证 preview 包含 by_tube_count 并成功渲染 3 张标签纸
  await page.getByRole('button', { name: '预览' }).click();
  await page.getByText('共 6 个标签，3 张标签纸').waitFor();
  assert.equal(lastPreviewBody.source, 'cells');
  assert.equal(lastPreviewBody.by_tube_count, true);
  await page.screenshot({ path: join(evidence, '04-preview-rendered.png'), fullPage: true });

  // 6. 搜索测试
  await page.getByLabel('搜索').fill('王小明');
  await page.getByRole('button', { name: '搜索' }).click();
  await page.getByText('共 1 条 · 第 1 / 1 页').waitFor();
  await page.getByText('HEK293T-Cas9', { exact: true }).waitFor();
  assert.equal(await page.getByText('HeLa-GFP-S1').count(), 0);
  await page.screenshot({ path: join(evidence, '05-search-filtered.png'), fullPage: true });

  // 7. 切回部门物料，原有功能照常
  await page.getByRole('button', { name: '部门物料' }).click();
  await page.getByText('示例耗材甲', { exact: true }).waitFor();
  await page.screenshot({ path: join(evidence, '06-back-to-materials.png'), fullPage: true });

  console.log('TASK-92 端到端走查与截图全部顺利通过！');
} finally {
  if (browser) await browser.close();
  if (server) server.close();
  await rm(stage, { recursive: true, force: true }).catch(() => {});
}
