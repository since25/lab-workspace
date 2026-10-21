# 常用耗材两级分类升级：部署与验收清单（2026-10-20）

对应分支 `task-63`（基于 `main` `651abac`），改动未提交。代码侧已完成：全量 103 条测试通过、`npm run build` 通过、UI 检查 12 项通过。

## 0. 合并前（开发机）

- [ ] 确认 `git status` 只有本轮改动（16 改 + 3 新增），无其他脏文件
- [ ] `cd apps/web && npx vitest run` → 13 文件 103 条通过
- [ ] `npm run build` → 退出码 0
- [ ] 合并到 `main`（需授权）：`git checkout main && git merge --no-ff task-63`

## 1. 部署前：生产配置检查（必须）

在 windows-wg 管理员 PowerShell：

```powershell
Select-String -Path C:\lab-workspace\config\lab.env -Pattern 'MATERIAL_STOCK_CATEGORIES_JSON'
```

- 无输出 → 不用改，使用内置四大类 + 其他。
- 有输出 → 删除该行，或换成新格式（见 `docs/consumable-stock.md`「类别配置」）。
  **不处理的话标签卡仍是旧五类，代码再新也没用。**

## 2. 打包与安装

```bash
# 开发机
bash infra/windows/build-bundle.sh
```

- [ ] 把 `dist/bundle/` 拷到 `C:\lab-workspace\incoming\`（覆盖 `app.zip` 与 `deploy/`）
- [ ] 管理员执行 `powershell -ExecutionPolicy Bypass -File C:\lab-workspace\incoming\deploy\install.ps1`
      （自动停旧进程、替换 `app\`、执行 011/012 迁移、重启）
- [ ] 健康检查 `http://<地址>:3000/api/v1/health` → `{"status":"ok","db":true,"r_engine":true}`

迁移 011/012 只新增 `consumable_stock`、`consumable_stock_checks`、`stock_reconcile_requests`，不改既有采购记录；`safety_stock` 列保留，老数据照常读。

## 3. 部署后冒烟（管理员登录，约 5 分钟）

1. 打开「常用耗材」：标签卡应是 **全部｜普通用品｜塑料耗材｜生物试剂｜试剂盒｜其他**。
   还是旧五类 → 回到第 1 步查 `lab.env`。
2. 点「塑料耗材」：只剩塑料行；类别列下方有子类小标签（如「吸头」）。
3. 状态列只有 已用完／需复核／正常；页面无「安全库存」字样；最后两列是「参考消耗/月」「最近采购」。
4. 点「新增耗材」：类别下拉按四个大类分组、只有子类选项；没有安全库存输入框。保存一条不填数量 → 状态应为「需复核」，不是「已用完」。
5. 点「从采购记录生成候选」：生产库存表当前 0 行，生成前页面空是正常的；返回 `created` 应接近 28（以生产数据为准）。
6. 抽一行看「最近采购」和「参考消耗/月」是否有值；没有采购历史的行显示 `—` 是正确的。

## 4. 41 条种子入库（需授权选择方式）

- 推荐：一次性脚本走 `POST /materials/stock`，逐条创建，`quantity` 留空。
  **不要把 CSV 的「入库数量 0」写成 `quantity=0`**，否则 41 条全变「已用完」（假警报）。
- 备选：页面逐条新增（41 次，易漏、易错）。
- 导入后预期：共 41 种，全部「需复核」，汇总显示「需复核 41」——这是准确的，盘点后逐条消掉。
- 数据文件在 `lab-workspace-work/cs_temp/stock-candidates-2026-10-20/final_import_v2.csv`（含采购人姓名，不进 Git）。

## 5. 现场盘点（5 个台账无记录的品目）

T175 培养瓶、48 孔板、Transwell、试剂瓶/血清瓶、丁腈手套。

- [ ] 实物数完，在页面对应行点「核对」录数量（会写核对历史）
- [ ] 数量 0 且已核对 → 「已用完」；有数 → 「正常」
- [ ] 其余 36 条按盘点结果同样处理

## 6. 回滚

- 应用：把上一版 `app.zip` 重新 `install.ps1` 覆盖即可；迁移只新增表，旧代码可忽略新表。
- 数据：已用新类别名（`大类/子类`）建的库存条目需手工改回旧类别，否则旧页面标签卡对不上。
- 未合并前：删除 `lab-workspace-task-63` 工作区、删分支 `task-63` 即可。

## 7. 验收与状态

- 第 3、4、5 步都通过后，再把 TASK-63～67 从「待验收」改为「完成」。
- TASK-68 在导入 + 盘点完成前保持「受阻」；TASK-69 保持「未开工」。
