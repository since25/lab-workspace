# OA 部门物料自动导出准备

## What was done

- 按用户确认的范围，实现独立 OA 网页导出程序：每次创建临时浏览器会话、账号密码登录、进入采购管理的部门物料报表，经两层 iframe 点击导出；不调用 OA API，不保存或复用登录状态。
- 支持根目录已有 env 键名，补充页面定位配置；`.env` 继续忽略，新增 `*.env` 和默认业务输出目录忽略规则。真实配置只保留在忽略的配置文件，不写入源码、示例或安装包。
- 导出采用独立文件名与临时文件校验，拒绝空下载和明显的登录 HTML；失败保留历史文件。增加单次运行锁和脱敏状态记录，不自动重试。
- 生成 Windows 独立安装与运行脚本：拟安装至 `C:\lab-workspace\automation\oa-export`，配置 `C:\lab-workspace\config\oa.env`，输出 `E:\lab-workspace\oa-materials`；计划任务拟每周六服务器时间 03:00 以 SYSTEM 运行。
- 用户明确自动更新策略需单独讨论，因此当前不接入工作台导入接口，不改现有物料数据、数据库结构、鉴权接口或网页服务。
- 生成入口 `bash infra/windows/build-oa-export.sh`，输入 `apps/oa-export/src/`、固定依赖及运行脚本，输出 `dist/oa-export.zip`。真实试跑入口 `node apps/oa-export/src/cli.mjs --env .env`，输入为忽略的本地配置，输出为忽略的 `apps/oa-export/output/`。

## Testing

- `npm test --prefix apps/oa-export`：6/6 通过。覆盖重复运行均重新登录、两层 iframe 下载、登录失败停止、空导出保留旧文件、文件校验、配置检查不登录和已有锁时停止。
- 真实 OA 本地试跑：成功导出一次，440,263 字节；文件存在且非空，ZIP CRC 与 XLSX 容器校验通过。未核验行数据、导出范围或字段映射；未导入工作台。
- `bash -n infra/windows/build-oa-export.sh` 和实际打包成功；安装包存在、非空、ZIP 校验通过，未包含 env、业务导出或测试文件；对本轮源码和包内文件做了真实配置值误带检查，未发现泄露。
- windows-wg 只读核对：Node 22.23.3、Microsoft Edge 155.0.4283.45、China Standard Time。两份 PowerShell 脚本在目标机 PowerShell 5.1 解析通过；每周六触发器与 IgnoreNew、10 分钟执行上限可构造，未注册或修改任务。
- `git diff --check` 通过；`.env`、`oa.env` 和默认输出日志均被忽略；PowerShell 新脚本已检查 UTF-8 BOM。
- 依 requesting-code-review 技能串行核对本轮源码、范围和验证证据，未委派代理。服务器完整运行与计划任务验收尚待部署确认后执行，不能据本机验证声称服务器已上线。

## Notes

- Changed files：`.gitignore`、`apps/oa-export/` 的源码/测试/依赖/脱敏示例、`infra/windows/{build-oa-export.sh,install-oa-export.ps1,run-oa-export.ps1}`、`docs/{deployment.md,oa-material-export.md}`、本日志。忽略的本地 `.env` 补充定位配置，输出目录保留一次真实导出。原有陌生未跟踪文件未改动，未提交或推送 Git。
- OA 会显示密码过期的非强制提示，关闭后当前可继续登录；程序不会改密码。强制过期、验证码或二次验证需人工处理。OA 报表拒绝 HeadlessChrome 标识，同版本普通 Chrome 标识已在真实页面验证可加载。
- 当前服务器未部署此程序、未上传 OA 账号配置、未注册定时任务。待用户按其 AGENTS.md 的部署审批要求确认后执行新增安装与试跑。
- Rollback：本地撤销本轮文件与忽略规则，保留原 env 账号值；如未来已部署，先禁用独立计划任务并等待结束，再注销任务、移除新增程序目录。账号配置、业务导出和日志默认保留，删除须单独确认。无需回滚网页或数据库。
