// TASK-87 脱敏验收预览：不连接数据库或真实打印服务，仅模拟部门物料、打印机状态和打印结果。
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const web = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const stage = await mkdtemp(join(tmpdir(), 'label-print-preview-'));
const port = Number(process.env.LABEL_PRINT_PREVIEW_PORT || 4317);
const sampleLabel = (await readFile('/Users/wangyichuan/localissue/myserver/labelprint/preview/sample1.png')).toString('base64');
const items = [
  { id: 1, item_name: '示例耗材甲', material_code: 'EXAMPLE-M-1', brand: '示例品牌甲', spec_model: 'EXAMPLE-SPEC-1', unit: '盒', department: '示例部门', requester: '示例成员', is_used_up: false },
  { id: 2, item_name: '示例耗材乙', material_code: 'EXAMPLE-M-2', brand: '示例品牌乙', spec_model: 'EXAMPLE-SPEC-2', unit: '盒', department: '示例部门', requester: '示例成员乙', is_used_up: false },
  { id: 3, item_name: '示例耗材丙', material_code: 'EXAMPLE-M-3', brand: '示例品牌丙', spec_model: 'EXAMPLE-SPEC-3', unit: '瓶', department: '示例部门', requester: '示例成员丙', is_used_up: false },
];
const printers = [
  { id: 1, printer_key: 'Queue A', name: '示例打印机 A', enabled: true, is_default: true, ready: true, jobs: 0 },
  { id: 2, printer_key: 'Queue B', name: '示例打印机 B', enabled: true, is_default: false, ready: false, reason: '示例设备离线', jobs: 0 },
];
await build({ stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';import Page from './src/app/(app)/label-print/LabelPrintClient.tsx';import './src/app/globals.css';createRoot(document.getElementById('root')).render(<main><Page/></main>);`, loader: 'tsx', resolveDir: web }, bundle: true, platform: 'browser', outfile: join(stage, 'app.js'), tsconfig: join(web, 'tsconfig.json'), define: { 'process.env.NODE_ENV': '"production"' } });

const body = async (req) => { const chunks = []; for await (const chunk of req) chunks.push(chunk); try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { return {}; } };
const json = (res, value) => { res.setHeader('content-type', 'application/json; charset=utf-8'); res.end(JSON.stringify(value)); };
const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${port}`);
  if (url.pathname === '/app.js') { res.setHeader('content-type', 'text/javascript'); res.end(await readFile(join(stage, 'app.js'))); return; }
  if (url.pathname === '/api/v1/label-print/materials') { json(res, { items, total: items.length, departments: ['示例部门'], limit: 500, fields: [{ key: 'item_name', label: '物料名称' }, { key: 'material_code', label: '物料编码' }, { key: 'spec_model', label: '规格型号' }, { key: 'brand', label: '品牌' }] }); return; }
  if (url.pathname === '/api/v1/label-print/printers') { json(res, { printers }); return; }
  if (url.pathname === '/api/v1/label-print/preview') { const input = await body(req); json(res, { images: [sampleLabel], count: (input.ids || []).length, media_count: 1, layout: 'two-up', fields: input.fields || [] }); return; }
  if (url.pathname === '/api/v1/label-print/print') { await body(req); json(res, { message: '已送出 2 张', sent: 2, printer: '示例打印机 A' }); return; }
  res.setHeader('content-type', 'text/html; charset=utf-8'); res.end('<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>TASK-87 标签打印预览</title></head><body><div id="root"></div><script src="/app.js"></script></body></html>');
});
await new Promise((resolveServer) => server.listen(port, '127.0.0.1', resolveServer));
console.log(`TASK-87 标签打印脱敏预览：http://127.0.0.1:${port}/label-print`);
console.log('停止命令：Ctrl-C，或 kill <PID>');
process.on('SIGINT', async () => { server.close(); await rm(stage, { recursive: true, force: true }); process.exit(0); });
