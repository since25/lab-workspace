import { build } from 'esbuild';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const web = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const stage = await mkdtemp(join(tmpdir(), 'label-print-preview-task92-'));
const port = Number(process.env.LABEL_PRINT_PREVIEW_PORT || 4322);
const sampleLabel = (await readFile(join(dirname(fileURLToPath(import.meta.url)), 'fixtures/two-up-sample.png'))).toString('base64');

const fieldsBySource = {
  materials: [
    { key: 'item_name', label: '物料名称' }, { key: 'material_code', label: '物料编码' },
    { key: 'spec_model', label: '规格型号' }, { key: 'brand', label: '品牌' },
    { key: 'department', label: '部门' }, { key: 'unit', label: '单位' },
  ],
  freezer: [
    { key: 'name', label: '样品信息' }, { key: 'project_no', label: '项目号' },
    { key: 'sample_type', label: '样品类型' }, { key: 'location', label: '位置' },
    { key: 'stored_on', label: '存入日期' }, { key: 'remarks', label: '备注' },
  ],
  assets: [
    { key: 'asset_name', label: '资产名称' }, { key: 'asset_code', label: '资产编号' },
    { key: 'spec_model', label: '规格型号' }, { key: 'location', label: '存放地点' },
    { key: 'user_name', label: '使用人' }, { key: 'department', label: '使用部门' },
  ],
  cells: [
    { key: 'cell_name', label: '细胞名称' }, { key: 'passage', label: '代次' },
    { key: 'frozen_on', label: '冻存日期' }, { key: 'location', label: '位置' },
    { key: 'depositor', label: '冻存人' }, { key: 'density', label: '细胞密度' },
    { key: 'source', label: '来源' }, { key: 'freezing_medium', label: '冻存液' },
    { key: 'tube_count', label: '管数' }, { key: 'remarks', label: '备注' },
  ],
};

const columnsBySource = {
  materials: [
    { key: 'item_name', label: '名称' }, { key: 'material_code', label: '物料编码' },
    { key: 'brand', label: '品牌' }, { key: 'spec_model', label: '规格型号' },
    { key: 'department', label: '部门' },
  ],
  freezer: [
    { key: 'name', label: '样品信息' }, { key: 'project_no', label: '项目号' },
    { key: 'sample_type', label: '样品类型' }, { key: 'location', label: '位置' },
    { key: 'stored_on', label: '存入日期' },
  ],
  assets: [
    { key: 'asset_name', label: '名称' }, { key: 'asset_code', label: '资产编号' },
    { key: 'spec_model', label: '规格型号' }, { key: 'location', label: '存放地点' },
    { key: 'user_name', label: '使用人' },
  ],
  cells: [
    { key: 'cell_name', label: '细胞名称' }, { key: 'passage', label: '代次' },
    { key: 'location', label: '位置' }, { key: 'depositor', label: '冻存人' },
    { key: 'frozen_on', label: '冻存日期' }, { key: 'tube_count', label: '管数' },
  ],
};

const rawCells = [
  { id: 101, cell_name: 'HEK293T-Cas9', passage: 'P12', location: '1号架 / 2层', depositor: '王小明', frozen_on: '2026-10-24', tube_count: 4, density: '5×10^6/mL', source: 'ATCC', freezing_medium: '90%FBS+10%DMSO', remarks: '高活性' },
  { id: 102, cell_name: 'HeLa-GFP-S1', passage: 'P8', location: '1号架 / 2层', depositor: '李四', frozen_on: '2026-10-20', tube_count: 2, density: '3×10^6/mL', source: '自建', freezing_medium: '常规', remarks: '' },
  { id: 103, cell_name: 'HeLa-GFP-S10', passage: 'P9', location: '1号架 / 2层', depositor: '李四', frozen_on: '2026-10-21', tube_count: 3, density: '4×10^6/mL', source: '自建', freezing_medium: '常规', remarks: '' },
  { id: 104, cell_name: 'HeLa-GFP-S2', passage: 'P8', location: '1号架 / 2层', depositor: '李四', frozen_on: '2026-10-20', tube_count: 1, density: '3×10^6/mL', source: '自建', freezing_medium: '常规', remarks: '' },
  { id: 105, cell_name: 'Jurkat-T', passage: 'P15', location: '2号架 / 1层', depositor: '赵六', frozen_on: '2026-09-15', tube_count: 5, density: '2×10^6/mL', source: '赠予', freezing_medium: '90%FBS+10%DMSO', remarks: '易聚团' },
];

const itemsBySource = {
  materials: [
    { id: 1, item_name: '示例耗材甲', material_code: 'EXAMPLE-M-1', brand: '示例品牌甲', spec_model: 'EXAMPLE-SPEC-1', department: '示例部门', unit: '盒' },
    { id: 2, item_name: '示例耗材乙', material_code: 'EXAMPLE-M-2', brand: '示例品牌乙', spec_model: 'EXAMPLE-SPEC-2', department: '示例部门', unit: '盒' },
  ],
  freezer: [
    { id: 11, name: '示例样品甲', project_no: 'P-001', sample_type: '细胞', location: '-80 1号（-80℃） · 第1层 · 盒子「A」', stored_on: '2026-10-01' },
  ],
  assets: [
    { id: 21, asset_name: '示例 PCR 仪', asset_code: 'EXAMPLE-CMC-1', spec_model: '示例型号', location: '示例房间', user_name: '示例使用人' },
  ],
  cells: rawCells,
};

const printers = [
  { id: 1, printer_key: 'brady-bbp12', name: 'Brady BBP12', enabled: true, is_default: true, ready: true, jobs: 0 },
];

const customBatches = [
  { id: 1, batch_name: '已存批次-质粒与抗体样品.csv', headers: ['质粒名称', '浓度', '体积', '纯度', '保存位置', '日期', '保管人'], row_count: 2, created_at: '2026-10-23 15:30' },
];

let customItems = [
  { id: 501, batch_id: 1, 质粒名称: 'pCDNA3.1-EGFP', 浓度: '250 ng/μL', 体积: '50 μL', 纯度: 'OD 1.85', 保存位置: '-20℃ 冰箱A-3', 日期: '2026-10-23', 保管人: '张三', title: 'pCDNA3.1-EGFP' },
  { id: 502, batch_id: 1, 质粒名称: 'pX458-SpCas9', 浓度: '500 ng/μL', 体积: '100 μL', 纯度: 'OD 1.90', 保存位置: '-20℃ 冰箱B-1', 日期: '2026-10-23', 保管人: '李四', title: 'pX458-SpCas9' },
];

await build({
  stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';import Page from './src/app/(app)/label-print/LabelPrintClient.tsx';import './src/app/globals.css';createRoot(document.getElementById('root')).render(<main><Page/></main>);`, loader: 'tsx', resolveDir: web },
  bundle: true, platform: 'browser', outfile: join(stage, 'app.js'), tsconfig: join(web, 'tsconfig.json'), define: { 'process.env.NODE_ENV': '"production"' },
});

const body = async (req) => { const chunks = []; for await (const chunk of req) chunks.push(chunk); try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { return {}; } };
const json = (res, value) => { res.setHeader('content-type', 'application/json; charset=utf-8'); res.end(JSON.stringify(value)); };

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${port}`);
  if (url.pathname === '/app.js') { res.setHeader('content-type', 'text/javascript'); res.end(await readFile(join(stage, 'app.js'))); return; }
  if (url.pathname === '/app.css') { res.setHeader('content-type', 'text/css'); res.end(await readFile(join(stage, 'app.css')).catch(() => '')); return; }

  if (url.pathname.startsWith('/api/v1/label-print/custom-batches')) {
    if (req.method === 'DELETE') {
      const id = Number(url.searchParams.get('id'));
      const idx = customBatches.findIndex((b) => b.id === id);
      if (idx >= 0) customBatches.splice(idx, 1);
      customItems = customItems.filter((it) => it.batch_id !== id);
      json(res, { message: '批次已删除' });
      return;
    }
    if (req.method === 'POST') {
      const input = await body(req);
      const csvText = String(input.csv_text || '');
      const batchName = String(input.batch_name || '未命名批次.csv');
      const lines = csvText.trim().split(/\r?\n/).filter(Boolean);
      const headers = (lines[0] || '').split(',').map((h) => h.trim().replace(/^"|"$/g, ''));
      const newBatch = {
        id: customBatches.length + 1,
        batch_name: batchName,
        headers,
        row_count: Math.max(0, lines.length - 1),
        created_at: new Date().toISOString().replace('T', ' ').slice(0, 16),
      };
      customBatches.unshift(newBatch);
      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
        const item = { id: 600 + customItems.length + 1, batch_id: newBatch.id, title: cols[0] || `行${i}` };
        headers.forEach((h, idx) => { item[h] = cols[idx] ?? ''; });
        customItems.unshift(item);
      }
      json(res, { batch: newBatch });
      return;
    }
    json(res, { batches: customBatches });
    return;
  }

  if (url.pathname.startsWith('/api/v1/label-print/custom-items/')) {
    const id = Number(url.pathname.split('/').pop());
    const input = await body(req);
    const item = customItems.find((it) => it.id === id);
    if (item && input.field) {
      item[input.field] = input.value;
      const b = customBatches.find((x) => x.id === item.batch_id);
      if (b && b.headers[0] === input.field) {
        item.title = input.value;
      }
      json(res, { item });
      return;
    }
    res.statusCode = 404;
    json(res, { error: 'item not found' });
    return;
  }

  if (url.pathname.startsWith('/api/v1/label-print/items')) {
    const source = url.searchParams.get('source') || 'materials';
    const q = (url.searchParams.get('q') || '').trim().toLowerCase();
    if (source === 'custom') {
      const batchId = Number(url.searchParams.get('batch_id')) || (customBatches[0]?.id ?? 1);
      const b = customBatches.find((x) => x.id === batchId) || customBatches[0] || { id: batchId, headers: ['title'] };
      const fields = (b.headers || []).map((h) => ({ key: h, label: h }));
      const columns = (b.headers || []).map((h) => ({ key: h, label: h }));
      let items = customItems.filter((x) => x.batch_id === b.id);
      if (q) {
        items = items.filter((item) => JSON.stringify(item).toLowerCase().includes(q));
      }
      json(res, { source, items, total: items.length, page: 1, page_size: 20, fields, columns, batch_id: b.id });
      return;
    }
    let items = itemsBySource[source] || [];
    if (q) {
      items = items.filter((item) => JSON.stringify(item).toLowerCase().includes(q));
    }
    json(res, { source, items, total: items.length, page: 1, page_size: 20, fields: fieldsBySource[source], columns: columnsBySource[source] });
    return;
  }
  if (url.pathname.startsWith('/api/v1/label-print/printers')) { json(res, { printers }); return; }
  if (url.pathname.startsWith('/api/v1/label-print/templates')) { json(res, { templates: [] }); return; }
  if (url.pathname.startsWith('/api/v1/label-print/media')) { json(res, { dpi: 300, width_mm: 59.5, height_mm: 15.1, slot_width_mm: 29.7, slot_height_mm: 15.1, columns: 2 }); return; }
  if (url.pathname.startsWith('/api/v1/label-print/preview')) {
    const input = await body(req);
    let count = (input.ids || []).length;
    if (input.source === 'cells' && input.by_tube_count) {
      count = (input.ids || []).reduce((sum, id) => {
        const item = rawCells.find((c) => c.id === id);
        return sum + (item?.tube_count || 1);
      }, 0);
    }
    const mediaCount = Math.ceil(count / 2);
    const images = Array.from({ length: mediaCount }, () => sampleLabel);
    json(res, { images, count, media_count: mediaCount, fields: input.fields || [], template: input.template, layout: 'two-up' });
    return;
  }
  if (url.pathname.startsWith('/api/v1/label-print/print')) {
    const input = await body(req);
    json(res, { message: '模拟打印作业已成功提交', sent: (input.ids || []).length, printer: 'Brady BBP12' });
    return;
  }

  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.end('<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>标签打印本地预览（TASK-92 细胞冻存 + TASK-102 自定义 CSV）</title><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>');
});

await new Promise((resolveServer) => server.listen(port, '127.0.0.1', resolveServer));
console.log(`标签打印本地验收预览服务已就绪（支持 TASK-92 细胞冻存与 TASK-102 自定义 CSV）：http://127.0.0.1:${port}/label-print`);
