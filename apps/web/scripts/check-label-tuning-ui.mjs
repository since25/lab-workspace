// 标签打印「本次微调」与「自定义批次上传」界面检查：全部脱敏桩数据，不连接数据库或打印机。
// 批次识别走真实的 label-custom-csv.ts 解析逻辑（打包成 node 模块在桩服务里调用）。
// 用法：node scripts/check-label-tuning-ui.mjs（截图目录可用 EVIDENCE_DIR 指定）
import { build } from 'esbuild';
import { chromium } from '/Users/wangyichuan/localissue/lab-workspace/apps/oa-export/node_modules/playwright-core/index.mjs';
import ExcelJS from 'exceljs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const web = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const stage = await mkdtemp(join(tmpdir(), 'label-tuning-ui-'));
const evidence = process.env.EVIDENCE_DIR || join(tmpdir(), 'label-tuning-ui-evidence');
await mkdir(evidence, { recursive: true });
const sampleLabel = (await readFile(join(web, 'scripts/fixtures/two-up-sample.png'))).toString('base64');

const materialFields = [{ key: 'item_name', label: '物料名称' }, { key: 'material_code', label: '物料编码' }, { key: 'spec_model', label: '规格型号' }, { key: 'brand', label: '品牌' }, { key: 'department', label: '部门' }, { key: 'unit', label: '单位' }];
const materialColumns = [{ key: 'item_name', label: '名称' }, { key: 'material_code', label: '物料编码' }, { key: 'brand', label: '品牌' }, { key: 'spec_model', label: '规格型号' }, { key: 'department', label: '部门' }];
const materials = [
  { id: 1, item_name: '示例耗材甲', material_code: 'EXAMPLE-M-1', brand: '示例品牌', spec_model: 'EXAMPLE-SPEC-1', department: '示例部门', unit: '盒' },
  { id: 2, item_name: '示例耗材乙', material_code: 'EXAMPLE-M-2', brand: '示例品牌', spec_model: 'EXAMPLE-SPEC-2', department: '示例部门', unit: '盒' },
];
const printers = [{ id: 1, printer_key: 'brady-bbp12', name: '示例打印机 A', enabled: true, is_default: true, ready: true, jobs: 0 }];

let browser, server;
try {
  // 前端页面（管理员视角，以便检查「存为新模板」）
  await build({
    stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';import Page from './src/app/(app)/label-print/LabelPrintClient.tsx';import './src/app/globals.css';createRoot(document.getElementById('root')).render(<main><Page isAdmin={true}/></main>);`, loader: 'tsx', resolveDir: web },
    bundle: true, platform: 'browser', outfile: join(stage, 'app.js'), tsconfig: join(web, 'tsconfig.json'), define: { 'process.env.NODE_ENV': '"production"' },
  });
  // 真实的批次解析逻辑，依赖包从 apps/web/node_modules 解析
  const parserFile = join(web, '.next', 'ui-check-label-parser.cjs');
  await build({
    stdin: { contents: `export { readCustomImport, customTextSheets, prepareCustomImport, parseCustomImportOptions } from './src/lib/label-custom-csv.ts';`, loader: 'ts', resolveDir: web },
    bundle: true, platform: 'node', format: 'cjs', external: ['exceljs', 'pg'], outfile: parserFile, tsconfig: join(web, 'tsconfig.json'),
  });
  const parser = await import(pathToFileURL(parserFile).href);

  const uploads = [];
  let customBatch = null;
  async function handleUpload(req, res) {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const form = await new Request('http://stub/upload', { method: 'POST', headers: req.headers, body: Buffer.concat(chunks) }).formData();
    const file = form.get('file');
    const send = (status, json) => { res.statusCode = status; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(json)); };
    try {
      const options = parser.parseCustomImportOptions(JSON.parse(String(form.get('options') || '{}')));
      const sheets = file && typeof file !== 'string' && file.size
        ? await parser.readCustomImport(await file.arrayBuffer(), file.name)
        : parser.customTextSheets(String(form.get('text') ?? ''), '粘贴', true);
      const parsed = parser.prepareCustomImport(sheets, options);
      uploads.push({ mode: form.get('mode'), options, preview: parsed.preview, headers: parsed.headers });
      if (form.get('mode') === 'commit') {
        customBatch = { name: String(form.get('batch_name')), headers: parsed.headers, rows: parsed.rows };
        return send(201, { batch: { id: 9, batch_name: customBatch.name, headers: parsed.headers, row_count: parsed.rows.length } });
      }
      return send(200, parsed.preview);
    } catch (e) { return send(400, { error: e.message }); }
  }

  server = createServer(async (req, res) => {
    if (req.url?.startsWith('/api/v1/label-print/custom-batches') && req.method === 'POST') return handleUpload(req, res);
    if (req.url === '/app.js') { res.setHeader('content-type', 'text/javascript'); res.end(await readFile(join(stage, 'app.js'))); return; }
    if (req.url === '/app.css') { res.setHeader('content-type', 'text/css'); res.end(await readFile(join(stage, 'app.css')).catch(() => '')); return; }
    res.setHeader('content-type', 'text/html; charset=utf-8'); res.end('<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 1100 } })).newPage();

  const previews = [], prints = [], saves = [];
  await page.route('**/api/v1/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const p = url.pathname;
    if (p.endsWith('/label-print/items')) {
      const source = url.searchParams.get('source') || 'materials';
      if (source === 'custom') {
        if (!customBatch) return route.fulfill({ json: { source, items: [], total: 0, page: 1, page_size: 20, fields: [], columns: [], batch_id: null } });
        const cols = customBatch.headers.map((h) => ({ key: h, label: h }));
        const items = customBatch.rows.map((row, i) => ({ id: 100 + i, title: row[0], ...Object.fromEntries(customBatch.headers.map((h, j) => [h, row[j]])) }));
        return route.fulfill({ json: { source, items, total: items.length, page: 1, page_size: 20, fields: cols, columns: cols, batch_id: 9, batch_name: customBatch.name } });
      }
      return route.fulfill({ json: { source, items: materials, total: materials.length, page: 1, page_size: 20, fields: materialFields, columns: materialColumns } });
    }
    if (p.endsWith('/printers')) return route.fulfill({ json: { printers } });
    if (p.endsWith('/label-print/templates')) return route.fulfill({ json: { templates: saves.length ? [{ id: 5, source: 'materials', name: saves[0].name, base_template: saves[0].base_template, name_pt: saves[0].name_pt, detail_pt: saves[0].detail_pt, line_gap: saves[0].line_gap, name_align: saves[0].name_align, detail_align: saves[0].detail_align, fields: saves[0].fields }] : [] } });
    if (p.endsWith('/media')) return route.fulfill({ json: { dpi: 300, width_mm: 59.5, height_mm: 15.1, slot_width_mm: 29.7, slot_height_mm: 15.1, columns: 2 } });
    if (p.endsWith('/preview')) { const body = req.postDataJSON(); previews.push(body); return route.fulfill({ json: { images: [sampleLabel], count: body.ids.length, media_count: 1, fields: body.fields ?? [], template: body.template, layout: 'two-up' } }); }
    if (p.endsWith('/print')) { prints.push(req.postDataJSON()); return route.fulfill({ json: { message: '已送出 1 张', sent: 1, printer: '示例打印机 A' } }); }
    if (p.endsWith('/admin/label-templates') && req.method() === 'POST') {
      const body = req.postDataJSON(); saves.push(body);
      return route.fulfill({ status: 201, json: { template: { id: 5, ...body } } });
    }
    if (p.endsWith('/custom-batches') && req.method() === 'GET') return route.fulfill({ json: { batches: customBatch ? [{ id: 9, batch_name: customBatch.name, headers: customBatch.headers, row_count: customBatch.rows.length }] : [] } });
    // 带文件的表单交给本地桩服务处理（Playwright 拦截时拿不到文件内容）
    if (p.endsWith('/custom-batches') && req.method() === 'POST') return route.continue();
    return route.fulfill({ status: 404, json: { error: `unexpected ${p}` } });
  });

  // ① 本次微调：预览后调字号、对齐，自动重新预览并带 style_override
  await page.goto(origin);
  await page.getByText('示例耗材甲', { exact: true }).waitFor();
  await page.getByLabel('选择 示例耗材甲').check();
  await page.getByLabel('选择 示例耗材乙').check();
  await page.getByRole('button', { name: '预览', exact: true }).click();
  await page.getByRole('heading', { name: '预览' }).waitFor();
  assert.equal(previews.length, 1);
  assert.equal(previews[0].style_override, undefined, '未微调时不应带样式覆盖');
  await page.getByRole('button', { name: '减小名称字号' }).click();
  await page.waitForFunction(() => true);
  await page.waitForTimeout(900);
  assert.equal(previews.length, 2, '改字号后应自动重新预览一次');
  assert.equal(previews[1].style_override?.name_pt, 32);
  await page.getByRole('group', { name: '名称对齐' }).getByRole('button', { name: '中' }).click();
  await page.getByRole('group', { name: '字段对齐' }).getByRole('button', { name: '右' }).click();
  await page.waitForTimeout(900);
  const last = previews.at(-1).style_override;
  assert.equal(last?.name_align, 'center');
  assert.equal(last?.detail_align, 'right');
  assert.equal(last?.name_pt, 32);
  await page.screenshot({ path: join(evidence, 'tuning-bar.png'), fullPage: true });
  await page.getByRole('button', { name: '确认打印' }).click();
  await page.getByRole('status').filter({ hasText: '已送出 1 张' }).waitFor();
  assert.deepEqual(prints[0].style_override, last, '打印必须沿用预览时的微调');

  // 恢复默认后不再带覆盖
  await page.getByRole('button', { name: '恢复默认' }).click();
  await page.waitForTimeout(900);
  assert.equal(previews.at(-1).style_override, undefined, '恢复默认后不应带样式覆盖');

  // ② 管理员「存为新模板」
  await page.getByRole('button', { name: '增大字段字号' }).click();
  await page.waitForTimeout(900);
  page.once('dialog', (d) => d.accept('示例微调模板'));
  await page.getByRole('button', { name: '存为新模板' }).click();
  await page.getByText('已保存并选用模板「示例微调模板」').waitFor();
  assert.equal(saves[0].source, 'materials');
  assert.equal(saves[0].detail_pt, 22);
  assert.equal(saves[0].name_align, 'left');
  assert.equal(saves[0].fields[0].prefix, '');

  // ③ 粘贴表格：表头上方有大标题，标题列应识别为「样品名称」（非首列）
  await page.getByRole('button', { name: '自定义批次' }).click();
  await page.getByRole('button', { name: '上传新批次' }).click();
  const pasted = ['示例样品登记表', '序号\t样品名称\t日期\t浓度\t空列', '1\t样品A\t2026-10-01\t0.3\t', '2\t样品B\t2026-10-02\t12.5\t'].join('\n');
  await page.getByLabel('或粘贴表格（从 Excel / WPS 复制）').fill(pasted);
  await page.getByRole('button', { name: '识别' }).click();
  await page.getByText('识别到 2 行').waitFor();
  const pv = uploads.at(-1).preview;
  assert.equal(pv.header_row, 1, '应跳过大标题行');
  assert.deepEqual(pv.columns.map((c) => c.name), ['序号', '样品名称', '日期', '浓度'], '全空列应去掉');
  assert.equal(pv.title_col, 1, '标题列应按列名挑中「样品名称」');
  await page.screenshot({ path: join(evidence, 'upload-paste-preview.png'), fullPage: true });
  // 去掉「序号」列、把「浓度」改名后导入
  await page.locator('th').filter({ has: page.getByLabel('第 1 列名称') }).getByRole('checkbox').uncheck();
  await page.getByLabel('第 4 列名称').fill('浓度 ng/uL');
  await page.getByRole('button', { name: '确认导入' }).click();
  await page.getByText(/导入成功，共 2 条/).waitFor();
  const commit = uploads.at(-1);
  assert.equal(commit.mode, 'commit');
  assert.deepEqual(commit.headers, ['样品名称', '日期', '浓度 ng/uL'], '标题列应排第一、去掉的列不入库、改名生效');
  await page.getByText('样品A', { exact: true }).first().waitFor();

  // ④ xlsx 多工作表：可切换工作表
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet('说明').addRows([['示例说明'], ['仅用于检查']]);
  const ws = wb.addWorksheet('样品');
  ws.addRows([['名称', '冻存日期', '管数'], ['样品C', new Date(Date.UTC(2026, 9, 3)), 0.1 + 0.2]]);
  const xlsx = join(stage, '示例批次.xlsx');
  await writeFile(xlsx, Buffer.from(await wb.xlsx.writeBuffer()));
  await page.getByRole('button', { name: '上传新批次' }).click();
  await page.getByLabel('选择文件（最多 20 MB）').setInputFiles(xlsx);
  await page.getByRole('button', { name: '识别' }).click();
  await page.getByLabel('工作表').waitFor({ timeout: 8000 }).catch(async (e) => { await page.screenshot({ path: join(evidence, 'xlsx-fail.png'), fullPage: true }); console.error('页面错误：', await page.locator('.error').allInnerTexts(), uploads.at(-1)?.preview); throw e; });
  await page.getByLabel('工作表').selectOption('样品');
  await page.getByText('识别到 1 行').waitFor();
  const xv = uploads.at(-1).preview;
  assert.equal(xv.sheet, '样品');
  assert.equal(xv.rows_preview[0][1], '2026-10-03', 'Excel 日期应转为 YYYY-MM-DD');
  assert.equal(xv.rows_preview[0][2], '0.3', 'Excel 数字的浮点尾巴应去掉');
  assert.equal(await page.getByLabel('批次名').inputValue(), '示例批次-样品');
  await page.screenshot({ path: join(evidence, 'upload-xlsx-preview.png'), fullPage: true });

  console.log(JSON.stringify({
    status: 'passed',
    checks: ['未微调不带覆盖', '改字号自动重新预览', '名称/字段对齐', '打印沿用微调', '恢复默认', '管理员存为新模板', '粘贴识别表头与标题列', '去全空列', '列保留/改名/标题列置首', 'xlsx 多工作表切换', 'Excel 日期与数字规范化'],
    screenshots: evidence,
  }));
} finally {
  await browser?.close();
  if (server) await new Promise((r) => server.close(r));
  await rm(stage, { recursive: true, force: true });
}
