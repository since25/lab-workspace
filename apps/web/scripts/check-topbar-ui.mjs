// 检查顶部导航：分组下拉在宽屏一行内，窄屏不换行错位；不连接数据库。
import { build } from 'esbuild';
import { chromium } from '/Users/wangyichuan/localissue/lab-workspace/apps/oa-export/node_modules/playwright-core/index.mjs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const web = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const stage = await mkdtemp(join(tmpdir(), 'topbar-ui-'));
const evidence = '/Users/wangyichuan/selfapp/ProjectInbox/work/evidence/TASK-87';
await mkdir(evidence, { recursive: true });

const navStub = join(stage, 'nav-stub.ts');
const linkStub = join(stage, 'link-stub.ts');
await writeFile(navStub, 'export const usePathname = () => "/materials";\n');
await writeFile(linkStub, `import React from "react";\nexport default function Link({ href, children, ...rest }: any) { return React.createElement("a", { href, ...rest }, children); }\n`);

let browser, server;
try {
  await build({
    stdin: {
      contents: `import React from 'react';import {createRoot} from 'react-dom/client';import TopBar from './src/app/(app)/TopBar.tsx';import './src/app/globals.css';const user={id:1,username:'demo',display_name:'示例用户',role:'admin',freezer_view_all:true,label_print_enabled:true};createRoot(document.getElementById('root')).render(<TopBar user={user}/>);`,
      loader: 'tsx', resolveDir: web,
    },
    bundle: true, platform: 'browser', outfile: join(stage, 'app.js'), tsconfig: join(web, 'tsconfig.json'),
    define: { 'process.env.NODE_ENV': '"production"' }, nodePaths: [join(web, 'node_modules')],
    alias: { 'next/navigation': navStub, 'next/link': linkStub },
  });
  server = createServer(async (req, res) => {
    if (req.url === '/app.js') { res.setHeader('content-type', 'text/javascript'); res.end(await readFile(join(stage, 'app.js'))); return; }
    if (req.url === '/app.css') { res.setHeader('content-type', 'text/css'); res.end(await readFile(join(stage, 'app.css')).catch(() => '')); return; }
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end('<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`;

  browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 420 } });
  const page = await context.newPage();
  await page.route('**/api/v1/feedback/unread', (route) => route.fulfill({ json: { count: 2 } }));

  await page.goto(origin);
  await page.getByRole('button', { name: '库存' }).waitFor();
  const compact = async (locator) => (await locator.allInnerTexts()).map((t) => t.replace(/\s+/g, ''));
  assert.deepEqual(await compact(page.locator('.nav-btn')), ['样品▾', '库存▾', '工具▾', '其他▾', '管理▾']);

  // 宽屏：顶栏一行，下拉菜单展开后能看到库存三项
  const wideHeight = (await page.locator('header.topbar').boundingBox())?.height ?? 0;
  assert.ok(wideHeight <= 60, `宽屏顶栏高度 ${wideHeight}，应该保持一行`);
  await page.getByRole('button', { name: '库存' }).click();
  await page.getByRole('menu').waitFor();
  assert.deepEqual(await compact(page.getByRole('menuitem')), ['部门物料', '常用耗材', '固定资产']);
  await page.waitForTimeout(150);
  await page.screenshot({ path: join(evidence, 'topbar-wide.png') });

  // 点空白处收起
  await page.mouse.click(1200, 300);
  await page.getByRole('menu').waitFor({ state: 'detached' });

  // 窄屏：分组仍是一行按钮，不出现换行错位
  await page.setViewportSize({ width: 560, height: 420 });
  const wide = await page.locator('.nav-menus').boundingBox();
  assert.ok(wide && wide.height <= 44, `窄屏导航容器高度 ${wide?.height}，分组应保持一行（可横向滚动）`);
  await page.getByRole('button', { name: '工具' }).click();
  await page.getByRole('menu').waitFor();
  assert.deepEqual(await compact(page.getByRole('menuitem')), ['Sanger分析', '纳米孔分析', '标签打印']);
  await page.waitForTimeout(150);
  await page.screenshot({ path: join(evidence, 'topbar-narrow.png') });

  console.log(JSON.stringify({ status: 'passed', checks: ['五个分组一行', '库存菜单三项', '点空白收起', '窄屏不换行', '工具菜单含标签打印'], screenshots: evidence }));
} finally {
  await browser?.close();
  if (server) await new Promise((r) => server.close(r));
  await rm(stage, { recursive: true, force: true });
}
