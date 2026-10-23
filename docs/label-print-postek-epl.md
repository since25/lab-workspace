# POSTEK C168/300s 接入工作台标签打印（EPL 后端）方案

> 目标：让工作台「标签打印」多一台可选设备 —— POSTEK C168/300s，打 30×20 mm 双列标签，与现有 Brady BBP12（59.5×15.1 mm TSPL）并存，互不影响。

## 1. 为什么必须加后端

| 事实 | 证据 |
|---|---|
| 驱动已装、队列可用 | `POSTEK C168/300s` → USB002，`Postek 2019.1.1.0`，`postek.inf`（252 条型号映射全是 EPL） |
| 该队列只认 EPL | 16:30:53 GDI 测试页正常出字；16:26 / 16:30:18 / 16:33:24 三次纯 TSPL 作业全部空白 |
| 标签服务只发 TSPL | `labelprint/tspl.py`：`SIZE / GAP / CLS / BITMAP / PRINT` |
| 工作台已按多打印机设计 | `apps/web` 的 print 路由已经传 `printer_id` + `layout:"two-up"` |
| 线上服务还是旧版 | `C:\labelprint` 的 `printer.py` 写死 `PRINTER_NAME = "Brady BBP12"`；task-87 的多打印机版尚未部署 |
| 工作台目录只有 Brady | `label_printers` 表目前仅 `brady-bbp12` |

结论：驱动层没问题，缺的是**按打印机选择指令集和介质**的能力。

## 2. 介质与版面（需要一次校准确认）

照片实测（IMG_3810）：两列、单张约 30×20 mm、列间距约 2 mm、行间距约 2 mm、整幅约 62 mm 宽。

300 dpi 换算（1 mm = 11.811 点）：

| 量 | 毫米 | 点 |
|---|---|---|
| 单格宽 SLOT_W | 30 | 354 |
| 列间距 SLOT_GAP | 2 | 24 |
| 整幅宽 MEDIA_W | 62 | 732 → 补到 **736**（92 字节，EPL 按字节对齐） |
| 单格高 MEDIA_H | 20 | 236 |
| 行间距 GAP_Y | 2 | 24 |

**这四个值必须实物校准后再定稿**：`MEDIA_W / MEDIA_H / SLOT_GAP / GAP_Y`。校准方法见 §6。

## 3. 改动清单

### 3.1 `labelprint/profiles.py`（新增）

一个 `LabelProfile` 描述「介质 + 排版 + 指令集」，内置两份：

```python
BRADY_30x15_TSPL = LabelProfile(
    id="brady-30x15", media_w=703, media_h=178, slot_gap=1,
    command_set="tspl", margins=(15, 10), fonts=...)

POSTEK_30x20_EPL = LabelProfile(
    id="postek-30x20", media_w=736, media_h=236, slot_gap=24,
    command_set="epl", margins=(15, 14), fonts=...)
```

Brady 的数值全部照抄现有常量，**默认 profile 就是 Brady**，旧调用行为不变。

### 3.2 `labelprint/epl.py`（新增）

`build_job(images, copies, profile, invert) -> bytes`，与 `tspl.build_job` 同签名、同输入（PIL `mode='1'` 位图）。

每个标签一帧：

```
N\r\n            # 清缓冲
q736\r\n         # 介质宽度（点）
Q236,24\r\n      # 标签长度, 间距（点）
S3\r\n           # 速度
D15\r\n          # 浓度
ZT\r\n           # 方向：正向
GW0,0,92,236,<92×236 字节位图>\r\n
P<copies>\r\n
```

要点：

- **极性**：PIL `mode='1'` 里 0=黑；EPL 的 `GW` 是 1=黑，必须按位取反（复用 `tspl._bitmap_payload` 的填充位处理思路）；
- **宽度对齐**：736 点 = 92 字节正好整字节，无填充位问题（这是把 732 取整到 736 的原因之一）；
- **份数**：`P<copies>`，多张图逐帧重复；
- 速度/浓度先用 `S3 / D15` 对齐 Brady 观感，实物偏淡再调。

### 3.3 `labelprint/render.py`（参数化，不动默认行为）

把 `_render_compact_slot` / `render_two_up` 里写死的 `LABEL_H / SLOT_W / SLOT_MARGIN_* / *_PT` 改为从 `profile` 取，函数签名加 `profile=BRADY_30x15_TSPL` 默认值：

- `render_two_up(rows, date_str, profile=...)`
- `_render_compact_slot(row, profile)`

Brady 的默认值保持逐字节一致，现有 95 条测试应全绿（回归门槛）。

### 3.4 `labelprint/config.py` + `app.py`（路由）

打印机目录条目增加两个字段：

```json
[
  {"id":"brady-bbp12","name":"Brady BBP12","printer_name":"Brady BBP12",
   "command_set":"tspl","profile":"brady-30x15"},
  {"id":"postek-c168","name":"POSTEK C168/300s","printer_name":"POSTEK C168/300s",
   "command_set":"epl","profile":"postek-30x20"}
]
```

`app.py` 按 `printer_id` 解析出 profile，然后：

```
images = render.render_two_up(rows, today, profile)
job    = tspl.build_job(...) 或 epl.build_job(..., profile)   # 按 command_set 选
```

新增 `config.printers_from_file()`：优先读 `C:\labelprint\printers.json`，没有才回退 `LABELPRINT_PRINTERS_JSON`，避免把长 JSON 塞进计划任务的 PowerShell 引号里（这台机的 `daemon.ps1` 已经因为引号踩过坑）。

### 3.5 `labelprint/selfcheck.py`

`verify.bat` 现在写死「TSPL 指令生成」。改成按配置逐台检查，报告里写明：

```
[2/5] 打印指令生成 ...... 通过（brady-bbp12: TSPL / postek-c168: EPL）
```

### 3.6 `apps/web`（工作台）

1. `preview` 路由补 `printer_id`：现在预览不传打印机，渲染的是 Brady 版面；选了 POSTEK 再打印会对不上。改动点：
   - `app/api/v1/label-print/preview/route.ts`：接收 `printer_id`，解析成 `printer_key` 后传给服务；
   - `LabelPrintClient.tsx`：预览时带上当前选中的打印机；未选打印机时提示先选。
2. 管理员页新增一条打印机：`name=POSTEK C168/300s`、`printer_key=postek-c168`、启用；是否设为默认按现场需要。

### 3.7 部署

1. 以 `task-87` 分支为基线（多打印机能力），在其上加 EPL 提交；
2. 备份 `C:\labelprint`（代码目录，**不动 `data\labelprint.db`**）；
3. 覆盖 `labelprint\` 包 + `deploy\`，写 `C:\labelprint\printers.json`；
4. 重启计划任务 `LabelPrintService`；
5. 校验：`GET http://127.0.0.1:8080/api/printers` 两台都在且 `ready:true`；
6. 工作台管理员页加打印机 → 预览 → 实打 2 张。

回滚：停任务 → 还原备份目录 → 重启 → 删掉 `label_printers` 里新增那行。

## 4. 测试与验收

**单元测试（开发机）**

- `epl.build_job`：帧头字段、`GW` 头（92×236）、位图字节数、极性取反、份数、多图拼接；
- `render` 参数化后 Brady 输出与改动前**逐像素一致**（拿旧实现生成一张基准图做快照）；
- `app`：`printer_id=postek-c168` 时走 EPL 编码器、未知 `printer_id` 的降级、`/api/printers` 同时列出两台；
- 回归：现有 95 条 pytest 全绿。

**实物校准（windows-wg）**

校准标签内容：1 点外框（0,0→735,235）+ 每 30 点一根刻度线并标 mm 数 + 中线十字。

量尺读四件事：

1. 打印起点相对标签左边缘的偏移（决定要不要加 `x` 偏移）；
2. 标签实际高度与间距（改 `Q` 的两个参数）；
3. 双列分界是否正好落在两列之间的缝上（改 `SLOT_GAP`）；
4. 浓度是否够黑（调 `D`）。

**验收标准**

- 30×20 格内四边留白 ≥1 mm，字不压边；
- 双列两张各自居中在自己的标签里，不跨缝；
- 连打 10 张不丢步、不偏移累积；
- Brady 那张老路径实打一张，和改动前无差别。

## 5. 风险与未决点

| 风险 | 处理 |
|---|---|
| 介质实际不是 30×20（可能是 30×19 或含边距 64 mm） | 校准打印先量，再定 `profiles.py` 数值 |
| EPL `GW` 极性/原点与预期相反 | 校准标签一眼可见，改一个常量即可 |
| EPL 在 300 dpi 下的最大宽度限制 | 736 点远小于 4 英寸机头，风险低 |
| 打印机间距传感器模式（间隙/黑标）不对 | 现在 EPL 驱动能打，说明传感器已可用；校准若走纸不准再查面板 |
| 线上服务是 master 旧版，task-87 未部署 | 部署步骤里先上 task-87 再叠加 EPL，分两次验证 |
| 打印机其实支持 TSPL 切换 | **先花 2 分钟看面板菜单**：有 Language/Emulation 就切过去，本方案整个可以不做（改配置即可） |

## 6. 顺序与工作量

| 步骤 | 内容 | 预估 |
|---|---|---|
| 0 | 面板找语言切换（有则方案作废） | 10 min |
| 1 | 校准标签 + 量尺定四个参数 | 0.5 h |
| 2 | `epl.py` + 单测 | 3 h |
| 3 | `render` 参数化 + 快照回归 | 3 h |
| 4 | `config`/`app` 路由 + 自检 | 2 h |
| 5 | 工作台 preview 带 `printer_id` | 1 h |
| 6 | 部署 windows-wg + 实打验收 | 2 h |

合计约 1.5 个工作日（不含现场等纸、等打印的时间）。
