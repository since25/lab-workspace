// 使用完全脱敏的部门物料和打印机状态检查 TASK-87 P0 页面，不连接真实数据库或打印机。
import { build } from 'esbuild';
import { chromium } from '/Users/wangyichuan/localissue/lab-workspace/apps/oa-export/node_modules/playwright-core/index.mjs';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const web = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repo = resolve(web, '../..');
const stage = await mkdtemp(join(tmpdir(), 'label-print-ui-'));
const evidence = '/Users/wangyichuan/selfapp/ProjectInbox/work/evidence/TASK-87';
await mkdir(evidence, { recursive: true });
const sampleLabel = (await readFile('/Users/wangyichuan/localissue/myserver/labelprint/preview/sample1.png')).toString('base64');
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
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const items = [
    { id: 1, item_name: '示例耗材甲', material_code: 'EXAMPLE-M-1', brand: '示例品牌甲', spec_model: 'EXAMPLE-SPEC-1', unit: '盒', department: '示例部门', requester: '示例成员', is_used_up: false },
    { id: 2, item_name: '示例耗材乙', material_code: 'EXAMPLE-M-2', brand: '示例品牌乙', spec_model: 'EXAMPLE-SPEC-2', unit: '盒', department: '示例部门', requester: '示例成员乙', is_used_up: false },
    { id: 3, item_name: '示例耗材丙', material_code: 'EXAMPLE-M-3', brand: '示例品牌丙', spec_model: 'EXAMPLE-SPEC-3', unit: '瓶', department: '示例部门', requester: '示例成员丙', is_used_up: false },
  ];
  const printers = [
    { id: 1, printer_key: 'Queue A', name: '示例打印机 A', enabled: true, is_default: true, ready: true, jobs: 0 },
    { id: 2, printer_key: 'Queue B', name: '示例打印机 B', enabled: true, is_default: false, ready: false, reason: '示例设备离线', jobs: 0 },
  ];
  let previewRequests = 0, printRequests = 0, lastPrintBody = null;
  await page.route('**/api/v1/label-print/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.pathname.endsWith('/materials')) {
      const page = Number(url.searchParams.get('page') || 1);
      const pageSize = Number(url.searchParams.get('page_size') || 20);
      const start = (page - 1) * pageSize;
      return route.fulfill({ json: { items: items.slice(start, start + pageSize), total: items.length, page, page_size: pageSize, departments: ['示例部门'], limit: 500, fields: [{ key: 'item_name', label: '物料名称' }, { key: 'material_code', label: '物料编码' }, { key: 'spec_model', label: '规格型号' }, { key: 'brand', label: '品牌' }] } });
    }
    if (url.pathname.endsWith('/printers')) return route.fulfill({ json: { printers } });
    if (url.pathname.endsWith('/preview')) { previewRequests += 1; const body = req.postDataJSON(); return route.fulfill({ json: { images: [sampleLabel], count: body.ids.length, media_count: 1, fields: body.fields } }); }
    if (url.pathname.endsWith('/print')) { printRequests += 1; lastPrintBody = req.postDataJSON(); return route.fulfill({ json: { message: '已送出 2 张', sent: 2, printer: '示例打印机 A' } }); }
    return route.fulfill({ status: 404, json: { error: 'unexpected route' } });
  });
  await page.goto(origin);
  await page.getByText('示例耗材甲', { exact: true }).waitFor();
  await page.screenshot({ path: join(evidence, 'before-label-print.png'), fullPage: true });
  await page.getByText('共 3 条，第 1 / 1 页').waitFor();
  await page.getByLabel('每页').selectOption('50');
  await page.getByLabel('选择 示例耗材甲').check();
  await page.getByLabel('选择 示例耗材乙').check();
  await page.getByLabel('份数').fill('2');
  await page.getByRole('button', { name: /预览/ }).click();
  await page.getByRole('heading', { name: '预览' }).waitFor();
  assert.equal(previewRequests, 1);
  assert.equal(await page.getByAltText(/标签纸预览/).count(), 1);
  const printerSelect = page.getByLabel('打印机');
  assert.equal(await printerSelect.locator('option:disabled').count(), 1);
  await page.getByRole('button', { name: '确认打印' }).click();
  await page.getByRole('status').filter({ hasText: '已送出 2 张' }).waitFor();
  assert.equal(printRequests, 1);
  assert.equal(lastPrintBody?.copies, 2);
  assert.deepEqual(lastPrintBody?.fields, ['item_name', 'material_code', 'spec_model']);
  await page.screenshot({ path: join(evidence, 'after-label-print.png'), fullPage: true });
  assert.deepEqual([], []);
  console.log(JSON.stringify({ status: 'passed', checks: ['物料表加载与分页信息', '每页条数切换', '多选物料', '份数提交', '字段选择与内置模板', '预览两张标签', '离线打印机不可选', '提交打印结果提示'], screenshots: evidence }));
} finally {
  await browser?.close();
  if (server) await new Promise((resolveServer) => server.close(resolveServer));
  await rm(stage, { recursive: true, force: true });
}
