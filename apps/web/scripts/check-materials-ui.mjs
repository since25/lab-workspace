// 实际 React 页面配虚构 API；只检查交互，不连接 OA 或工作台数据库。
import { build } from 'esbuild';
import { chromium } from '../../oa-export/node_modules/playwright-core/index.mjs';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const web = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const stage = await mkdtemp(join(tmpdir(), 'materials-ui-'));
const output = resolve(web, '../../tmp/materials-ui-check');
let browser, server;
try {
  await build({
    stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';
      import Materials from './src/app/(app)/materials/page.tsx';import Requests from './src/app/(app)/admin/materials/page.tsx';
      import './src/app/globals.css';const Page=location.pathname==='/admin/materials'?Requests:Materials;
      createRoot(document.getElementById('root')).render(<main><Page/></main>);`, loader: 'tsx', resolveDir: web },
    bundle: true, platform: 'browser', outfile: join(stage, 'app.js'), tsconfig: join(web, 'tsconfig.json'), define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [{ name: 'test-link', setup(b) {
      b.onResolve({ filter: /^next\/link$/ }, () => ({ path: 'link', namespace: 'test-link' }));
      b.onLoad({ filter: /.*/, namespace: 'test-link' }, () => ({ contents: "import React from 'react';export default function Link(p){return React.createElement('a',p,p.children)}", resolveDir: web }));
    } }],
  });
  server = createServer(async (req, res) => {
    if (req.url === '/app.js' || req.url === '/app.css') {
      res.setHeader('Content-Type', req.url.endsWith('.js') ? 'text/javascript' : 'text/css');
      res.end(await readFile(join(stage, req.url.slice(1))));
    } else {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end('<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>物料交互检查</title><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>');
    }
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  let role = 'member', posts = 0;
  const fixture = (id, name, used = false, pending = false) => ({
    id, item_name: name, requested_on: '2026-01-01', requester: '示例成员', department: '示例部门甲', request_no: `EXAMPLE-REQ-${id}`,
    material_code: `EXAMPLE-M-${id}`, status: '启用', minor_category: '示例小类', brand: '示例品牌', spec_model: 'EXAMPLE-SPEC', unit: '盒',
    quantity: '2', project_code: 'EXAMPLE-PRJ', remarks: '示例备注', receipt_status: '全部收货', last_received_on: '2026-01-02', received_qty: '2',
    is_used_up: used, used_up_requested_at: pending ? '2026-01-03T01:00:00Z' : null,
  });
  const items = [fixture(1, '示例耗材甲'), fixture(2, '示例耗材乙', true), fixture(3, '示例耗材丙', false, true)];
  await context.route('**/api/v1/**', async route => {
    const req = route.request(), url = new URL(req.url());
    let result;
    if (url.pathname === '/api/v1/auth/me') result = { user: { role } };
    else if (url.pathname === '/api/v1/materials') {
      const visible = items.filter(m => m.is_used_up === (url.searchParams.get('used_up') === '1'));
      result = { items: visible, total: visible.length, page: 1, page_size: 50, departments: ['示例部门甲', '示例部门乙'],
        pending_count: items.filter(m => !m.is_used_up && m.used_up_requested_at).length,
        facets: { category: ['示例小类'], status: ['启用'], receipt: ['全部收货'], brand: ['示例品牌'], requester: ['示例成员'] }, last_import: null };
    } else if (url.pathname === '/api/v1/admin/materials/usage-requests') {
      if (req.method() === 'POST') {
        const body = req.postDataJSON();
        for (const m of items.filter(m => body.ids.includes(m.id))) { if (body.action === 'approve') m.is_used_up = true; else m.used_up_requested_at = null; }
        result = { done: body.ids.length, skipped: 0 };
      } else { const pending = items.filter(m => !m.is_used_up && m.used_up_requested_at).map(m => ({ ...m, requested_by: '示例成员' }));
        result = { items: pending, total: pending.length, page: 1, page_size: 50 }; }
    } else if (/\/materials\/\d+\/usage$/.test(url.pathname)) {
      posts++;
      const m = items.find(m => m.id === Number(url.pathname.split('/').at(-2))), body = req.postDataJSON();
      if (role === 'member') { assert.equal(body.confirmed, true); m.used_up_requested_at = '2026-01-03T02:00:00Z'; }
      else if (body.action === 'restore') { m.is_used_up = false; m.used_up_requested_at = null; } else m.is_used_up = true;
      result = { done: 1, skipped: 0, pending: role === 'member' };
    } else throw new Error(`Unexpected fixture route: ${url.pathname}`);
    await route.fulfill({ json: result });
  });
  await page.goto(origin + '/materials');
  await page.getByRole('button', { name: '申请已用完', exact: true }).waitFor();
  assert.equal(await page.locator('thead th').count(), 10);
  assert.equal(await page.getByRole('button', { name: '复制采购信息' }).count(), 0);
  const materialRow = page.locator('tbody tr').filter({ hasText: '示例耗材甲' });
  const codeCell = materialRow.getByRole('cell').nth(9);
  const applyButton = codeCell.getByRole('button', { name: '申请已用完', exact: true });
  assert.equal(await applyButton.count(), 1);
  const codeBounds = await codeCell.getByText('EXAMPLE-M-1', { exact: true }).boundingBox();
  const actionBounds = await applyButton.boundingBox();
  assert.ok(actionBounds.y >= codeBounds.y + codeBounds.height, '申请按钮应位于物料编码下方');
  assert.equal(await materialRow.getByRole('cell').nth(1).getByRole('button').count(), 0);
  await mkdir(output, { recursive: true });
  await page.screenshot({ path: join(output, 'member-list.png'), fullPage: true });
  assert.equal(await page.locator('tbody tr').filter({ hasText: '示例耗材乙' }).count(), 0);
  page.once('dialog', d => d.dismiss());
  await page.getByRole('button', { name: '申请已用完', exact: true }).click();
  assert.equal(posts, 0);
  page.once('dialog', d => d.accept());
  await page.getByRole('button', { name: '申请已用完', exact: true }).click();
  await page.getByRole('status').filter({ hasText: '等待管理员批准' }).waitFor();
  assert.equal(await page.locator('tbody tr').filter({ hasText: '示例耗材甲' }).count(), 1);
  await page.getByLabel('仅显示已用完物料').check();
  await page.locator('tbody tr').filter({ hasText: '示例耗材乙' }).waitFor();
  assert.equal(await page.getByRole('button', { name: '恢复显示' }).count(), 0);
  assert.equal(await page.getByRole('button', { name: '复制采购信息' }).count(), 0);
  assert.equal(await page.locator('textarea').count(), 0);
  await page.screenshot({ path: join(output, 'member-used-up.png'), fullPage: true });
  role = 'admin';
  await page.goto(origin + '/admin/materials');
  await page.locator('tbody tr').filter({ hasText: '示例耗材甲' }).waitFor();
  await page.getByLabel('选择本页全部申请').check();
  await page.getByRole('button', { name: '批准所选（2）' }).waitFor();
  await page.screenshot({ path: join(output, 'admin-approval.png'), fullPage: true });
  await page.getByRole('button', { name: '批准所选（2）' }).click();
  await page.getByText('没有待批准的申请', { exact: true }).waitFor();
  assert.equal(items.filter(m => m.is_used_up).length, 3);
  await page.goto(origin + '/materials');
  await page.getByText('没有符合条件的记录', { exact: true }).waitFor();
  await page.getByLabel('仅显示已用完物料').check();
  await page.locator('tbody tr').filter({ hasText: '示例耗材甲' }).waitFor();
  const target = page.locator('tbody tr').filter({ hasText: '示例耗材甲' });
  await target.getByRole('cell').nth(9).getByRole('button', { name: '恢复显示' }).click();
  await page.getByRole('status').filter({ hasText: '已恢复显示' }).waitFor();
  await page.getByLabel('仅显示已用完物料').uncheck();
  await page.locator('tbody tr').filter({ hasText: '示例耗材甲' }).waitFor();
  await page.locator('tbody tr').filter({ hasText: '示例耗材甲' }).getByRole('cell').nth(9).getByRole('button', { name: '标记已用完', exact: true }).click();
  await page.getByText('没有符合条件的记录', { exact: true }).waitFor();
  await page.getByRole('button', { name: '导入采购导出（增量更新）' }).click();
  await page.getByText('新增采购记录、更新已有采购信息', { exact: false }).waitFor();
  assert.equal(await page.locator('thead th').count(), 10);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ status: 'passed', checks: ['10列不变', '无复制按钮或复制面板', '申请位于编码下方且名称无按钮', '取消确认不提交', '确认后待批仍显示', '成员无恢复按钮', '已用完查询', '批量批准', '管理员编码列恢复', '管理员编码列直接标记', '增量导入提示'], screenshots: output }));
} finally {
  await browser?.close();
  if (server) await new Promise(r => server.close(r));
  await rm(stage, { recursive: true, force: true });
}
