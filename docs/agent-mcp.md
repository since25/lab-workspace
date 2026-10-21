# 用 agent 校对库存（MCP）

## 目标

让 pi agent 等支持 MCP 的客户端，通过对话完成「发现某耗材用完 → 核实采购和库存 → 用户确认 → 提交校对请求」；**提交不等于生效**，仍由管理员在后台批准后同时更新库存和采购记录。

MCP 服务不直接连 PostgreSQL，也不携带管理员权限。它用一个普通账号登录现有网页 API，因此继承该账号的权限：能查询、能提交请求，不能批准。

## 组成

| 部分 | 位置 | 作用 |
|---|---|---|
| MCP 服务（stdio） | `apps/mcp-server/` | 暴露 3 个工具，调用工作台 HTTP API |
| 检索 API | `GET /api/v1/materials/reconcile/search` | 一次返回库存条目、采购记录、近 N 月未收货标记、建议采购记录 ID |
| 提交 API | `POST /api/v1/materials/reconcile` | 生成待审批的库存校对请求，不立即改数据 |
| 状态 API | `GET /api/v1/materials/reconcile[/:id]` | 查自己的请求（管理员可查全部） |
| 管理审批 | 「物料审批 → 库存校对」 | 管理员批准/驳回，批准时事务内改库存＋写核对历史＋标记采购记录 |

## 安装与配置

1. 在工作台「账号管理」创建一个**普通成员**账号给 agent（不要用管理员账号）。
2. 安装依赖（只需一次）：

   ```bash
   npm ci --prefix apps/mcp-server
   ```

3. 配置账号。推荐把账号密码放在仓库根的 `.mcp.env`（已被 `*.env` 忽略，不要提交）：

   ```bash
   LAB_USERNAME=<agent 账号>
   LAB_PASSWORD=<agent 密码>
   ```

   MCP 服务启动时会自动读取仓库根的 `.mcp.env`；也可以用 `LAB_MCP_ENV_FILE` 指向其他文件。显式环境变量优先于文件。`LAB_WORKSPACE_URL` 建议在 MCP 配置里单独设置（不要写死在代码里）。
   建议执行 `chmod 600 .mcp.env`，限制本机其他用户读取。

4. 在 pi agent / 其他 MCP 客户端的 stdio 配置中加入（路径改成实际绝对路径）：

   ```json
   {
     "mcpServers": {
       "lab-workspace": {
         "command": "node",
         "args": ["/Users/you/lab-workspace/apps/mcp-server/src/index.mjs"],
         "env": {
           "LAB_WORKSPACE_URL": "http://<工作台地址>:3000",
           "LAB_USERNAME": "<agent 账号>",
           "LAB_PASSWORD": "<agent 密码>"
         }
       }
     }
   }
   ```

不同客户端的配置键名可能不同，核心是「command=node、args 指向 `src/index.mjs`、通过 env 注入地址和账号」。服务只向 stdout 写 MCP 协议，日志写 stderr。

## 工具

### `search_consumable`

输入：`query`（名称/品牌/规格，如 `24孔板`）、`months`（默认 2，1–24）。

返回（节选）：

```json
{
  "query": "24孔板",
  "months": 2,
  "cutoff": "2026-08-20",
  "stock_items": [
    { "id": 5, "item_name": "24 孔板", "quantity": 2, "unit": "箱", "status": "ok", "status_text": "正常", "revision": 3 }
  ],
  "purchase_records": [
    { "id": 101, "item_name": "24 孔板", "request_no": "...", "requested_on": "2026-09-01", "last_received_on": null,
      "receipt_status": "未收货", "recent": true, "unreceived": true, "is_used_up": false }
  ],
  "departments": ["示例部门甲"],
  "summary": {
    "recent_unreceived_count": 1,
    "pending_used_up_count": 0,
    "suggested_material_ids": [101, 102],
    "pending_material_ids": []
  }
}
```

- `suggested_material_ids` 是尚未已用完、也还没有待审批「已用完申请」的采购记录；`pending_material_ids` 是已在等待审批的记录。agent 应先向用户说明两者区别。采购记录最多返回 500 条，超过时 `summary.truncated` 为 true；`departments` 是当前展示部门。
- 库存状态：`out` 需采购（已核对且数量 0）、`stale` 需复核（从未核对或超过 30 天未核对）、`ok` 正常；从未核对的数量视为未知，不当作 0。
- 名称匹配会同时比较去掉空格后的文本，`24孔板` 能匹配 `24 孔板`。

### `submit_stock_reconciliation`

输入：`stock_id?`、`proposed_quantity?`、`material_ids?`、`note`、`confirmed`。

- `proposed_quantity: 0` 表示用完；不填表示不改库存数量。
- `material_ids` 通常取 `suggested_material_ids`；也可由用户指定。
- `confirmed` 必须为 `true`；tool 会在本地拒绝 `false`，服务端也会再次拒绝。
- 成功返回请求 id 和 `status: "pending"`；此时库存、采购记录都**没有**变化。

### `get_stock_reconciliation`

输入：`id?`、`status?`、`page?`。有 id 查单条，否则列出当前账号最近的请求。管理员账号可列全部，但一般不需要给 agent 管理员权限。

## 建议的对话流程

```text
用户：24孔板用完了
agent：调用 search_consumable("24孔板", 2)
       发现：常用耗材 24 孔板登记 2 箱（最近核对于 …）；
             近 2 个月有 1 条采购记录未收货；历史采购 12 条，其中 3 条仍未标记已用完。
agent：复述上述情况，并问：
       “是否把其中 3 条历史采购记录标记为已用完，并把常用耗材数量改为 0（用完）？”
用户：确认
agent：调用 submit_stock_reconciliation({stock_id:5, proposed_quantity:0, material_ids:[101,102,103],
                                        note:"用户反馈 24 孔板已用完", confirmed:true})
       告知：“已提交库存校对请求 #12，等待管理员在「物料审批 → 库存校对」批准。”
管理员：打开「物料审批 → 库存校对」，核对建议数量和采购记录，点「批准」
       → 库存变为 0，写一条核对历史，选中的采购记录标记为已用完，请求状态改为已批准。
```

如果常用耗材清单里没有该条目，agent 应告诉用户先由管理员在「常用耗材」新增，不会自动创建。

## 审批规则

- 只有管理员能调用 `POST /api/v1/admin/materials/reconcile` 批准/驳回。
- 批准时：
  - 若提交后库存被其他人改过（`revision` 变化）或条目已删除，整批返回 409，需驳回后重新提交，避免覆盖新数量。
  - 若采购记录已不存在，整批返回 409。
  - 库存数量更新后写 `consumable_stock_checks`（改前/改后/审批人/备注）。
  - 采购记录设为 `is_used_up=true`，并清除可能存在的待审批「已用完申请」字段。
- 同一耗材同时只允许一条待审批请求（数据库部分唯一索引）；重复提交返回 409。
- 审计日志记录提交、批准、驳回；不写密码、Cookie 或采购明细。

## 验证

```bash
npm test --prefix apps/mcp-server
```

测试用本地 mock HTTP 服务器 + 真实 MCP stdio 客户端，覆盖：登录 Cookie 复用、检索、未确认拒绝提交、确认后提交、状态查询、缺少账号配置时启动失败且不泄露密码。

工作台侧：

```bash
cd apps/web
npx vitest run src/lib/stock-reconcile.test.ts src/lib/reconcile-routes.test.ts
node scripts/check-reconcile-ui.mjs
```

## 限制

- MCP 服务需要能通过 HTTP 访问工作台；当前使用用户名/密码登录。推荐把账号密码放在仓库根 `.mcp.env`（已在 Git 忽略），不要写进 MCP JSON；该文件建议 `chmod 600`。
- 登录会话 7 天；过期后客户端下一次调用会自动重新登录。
- 没有「批准」工具，agent 不能自行批准；管理员仍需在网页操作。
- 不自动创建耗材条目、不自动生成 OA 请购单。
- agent 工具依赖现有展示部门配置；部门外采购记录不会出现在检索结果中。
