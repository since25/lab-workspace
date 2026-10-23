# -*- coding: utf-8 -*-
"""selfcheck.check_link() 的控制流验证（最终整支审查 C1/C2 修复轮新增）。

printer_guard.ps1 本身依赖真实 Windows CIM/WMI（Get-CimInstance/
Invoke-CimMethod），在 macOS 开发机上完全跑不了，也不该在真实打印机上试——
那部分的验证（只作用于目标打印机、Pause 后回读确认真的暂停）走的是目标机
上的假 CIM 环境脚本，证据见 final-fix-report.md。

这里只验证、也只能验证 selfcheck.py 自己这一层的控制流性质，跟 PowerShell
脚本内部怎么实现无关：不管 _run_guard("Pause") 因为什么原因返回非 0（目标
打印机没找到、真没暂停成功、WMI 调用异常……），check_link() 都必须在调用
printer.send_raw() 之前就停下来——这正是 C2 描述的事故路径的最后一道闸门：
Pause 报告失败时，绝不能把真实数据发给打印机。
"""
import sys
import types

import pytest


@pytest.fixture
def fake_printer_module(monkeypatch):
    """伪造 labelprint.printer 整个模块，只关心 send_raw 有没有被调用，
    不做任何真实 IO——不依赖 pywin32，Mac 上也能跑。
    """
    calls = []
    mod = types.ModuleType("labelprint.printer")
    mod.PRINTER_NAME = "Brady BBP12"

    def send_raw(data, doc_name="labelprint"):
        calls.append(("send_raw", doc_name, len(data)))
        return 1

    def status():
        return {"status": 0, "jobs": 0, "ready": True, "reason": "", "notes": ""}

    mod.send_raw = send_raw
    mod.status = status
    mod.calls = calls

    monkeypatch.setitem(sys.modules, "labelprint.printer", mod)
    # 跟 test_printer.py 的 fake_win32print 同一个理由：labelprint 包对象
    # 如果已经持有旧的 printer 属性，`from labelprint import printer` 会走
    # 属性查找而不重新导入，必须一并替换掉该属性，否则跨用例会串数据。
    _pkg = sys.modules.get("labelprint")
    if _pkg is not None:
        monkeypatch.setattr(_pkg, "printer", mod, raising=False)
    return mod


@pytest.fixture(autouse=True)
def _no_real_sleep(monkeypatch):
    """selfcheck.check_link() 在正常路径里有 time.sleep(3)，测试不需要真的
    等——这不是在测"等待"这件事本身，跳过它只是让用例跑得快。"""
    from labelprint import selfcheck
    monkeypatch.setattr(selfcheck.time, "sleep", lambda seconds: None)


@pytest.fixture
def fake_spool_dir(monkeypatch, tmp_path):
    """check_link() 里硬编码的 _SPOOL_DIR 是 Windows 路径，Mac 上不存在，
    指向一个真实存在的空临时目录，避免 os.listdir 直接因路径不存在而报错、
    掩盖掉本测试真正关心的行为。"""
    from labelprint import selfcheck
    monkeypatch.setattr(selfcheck, "_SPOOL_DIR", str(tmp_path))
    return tmp_path


def test_check_link_never_sends_when_pause_fails(fake_printer_module, fake_spool_dir, monkeypatch):
    """C2 的核心断言：Pause 失败（比如目标打印机没找到，退出码非 0）时，
    check_link() 绝不能走到 printer.send_raw()——这是本项目吃过的同一类
    假绿灯（只看调用没报错，不看是否真的生效）在收尾处的最后一道防线。
    """
    from labelprint import selfcheck

    guard_calls = []

    def fake_run_guard(action):
        guard_calls.append(action)
        if action == "Pause":
            return 1, "找不到名为「Brady BBP12」的打印机，Pause 未作用于任何打印机", ""
        return 0, "", ""  # 收尾的 Purge / Resume 照常报告成功

    monkeypatch.setattr(selfcheck, "_run_guard", fake_run_guard)

    with pytest.raises(RuntimeError) as exc_info:
        selfcheck.check_link()

    assert "暂停打印机失败" in str(exc_info.value)
    assert fake_printer_module.calls == [], (
        "Pause 失败时不应该调用 printer.send_raw()，实际调用了：%s"
        % fake_printer_module.calls)
    # 即使 Pause 失败，收尾的 Purge 和 Resume 仍必须被尝试到——这是已有的
    # "最后一道防线，任何情况下都要走"设计，顺手锁一下，不属于本轮改动
    assert guard_calls == ["Pause", "Purge", "Resume"]


def test_check_link_sends_when_pause_succeeds(fake_printer_module, fake_spool_dir, monkeypatch):
    """对照组：Pause 成功时 check_link 必须正常走到发送这一步——证明上面
    那条用例不是靠"整个函数从来不发送"这种退化实现蒙混过关的。这里不模拟
    真实的假脱机行为，预期在"没有生成 spool 文件"这一步失败，但那已经在
    printer.send_raw() 被调用之后，本用例只关心"有没有调用"。
    """
    from labelprint import selfcheck

    monkeypatch.setattr(selfcheck, "_run_guard", lambda action: (0, "ok", ""))

    with pytest.raises(RuntimeError) as exc_info:
        selfcheck.check_link()

    assert "没有生成 spool 文件" in str(exc_info.value)
    assert len(fake_printer_module.calls) == 1, (
        "Pause 成功时应该走到且只走到一次 printer.send_raw()，实际调用：%s"
        % fake_printer_module.calls)


def test_run_guard_passes_printer_name_from_printer_module(fake_printer_module, monkeypatch):
    """C1 的 Python 侧对应断言：_run_guard 传给 printer_guard.ps1 的
    -PrinterName 必须来自 printer.PRINTER_NAME 这个唯一权威来源，不能是
    Python 这边另外硬编码的一份——否则两边一旦有一边改名忘了改另一边，
    就会安静地错位（Python 传的名字在 PowerShell 那边找不到匹配的打印机，
    详见 printer_guard.ps1 里"目标为空即失败"的检查）。
    """
    from labelprint import selfcheck

    captured = {}

    class FakeCompletedProcess:
        returncode = 0
        stdout = b""
        stderr = b""

    def fake_run(cmd, **kwargs):
        captured["cmd"] = cmd
        return FakeCompletedProcess()

    monkeypatch.setattr(selfcheck.subprocess, "run", fake_run)

    selfcheck._run_guard("Pause")

    cmd = captured["cmd"]
    assert "-PrinterName" in cmd, "必须显式传 -PrinterName，不能依赖 PowerShell 脚本自己的默认值"
    idx = cmd.index("-PrinterName")
    assert cmd[idx + 1] == "Brady BBP12"
    assert cmd[idx + 1] == fake_printer_module.PRINTER_NAME
