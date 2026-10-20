#!/usr/bin/env node
// Lab Workspace MCP server (stdio). The agent uses a normal workbench account and
// can only submit reconciliation requests; approval stays in the admin UI.
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { LabWorkspaceClient } from "./client.mjs";

// 允许把 LAB_USERNAME / LAB_PASSWORD 放在仓库根的 .mcp.env（本地、已忽略），
// 避免把密码写进 pi 的 MCP 配置；显式环境变量优先。
function loadLocalEnv() {
  const explicit = process.env.LAB_MCP_ENV_FILE;
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
  const file = explicit || resolve(repoRoot, ".mcp.env");
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match) continue;
    const value = match[2].replace(/^(['"])(.*)\1$/, "$2");
    if (process.env[match[1]] === undefined || process.env[match[1]] === "") process.env[match[1]] = value;
  }
}

const INSTRUCTIONS = `你是实验室工作台的库存助手。用户说某耗材用完、数量不对或需要盘点时：
1. 先调用 search_consumable 查询该耗材的采购记录和常用耗材库存，不要凭记忆回答。
2. 向用户复述：近 months 个月内的采购记录及是否未收货/部分收货、常用耗材当前登记数量/状态/最近核对时间、建议标记为已用完的采购记录数量。
3. 只有用户明确确认后，才调用 submit_stock_reconciliation，confirmed 必须为 true。不要替用户猜测数量。
4. 提交成功后告诉用户“已提交库存校对请求，等待管理员在「物料审批 → 库存校对」批准”，不要声称库存已经更新。
5. 如果常用耗材清单没有匹配条目，不要自动创建；告诉用户需要管理员先在「常用耗材」新增条目。
管理员批准前，任何工具都不会修改库存或采购标记。`;

export function createServer(client) {
  const server = new McpServer(
    { name: "lab-workspace", version: "0.1.0" },
    { instructions: INSTRUCTIONS }
  );

  server.registerTool(
    "search_consumable",
    {
      title: "查询耗材采购与库存",
      description: "按耗材名称/品牌/规格（如“24孔板”）查询部门物料采购记录和常用耗材库存。返回近 N 个月采购、未收货/部分收货标记、当前库存与状态、建议标记为已用完的采购记录 ID。只读，不修改任何数据。",
      inputSchema: {
        query: z.string().min(1).max(100).describe("耗材名称、品牌或规格，例如 24孔板、吸头、DMEM"),
        months: z.number().int().min(1).max(24).optional().describe("查看最近几个月内的采购，默认 2"),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ query, months }) => result(await client.searchContext(query, months ?? 2))
  );

  server.registerTool(
    "submit_stock_reconciliation",
    {
      title: "提交库存校对请求",
      description: "提交一条待管理员批准的库存校对请求：可把常用耗材数量改为指定值（0 表示用完），并把指定采购记录标记为已用完。提交后不会立即生效，管理员在后台批准后才更新。仅在用户明确确认后调用，confirmed 必须为 true。",
      inputSchema: {
        stock_id: z.number().int().positive().optional().describe("常用耗材条目 ID，来自 search_consumable 的 stock_items.id"),
        proposed_quantity: z.number().min(0).max(1_000_000_000).optional().describe("建议库存数量；0 表示用完。不填则不改库存数量"),
        material_ids: z.array(z.number().int().positive()).max(500).optional().describe("要标记为已用完的采购记录 ID，通常来自 suggested_material_ids"),
        note: z.string().min(1).max(500).describe("校对说明，例如“用户反馈 24 孔板已用完”"),
        confirmed: z.boolean().describe("用户是否已明确确认；必须为 true 才会提交"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async (input) => {
      if (!input.confirmed) return errorResult("未提交：用户尚未确认。请先复述库存和采购情况，得到明确确认后再调用。");
      const materialIds = input.material_ids ?? [];
      if (!input.stock_id && !materialIds.length) return errorResult("未提交：至少需要 stock_id 或 material_ids 之一。");
      if (input.proposed_quantity !== undefined && !input.stock_id) return errorResult("未提交：修改库存数量时必须提供 stock_id。");
      return result(await client.submitReconciliation({
        stock_id: input.stock_id,
        proposed_quantity: input.proposed_quantity,
        material_ids: materialIds,
        note: input.note,
        confirmed: true,
      }));
    }
  );

  server.registerTool(
    "get_stock_reconciliation",
    {
      title: "查询库存校对请求状态",
      description: "按 id 查询单条库存校对请求，或不传 id 时列出当前账号最近的请求（可用 status 过滤）。用于告诉用户“还在待审批/已批准/已驳回”。",
      inputSchema: {
        id: z.number().int().positive().optional().describe("请求 ID；不填则列出最近请求"),
        status: z.enum(["all", "pending", "approved", "rejected"]).optional().describe("列表过滤，默认 all"),
        page: z.number().int().min(1).max(100).optional().describe("列表页码，默认 1"),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ id, status, page }) => result(id
      ? await client.getRequest(id)
      : await client.listRequests({ status: status ?? "all", page: page ?? 1 }))
  );

  return server;
}

function result(data) {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

function errorResult(message) {
  return { content: [{ type: "text", text: message }], isError: true };
}

async function main() {
  loadLocalEnv();
  const client = new LabWorkspaceClient({
    baseUrl: process.env.LAB_WORKSPACE_URL || "http://127.0.0.1:3000",
    username: process.env.LAB_USERNAME,
    password: process.env.LAB_PASSWORD,
    timeoutMs: Math.min(120000, Math.max(1000, Number(process.env.LAB_MCP_TIMEOUT_MS) || 20000)),
  });
  const server = createServer(client);
  await server.connect(new StdioServerTransport());
  // stderr only: stdout is the MCP protocol channel.
  console.error("lab-workspace-mcp started");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(`lab-workspace-mcp failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
