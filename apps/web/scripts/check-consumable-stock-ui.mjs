// 实际 React 页面配虚构 API；只检查新增的常用耗材库存交互，不连接工作台数据库。
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
      () => ({ contents: "export function usePathname(){return new URLSearchParams(location.search).get('path') || location.pathname}", resolveDir: web })
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
  const materialsDir = join(web, 'src/app/(app)/materials');
  const stockDir = join(materialsDir, 'stock');
  const beforeSource = execFileSync('git', ['show', 'HEAD:apps/web/src/app/(app)/materials/page.tsx'], { cwd: repo, encoding: 'utf8' });
  await bundle('before-materials', `${beforeSource}
import { createRoot } from 'react-dom/client';
import '../../globals.css';
createRoot(document.getElementById('root')).render(<main><MaterialsPage/></main>);`, materialsDir);
  await bundle('after-materials', `import { createRoot } from 'react-dom/client';
import Page from './page.tsx';
import '../../globals.css';
createRoot(document.getElementById('root')).render(<main><Page/></main>);`, materialsDir);
  await bundle('stock', `import { createRoot } from 'react-dom/client';
import Page from './page.tsx';
import '../../../globals.css';
createRoot(document.getElementById('root')).render(<main><Page/></main>);`, stockDir);
  const beforeTopBar = execFileSync('git', ['show', 'HEAD:apps/web/src/app/(app)/TopBar.tsx'], { cwd: repo, encoding: 'utf8' });
  const afterTopBar = await readFile(join(web, 'src/app/(app)/TopBar.tsx'), 'utf8');
  const topbarWrapper = `
import { createRoot } from 'react-dom/client';
import '../globals.css';
createRoot(document.getElementById('root')).render(<TopBar user={{ id: 1, username: 'example', display_name: '示例管理员', role: 'admin', freezer_view_all: false }}/>);`;
  await bundle('before-nav', `${beforeTopBar}${topbarWrapper}`, join(web, 'src/app/(app)'));
  await bundle('after-nav', `${afterTopBar}${topbarWrapper}`, join(web, 'src/app/(app)'));

  const routes = {
    '/before-materials': 'before-materials', '/materials': 'after-materials', '/materials/stock': 'stock',
    '/before-nav': 'before-nav', '/after-nav': 'after-nav',
  };
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
  let nextId = 5;
  const categoryNames = ['吸头', '细胞培养板', '移液管', '离心管', '培养基'];
  const stamp = '2026-10-18T02:00:00Z';
  let items = [
    { id: 1, category: '吸头', item_name: '200ul 滤芯吸头', brand: '示例品牌', spec_model: 'EXAMPLE-TIP-200', unit: '盒', quantity: 4, safety_stock: 10, note: '放在细胞房第二层', last_checked_at: stamp, checked_by_name: '示例管理员', updated_at: stamp, revision: 2, status: 'low', stale: false },
    { id: 2, category: '细胞培养板', item_name: 'T25 细胞培养板', brand: '示例品牌', spec_model: 'EXAMPLE-PLATE-25', unit: '箱', quantity: 0, safety_stock: 2, note: '', last_checked_at: stamp, checked_by_name: '示例管理员', updated_at: stamp, revision: 1, status: 'out', stale: false },
    { id: 3, category: '移液管', item_name: '10mL 移液管', brand: '示例品牌', spec_model: 'EXAMPLE-PIPETTE-10', unit: '包', quantity: 0, safety_stock: 3, note: '', last_checked_at: null, checked_by_name: null, updated_at: stamp, revision: 0, status: 'unchecked', stale: true },
    { id: 4, category: '培养基', item_name: 'DMEM 高糖培养基', brand: '示例品牌', spec_model: 'EXAMPLE-DMEM', unit: '瓶', quantity: 12, safety_stock: 5, note: '4℃ 保存', last_checked_at: stamp, checked_by_name: '示例管理员', updated_at: stamp, revision: 3, status: 'ok', stale: false },
  ];
  const checks = [
    { id: 2, stock_id: 1, before_qty: 10, after_qty: 4, note: '本周用掉 6 盒', checked_at: stamp, checked_by_name: '示例管理员' },
    { id: 1, stock_id: 1, before_qty: 0, after_qty: 10, note: '建立库存', checked_at: '2026-10-01T02:00:00Z', checked_by_name: '示例管理员' },
  ];
  const materialItems = [
    { id: 1, requested_on: '2026-01-01', requester: '示例成员', material_code: 'EXAMPLE-M-1', status: '启用', minor_category: '示例小类', item_name: '示例耗材甲', brand: '示例品牌', spec_model: 'EXAMPLE-SPEC', unit: '盒', quantity: '2', project_code: 'EXAMPLE-PRJ', remarks: '示例备注', receipt_status: '全部收货', last_received_on: '2026-01-02', received_qty: '2', is_used_up: false, used_up_requested_at: null },
    { id: 2, requested_on: '2026-01-01', requester: '示例成员', material_code: 'EXAMPLE-M-2', status: '启用', minor_category: '示例小类', item_name: '示例耗材乙', brand: '示例品牌', spec_model: 'EXAMPLE-SPEC', unit: '盒', quantity: '1', project_code: 'EXAMPLE-PRJ', remarks: '', receipt_status: '全部收货', last_received_on: '2026-01-02', received_qty: '1', is_used_up: true, used_up_requested_at: null },
  ];

  const summarize = (list) => ({
    item_count: list.length,
    unchecked_count: list.filter((i) => i.status === 'unchecked').length,
    out_count: list.filter((i) => i.status === 'out').length,
    low_count: list.filter((i) => i.status === 'low').length,
    stale_count: list.filter((i) => i.status !== 'unchecked' && i.stale).length,
    last_checked_at: list.map((i) => i.last_checked_at).filter(Boolean).sort().at(-1) ?? null,
  });

  await context.route('**/api/v1/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    let result, status = 200;
    if (url.pathname === '/api/v1/auth/me') result = { user: { role } };
    else if (url.pathname === '/api/v1/feedback/unread') result = { count: 0 };
    else if (url.pathname === '/api/v1/materials') {
      const used = url.searchParams.get('used_up') === '1';
      const visible = materialItems.filter((m) => m.is_used_up === used);
      result = {
        items: visible, total: visible.length, page: 1, page_size: 50, departments: ['示例部门甲', '示例部门乙'], pending_count: 0,
        facets: { category: ['示例小类'], status: ['启用'], receipt: ['全部收货'], brand: ['示例品牌'], requester: ['示例成员'] }, last_import: null,
      };
    } else if (url.pathname === '/api/v1/materials/stock' && req.method() === 'GET') {
      const category = url.searchParams.get('category') || '';
      const statusFilter = url.searchParams.get('status') || '';
      const q = url.searchParams.get('q') || '';
      const searched = items.filter((i) => !q || [i.item_name, i.brand, i.spec_model, i.note].join(' ').includes(q));
      const scoped = searched.filter((i) => !category || i.category === category);
      const visible = scoped.filter((i) => !statusFilter
        || (statusFilter === 'stale' ? i.status !== 'unchecked' && i.stale : i.status === statusFilter));
      result = {
        categories: categoryNames.map((name) => ({ name, ...summarize(searched.filter((i) => i.category === name)) })),
        items: visible, summary: summarize(searched), stale_days: 30,
      };
    } else if (url.pathname === '/api/v1/materials/stock' && req.method() === 'POST') {
      const body = req.postDataJSON();
      const counted = body.quantity !== undefined && body.quantity !== null && body.quantity !== '';
      const item = {
        id: nextId++, category: body.category, item_name: body.item_name, brand: body.brand || '', spec_model: body.spec_model || '',
        unit: body.unit || '', quantity: counted ? Number(body.quantity) : 0, safety_stock: Number(body.safety_stock || 0), note: body.note || '',
        last_checked_at: counted ? new Date().toISOString() : null, checked_by_name: counted ? '示例管理员' : null,
        updated_at: new Date().toISOString(), revision: 0,
      };
      item.status = !counted ? 'unchecked' : item.quantity <= 0 ? 'out' : item.safety_stock > 0 && item.quantity <= item.safety_stock ? 'low' : 'ok';
      item.stale = !counted;
      items.push(item);
      status = 201;
      result = item;
    } else if (url.pathname === '/api/v1/materials/stock/sync') {
      result = { scanned: 12, candidates: 6, created: 2, skipped: 4 };
    } else if (/\/materials\/stock\/\d+\/check$/.test(url.pathname)) {
      const id = Number(url.pathname.split('/').at(-2));
      const item = items.find((i) => i.id === id);
      const body = req.postDataJSON();
      assert.equal(body.expected_revision, item.revision, '核对请求应带当前 revision');
      const before = item.quantity;
      item.quantity = Number(body.quantity);
      item.revision += 1;
      item.status = item.quantity <= 0 ? 'out' : item.safety_stock > 0 && item.quantity <= item.safety_stock ? 'low' : 'ok';
      item.stale = false;
      item.last_checked_at = new Date().toISOString();
      item.checked_by_name = '示例管理员';
      item.updated_at = item.last_checked_at;
      checks.unshift({ id: checks.length + 1, stock_id: id, before_qty: before, after_qty: item.quantity, note: body.note || '', checked_at: item.last_checked_at, checked_by_name: '示例管理员' });
      result = item;
    } else if (/\/materials\/stock\/\d+\/checks$/.test(url.pathname)) {
      const id = Number(url.pathname.split('/').at(-2));
      result = { items: checks.filter((c) => c.stock_id === id) };
    } else if (/\/materials\/stock\/\d+$/.test(url.pathname)) {
      const id = Number(url.pathname.split('/').at(-1));
      const index = items.findIndex((i) => i.id === id);
      if (req.method() === 'DELETE') { items = items.filter((i) => i.id !== id); result = { deleted: 1 }; }
      else {
        const body = req.postDataJSON();
        items[index] = { ...items[index], ...body, safety_stock: Number(body.safety_stock ?? items[index].safety_stock), revision: items[index].revision + 1 };
        result = items[index];
      }
    } else throw new Error(`Unexpected fixture route: ${url.pathname}`);
    await route.fulfill({ status, json: result });
  });

  await mkdir(output, { recursive: true });
  await page.goto(`${origin}/before-materials`);
  await page.getByRole('heading', { name: '部门物料' }).waitFor();
  await page.locator('tbody tr').filter({ hasText: '示例耗材甲' }).waitFor();
  await page.screenshot({ path: join(output, 'before-materials.png'), fullPage: true });
  assert.equal(await page.getByText('常用耗材库存核对').count(), 0, '改动前的部门物料页不应有库存入口');

  await page.goto(`${origin}/materials`);
  await page.getByRole('heading', { name: '部门物料' }).waitFor();
  await page.locator('tbody tr').filter({ hasText: '示例耗材甲' }).waitFor();
  await page.screenshot({ path: join(output, 'after-materials.png'), fullPage: true });
  assert.equal(await page.getByRole('link', { name: '常用耗材库存核对', exact: true }).count(), 0, '入口应移到顶部选项卡');

  await page.goto(`${origin}/before-nav?path=/materials`);
  await page.locator('header.topbar').waitFor();
  assert.equal(await page.getByRole('link', { name: '常用耗材', exact: true }).count(), 0, '改动前导航不应有常用耗材');
  await page.locator('header.topbar').screenshot({ path: join(output, 'nav-before.png') });

  await page.goto(`${origin}/after-nav?path=/materials/stock`);
  await page.locator('header.topbar').waitFor();
  const stockTab = page.getByRole('link', { name: '常用耗材', exact: true });
  assert.equal(await stockTab.getAttribute('href'), '/materials/stock');
  assert.ok((await stockTab.getAttribute('class') ?? '').split(/\s+/).includes('active'), '常用耗材选项卡应高亮');
  assert.ok(!((await page.getByRole('link', { name: '部门物料', exact: true }).getAttribute('class') ?? '').split(/\s+/).includes('active')), '部门物料不应同时高亮');
  await page.locator('header.topbar').screenshot({ path: join(output, 'nav-after.png') });

  await page.goto(`${origin}/after-nav?path=/materials`);
  await page.locator('header.topbar').waitFor();
  assert.ok((await page.getByRole('link', { name: '部门物料', exact: true }).getAttribute('class') ?? '').split(/\s+/).includes('active'));
  assert.ok(!((await page.getByRole('link', { name: '常用耗材', exact: true }).getAttribute('class') ?? '').split(/\s+/).includes('active')));

  await page.goto(`${origin}/materials/stock`);
  await page.getByRole('heading', { name: '常用耗材库存' }).waitFor();
  await page.locator('tbody tr').filter({ hasText: '200ul 滤芯吸头' }).waitFor();
  assert.equal(await page.locator('tbody tr').count(), 4);
  assert.equal(await page.getByRole('button', { name: '新增耗材', exact: true }).count(), 0, '成员不应看到新增按钮');
  assert.equal(await page.getByRole('button', { name: '核对', exact: true }).count(), 0, '成员不应看到核对按钮');
  assert.equal(await page.getByRole('button', { name: '从采购记录生成候选', exact: true }).count(), 0);
  await page.screenshot({ path: join(output, 'member-stock.png'), fullPage: true });

  role = 'admin';
  await page.reload();
  await page.getByRole('button', { name: '新增耗材', exact: true }).waitFor();
  await page.locator('tbody tr').filter({ hasText: '200ul 滤芯吸头' }).waitFor();
  assert.equal(await page.getByRole('button', { name: '核对', exact: true }).count(), 4);
  await page.screenshot({ path: join(output, 'admin-stock.png'), fullPage: true });

  const tipRow = page.locator('tbody tr').filter({ hasText: '200ul 滤芯吸头' });
  await tipRow.getByRole('button', { name: '核对', exact: true }).click();
  await page.getByRole('heading', { name: '核对库存：200ul 滤芯吸头' }).waitFor();
  await page.getByLabel('实际数量').fill('6');
  await page.getByLabel('备注（领用、报损、盘点说明）').fill('周五盘点');
  await page.getByRole('button', { name: '保存核对' }).click();
  await page.getByRole('status').filter({ hasText: '已核对' }).waitFor();
  assert.equal(await page.getByText('周五盘点').count(), 0, '提交后弹窗应关闭');
  await page.waitForFunction(() => {
    const row = [...document.querySelectorAll('tbody tr')].find((r) => r.textContent?.includes('200ul 滤芯吸头'));
    return row?.querySelectorAll('td')[4]?.textContent?.trim() === '6';
  });
  await page.screenshot({ path: join(output, 'admin-checked.png'), fullPage: true });

  await page.getByRole('button', { name: '新增耗材', exact: true }).click();
  await page.getByRole('heading', { name: '新增耗材', exact: true }).waitFor();
  await page.getByLabel('名称', { exact: true }).fill('50mL 离心管');
  await page.getByLabel('品牌', { exact: true }).fill('示例品牌');
  await page.getByLabel('规格型号', { exact: true }).fill('EXAMPLE-TUBE-50');
  await page.getByLabel('单位', { exact: true }).fill('包');
  await page.getByLabel('安全库存', { exact: true }).fill('2');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByRole('status').filter({ hasText: '已新增耗材' }).waitFor();
  const newRow = page.locator('tbody tr').filter({ hasText: '50mL 离心管' });
  await newRow.waitFor();
  await newRow.getByText('待核对', { exact: true }).waitFor();

  await page.locator('tbody tr').filter({ hasText: '50mL 离心管' }).getByRole('button', { name: '历史', exact: true }).click();
  await page.getByRole('heading', { name: '核对历史：50mL 离心管' }).waitFor();
  await page.getByText('尚未核对过。', { exact: true }).waitFor();
  await page.screenshot({ path: join(output, 'admin-history.png'), fullPage: true });
  await page.getByRole('button', { name: '关闭', exact: true }).click();

  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: '从采购记录生成候选', exact: true }).click();
  await page.getByRole('status').filter({ hasText: '新增 2 条' }).waitFor();

  assert.deepEqual(errors, []);
  console.log(JSON.stringify({
    status: 'passed',
    checks: ['常用耗材移到独立顶部选项卡', '选项卡按最长路径高亮', '部门物料页不再重复入口', '成员只读', '按类别汇总与状态徽标', '管理员核对并保留备注', '新增耗材默认待核对', '核对历史空状态', '从采购记录生成候选'],
    screenshots: output,
  }));
} finally {
  await browser?.close();
  if (server) await new Promise((r) => server.close(r));
  await rm(stage, { recursive: true, force: true });
}
