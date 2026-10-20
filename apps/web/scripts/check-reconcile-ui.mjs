// 实际 React 页面配虚构 API；检查管理员审批库存校对请求的交互。
import { build } from 'esbuild';
import { chromium } from '../../oa-export/node_modules/playwright-core/index.mjs';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const web = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repo = resolve(web, '../..');
const stage = await mkdtemp(join(tmpdir(), 'reconcile-ui-'));
const output = resolve(repo, 'tmp/reconcile-ui-check');

let browser, server;
try {
  const pageDir = join(web, 'src/app/(app)/admin/materials/reconcile');
  await build({
    stdin: {
      contents: `import { createRoot } from 'react-dom/client';
import Page from './page.tsx';
import '../../../../globals.css';
createRoot(document.getElementById('root')).render(<main><Page/></main>);`,
      loader: 'tsx', resolveDir: pageDir,
    },
    bundle: true, platform: 'browser', outfile: join(stage, 'app.js'), tsconfig: join(web, 'tsconfig.json'),
    define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [{
      name: 'test-link', setup(b) {
        b.onResolve({ filter: /^next\/link$/ }, () => ({ path: 'link', namespace: 'test-link' }));
        b.onLoad({ filter: /.*/, namespace: 'test-link' }, () => ({
          contents: "import React from 'react';export default function Link(p){return React.createElement('a',p,p.children)}", resolveDir: web,
        }));
      },
    }],
  });
  server = createServer(async (req, res) => {
    if (req.url === '/app.js' || req.url === '/app.css') {
      res.setHeader('Content-Type', req.url.endsWith('.js') ? 'text/javascript' : 'text/css');
      res.end(await readFile(join(stage, req.url.slice(1))));
    } else {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end('<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>库存校对审批检查</title><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>');
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  let posts = [];

  const material = (id, name, used = false) => ({
    id, item_name: name, brand: '示例品牌', spec_model: 'EXAMPLE-24W', material_code: `EXAMPLE-M-${id}`,
    request_no: `EXAMPLE-REQ-${id}`, department: '示例部门甲', requested_on: '2026-09-01', last_received_on: null,
    receipt_status: '未收货', purchased_qty: 2, received_qty: 0, is_used_up: used, used_up_requested_at: null,
  });
  let requests = [
    {
      id: 1, stock_id: 1, stock_label: '细胞培养板 · 24 孔板 · 示例品牌 · EXAMPLE-24W', stock_before: 2, stock_revision: 0,
      proposed_quantity: 0, material_ids: [11, 12], note: '24 孔板已用完', status: 'pending', requested_by_name: '示例成员',
      requested_at: '2026-10-20T02:00:00Z', reviewed_by_name: null, reviewed_at: null, review_note: '',
      current_quantity: 2, current_revision: 0, stock_changed: false, materials: [material(11, '24 孔板'), material(12, '24 孔板', true)],
    },
    {
      id: 2, stock_id: 2, stock_label: '吸头 · 200ul 滤芯吸头 · 示例品牌 · EXAMPLE-TIP', stock_before: 10, stock_revision: 1,
      proposed_quantity: 0, material_ids: [13], note: '吸头用完', status: 'pending', requested_by_name: '示例成员乙',
      requested_at: '2026-10-20T01:00:00Z', reviewed_by_name: null, reviewed_at: null, review_note: '',
      current_quantity: 6, current_revision: 2, stock_changed: true, materials: [material(13, '200ul 滤芯吸头')],
    },
    {
      id: 3, stock_id: 3, stock_label: '培养基 · DMEM · 示例品牌 · EXAMPLE-DMEM', stock_before: 5, stock_revision: 0,
      proposed_quantity: 3, material_ids: [], note: '盘点', status: 'approved', requested_by_name: '示例成员',
      requested_at: '2026-10-19T02:00:00Z', reviewed_by_name: '示例管理员', reviewed_at: '2026-10-19T03:00:00Z', review_note: '同意',
      current_quantity: 3, current_revision: 1, stock_changed: false, materials: [],
    },
  ];

  await context.route('**/api/v1/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    let result, status = 200;
    if (url.pathname === '/api/v1/admin/materials/reconcile') {
      if (req.method() === 'POST') {
        const body = req.postDataJSON();
        posts.push(body);
        for (const item of requests.filter((r) => body.ids.includes(r.id))) {
          item.status = body.action === 'approve' ? 'approved' : 'rejected';
          item.reviewed_by_name = '示例管理员';
          item.reviewed_at = new Date().toISOString();
          item.review_note = body.note || '';
        }
        result = { approved: body.action === 'approve' ? 1 : 0, rejected: body.action === 'reject' ? 1 : 0, skipped: 0 };
      } else {
        const statusFilter = url.searchParams.get('status') || 'all';
        const visible = statusFilter === 'all' ? requests : requests.filter((r) => r.status === statusFilter);
        result = { items: visible, total: visible.length, page: 1, page_size: 50 };
      }
    } else throw new Error(`Unexpected fixture route: ${url.pathname}`);
    await route.fulfill({ status, json: result });
  });

  await mkdir(output, { recursive: true });
  await page.goto(origin);
  await page.getByRole('heading', { name: '库存校对请求' }).waitFor();
  await page.locator('tbody tr').filter({ hasText: '24 孔板已用完' }).waitFor();
  assert.equal(await page.getByRole('button', { name: '批准', exact: true }).count(), 2);
  const changedRow = page.locator('tbody tr').filter({ hasText: '吸头用完' });
  assert.equal(await changedRow.getByRole('button', { name: '批准', exact: true }).isDisabled(), true, '库存变化的请求不能直接批准');
  await page.screenshot({ path: join(output, 'admin-reconcile.png'), fullPage: true });

  const firstRow = page.locator('tbody tr').filter({ hasText: '24 孔板已用完' });
  page.once('dialog', (d) => d.accept());
  await firstRow.getByRole('button', { name: '批准', exact: true }).click();
  await page.getByRole('status').filter({ hasText: '已批准' }).waitFor();
  assert.deepEqual(posts[0], { ids: [1], action: 'approve', note: '' });
  await page.getByRole('status').filter({ hasText: '已批准' }).waitFor();
  assert.equal(await firstRow.count(), 0, '批准后默认待审批列表不再显示该条');

  page.once('dialog', (d) => d.accept('数量不对'));
  await changedRow.getByRole('button', { name: '驳回', exact: true }).click();
  await page.getByRole('status').filter({ hasText: '已驳回' }).waitFor();
  assert.deepEqual(posts[1], { ids: [2], action: 'reject', note: '数量不对' });
  await page.screenshot({ path: join(output, 'admin-reconcile-done.png'), fullPage: true });

  await page.getByRole('button', { name: '全部', exact: true }).click();
  await page.locator('tbody tr').filter({ hasText: '24 孔板已用完' }).waitFor();
  assert.ok((await page.locator('tbody tr').filter({ hasText: '已批准' }).count()) >= 1);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ status: 'passed', checks: ['待审批列表', '库存变化禁止批准', '批准写回', '驳回原因', '全部状态'], screenshots: output }));
} finally {
  await browser?.close();
  if (server) await new Promise((r) => server.close(r));
  await rm(stage, { recursive: true, force: true });
}
