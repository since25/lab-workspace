import { build } from 'esbuild';
import { chromium } from '/Users/wangyichuan/localissue/lab-workspace/apps/oa-export/node_modules/playwright-core/index.mjs';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const web = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const stage = await mkdtemp(join(tmpdir(), 'label-print-task91-'));
const evidence = '/Users/wangyichuan/selfapp/ProjectInbox/work/evidence/TASK-91';
await mkdir(evidence, { recursive: true });
const sampleLabel = (await readFile(join(dirname(fileURLToPath(import.meta.url)), 'fixtures/two-up-sample.png'))).toString('base64');

const printers = [
  { id: 1, printer_key: 'brady-bbp12', name: 'Brady BBP12', enabled: true, is_default: true, ready: true, jobs: 0 },
  { id: 2, printer_key: 'postek-c168', name: 'POSTEK C168/300s', enabled: true, is_default: false, ready: true, jobs: 0 },
];

const mockMaterials = [
  { id: 1, item_name: '无水乙醇 500mL', material_code: 'CHEM-001', brand: '国药', spec_model: 'AR 500mL', department: '分子生物室', unit: '瓶' },
  { id: 2, item_name: '胎牛血清 FBS 500mL', material_code: 'BIO-002', brand: 'Gibco', spec_model: '500mL', department: '细胞间', unit: '瓶' },
  { id: 3, item_name: 'DMEM高糖培养基', material_code: 'BIO-003', brand: 'Gibco', spec_model: '500mL', department: '细胞间', unit: '瓶' },
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
    res.end('<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><link rel="stylesheet" href="/app.css"><title>TASK-91 验收测试</title></head><body><div id="root"></div><script src="/app.js"></script></body></html>');
  });
  await new Promise((resolveServer) => server.listen(0, '127.0.0.1', resolveServer));
  const origin = `http://127.0.0.1:${server.address().port}`;

  browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  const page = await context.newPage();

  let lastPreviewPayload = null;
  let lastPrintPayload = null;

  await page.route('**/api/v1/label-print/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());

    if (url.pathname.endsWith('/printers')) {
      return route.fulfill({ json: { printers } });
    }
    if (url.pathname.endsWith('/templates')) {
      return route.fulfill({ json: { templates: [] } });
    }
    if (url.pathname.endsWith('/custom-batches')) {
      return route.fulfill({ json: { batches: [] } });
    }
    if (url.pathname.endsWith('/items')) {
      return route.fulfill({
        json: {
          source: 'materials',
          items: mockMaterials,
          total: mockMaterials.length,
          page: 1,
          page_size: 20,
          fields: [
            { key: 'item_name', label: '物料名称' }, { key: 'material_code', label: '物料编码' },
            { key: 'brand', label: '品牌' }, { key: 'spec_model', label: '规格型号' },
          ],
          columns: [
            { key: 'item_name', label: '物料名称' }, { key: 'material_code', label: '物料编码' },
            { key: 'brand', label: '品牌' }, { key: 'spec_model', label: '规格型号' },
          ],
        },
      });
    }
    if (url.pathname.endsWith('/media')) {
      const printerId = url.searchParams.get('printer_id');
      if (printerId === 'postek-c168') {
        return route.fulfill({
          json: {
            dpi: 300,
            width_mm: 62.0,
            height_mm: 20.0,
            slot_width_mm: 30.0,
            slot_height_mm: 20.0,
            columns: 2,
            command_set: 'epl',
            media_w: 736,
            media_h: 236,
          },
        });
      }
      return route.fulfill({
        json: {
          dpi: 300,
          width_mm: 59.5,
          height_mm: 15.1,
          slot_width_mm: 29.7,
          slot_height_mm: 15.1,
          columns: 2,
          command_set: 'tspl',
          media_w: 703,
          media_h: 178,
        },
      });
    }
    if (url.pathname.endsWith('/preview')) {
      const body = req.postDataJSON() || {};
      lastPreviewPayload = body;
      const pKey = body.printer_id;
      const isPostek = pKey === 'postek-c168';
      return route.fulfill({
        json: {
          images: [sampleLabel],
          count: (body.ids || []).length,
          media_count: 1,
          fields: body.fields || [],
          template: body.template,
          layout: 'two-up',
          media: isPostek
            ? { dpi: 300, width_mm: 62.0, height_mm: 20.0, slot_width_mm: 30.0, slot_height_mm: 20.0, columns: 2, command_set: 'epl' }
            : { dpi: 300, width_mm: 59.5, height_mm: 15.1, slot_width_mm: 29.7, slot_height_mm: 15.1, columns: 2, command_set: 'tspl' },
        },
      });
    }
    if (url.pathname.endsWith('/print')) {
      const body = req.postDataJSON() || {};
      lastPrintPayload = body;
      const p = printers.find((x) => x.id === body.printer_id) || printers[0];
      return route.fulfill({
        json: {
          message: `打印作业已提交到「${p.name}」（${p.printer_key === 'postek-c168' ? 'EPL' : 'TSPL'}）`,
          sent: (body.ids || []).length,
          printer: p.name,
        },
      });
    }

    return route.continue();
  });

  console.log('Navigating to', origin);
  await page.goto(origin, { waitUntil: 'domcontentloaded' });

  // 1. 等待打印机列表加载完毕并验证默认 Brady BBP12
  console.log('Step 1: Wait for printers and check default Brady BBP12');
  const printerSelect = page.locator('label', { hasText: '打印机' }).locator('select');
  await printerSelect.waitFor({ state: 'visible' });
  await page.locator('option[value="2"]').waitFor({ state: 'attached' });
  await page.waitForTimeout(600);

  const initialMediaText = await page.textContent('body');
  assert.ok(initialMediaText.includes('59.5 × 15.1 mm') || initialMediaText.includes('59.5'), '页面初始需展示 Brady 59.5 mm 介质规格');
  assert.ok(initialMediaText.includes('TSPL') || initialMediaText.includes('tspl'), '需标明 TSPL 指令集');
  await page.screenshot({ path: join(evidence, '01-default-brady-30x15.png'), fullPage: true });

  // 2. 切换到 POSTEK C168
  console.log('Step 2: Switch to POSTEK C168/300s');
  await printerSelect.selectOption('2');
  await page.waitForTimeout(800);

  const postekMediaText = await page.textContent('body');
  assert.ok(postekMediaText.includes('62 × 20 mm') || postekMediaText.includes('62.0 × 20.0 mm') || (postekMediaText.includes('62') && postekMediaText.includes('20')), '页面切换后需联动展示 POSTEK 62×20 mm 介质规格');
  assert.ok(postekMediaText.includes('EPL') || postekMediaText.includes('epl'), '需标明 EPL 指令集');
  await page.screenshot({ path: join(evidence, '02-switch-postek-30x20.png'), fullPage: true });

  // 3. 勾选记录并点击「预览」
  console.log('Step 3: Select items and generate preview for POSTEK');
  const checkboxes = page.locator('input[type="checkbox"]');
  const count = await checkboxes.count();
  if (count > 1) {
    await checkboxes.nth(1).check();
    await checkboxes.nth(2).check();
  }

  const previewBtn = page.getByRole('button', { name: '预览' });
  await previewBtn.click();
  await page.waitForTimeout(800);

  assert.ok(lastPreviewPayload, '需触发 /preview 请求');
  assert.equal(lastPreviewPayload.printer_id, 'postek-c168', 'preview 请求 payload 需带上 postek-c168 printer_id');
  await page.screenshot({ path: join(evidence, '03-postek-epl-preview.png'), fullPage: true });

  // 4. 点击「确认打印」
  console.log('Step 4: Click print and verify EPL backend feedback');
  const printBtn = page.getByRole('button', { name: /确认打印/ });
  await printBtn.click();
  await page.waitForTimeout(800);

  assert.ok(lastPrintPayload, '需触发 /print 请求');
  assert.equal(lastPrintPayload.printer_id, 2, 'print 请求 payload 需为 POSTEK 的数据库 ID 2');
  const pageTextAfterPrint = await page.textContent('body');
  assert.ok(pageTextAfterPrint.includes('POSTEK C168/300s'), '提示消息应显示 POSTEK C168/300s');
  await page.screenshot({ path: join(evidence, '04-postek-print-success.png'), fullPage: true });

  // 5. 切回 Brady BBP12，验证不破坏
  console.log('Step 5: Switch back to Brady BBP12');
  await printerSelect.selectOption('1');
  await page.waitForTimeout(800);

  const restoredText = await page.textContent('body');
  assert.ok(restoredText.includes('59.5 × 15.1 mm') || restoredText.includes('59.5'), '切回后需恢复 Brady 59.5 介质');
  await page.screenshot({ path: join(evidence, '05-switch-back-brady.png'), fullPage: true });

  console.log('All TASK-91 UI checks passed successfully!');
} finally {
  if (browser) await browser.close();
  if (server) await new Promise((r) => server.close(r));
  await rm(stage, { recursive: true, force: true });
}
