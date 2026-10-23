# -*- coding: utf-8 -*-
"""一键自检：双击 verify.bat 即可运行，面向不写代码的实验室人员，输出中文人话。

五项检查：
    1. 标签渲染          纯 Python/Pillow 逻辑，零实物，两台机器上都应该真的跑通
    2. TSPL 指令生成      纯字节逻辑，零实物，两台机器上都应该真的跑通
    3. 打印链路（不出纸） 暂停打印机 -> 真发送 -> 比对 spool -> 清空 -> 恢复，
                         需要 Windows + pywin32 + 真实打印机；开发机（Mac）上
                         没有这些，明确报告"本机不适用"，不装作通过、也不崩溃
    4. 打印机状态         只读查询，同样需要 Windows + pywin32
    5. 自动化测试套件      跑 tests\\ 下的 pytest 用例，断言没有真正失败的用例。
                         这个项目吃过"静默跳过=没跑但看起来是绿的"的真亏（详见
                         tests/test_frontend.py 头部注释）：没装 node 的机器上，
                         纯 JS 逻辑那条用例会 skip 而不是 fail。这里不把"跳过"
                         悄悄算成"通过"——跳过几项、为什么跳过，都如实写进
                         结果；但只要没有真正 failed 的用例，也不把它打成红色
                         "失败"去吓唯一不写代码的用户，单独算作"跳过"

每一项检查的结果只有三种，不允许把"跳过"伪装成"通过"：
    通过 —— 真的跑了，符合预期
    失败 —— 真的跑了，不符合预期，或者过程中出了不该出的异常
    跳过 —— 因为已知的、非代码缺陷的原因这次没能完整验证（环境缺组件，如
           本机没装 pywin32/node），原因写清楚，不计入"失败"，但也绝不会
           显示成"通过"；跳过项必须在白名单内，白名单外的跳过一律算失败
"""
import os
import re
import subprocess
import sys
import time
from datetime import date

RESULTS = []  # [(序号, 标题, 'pass'/'fail'/'skip', 说明文字), ...]

# selfcheck.py 部署后位于 C:\lab-workspace\app\labelprint\labelprint\ 下（作为
# labelprint 包的一个模块，用 `python -m labelprint.selfcheck` 从
# C:\lab-workspace\app\labelprint 启动，见 verify.bat）。deploy\ 和
# preview\ 都挂在项目根目录（上一级），不是 __file__ 自己所在的包目录——直接用
# os.path.dirname(__file__) 会指到包目录本身，差一层。
_PKG_DIR = os.path.dirname(os.path.abspath(__file__))
_PROJECT_ROOT = os.path.dirname(_PKG_DIR)
_GUARD_PS1 = os.path.join(_PROJECT_ROOT, "deploy", "printer_guard.ps1")
_TESTS_DIR = os.path.join(_PROJECT_ROOT, "tests")
_SPOOL_DIR = r"C:\Windows\System32\spool\PRINTERS"

try:
    sys.stdout.reconfigure(encoding="utf-8")  # 避免 Windows 控制台代码页把中文输出转乱码
    sys.stderr.reconfigure(encoding="utf-8")  # 同上：Python 自身的警告等信息走 stderr
except AttributeError:
    pass  # 极少数环境 stdout/stderr 没有 reconfigure，不因此中断


class Skip(Exception):
    """这一项这次没能完整验证，但不代表代码有缺陷（环境限制、已知跳过项等）。"""


def step(no, title, fn):
    try:
        detail = fn()
        RESULTS.append((no, title, "pass", detail))
    except Skip as exc:
        RESULTS.append((no, title, "skip", str(exc)))
    except Exception as exc:
        RESULTS.append((no, title, "fail", str(exc)))


def _require_windows_printer():
    """打印相关检查的共同前提：本机要有 pywin32。开发机（Mac）没有，这不是
    缺陷，是这台机器本来就不该跑这一项——明确报告"跳过"，而不是崩溃或假装通过。
    """
    try:
        from labelprint import printer  # noqa: F401
    except ImportError as exc:
        raise Skip(
            "本机没有 pywin32（%s）。这项检查依赖 Windows 打印驱动，只能在目标 "
            "Windows 机器上验证，开发用的 Mac 上不适用" % exc)


def _printer_error_message(exc, printer_name):
    """把 pywin32 打印机调用的异常转成中文人话：结论和建议动作在前，原始
    技术信息垫底——这是本项目给非程序员看的内容的统一行文口径。之前的
    版本是"英文元组在前、中文解释在后"，而 check_link()（第 3 项）排在
    check_printer()（第 4 项）前面执行，用户会先看到一句读不懂的英文，
    往下翻才看到中文解释，同一个故障、同一份报告里一冷一热两种表述，
    反而让人以为出了两个毛病。现在两处统一调用这一份文案。
    """
    return (
        "打印机连不上，常见原因：没开机、USB 线没插好，或者被拔掉/卸载/"
        "改名了（当前配置要连的是「%s」）。请检查打印机电源与连接后重试。"
        "（技术信息：%s）" % (printer_name, exc)
    )


def check_render():
    from labelprint.model import LabelRow
    from labelprint import render
    outdir = os.path.join(_PROJECT_ROOT, "preview")
    os.makedirs(outdir, exist_ok=True)
    today = date.today().strftime("%Y-%m-%d")
    samples = [
        LabelRow(sample="G1_WT-1_U", conc="128.5", ratio="1.85"),
        LabelRow(sample="只有样品名"),
        LabelRow(sample="G1_WT_KNOCKOUT_REPLICATE_12_UNTREATED_LONG", conc="9.9"),
    ]
    for i, row in enumerate(samples, 1):
        img = render.render_label(row, today)
        assert img.size == (703, 178), "画布尺寸不对：%s" % (img.size,)
        assert 0 in img.get_flattened_data(), "画布全白，没画上去"
        img.convert("L").save(os.path.join(outdir, "sample%d.png" % i))

    # 专门核验第一张样例（含下划线的样品名 + 第二行浓度/比值）：第二行的
    # 起始位置必须按这台机器实际用的字体的真实字形下边界算，不能按标称
    # 字号估算——真实发生过的错标：生产字体（微软雅黑加粗）下按标称字号
    # 估算会把下划线压进第二行、跟第二行文字糊在一起，G1_WT-1_U 因此被
    # 印成看不出下划线的 G1 WT-1 U。这跟 tests/test_render.py 里的
    # test_second_line_does_not_collide_with_name_descender 是同一条断言，
    # 之所以在 selfcheck 里也放一份：只有目标机才有生产字体，这项检查必须
    # 在目标机上被持续验证，不能只指望开发机上的 pytest 兜底。
    name = samples[0].sample.strip()
    usable = render.LABEL_W - 2 * render.MARGIN_X
    name_pt = render.fit_font_size(name, usable, render.NAME_MAX_PT)
    name_bottom = render.MARGIN_TOP + render._bold(name_pt).getbbox(name)[3]
    img0 = render.render_label(samples[0], today)
    gap, y = 0, name_bottom
    while y < render.LABEL_H and 0 not in img0.crop((0, y, render.LABEL_W, y + 1)).get_flattened_data():
        gap += 1
        y += 1
    assert gap >= 2, (
        "样品名真实字形下边界（y=%d）往下没找到空白间隙（只有 %d 行空白），"
        "下划线等下伸部分可能与第二行文字重叠" % (name_bottom, gap))

    return "预览图已存到 preview\\，共 %d 张；下划线与第二行不重叠核验通过" % len(samples)


def check_tspl():
    from labelprint.model import LabelRow
    from labelprint import render, tspl
    img = render.render_label(LabelRow(sample="S1"), "2026-01-01")
    job = tspl.build_job([img], copies=1)
    head = job[:200].decode("latin-1")
    assert head.startswith("SIZE 59.5 mm, 15.1 mm"), "指令头不对"
    assert b"BITMAP 0,0,88,178,0," in job, "缺 BITMAP 指令"
    assert b"PRINT 1,1" in job, "缺 PRINT 指令"
    assert b"GAP" not in job, "不应出现 GAP 指令"
    return "指令 %d 字节，结构正确" % len(job)


def _run_guard(action):
    """调用 printer_guard.ps1，返回 (退出码, stdout 文本, stderr 文本)。

    成败判定一律用退出码，不解析中文文本——PowerShell 经不同方式调用时控制台
    代码页可能不一致，这个项目已经因为类似原因出过乱码事故（其中一次导致命令
    穿透到真实打印机），退出码不受编码影响；文本只用来给人看，尽量还原，
    解码失败时用 replace 兜底，不会因为编码问题让脚本本身崩溃。

    显式传 -PrinterName，不依赖 printer_guard.ps1 自己的默认值：打印机名的
    唯一权威来源是 printer.py 的 PRINTER_NAME，这里跟它保持同一份，避免
    Python/PowerShell 两边各写一份、日后改了一边忘了另一边。这个函数只会在
    _require_windows_printer() 已经确认 printer 模块可正常导入之后才被调用
    （check_link() 的调用顺序保证了这一点），所以这里直接导入不会失败。
    """
    from labelprint import printer
    r = subprocess.run(
        ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass",
         "-File", _GUARD_PS1, "-Action", action, "-PrinterName", printer.PRINTER_NAME],
        capture_output=True, timeout=30)
    out = r.stdout.decode("utf-8", errors="replace").strip()
    err = r.stderr.decode("utf-8", errors="replace").strip()
    return r.returncode, out, err


def check_link():
    """暂停打印机 -> 真发 -> 抓 spool 比对 -> 清空 -> 恢复。零实物。

    控制流已经过多轮对抗式审查验证：Pause 本身也在保护范围内（哪怕 Pause
    自己抛异常也要走到收尾）；收尾的 Purge 与 Resume 各自单独 try/except、
    互相隔离（一个失败不能连累另一个，Resume 是最后一道防线，任何情况下都
    必须尝试）。printer_guard.ps1 只作用于 printer.PRINTER_NAME 这一台
    （见该文件头部注释），这台机上其它实验室共享打印机（激光打印机等）
    不会被这里的 Pause/Purge/Resume 碰到。
    """
    _require_windows_printer()
    from labelprint.model import LabelRow
    from labelprint import printer, render, tspl

    problems = []
    ok_detail = [None]

    try:
        code, out, err = _run_guard("Pause")
        if code != 0:
            problems.append("暂停打印机失败（exit=%d）：%s" % (code, out or err))
        else:
            code, out, err = _run_guard("Purge")
            if code != 0:
                problems.append("发送前清空队列失败（exit=%d）：%s" % (code, out or err))

            before = set(os.listdir(_SPOOL_DIR))
            img = render.render_label(LabelRow(sample="SELFCHECK"), "2026-01-01")
            job = tspl.build_job([img], copies=1)
            try:
                printer.send_raw(job, "selfcheck")
            except Exception as exc:
                # 同一份中文文案，跟 check_printer() 共用——这一项排在
                # check_printer() 前面执行，不能让用户先看到一句读不懂的
                # 英文元组，翻到下一项才看到中文解释
                problems.append(_printer_error_message(exc, printer.PRINTER_NAME))
            else:
                time.sleep(3)
                new = [f for f in os.listdir(_SPOOL_DIR)
                       if f not in before and f.upper().endswith(".SPL")]
                if not new:
                    problems.append("没有生成 spool 文件，作业没进队列")
                else:
                    path = os.path.join(_SPOOL_DIR, new[0])
                    with open(path, "rb") as fh:
                        captured = fh.read()
                    if captured != job:
                        problems.append(
                            "打印机收到的字节与发送的不一致：收到 %d，发送 %d"
                            % (len(captured), len(job)))
                    else:
                        ok_detail[0] = "已送出并逐字节比对一致（%d 字节）" % len(job)
    except Exception as exc:
        problems.append("链路测试过程中出现异常：%s" % exc)
    finally:
        try:
            code, out, err = _run_guard("Purge")
            if code != 0:
                problems.append("收尾清空队列失败（exit=%d）：%s" % (code, out or err))
        except Exception as exc:
            problems.append("收尾清空队列时出现异常：%s" % exc)

        try:
            code, out, err = _run_guard("Resume")
            if code != 0:
                problems.append(
                    "恢复打印机失败（exit=%d）：%s——请立刻人工检查实体打印机是否卡在暂停状态"
                    % (code, out or err))
        except Exception as exc:
            problems.append(
                "恢复打印机时出现异常：%s——请立刻人工检查实体打印机是否卡在暂停状态" % exc)

        # 字节比对一致只能证明"作业成功进了 spool 队列"，不能证明"打印机
        # 真的能打"——目标机实测过：打印机已注册但物理离线（USB 拔线/关机）
        # 时，Windows 假脱机服务照样会把作业收进队列、字节完全一致，但纸
        # 永远不会出来。这里必须在 Resume 之后再查一次真实联机状态：如果
        # 在 try 内、Resume 之前查，我们自己主动 Pause 的这一位会一直是
        # 「打印机被暂停」，跟"打印机真的有问题"分不清——一度真的把这两者
        # 混在一起，导致连健康的 Brady BBP12 也被误判失败，发现后改成
        # Resume 之后再查。
        if ok_detail[0] is not None:
            try:
                st = printer.status()
            except Exception as exc:
                problems.append(_printer_error_message(exc, printer.PRINTER_NAME))
                ok_detail[0] = None
            else:
                if not st["ready"]:
                    problems.append(
                        "作业已进入队列且字节比对一致，但恢复后打印机状态异常：%s"
                        "——队列里的作业不会被真正打印出来，不能算通过"
                        % (st["reason"] or "状态码 %s" % st["status"]))
                    ok_detail[0] = None

    if problems:
        raise RuntimeError("；".join(problems))
    return ok_detail[0] + "，未出纸，打印机已恢复"


def check_printer():
    _require_windows_printer()
    from labelprint import printer
    # printer.status() 内部直接调 win32print.OpenPrinter，打印机名不存在/
    # 打印机被拔掉或卸载时会抛出 pywintypes.error，形如
    # (1801, 'OpenPrinter', '打印机名无效。')——这种原始异常直接透给用户
    # 没有意义，这里包一层转成看得懂的中文。不改 printer.py 本身（那是
    # Task 3 的代码，改动面越小越好）。
    try:
        st = printer.status()
    except Exception as exc:
        raise RuntimeError(_printer_error_message(exc, printer.PRINTER_NAME))
    if not st["ready"]:
        raise RuntimeError(st["reason"] or "状态码 %s" % st["status"])
    return "就绪，队列 %d 个作业" % st["jobs"]


def _count(text, word):
    m = re.search(r"(\d+) " + word, text)
    return int(m.group(1)) if m else 0


def _summary_lines(text, prefix):
    return [ln for ln in text.splitlines() if ln.startswith(prefix)]


# 已知且被接受的跳过项白名单——凡是不在这份名单里的跳过一律当"失败"处理，
# 不能算"跳过"。理由：目标机永远不会装 node，白名单里这一条会永久跳过，
# 天长日久会变成没人在意的背景噪音；如果不设白名单，某天新冒出来的一条
# 意外跳过会被这条"永远存在"的噪音盖住，没人会注意到。nodeid 统一用
# 正斜杠——Windows 下 pytest 输出的是反斜杠，比对前会先归一化。
_EXPECTED_SKIPS = {
    "tests/test_frontend.py::test_row_compare_pure_logic_via_node",
}


def _normalize_nodeid(nodeid):
    return nodeid.replace("\\", "/")


def check_pytest_suite():
    """跑 tests\\ 下的 pytest 用例，断言没有非预期跳过、没有失败。

    "静默跳过=没跑但看起来是绿的"是这个项目吃过的真实亏：
    tests/test_frontend.py 里有一条纯 JS 逻辑测试，本机没装 node 时会 skip
    而不是 fail。这里不把跳过悄悄算成通过——跳过几项、为什么跳过，都会如实
    写进结果；但也不是"只要有跳过就一律算失败去吓用户"：跳过项对照
    _EXPECTED_SKIPS 白名单逐条核对，只有全部在白名单内才归为"跳过"，
    任何一条不在名单内的跳过都当"失败"处理——否则目标机上永远存在的
    "没装 node"这一条跳过会掩盖某天新出现的、真正需要被人注意到的跳过。
    """
    if not os.path.isdir(_TESTS_DIR):
        raise Skip("本机没有 tests\\ 目录，这项检查无法运行")

    all_files = sorted(f for f in os.listdir(_TESTS_DIR)
                        if f.startswith("test_") and f.endswith(".py"))
    if not all_files:
        raise Skip("tests\\ 目录下没有测试文件")

    # 不区分"哪个测试文件依赖的模块本机还没有"，全部交给 pytest 收集——
    # 曾经加过一层"依赖的模块不存在就跳过收集"的机制，是为了 Task 7 自己
    # 部署顺序的过渡期（那时 app.py 还没推到目标机），但这个机制有个真实
    # 的漏洞：如果一个已经部署好的核心模块（比如 app.py）哪天意外消失了
    # （误删、部署出错、被篡改），它会被这套机制当成"还没部署"悄悄跳过收集，
    # 报告里显示"跳过"、退出码还是 0，而不是应有的"失败"。现在这几个模块
    # 已经全部部署到位，不再需要这层特殊处理；交给 pytest 后，如果某个
    # 测试文件真的因为缺模块而无法收集，pytest 会报 collection error、
    # 非 0/1 退出码，下面已有的分支会把它当成真正的失败处理，不会被静默放过。

    env = dict(os.environ)
    env["PYTHONIOENCODING"] = "utf-8"  # 让子进程用 UTF-8 输出，不依赖系统代码页猜测
    # 用 -v（逐条列出 "<nodeid> SKIPPED" 这样的行）而不是 -q，是为了能精确
    # 拿到每一条跳过用例的完整 nodeid 去核对白名单——q 模式配 -ra 的短摘要
    # 只给 "file:line"（Windows 下还是反斜杠），既没有函数名，也没法可靠
    # 判断"是不是白名单里那一条"。
    cmd = [sys.executable, "-m", "pytest", "-v", "--no-header", "-ra"] + \
        [os.path.join(_TESTS_DIR, f) for f in all_files]
    try:
        proc = subprocess.run(cmd, capture_output=True, timeout=180,
                              cwd=_PROJECT_ROOT, env=env)
    except subprocess.TimeoutExpired:
        raise RuntimeError("pytest 180 秒内没有跑完，判定为挂起")

    output = (proc.stdout.decode("utf-8", errors="replace") +
              proc.stderr.decode("utf-8", errors="replace"))

    if "No module named pytest" in output or "No module named 'pytest'" in output:
        raise Skip("本机没有安装 pytest，这项检查无法运行")

    if proc.returncode not in (0, 1):
        # 0=全部通过，1=有失败但正常跑完；其余返回码代表跑法本身有问题（命令行
        # 用错、内部错误、一个用例都没收集到等），不是"测试失败"，原始信息全贴出来
        raise RuntimeError(
            "pytest 异常退出（exit=%d），不是正常的测试失败：\n%s"
            % (proc.returncode, output[-3000:]))

    passed = _count(output, "passed")
    failed = _count(output, "failed")
    errors = _count(output, "error")
    skipped = _count(output, "skipped")

    # 逐行找 "<nodeid> SKIPPED ..."（-v 模式的每用例结果行），拿到完整
    # nodeid 后统一路径分隔符，再对照白名单
    skipped_nodeids = []
    for ln in output.splitlines():
        m = re.match(r"^(\S+)\s+SKIPPED\b", ln)
        if m:
            skipped_nodeids.append(_normalize_nodeid(m.group(1)))
    unexpected_skips = [n for n in skipped_nodeids if n not in _EXPECTED_SKIPS]

    if failed or errors or unexpected_skips:
        lines = _summary_lines(output, "FAILED") + _summary_lines(output, "ERROR")
        reasons = []
        if failed or errors:
            reasons.append("%d 个用例失败、%d 个用例出错" % (failed, errors))
        if unexpected_skips:
            reasons.append("%d 个非预期跳过（不在白名单内）：%s"
                           % (len(unexpected_skips), "、".join(unexpected_skips)))
        raise RuntimeError(
            "%s（%d 个通过、%d 个跳过）：\n%s"
            % ("；".join(reasons), passed, skipped, "\n".join(lines)))

    if skipped:
        # 走到这里说明每一条跳过都在白名单内，如实报告但不算失败
        lines = _summary_lines(output, "SKIPPED")
        raise Skip(
            "%d 个用例通过，%d 个用例跳过（均为已知白名单内的跳过），原因：\n%s"
            % (passed, skipped, "\n".join(lines)))

    return "%d 个用例全部通过，0 个跳过" % passed


def main():
    step(1, "标签渲染", check_render)
    step(2, "TSPL 指令生成", check_tspl)
    step(3, "打印链路（不出纸）", check_link)
    step(4, "打印机状态", check_printer)
    step(5, "自动化测试套件", check_pytest_suite)

    total = len(RESULTS)
    mark_text = {"pass": "通过", "fail": "失败", "skip": "跳过"}

    print()
    failed = 0
    skipped = 0
    for no, title, status, detail in RESULTS:
        dots = "." * max(2, 26 - len(title) * 2)
        print("[%d/%d] %s %s %s —— %s" % (no, total, title, dots, mark_text[status], detail))
        if status == "fail":
            failed += 1
        elif status == "skip":
            skipped += 1

    print()
    if failed:
        print("有 %d 项没通过。把上面这段整个发给 Claude 即可。" % failed)
    elif skipped:
        print("功能性检查全部通过；另有 %d 项因已知原因这次没能完整验证（原因见上），"
              "不代表打印功能有问题。" % skipped)
        print("preview 文件夹里可以看到标签长什么样。")
    else:
        print("全部通过。preview 文件夹里可以看到标签长什么样。")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
