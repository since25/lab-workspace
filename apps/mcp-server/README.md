# Lab Workspace MCP

让支持 MCP 的 agent 通过对话核对常用耗材库存，并提交待管理员批准的库存校对请求。

完整的安装、工具说明、对话流程和安全边界见仓库文档 [`docs/agent-mcp.md`](../../docs/agent-mcp.md)。

## 快速开始

```bash
npm ci
# 账号密码可放在仓库根 .mcp.env（LAB_USERNAME / LAB_PASSWORD），服务会自动读取
LAB_WORKSPACE_URL=http://127.0.0.1:3000 npm start
```

MCP 客户端配置：

```json
{
  "mcpServers": {
    "lab-workspace": {
      "command": "node",
      "args": ["/absolute/path/lab-workspace/apps/mcp-server/src/index.mjs"],
      "env": {
        "LAB_WORKSPACE_URL": "http://<工作台地址>:3000"
      }
    }
  }
}
```

## 工具

- `search_consumable`：查采购记录和库存，只读。
- `submit_stock_reconciliation`：提交待审批请求，用户确认后调用。
- `get_stock_reconciliation`：查请求状态。

## 权限与安全

- 使用**普通成员**账号，不要配置管理员账号；MCP 没有批准工具。
- 管理员在「物料审批 → 库存校对」批准后才更新库存和采购记录。
- 账号密码放在仓库根 `.mcp.env`（Git 忽略，建议 `chmod 600`）；MCP 服务自动读取，也可用 `LAB_MCP_ENV_FILE` 指定其他文件。

## 测试

```bash
npm test
```
