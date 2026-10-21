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

  const routes = { '/before-stock': 'before-stock', '/materials/stock': 'stock' };
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
  let nextId = 6;
  const categoryNames = [
    '普通用品/手套', '塑料耗材/吸头', '塑料耗材/培养板皿', '塑料耗材/PCR板连管封膜', '生物试剂/培养基', '生物试剂/转染', '试剂盒/检测试剂盒', '其他',
  ];
  const groupOf = (c) => c.split('/')[0];
  const groupNames = [...new Set(categoryNames.map(groupOf))];
  const stamp = '2026-10-18T02:00:00Z';
  const old = '2026-08-01T02:00:00Z';
  const base = { note: '', updated_at: stamp, monthly_usage: null, last_purchase: null };
  let items = [
    { ...base, id: 1, category: '塑料耗材/吸头', item_name: '200ul 滤芯吸头', brand: '示例品牌', spec_model: 'EXAMPLE-TIP-200', unit: '盒', quantity: 4, note: '放在细胞房第二层', last_checked_at: stamp, checked_by_name: '示例管理员', revision: 2, status: 'ok', stale: false, monthly_usage: 2.5, last_purchase: { on: '2026-09-01', quantity: 5, unit: '盒' } },
    { ...base, id: 2, category: '塑料耗材/培养板皿', item_name: '24孔细胞培养板', brand: '示例品牌', spec_model: 'EXAMPLE-PLATE-24', unit: '箱', quantity: 0, last_checked_at: stamp, checked_by_name: '示例管理员', revision: 1, status: 'out', stale: false, last_purchase: { on: '2026-06-20', quantity: 1, unit: '箱' } },
    { ...base, id: 3, category: '塑料耗材/PCR板连管封膜', item_name: '8连管', brand: '示例品牌', spec_model: 'EXAMPLE-STRIP', unit: '箱', quantity: 0, last_checked_at: null, checked_by_name: null, revision: 0, status: 'stale', stale: true },
    { ...base, id: 4, category: '生物试剂/培养基', item_name: 'DMEM 高糖培养基', brand: '示例品牌', spec_model: 'EXAMPLE-DMEM', unit: '瓶', quantity: 12, note: '4℃ 保存', last_checked_at: old, checked_by_name: '示例管理员', revision: 3, status: 'stale', stale: true, monthly_usage: 6, last_purchase: { on: '2026-08-15', quantity: 10, unit: '瓶' } },
    { ...base, id: 5, category: '试剂盒/检测试剂盒', item_name: '示例 ELISA 试剂盒', brand: '示例品牌', spec_model: 'EXAMPLE-EK 96T', unit: '盒', quantity: 2, last_checked_at: stamp, checked_by_name: '示例管理员', revision: 1, status: 'ok', stale: false },
  ];
  const checks = [
    { id: 2, stock_id: 1, before_qty: 10, after_qty: 4, note: '本周用掉 6 盒', checked_at: stamp, checked_by_name: '示例管理员' },
    { id: 1, stock_id: 1, before_qty: 0, after_qty: 10, note: '建立库存', checked_at: '2026-10-01T02:00:00Z', checked_by_name: '示例管理员' },
  ];
  // 改动前页面用的旧接口形状：五类、四种状态、安全库存。
  const legacy = {
    categories: ['吸头', '细胞培养板', '移液管', '离心管', '培养基'].map((name, i) => ({ name, item_count: [1, 1, 0, 0, 1][i], unchecked_count: 0, out_count: i === 1 ? 1 : 0, low_count: 0, stale_count: 0, last_checked_at: stamp })),
    items: [
      { id: 1, category: '吸头', item_name: '200ul 滤芯吸头', brand: '示例品牌', spec_model: 'EXAMPLE-TIP-200', unit: '盒', quantity: 4, safety_stock: 0, note: '放在细胞房第二层', last_checked_at: stamp, checked_by_name: '示例管理员', updated_at: stamp, revision: 2, status: 'ok', stale: false },
      { id: 2, category: '细胞培养板', item_name: '24孔细胞培养板', brand: '示例品牌', spec_model: 'EXAMPLE-PLATE-24', unit: '箱', quantity: 0, safety_stock: 0, note: '', last_checked_at: stamp, checked_by_name: '示例管理员', updated_at: stamp, revision: 1, status: 'out', stale: false },
      { id: 4, category: '培养基', item_name: 'DMEM 高糖培养基', brand: '示例品牌', spec_model: 'EXAMPLE-DMEM', unit: '瓶', quantity: 12, safety_stock: 0, note: '4℃ 保存', last_checked_at: stamp, checked_by_name: '示例管理员', updated_at: stamp, revision: 3, status: 'ok', stale: false },
    ],
    summary: { item_count: 3, unchecked_count: 0, out_count: 1, low_count: 0, stale_count: 0, last_checked_at: stamp }, stale_days: 30,
  };

  const summarize = (list) => ({
    item_count: list.length,
    out_count: list.filter((i) => i.status === 'out').length,
    stale_count: list.filter((i) => i.status === 'stale').length,
    last_checked_at: list.map((i) => i.last_checked_at).filter(Boolean).sort().at(-1) ?? null,
  });

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
        items: visible, summary: summarize(searched), stale_days: 30,
      };
    } else if (url.pathname === '/api/v1/materials/stock' && req.method() === 'POST') {
      const body = req.postDataJSON();
      assert.ok(!('safety_stock' in body), '新增请求不应再带安全库存');
      const counted = body.quantity !== undefined && body.quantity !== null && body.quantity !== '';
      const item = {
        ...base, id: nextId++, category: body.category, item_name: body.item_name, brand: body.brand || '', spec_model: body.spec_model || '',
        unit: body.unit || '', quantity: counted ? Number(body.quantity) : 0, note: body.note || '',
        last_checked_at: counted ? new Date().toISOString() : null, checked_by_name: counted ? '示例管理员' : null,
        updated_at: new Date().toISOString(), revision: 0,
      };
      item.status = !counted ? 'stale' : item.quantity <= 0 ? 'out' : 'ok';
      item.stale = !counted;
      items.push(item);
      status = 201;
      result = item;
    } else if (url.pathname === '/api/v1/materials/stock/sync') {
      result = { scanned: 749, candidates: 28, created: 26, skipped: 2 };
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
        assert.ok(!('safety_stock' in body), '编辑请求不应再带安全库存');
        items[index] = { ...items[index], ...body, revision: items[index].revision + 1 };
        result = items[index];
      }
    } else throw new Error(`Unexpected fixture route: ${url.pathname}`);
    await route.fulfill({ status, json: result });
  });

  await mkdir(output, { recursive: true });
  role = 'admin';
  await page.goto(`${origin}/before-stock`);
  await page.locator('tbody tr').filter({ hasText: '200ul 滤芯吸头' }).waitFor();
  await page.screenshot({ path: join(output, 'before-stock.png'), fullPage: true });
  role = 'member';

  await page.goto(`${origin}/materials/stock`);
  await page.getByRole('heading', { name: '常用耗材库存' }).waitFor();
  await page.locator('tbody tr').filter({ hasText: '200ul 滤芯吸头' }).waitFor();
  assert.equal(await page.locator('tbody tr').count(), 5);
  const tabs = (await page.locator('.tabs button').allTextContents()).map((t) => t.replace(/[\d⚠]+/g, '').trim());
  assert.deepEqual(tabs, ['全部', '普通用品', '塑料耗材', '生物试剂', '试剂盒', '其他'], '标签卡应为全部 + 四大类 + 其他');
  const headers = (await page.locator('thead th').allTextContents()).map((t) => t.trim());
  assert.deepEqual(headers, ['类别', '耗材名称', '品牌', '规格型号', '单位', '当前库存', '状态', '最近核对', '参考消耗/月*', '最近采购*', '操作']);
  assert.equal(await page.getByText('安全库存').count(), 0, '页面不应再出现安全库存');
  assert.equal(await page.getByText('未设', { exact: true }).count(), 0);
  const tipRow = page.locator('tbody tr').filter({ hasText: '200ul 滤芯吸头' });
  assert.equal((await tipRow.locator('td').nth(0).textContent()).trim(), '塑料耗材吸头', '类别列显示大类和子类标签');
  assert.equal((await tipRow.locator('td').nth(8).textContent()).trim(), '2.5 盒');
  assert.equal((await tipRow.locator('td').nth(9).textContent()).trim(), '2026-09-015 盒');
  const kitRow = page.locator('tbody tr').filter({ hasText: '示例 ELISA 试剂盒' });
  assert.equal((await kitRow.locator('td').nth(8).textContent()).trim(), '', '无采购历史时参考消耗为空');
  assert.equal((await kitRow.locator('td').nth(9).textContent()).trim(), '', '无采购历史时最近采购为空');
  const statusOf = async (name) => (await page.locator('tbody tr').filter({ hasText: name }).locator('.stock-status').textContent()).trim();
  assert.equal(await statusOf('24孔细胞培养板'), '已用完');
  assert.equal(await statusOf('8连管'), '需复核');
  assert.equal(await statusOf('DMEM 高糖培养基'), '需复核');
  assert.equal(await statusOf('200ul 滤芯吸头'), '正常');
  assert.deepEqual(await page.locator('select').first().locator('option').allTextContents(), ['全部状态', '已用完', '需复核', '正常']);
  assert.equal(await page.getByRole('button', { name: '新增耗材', exact: true }).count(), 0, '成员不应看到新增按钮');
  assert.equal(await page.getByRole('button', { name: '核对', exact: true }).count(), 0, '成员不应看到核对按钮');
  await page.screenshot({ path: join(output, 'member-stock.png'), fullPage: true });

  await page.locator('.tabs button').filter({ hasText: '塑料耗材' }).click();
  await page.waitForFunction(() => document.querySelectorAll('tbody tr').length === 3);
  await page.screenshot({ path: join(output, 'tab-plastic.png'), fullPage: true });
  await page.locator('.tabs button').filter({ hasText: '试剂盒' }).click();
  await page.waitForFunction(() => document.querySelectorAll('tbody tr').length === 1);
  await page.locator('.tabs button').filter({ hasText: '全部' }).click();
  await page.waitForFunction(() => document.querySelectorAll('tbody tr').length === 5);

  role = 'admin';
  await page.reload();
  await page.getByRole('button', { name: '新增耗材', exact: true }).waitFor();
  await page.locator('tbody tr').filter({ hasText: '200ul 滤芯吸头' }).waitFor();
  assert.equal(await page.getByRole('button', { name: '核对', exact: true }).count(), 5);
  await page.screenshot({ path: join(output, 'admin-stock.png'), fullPage: true });

  const stripRow = page.locator('tbody tr').filter({ hasText: '8连管' });
  await stripRow.getByRole('button', { name: '核对', exact: true }).click();
  await page.getByRole('heading', { name: '核对库存：8连管' }).waitFor();
  await page.getByLabel('实际数量').fill('6');
  await page.getByLabel('备注（领用、报损、盘点说明）').fill('首次盘点');
  await page.getByRole('button', { name: '保存核对' }).click();
  await page.getByRole('status').filter({ hasText: '已核对' }).waitFor();
  await page.waitForFunction(() => {
    const row = [...document.querySelectorAll('tbody tr')].find((r) => r.textContent?.includes('8连管'));
    return row?.querySelectorAll('td')[5]?.textContent?.trim() === '6' && row.querySelector('.stock-status')?.textContent === '正常';
  });

  await page.getByRole('button', { name: '新增耗材', exact: true }).click();
  await page.getByRole('heading', { name: '新增耗材', exact: true }).waitFor();
  assert.equal(await page.getByLabel('安全库存').count(), 0, '新增表单不应有安全库存');
  assert.deepEqual(await page.locator('.dialog select optgroup').evaluateAll((g) => g.map((x) => x.label)), ['普通用品', '塑料耗材', '生物试剂', '试剂盒']);
  await page.locator('.dialog select').selectOption('塑料耗材/吸头');
  await page.getByLabel('名称', { exact: true }).fill('1000ul 吸头');
  await page.getByLabel('品牌', { exact: true }).fill('示例品牌');
  await page.getByLabel('规格型号', { exact: true }).fill('EXAMPLE-TIP-1000');
  await page.getByLabel('单位', { exact: true }).fill('盒');
  await page.screenshot({ path: join(output, 'admin-create.png'), fullPage: true });
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByRole('status').filter({ hasText: '已新增耗材' }).waitFor();
  const newRow = page.locator('tbody tr').filter({ hasText: '1000ul 吸头' });
  await newRow.getByText('需复核', { exact: true }).waitFor();

  await newRow.getByRole('button', { name: '编辑', exact: true }).click();
  await page.getByRole('heading', { name: '编辑耗材：1000ul 吸头' }).waitFor();
  assert.equal(await page.getByLabel('安全库存').count(), 0, '编辑表单不应有安全库存');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByRole('status').filter({ hasText: '已保存耗材信息' }).waitFor();

  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: '从采购记录生成候选', exact: true }).click();
  await page.getByRole('status').filter({ hasText: '匹配 28 条' }).waitFor();

  assert.deepEqual(errors, []);
  console.log(JSON.stringify({
    status: 'passed',
    checks: ['改动前截图（HEAD 页面）', '标签卡为全部+四大类+其他并按大类过滤', '列顺序与品牌/规格拆列', '类别列显示子类标签', '参考消耗/月与最近采购显示及空值', '三态状态与筛选项', '无安全库存列与表单项', '成员只读', '管理员核对后状态变正常', '新增按大类分组选择子类、默认需复核', '编辑不带安全库存', '从采购记录生成候选'],
    screenshots: output,
  }));
} finally {
  await browser?.close();
  if (server) await new Promise((r) => server.close(r));
  await rm(stage, { recursive: true, force: true });
}
