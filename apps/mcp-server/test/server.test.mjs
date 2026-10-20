import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const here = dirname(fileURLToPath(import.meta.url));
const entry = resolve(here, "../src/index.mjs");

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

test("MCP 工具：登录、检索、确认后提交、查询状态", async () => {
  let logins = 0;
  let submits = 0;
  let lastSubmit;
  const requests = [];
  const server = createServer(async (req, res) => {
    const path = new URL(req.url, "http://localhost").pathname;
    requests.push(`${req.method} ${path}`);
    res.setHeader("content-type", "application/json");
    if (path === "/api/v1/auth/login") {
      logins += 1;
      const body = await readBody(req);
      assert.deepEqual(body, { username: "agent", password: "secret" });
      res.setHeader("set-cookie", "lab_session=test-token; Path=/; HttpOnly");
      res.end(JSON.stringify({ user: { id: 9, role: "member" } }));
      return;
    }
    assert.equal(req.headers.cookie, "lab_session=test-token", "后续请求应复用登录 Cookie");
    if (path === "/api/v1/materials/reconcile/search") {
      res.end(JSON.stringify({
        query: "24孔板", months: 2, cutoff: "2026-08-20",
        stock_items: [{ id: 1, item_name: "24 孔板", quantity: 2, status: "low", status_text: "低于安全库存" }],
        purchase_records: [{ id: 11, item_name: "24 孔板", recent: true, unreceived: true, is_used_up: false }],
        summary: { suggested_material_ids: [11], recent_unreceived_count: 1 },
      }));
      return;
    }
    if (path === "/api/v1/materials/reconcile" && req.method === "POST") {
      submits += 1;
      lastSubmit = await readBody(req);
      res.statusCode = 201;
      res.end(JSON.stringify({ id: 7, status: "pending" }));
      return;
    }
    if (path === "/api/v1/materials/reconcile/7") {
      res.end(JSON.stringify({ id: 7, status: "pending" }));
      return;
    }
    if (path === "/api/v1/materials/reconcile") {
      res.end(JSON.stringify({ items: [], total: 0, page: 1, page_size: 50 }));
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ error: "not found" }));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = `http://127.0.0.1:${server.address().port}`;
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [entry],
    env: { ...process.env, LAB_WORKSPACE_URL: origin, LAB_USERNAME: "agent", LAB_PASSWORD: "secret", LAB_MCP_ENV_FILE: "/nonexistent" },
    stderr: "pipe",
  });
  const client = new Client({ name: "test", version: "0.1.0" });
  try {
    await client.connect(transport);
    const tools = await client.listTools();
    assert.deepEqual(tools.tools.map((t) => t.name).sort(), ["get_stock_reconciliation", "search_consumable", "submit_stock_reconciliation"]);

    const searched = await client.callTool({ name: "search_consumable", arguments: { query: "24孔板" } });
    const searchData = JSON.parse(searched.content[0].text);
    assert.equal(searchData.stock_items[0].quantity, 2);
    assert.deepEqual(searchData.summary.suggested_material_ids, [11]);
    assert.equal(logins, 1);

    const refused = await client.callTool({
      name: "submit_stock_reconciliation",
      arguments: { stock_id: 1, proposed_quantity: 0, material_ids: [11], note: "已用完", confirmed: false },
    });
    assert.equal(refused.isError, true);
    assert.match(refused.content[0].text, /尚未确认/);
    assert.equal(submits, 0);

    const submitted = await client.callTool({
      name: "submit_stock_reconciliation",
      arguments: { stock_id: 1, proposed_quantity: 0, material_ids: [11], note: "已用完", confirmed: true },
    });
    assert.equal(submitted.isError, undefined);
    assert.equal(JSON.parse(submitted.content[0].text).id, 7);
    assert.deepEqual(lastSubmit, { stock_id: 1, proposed_quantity: 0, material_ids: [11], note: "已用完", confirmed: true });
    assert.equal(submits, 1);

    const status = await client.callTool({ name: "get_stock_reconciliation", arguments: { id: 7 } });
    assert.equal(JSON.parse(status.content[0].text).status, "pending");
    assert.equal(logins, 1, "会话应复用，不应重复登录");
    assert.deepEqual(requests, [
      "POST /api/v1/auth/login",
      "GET /api/v1/materials/reconcile/search",
      "POST /api/v1/materials/reconcile",
      "GET /api/v1/materials/reconcile/7",
    ]);
  } finally {
    await client.close().catch(() => {});
    await new Promise((resolve) => server.close(resolve));
  }
});

test("缺少账号配置时启动失败且不泄露密码", async () => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [entry],
    env: { ...process.env, LAB_WORKSPACE_URL: "http://127.0.0.1:1", LAB_USERNAME: "", LAB_PASSWORD: "secret", LAB_MCP_ENV_FILE: "/nonexistent" },
    stderr: "pipe",
  });
  const client = new Client({ name: "test", version: "0.1.0" });
  await assert.rejects(() => client.connect(transport));
  const stderr = transport.stderr?.read()?.toString() ?? "";
  assert.match(stderr, /LAB_USERNAME/);
  assert.doesNotMatch(stderr, /secret/);
});
