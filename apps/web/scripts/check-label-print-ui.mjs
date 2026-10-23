// 使用完全脱敏的部门物料 / 常用耗材 / 固定资产检查标签打印页面，不连接真实数据库或打印机。
import { build } from 'esbuild';
import { chromium } from '/Users/wangyichuan/localissue/lab-workspace/apps/oa-export/node_modules/playwright-core/index.mjs';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const web = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const stage = await mkdtemp(join(tmpdir(), 'label-print-ui-'));
const evidence = '/Users/wangyichuan/selfapp/ProjectInbox/work/evidence/TASK-87';
await mkdir(evidence, { recursive: true });
const sampleLabel = (await readFile('/Users/wangyichuan/localissue/myserver/labelprint/preview/sample1.png')).toString('base64');

const fieldsBySource = {
  materials: [{ key: 'item_name', label: '物料名称' }, { key: 'material_code', label: '物料编码' }, { key: 'spec_model', label: '规格型号' }, { key: 'brand', label: '品牌' }, { key: 'department', label: '部门' }, { key: 'unit', label: '单位' }],
  consumables: [{ key: 'item_name', label: '耗材名称' }, { key: 'spec_model', label: '规格型号' }, { key: 'brand', label: '品牌' }, { key: 'stock', label: '库存' }, { key: 'category', label: '分类' }],
  assets: [{ key: 'asset_name', label: '资产名称' }, { key: 'asset_code', label: '资产编号' }, { key: 'spec_model', label: '规格型号' }, { key: 'location', label: '存放地点' }, { key: 'user_name', label: '使用人' }, { key: 'department', label: '使用部门' }],
};
const columnsBySource = {
  materials: [{ key: 'item_name', label: '名称' }, { key: 'material_code', label: '物料编码' }, { key: 'brand', label: '品牌' }, { key: 'spec_model', label: '规格型号' }, { key: 'department', label: '部门' }],
  consumables: [{ key: 'item_name', label: '名称' }, { key: 'spec_model', label: '规格型号' }, { key: 'brand', label: '品牌' }, { key: 'stock', label: '库存' }, { key: 'category', label: '分类' }],
  assets: [{ key: 'asset_name', label: '名称' }, { key: 'asset_code', label: '资产编号' }, { key: 'spec_model', label: '规格型号' }, { key: 'location', label: '存放地点' }, { key: 'user_name', label: '使用人' }],
};
const itemsBySource = {
  materials: [
    { id: 1, item_name: '示例耗材甲', material_code: 'EXAMPLE-M-1', brand: '示例品牌甲', spec_model: 'EXAMPLE-SPEC-1', department: '示例部门', unit: '盒' },
    { id: 2, item_name: '示例耗材乙', material_code: 'EXAMPLE-M-2', brand: '示例品牌乙', spec_model: 'EXAMPLE-SPEC-2', department: '示例部门', unit: '盒' },
    { id: 3, item_name: '示例耗材丙', material_code: 'EXAMPLE-M-3', brand: '示例品牌丙', spec_model: 'EXAMPLE-SPEC-3', department: '示例部门', unit: '瓶' },
  ],
  consumables: [
    { id: 11, item_name: '示例吸头槽位', spec_model: '200µL 滤芯', brand: '示例品牌', stock: '3盒', category: '塑料耗材' },
    { id: 12, item_name: '示例培养板槽位', spec_model: '96 孔 TC', brand: '示例品牌', stock: '1包', category: '细胞耗材' },
  ],
  assets: [
    { id: 21, asset_name: '示例 PCR 仪', asset_code: 'EXAMPLE-CMC-1', spec_model: '示例型号', location: '示例房间', user_name: '示例使用人' },
    { id: 22, asset_name: '示例离心机', asset_code: 'EXAMPLE-CMC-2', spec_model: '示例型号', location: '示例房间', user_name: '示例使用人' },
  ],
};
const printers = [
  { id: 1, printer_key: 'brady-bbp12', name: '示例打印机 A', enabled: true, is_default: true, ready: true, jobs: 0 },
  { id: 2, printer_key: 'postek-c168', name: '示例打印机 B', enabled: true, is_default: false, ready: false, reason: '示例设备离线', jobs: 0 },
];

let browser, server;
try {
  await build({
    stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';import Page from './src/app/(app)/label-print/LabelPrintClient.tsx';import './src/app/globals.css';createRoot(document.getElementById('root')).render(<main><Page/></main>);`, loader: 'tsx', resolveDir: web },
    bundle: true, platform: 'browser', outfile: join(stage, 'app.js'), tsconfig: join(web, 'tsconfig.json'), define: { 'process.env.NODE_ENV': '"production"' },
  });
  server = createServer(async (req, res) => {
    if (req.url === '/app.js') { res.setHeader('content-type', 'text/javascript'); res.end(await readFile(join(stage, 'app.js'))); return; }
    res.setHeader('content-type', 'text/html; charset=utf-8'); res.end('<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>');
  });
  await new Promise((resolveServer) => server.listen(0, '127.0.0.1', resolveServer));
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  const page = await context.newPage();

  let previewBody = null, printBody = null, previewRequests = 0, printRequests = 0;
  await page.route('**/api/v1/label-print/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.pathname.endsWith('/items')) {
      const source = url.searchParams.get('source') || 'materials';
      const items = itemsBySource[source];
      return route.fulfill({ json: { source, items, total: items.length, page: 1, page_size: 20, fields: fieldsBySource[source], columns: columnsBySource[source] } });
    }
    if (url.pathname.endsWith('/printers')) return route.fulfill({ json: { printers } });
    if (url.pathname.endsWith('/preview')) { previewRequests += 1; previewBody = req.postDataJSON(); return route.fulfill({ json: { images: [sampleLabel], count: previewBody.ids.length, media_count: 1, fields: previewBody.fields, template: previewBody.template, layout: 'two-up' } }); }
    if (url.pathname.endsWith('/print')) { printRequests += 1; printBody = req.postDataJSON(); return route.fulfill({ json: { message: '已送出 2 张', sent: 2, printer: '示例打印机 A' } }); }
    return route.fulfill({ status: 404, json: { error: 'unexpected route' } });
  });

  await page.goto(origin);
  await page.getByText('示例耗材甲', { exact: true }).waitFor();
  await page.getByText('共 3 条 · 第 1 / 1 页').waitFor();
  await page.screenshot({ path: join(evidence, 'before-label-print.png'), fullPage: true });

  // 来源切换会清空选择
  await page.getByLabel('选择 示例耗材甲').check();
  await page.getByText(/已选 1 条/).waitFor();
  await page.getByRole('button', { name: '常用耗材' }).click();
  await page.getByText('示例吸头槽位', { exact: true }).waitFor();
  await page.getByText('共 2 条 · 第 1 / 1 页').waitFor();
  await page.getByText(/已选 0 条/).waitFor();
  assert.equal(await page.getByText(/已选 1 条/).count(), 0);

  // 回到部门物料，选两条、份数 2、仅名称模板
  await page.getByRole('button', { name: '部门物料' }).click();
  await page.getByText('示例耗材甲', { exact: true }).waitFor();
  await page.getByLabel('选择 示例耗材甲').check();
  await page.getByLabel('选择 示例耗材乙').check();
  await page.getByLabel('份数').fill('2');
  await page.getByText('仅名称').click();
  await page.getByRole('button', { name: '预览', exact: true }).click();
  await page.getByRole('heading', { name: '预览' }).waitFor();
  assert.equal(previewRequests, 1);
  assert.equal(previewBody?.source, 'materials');
  assert.equal(previewBody?.template, 'name-only');
  assert.deepEqual(previewBody?.fields, ['item_name', 'material_code', 'spec_model']);
  assert.equal(await page.getByAltText(/标签纸预览/).count(), 1);

  const printerSelect = page.getByLabel('打印机');
  assert.equal(await printerSelect.locator('option:disabled').count(), 1);
  await page.getByRole('button', { name: '确认打印' }).click();
  await page.getByRole('status').filter({ hasText: '已送出 2 张' }).waitFor();
  assert.equal(printRequests, 1);
  assert.equal(printBody?.copies, 2);
  assert.equal(printBody?.template, 'name-only');
  assert.equal(printBody?.source, 'materials');
  await page.screenshot({ path: join(evidence, 'after-label-print.png'), fullPage: true });

  console.log(JSON.stringify({
    status: 'passed',
    checks: ['三种来源切换与清空选择', '分页信息', '多选物料', '份数提交', '仅名称模板预览', '离线打印机不可选', '提交打印结果提示'],
    screenshots: evidence,
  }));
} finally {
  await browser?.close();
  if (server) await new Promise((resolveServer) => server.close(resolveServer));
  await rm(stage, { recursive: true, force: true });
}
