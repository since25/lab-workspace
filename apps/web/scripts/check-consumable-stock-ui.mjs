// 实际 React 页面配虚构 API；检查常用耗材槽位页与核对工作台的交互，不连接工作台数据库。
import { build } from 'esbuild';
import { chromium } from '../../oa-export/node_modules/playwright-core/index.mjs';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const web = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repo = resolve(web, '../..');
const stage = await mkdtemp(join(tmpdir(), 'consumable-stock-ui-'));
const output = resolve(repo, 'tmp/consumable-stock-ui-check');
const linkStub = {
  name: 'test-link',
  setup(build) {
    build.onResolve({ filter: /^next\/link$/ }, () => ({ path: 'link', namespace: 'test-link' }));
    build.onLoad(
      { filter: /.*/, namespace: 'test-link' },
      () => ({ contents: "import React from 'react';export default function Link(p){return React.createElement('a',p,p.children)}", resolveDir: web })
    );
  },
};
const navStub = {
  name: 'test-navigation',
  setup(build) {
    build.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: 'navigation', namespace: 'test-navigation' }));
    build.onLoad(
      { filter: /.*/, namespace: 'test-navigation' },
      () => ({ contents: "export function usePathname(){return new URLSearchParams(location.search).get('path') || location.pathname}export function useSearchParams(){return new URLSearchParams(location.search)}", resolveDir: web })
    );
  },
};

async function bundle(name, contents, resolveDir) {
  await build({
    stdin: { contents, loader: 'tsx', resolveDir },
    bundle: true,
    platform: 'browser',
    outfile: join(stage, `${name}.js`),
    tsconfig: join(web, 'tsconfig.json'),
    define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [linkStub, navStub],
  });
}

let browser, server;
try {
  const stockDir = join(web, 'src/app/(app)/materials/stock');
  // 改动前的页面取自 HEAD，用旧接口形状的虚构数据渲染，用于前后对比截图。
  const beforeSource = execFileSync('git', ['show', 'HEAD:apps/web/src/app/(app)/materials/stock/page.tsx'], { cwd: repo, encoding: 'utf8' });
  await bundle('before-stock', `${beforeSource}
import { createRoot } from 'react-dom/client';
import '../../../globals.css';
createRoot(document.getElementById('root')).render(<main><ConsumableStockPage/></main>);`, stockDir);
  await bundle('stock', `import { createRoot } from 'react-dom/client';
import Page from './page.tsx';
import '../../../globals.css';
createRoot(document.getElementById('root')).render(<main><Page/></main>);`, stockDir);

  await bundle('review', `import { createRoot } from 'react-dom/client';
import Page from './review/page.tsx';
import '../../../globals.css';
createRoot(document.getElementById('root')).render(<main><Page/></main>);`, stockDir);

  const routes = { '/before-stock': 'before-stock', '/materials/stock': 'stock', '/materials/stock/review': 'review' };
  server = createServer(async (req, res) => {
    const name = routes[new URL(req.url, 'http://localhost').pathname];
    if (req.url.startsWith('/js/') || req.url.startsWith('/css/')) {
      res.setHeader('Content-Type', req.url.endsWith('.js') ? 'text/javascript' : 'text/css');
      res.end(await readFile(join(stage, req.url.replace(/^\/(js|css)\//, ''))));
    } else if (name) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>耗材库存交互检查</title>
        <link rel="stylesheet" href="/css/${name}.css"></head><body><div id="root"></div><script src="/js/${name}.js"></script></body></html>`);
    } else {
      res.statusCode = 404;
      res.end('not found');
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  let role = 'member';
  let nextId = 100;
  const stamp = '2026-10-18T02:00:00Z';
  const old = '2026-08-01T02:00:00Z';
  const categoryNames = ['细胞耗材/细胞培养板', '细胞耗材/培养皿', '塑料耗材/吸头', '塑料耗材/离心管', '通用耗材/手套', '培养基/基础培养基', '培养基/添加物', '常用试剂/单品', '其他'];
  const groupOf = (c) => c.split('/')[0];
  const groupNames = [...new Set(categoryNames.map(groupOf))];
  const slot = (id, category, item_name, unit, extra = {}) => ({
    id, category, item_name, brand: '', spec_model: '', unit, quantity: 0, note: '', last_checked_at: null, checked_by_name: null,
    updated_at: stamp, revision: 0, status: 'stale', stale: true, slot_key: `example-${id}`, baseline_at: null, skus: [],
    monthly_usage: null, usage_basis: null, last_purchase: null, pending_inbound: 0, ...extra,
  });
  let items = [
    slot(1, '细胞耗材/细胞培养板', '24孔板 TC', '箱', { quantity: 0, last_checked_at: stamp, baseline_at: old, checked_by_name: '示例管理员', revision: 2, status: 'out', stale: false,
      skus: [{ item_name: '24孔细胞培养板，平底，TC', brand: '示例品牌甲', spec_model: 'EXAMPLE-P24' }, { item_name: '24孔板', brand: '示例品牌乙', spec_model: 'EXAMPLE-Q24' }],
      monthly_usage: 1.2, usage_basis: 'checks', last_purchase: { on: '2026-09-01', quantity: 2, unit: '箱' } }),
    slot(2, '细胞耗材/细胞培养板', '48孔板 TC', '箱'),
    slot(3, '塑料耗材/吸头', '200µL 滤芯吸头', '箱', { quantity: 3, last_checked_at: stamp, baseline_at: old, checked_by_name: '示例管理员', revision: 1, status: 'ok', stale: false,
      skus: [{ item_name: '200ul吸头滤芯', brand: '示例品牌甲', spec_model: 'EXAMPLE-TF200' }], monthly_usage: 0.8, usage_basis: 'purchases',
      last_purchase: { on: '2026-10-10', quantity: 2, unit: '箱' }, pending_inbound: 1 }),
    slot(4, '塑料耗材/离心管', '1.5mL 离心管', '箱'),
    slot(5, '培养基/基础培养基', 'DMEM 高糖', '瓶', { quantity: 12, last_checked_at: old, baseline_at: old, checked_by_name: '示例管理员', revision: 3, status: 'stale' }),
    slot(6, '常用试剂/单品', 'QuickExtract DNA 提取液', '瓶', { brand: 'Lucigen', quantity: 2, last_checked_at: stamp, baseline_at: stamp, status: 'ok', stale: false }),
  ];
  const checks = [
    { id: 3, stock_id: 3, before_qty: 1, after_qty: 3, note: '入库：EXAMPLE-REQ-9 200ul吸头滤芯', checked_at: stamp, checked_by_name: '示例管理员', kind: 'inbound' },
    { id: 2, stock_id: 3, before_qty: 4, after_qty: 1, note: '月度盘点', checked_at: '2026-10-01T02:00:00Z', checked_by_name: '示例管理员', kind: 'check' },
    { id: 1, stock_id: 3, before_qty: 0, after_qty: 4, note: '建立基线', checked_at: old, checked_by_name: '示例管理员', kind: 'check' },
  ];
  const link = (material_id, state, confidence, stock_id, item_name, extra = {}) => {
    const s = items.find((i) => i.id === stock_id);
    return {
      material_id, state, confidence, stock_id, slot_label: s ? `${s.category} · ${s.item_name}` : '', slot_unit: s?.unit ?? '',
      item_name, brand: '示例品牌甲', spec_model: `EXAMPLE-${material_id}`, unit: '箱', quantity: 2, request_no: `EXAMPLE-REQ-${material_id}`,
      minor_category: '耗材', requested_on: '2026-10-10', last_received_on: null, receipt_status: '未收货', applied_qty: null,
      decided_by_name: null, decided_at: null, ...extra,
    };
  };
  let links = [
    link(11, 'pending', 'high', 1, '24孔细胞培养板，平底，TC'),
    link(12, 'pending', 'high', 1, '24孔细胞培养板 透明盖'),
    link(14, 'pending', 'low', 4, '示例 转染试剂 1.5ml', { minor_category: '生物试剂', unit: '盒' }),
    link(13, 'pending', 'mid', 5, 'DMEM 培养基', { unit: '瓶' }),
    link(21, 'confirmed', 'known', 3, '200ul吸头滤芯', { last_received_on: '2026-10-12', receipt_status: '全部收货' }),
    link(22, 'confirmed', 'known', 1, '24孔板', { unit: '包', quantity: 5 }),
  ];
  const inboundView = () => links.filter((l) => l.state === 'confirmed' && l.stock_id && items.find((i) => i.id === l.stock_id)?.baseline_at);
  const counts = () => ({ pending: links.filter((l) => l.state === 'pending').length, inbound: inboundView().length });
  // 改动前页面（HEAD）用的接口形状：按货号的条目、品牌/规格列、参考消耗与最近采购。
  const legacyItems = [
    { id: 1, category: '塑料耗材/吸头', item_name: '200ul吸头滤芯低吸附盒装灭菌', brand: '示例品牌甲', spec_model: 'EXAMPLE-TF200', unit: '箱', quantity: 0, note: '由采购记录生成，待首次核对', last_checked_at: null, checked_by_name: null, updated_at: stamp, revision: 0, status: 'stale', stale: true, monthly_usage: null, last_purchase: { on: '2026-06-01', quantity: 2, unit: '箱' } },
    { id: 2, category: '塑料耗材/吸头', item_name: '200μl 叠装短吸头', brand: '示例品牌乙', spec_model: 'EXAMPLE-T200', unit: '箱', quantity: 0, note: '由采购记录生成，待首次核对', last_checked_at: null, checked_by_name: null, updated_at: stamp, revision: 0, status: 'stale', stale: true, monthly_usage: 0.5, last_purchase: { on: '2026-06-01', quantity: 2, unit: '箱' } },
    { id: 3, category: '塑料耗材/培养板皿', item_name: '24孔细胞培养板，平底，TC', brand: '示例品牌甲', spec_model: 'EXAMPLE-P24', unit: '箱', quantity: 0, note: '由采购记录生成，待首次核对', last_checked_at: null, checked_by_name: null, updated_at: stamp, revision: 0, status: 'stale', stale: true, monthly_usage: null, last_purchase: null },
  ];
  const legacySummary = { item_count: 3, out_count: 0, stale_count: 3, last_checked_at: null };
  const legacy = {
    groups: ['普通用品', '塑料耗材', '生物试剂', '试剂盒', '其他'].map((name) => ({ name, ...(name === '塑料耗材' ? legacySummary : { item_count: 0, out_count: 0, stale_count: 0, last_checked_at: null }) })),
    categories: [{ name: '塑料耗材/吸头', item_count: 2, out_count: 0, stale_count: 2, last_checked_at: null }, { name: '塑料耗材/培养板皿', item_count: 1, out_count: 0, stale_count: 1, last_checked_at: null }],
    items: legacyItems, summary: legacySummary, stale_days: 30,
  };

  const summarize = (list) => ({
    item_count: list.length,
    out_count: list.filter((i) => i.status === 'out').length,
    stale_count: list.filter((i) => i.status === 'stale').length,
    last_checked_at: list.map((i) => i.last_checked_at).filter(Boolean).sort().at(-1) ?? null,
  });
  const linkRequests = [];

  await context.route('**/api/v1/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const legacyPage = new URL(page.url()).pathname === '/before-stock';
    let result, status = 200;
    if (url.pathname === '/api/v1/auth/me') result = { user: { role } };
    else if (url.pathname === '/api/v1/materials/stock' && req.method() === 'GET' && legacyPage) result = legacy;
    else if (url.pathname === '/api/v1/materials/stock' && req.method() === 'GET') {
      const category = url.searchParams.get('category') || '';
      const statusFilter = url.searchParams.get('status') || '';
      const q = url.searchParams.get('q') || '';
      const searched = items.filter((i) => !q || [i.item_name, i.brand, i.spec_model, i.note].join(' ').includes(q));
      const scoped = searched.filter((i) => !category || i.category === category || groupOf(i.category) === category);
      const visible = scoped.filter((i) => !statusFilter || i.status === statusFilter);
      result = {
        groups: groupNames.map((name) => ({ name, ...summarize(searched.filter((i) => groupOf(i.category) === name)) })),
        categories: categoryNames.map((name) => ({ name, ...summarize(searched.filter((i) => i.category === name)) })),
        items: visible, summary: summarize(searched), stale_days: 30, review: counts(),
      };
    } else if (url.pathname === '/api/v1/materials/stock' && req.method() === 'POST') {
      const body = req.postDataJSON();
      const counted = body.quantity !== undefined && body.quantity !== null && body.quantity !== '';
      const item = slot(nextId++, body.category, body.item_name, body.unit || '', {
        brand: body.brand || '', spec_model: body.spec_model || '', note: body.note || '', slot_key: null,
        quantity: counted ? Number(body.quantity) : 0, last_checked_at: counted ? new Date().toISOString() : null,
      });
      items.push(item);
      status = 201;
      result = item;
    } else if (url.pathname === '/api/v1/materials/stock/templates') {
      result = { templates: 58, created: 52, skipped: 6 };
    } else if (url.pathname === '/api/v1/materials/stock/sync') {
      result = { scanned: 886, suggested: 190, known: 0, excluded: 0, unmatched: 696 };
    } else if (url.pathname === '/api/v1/materials/stock/links') {
      const view = url.searchParams.get('view');
      const rows = view === 'pending' ? links.filter((l) => l.state === 'pending') : view === 'inbound' ? inboundView() : links.filter((l) => ['stocked', 'skipped', 'excluded'].includes(l.state));
      result = { view, items: rows, counts: counts(), slots: items.map(({ id, category, item_name, unit }) => ({ id, category, item_name, unit })) };
    } else if (/\/materials\/stock\/links\/\d+$/.test(url.pathname)) {
      const id = Number(url.pathname.split('/').at(-1));
      const body = req.postDataJSON();
      linkRequests.push([id, body]);
      const row = links.find((l) => l.material_id === id);
      if (body.action === 'confirm') {
        // 同货号（示例里 11 和 12 视为同一货号）一并归入。
        const same = id === 11 ? [11, 12] : [id];
        for (const l of links.filter((x) => same.includes(x.material_id))) Object.assign(l, { state: 'confirmed', stock_id: body.stock_id });
        result = { updated: same.length };
      } else if (body.action === 'exclude') { row.state = 'excluded'; row.stock_id = null; row.slot_label = ''; result = { updated: 1 }; }
      else if (body.action === 'stock') {
        const s = items.find((i) => i.id === row.stock_id);
        s.quantity += Number(body.quantity ?? row.quantity);
        s.pending_inbound = Math.max(0, s.pending_inbound - 1);
        Object.assign(row, { state: 'stocked', applied_qty: Number(body.quantity ?? row.quantity), decided_by_name: '示例管理员', decided_at: new Date().toISOString() });
        result = { updated: 1, stock: s };
      } else { Object.assign(row, { state: 'skipped', decided_by_name: '示例管理员', decided_at: new Date().toISOString() }); result = { updated: 1 }; }
    } else if (/\/materials\/stock\/\d+\/check$/.test(url.pathname)) {
      const id = Number(url.pathname.split('/').at(-2));
      const item = items.find((i) => i.id === id);
      const body = req.postDataJSON();
      assert.equal(body.expected_revision, item.revision, '核对请求应带当前 revision');
      const before = item.quantity;
      item.quantity = Number(body.quantity);
      item.revision += 1;
      item.status = item.quantity <= 0 ? 'out' : 'ok';
      item.stale = false;
      item.last_checked_at = new Date().toISOString();
      item.baseline_at ??= item.last_checked_at;
      item.checked_by_name = '示例管理员';
      checks.unshift({ id: checks.length + 1, stock_id: id, before_qty: before, after_qty: item.quantity, note: body.note || '', checked_at: item.last_checked_at, checked_by_name: '示例管理员', kind: 'check' });
      result = item;
    } else if (/\/materials\/stock\/\d+\/checks$/.test(url.pathname)) {
      const id = Number(url.pathname.split('/').at(-2));
      result = { items: checks.filter((c) => c.stock_id === id) };
    } else if (/\/materials\/stock\/\d+$/.test(url.pathname)) {
      const id = Number(url.pathname.split('/').at(-1));
      const index = items.findIndex((i) => i.id === id);
      if (req.method() === 'DELETE') { items = items.filter((i) => i.id !== id); result = { deleted: 1 }; }
      else { items[index] = { ...items[index], ...req.postDataJSON(), revision: items[index].revision + 1 }; result = items[index]; }
    } else throw new Error(`Unexpected fixture route: ${url.pathname}`);
    await route.fulfill({ status, json: result });
  });

  await mkdir(output, { recursive: true });
  role = 'admin';
  await page.goto(`${origin}/before-stock`);
  await page.locator('tbody tr').filter({ hasText: '200μl 叠装短吸头' }).waitFor();
  await page.screenshot({ path: join(output, 'before-stock.png'), fullPage: true });

  // 成员：只读，看得到待入库提示但没有管理按钮。
  role = 'member';
  await page.goto(`${origin}/materials/stock`);
  await page.getByRole('heading', { name: '常用耗材库存' }).waitFor();
  await page.locator('tbody tr').filter({ hasText: '200µL 滤芯吸头' }).waitFor();
  assert.equal(await page.locator('tbody tr').count(), 6);
  const tabs = (await page.locator('.tabs button').allTextContents()).map((t) => t.replace(/[\d⚠]+/g, '').trim());
  assert.deepEqual(tabs, ['全部', '细胞耗材', '塑料耗材', '通用耗材', '培养基', '常用试剂', '其他'], '标签卡应为全部 + 五大类 + 其他');
  const headers = (await page.locator('thead th').allTextContents()).map((t) => t.trim());
  assert.deepEqual(headers, ['类别', '槽位', '已挂货号', '单位', '当前库存', '状态', '最近核对', '消耗/月', '最近采购', '操作']);
  const statusOf = async (name) => (await page.locator('tbody tr').filter({ hasText: name }).locator('.stock-status').textContent()).trim();
  assert.equal(await statusOf('24孔板 TC'), '需采购');
  assert.equal(await statusOf('48孔板 TC'), '需复核');
  assert.equal(await statusOf('200µL 滤芯吸头'), '正常');
  assert.deepEqual(await page.locator('select').first().locator('option').allTextContents(), ['全部状态', '需采购', '需复核', '正常']);
  const plateRow = page.locator('tbody tr').filter({ hasText: '24孔板 TC' });
  assert.equal((await plateRow.locator('td').nth(2).locator('summary').textContent()).trim(), '2 个');
  await plateRow.locator('summary').click();
  await plateRow.getByText('示例品牌乙 EXAMPLE-Q24').waitFor();
  assert.equal((await plateRow.locator('td').nth(7).textContent()).trim(), '1.2 箱', '盘点得出的消耗不带 *');
  assert.match(await plateRow.locator('td').nth(6).textContent(), /基线/);
  const tipRow = page.locator('tbody tr').filter({ hasText: '200µL 滤芯吸头' });
  assert.equal((await tipRow.locator('td').nth(7).textContent()).trim(), '0.8 箱*', '采购估算的消耗带 *');
  assert.match(await tipRow.locator('td').nth(5).textContent(), /待入库 1/);
  assert.equal(await page.getByRole('button', { name: '建立槽位模板' }).count(), 0, '成员不应看到建模板');
  assert.equal(await page.getByRole('link', { name: /核对工作台/ }).count(), 0, '成员不应看到核对工作台入口');
  assert.equal(await page.getByRole('button', { name: '核对', exact: true }).count(), 0);
  await page.screenshot({ path: join(output, 'member-stock.png'), fullPage: true });

  await page.locator('.tabs button').filter({ hasText: '细胞耗材' }).click();
  await page.waitForFunction(() => document.querySelectorAll('tbody tr').length === 2);
  await page.screenshot({ path: join(output, 'tab-cell.png'), fullPage: true });
  await page.locator('.tabs button').filter({ hasText: '全部' }).click();
  await page.waitForFunction(() => document.querySelectorAll('tbody tr').length === 6);

  // 管理员：建模板、匹配采购、首次核对即基线、历史区分盘点/入库。
  role = 'admin';
  await page.reload();
  await page.getByRole('button', { name: '新增槽位', exact: true }).waitFor();
  await page.getByRole('link', { name: /核对工作台/ }).waitFor();
  assert.equal((await page.locator('a .badge').textContent()).trim(), '6', '工作台角标 = 待确认 + 待入库');
  await page.locator('tbody tr').filter({ hasText: '200µL 滤芯吸头' }).waitFor();
  await page.screenshot({ path: join(output, 'admin-stock.png'), fullPage: true });
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: '建立槽位模板' }).click();
  await page.getByRole('status').filter({ hasText: '新建 52 个' }).waitFor();
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: '匹配采购记录' }).click();
  await page.getByRole('status').filter({ hasText: '待确认 190 条' }).waitFor();

  const emptyRow = page.locator('tbody tr').filter({ hasText: '48孔板 TC' });
  await emptyRow.getByRole('button', { name: '核对', exact: true }).click();
  await page.getByRole('heading', { name: '核对库存：48孔板 TC' }).waitFor();
  await page.getByText('将作为基线').waitFor();
  await page.getByLabel('实际数量').fill('2');
  await page.getByRole('button', { name: '保存核对' }).click();
  await page.getByRole('status').filter({ hasText: '已核对' }).waitFor();
  await page.waitForFunction(() => {
    const row = [...document.querySelectorAll('tbody tr')].find((r) => r.textContent?.includes('48孔板 TC'));
    return row?.querySelectorAll('td')[4]?.textContent?.trim() === '2' && row.textContent.includes('基线');
  });
  await tipRow.getByRole('button', { name: '历史', exact: true }).click();
  await page.getByRole('heading', { name: '核对历史：200µL 滤芯吸头' }).waitFor();
  await page.locator('.dialog tbody tr').filter({ hasText: '月度盘点' }).waitFor();
  assert.deepEqual(await page.locator('.dialog tbody tr td:nth-child(2)').allTextContents(), ['入库', '盘点', '盘点']);
  await page.getByRole('button', { name: '关闭' }).click();

  await page.getByRole('button', { name: '新增槽位', exact: true }).click();
  await page.getByRole('heading', { name: '新增槽位', exact: true }).waitFor();
  await page.locator('.dialog select').selectOption('常用试剂/单品');
  await page.getByLabel('槽位名称').fill('示例单品试剂');
  await page.getByLabel('单位（按采购单位，如箱）').fill('盒');
  await page.screenshot({ path: join(output, 'admin-create.png'), fullPage: true });
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByRole('status').filter({ hasText: '已新增槽位' }).waitFor();

  // 核对工作台：待确认（同货号一并确认、改归、排除）→ 待入库（入库、不加数）→ 已处理。
  await page.goto(`${origin}/materials/stock/review`);
  await page.getByRole('heading', { name: '核对工作台' }).waitFor();
  await page.locator('tbody tr').filter({ hasText: 'DMEM 培养基' }).waitFor();
  assert.deepEqual(await page.locator('tr.stock-group td').allTextContents(), ['细胞耗材/细胞培养板 · 24孔板 TC　按 箱 计', '塑料耗材/离心管 · 1.5mL 离心管　按 箱 计', '培养基/基础培养基 · DMEM 高糖　按 瓶 计']);
  const confidence = async (name) => (await page.locator('tbody tr').filter({ hasText: name }).locator('.stock-status').textContent()).trim();
  assert.equal(await confidence('DMEM 培养基'), '中');
  assert.equal(await confidence('示例 转染试剂'), '低');
  await page.screenshot({ path: join(output, 'review-pending.png'), fullPage: true });
  await page.locator('tbody tr').filter({ hasText: '24孔细胞培养板，平底，TC' }).getByRole('button', { name: '确认' }).click();
  await page.getByRole('status').filter({ hasText: '同货号另外 1 条一并处理' }).waitFor();
  const dmem = page.locator('tbody tr').filter({ hasText: 'DMEM 培养基' });
  await dmem.locator('select').selectOption({ label: 'DMEM 高糖（瓶）' });
  await dmem.getByRole('button', { name: '确认' }).click();
  await page.getByRole('status').filter({ hasText: '已确认归属：DMEM 培养基' }).waitFor();
  await page.locator('tbody tr').filter({ hasText: '示例 转染试剂' }).getByRole('button', { name: '排除' }).click();
  await page.getByText('没有待确认的采购记录').waitFor();

  await page.locator('.tabs button').filter({ hasText: '待入库' }).click();
  const inboundTip = page.locator('tbody tr').filter({ hasText: '200ul吸头滤芯' });
  await inboundTip.waitFor();
  const odd = page.locator('tbody tr').filter({ hasText: 'EXAMPLE-22' });
  assert.match(await odd.textContent(), /≠ 槽位单位 箱/, '采购单位与槽位不同要提示');
  await page.screenshot({ path: join(output, 'review-inbound.png'), fullPage: true });
  await inboundTip.locator('input').fill('3');
  await inboundTip.getByRole('button', { name: '入库' }).click();
  await page.getByRole('status').filter({ hasText: '已入库' }).waitFor();
  await odd.getByRole('button', { name: '不加数' }).click();
  await page.getByRole('status').filter({ hasText: '已标记不加数' }).waitFor();
  await page.locator('.tabs button').filter({ hasText: '已处理' }).click();
  await page.locator('tbody tr').filter({ hasText: '已入库' }).waitFor();
  await page.screenshot({ path: join(output, 'review-done.png'), fullPage: true });
  assert.deepEqual(linkRequests.map(([id, b]) => [id, b.action, b.stock_id ?? b.quantity ?? null]), [
    [11, 'confirm', 1], [13, 'confirm', 5], [14, 'exclude', null], [21, 'stock', '3'], [22, 'skip', null],
  ]);

  assert.deepEqual(errors, []);
  console.log(JSON.stringify({
    status: 'passed',
    checks: ['改动前截图（HEAD 页面）', '标签卡为全部+五大类+其他', '槽位列与已挂货号展开', '需采购/需复核/正常与筛选项', '消耗/月区分盘点与采购估算', '待入库提示', '成员只读无工作台入口',
      '建立槽位模板与匹配采购', '首次核对成为基线', '历史区分盘点与入库', '新增单品槽位', '工作台按槽位分组与把握', '同货号一并确认、改归、排除', '入库改数量、单位不符提示、不加数', '已处理列表'],
    screenshots: output,
  }));
} finally {
  await browser?.close();
  if (server) await new Promise((r) => server.close(r));
  await rm(stage, { recursive: true, force: true });
}
