# -*- coding: utf-8 -*-
import sys
import types
import pytest


@pytest.fixture
def fake_win32print(monkeypatch):
    """伪造 win32print，使适配层可在 macOS 上测试。

    常量值与目标机（windows-wg）上 pywin32 的真实 win32print 模块逐条核对过，
    覆盖 printer.py 引用到的全部 PRINTER_STATUS_* 位，而不是只挑几个。
    """
    calls = []
    mod = types.ModuleType("win32print")
    mod.PRINTER_STATUS_PAUSED = 0x00000001
    mod.PRINTER_STATUS_ERROR = 0x00000002
    mod.PRINTER_STATUS_PENDING_DELETION = 0x00000004
    mod.PRINTER_STATUS_PAPER_JAM = 0x00000008
    mod.PRINTER_STATUS_PAPER_OUT = 0x00000010
    mod.PRINTER_STATUS_MANUAL_FEED = 0x00000020
    mod.PRINTER_STATUS_PAPER_PROBLEM = 0x00000040
    mod.PRINTER_STATUS_OFFLINE = 0x00000080
    mod.PRINTER_STATUS_IO_ACTIVE = 0x00000100
    mod.PRINTER_STATUS_BUSY = 0x00000200
    mod.PRINTER_STATUS_PRINTING = 0x00000400
    mod.PRINTER_STATUS_OUTPUT_BIN_FULL = 0x00000800
    mod.PRINTER_STATUS_NOT_AVAILABLE = 0x00001000
    mod.PRINTER_STATUS_WAITING = 0x00002000
    mod.PRINTER_STATUS_PROCESSING = 0x00004000
    mod.PRINTER_STATUS_INITIALIZING = 0x00008000
    mod.PRINTER_STATUS_WARMING_UP = 0x00010000
    mod.PRINTER_STATUS_TONER_LOW = 0x00020000
    mod.PRINTER_STATUS_NO_TONER = 0x00040000
    mod.PRINTER_STATUS_PAGE_PUNT = 0x00080000
    mod.PRINTER_STATUS_USER_INTERVENTION = 0x00100000
    mod.PRINTER_STATUS_OUT_OF_MEMORY = 0x00200000
    mod.PRINTER_STATUS_DOOR_OPEN = 0x00400000
    mod.PRINTER_STATUS_SERVER_UNKNOWN = 0x00800000
    mod.PRINTER_STATUS_POWER_SAVE = 0x01000000
    # Attributes 是跟 Status 完全不同的另一个位域，目标机实测核对过：
    # PRINTER_ATTRIBUTE_WORK_OFFLINE=0x400 是唯二能反映"打印机已注册但
    # 物理离线"的信号（Status 位域对这种情况恒为 0，测不出来）。
    mod.PRINTER_ATTRIBUTE_WORK_OFFLINE = 0x00000400

    def OpenPrinter(name):
        calls.append(("OpenPrinter", name))
        return 1234

    def StartDocPrinter(h, level, tup):
        calls.append(("StartDocPrinter", h, level, tup))
        return 39

    def StartPagePrinter(h):
        calls.append(("StartPagePrinter", h))

    def WritePrinter(h, data):
        calls.append(("WritePrinter", h, len(data)))
        return len(data)

    def EndPagePrinter(h):
        calls.append(("EndPagePrinter", h))

    def EndDocPrinter(h):
        calls.append(("EndDocPrinter", h))

    def ClosePrinter(h):
        calls.append(("ClosePrinter", h))

    def GetPrinter(h, level):
        calls.append(("GetPrinter", h, level))
        return {"Status": mod._status, "cJobs": mod._jobs,
                "Attributes": mod._attributes}

    mod.OpenPrinter = OpenPrinter
    mod.StartDocPrinter = StartDocPrinter
    mod.StartPagePrinter = StartPagePrinter
    mod.WritePrinter = WritePrinter
    mod.EndPagePrinter = EndPagePrinter
    mod.EndDocPrinter = EndDocPrinter
    mod.ClosePrinter = ClosePrinter
    mod.GetPrinter = GetPrinter
    mod._status = 0
    mod._jobs = 0
    # 0x1a40：目标机上 Brady BBP12（在线状态）GetPrinter 实测到的真实
    # Attributes 值，做默认基线；单独测脱机时按位或上 WORK_OFFLINE。
    mod._attributes = 0x1a40
    mod.calls = calls

    monkeypatch.setitem(sys.modules, "win32print", mod)
    for name in list(sys.modules):
        if name.startswith("labelprint.printer"):
            del sys.modules[name]
    # 修复：仅清 sys.modules 不够——`from labelprint import printer` 在
    # labelprint 包对象仍持有旧 printer 属性时，会走属性查找而不重新导入，
    # 导致跨用例复用上一次绑定的 win32print stub。必须一并清掉该属性。
    _pkg = sys.modules.get("labelprint")
    if _pkg is not None and hasattr(_pkg, "printer"):
        delattr(_pkg, "printer")
    return mod


def test_send_raw_uses_raw_datatype_and_correct_order(fake_win32print):
    from labelprint import printer
    job = printer.send_raw(b"SIZE 59.5 mm, 15.1 mm\r\n", "unit-test")
    assert job == 39
    names = [c[0] for c in fake_win32print.calls]
    assert names == ["OpenPrinter", "StartDocPrinter", "StartPagePrinter",
                     "WritePrinter", "EndPagePrinter", "EndDocPrinter",
                     "ClosePrinter"]
    start = [c for c in fake_win32print.calls if c[0] == "StartDocPrinter"][0]
    assert start[3] == ("unit-test", None, "RAW"), "必须以 RAW 数据类型提交"
    assert [c for c in fake_win32print.calls if c[0] == "OpenPrinter"][0][1] == "Brady BBP12"


def test_closes_printer_even_when_write_fails(fake_win32print):
    from labelprint import printer

    def boom(h, data):
        fake_win32print.calls.append(("WritePrinter", h, len(data)))
        raise OSError("模拟写入失败")

    fake_win32print.WritePrinter = boom
    with pytest.raises(OSError):
        printer.send_raw(b"x", "unit-test")
    assert ("ClosePrinter", 1234) in fake_win32print.calls, "异常路径也必须关闭句柄"


def test_status_ready_when_zero(fake_win32print):
    from labelprint import printer
    fake_win32print._status = 0
    fake_win32print._jobs = 0
    st = printer.status()
    assert st["ready"] is True
    assert st["jobs"] == 0


def test_status_reports_human_reason_when_paused(fake_win32print):
    from labelprint import printer
    fake_win32print._status = fake_win32print.PRINTER_STATUS_PAUSED
    st = printer.status()
    assert st["ready"] is False
    assert "暂停" in st["reason"]


def test_status_reports_paper_out(fake_win32print):
    from labelprint import printer
    fake_win32print._status = fake_win32print.PRINTER_STATUS_PAPER_OUT
    st = printer.status()
    assert st["ready"] is False
    assert "缺纸" in st["reason"]


def test_status_ready_true_when_printing(fake_win32print):
    """「正在打印」是正常工作阶段，绝不能被判定为不可用——否则上一批标签
    还在打印机里走纸时，下一批正常提交就会被误判为「打印机不可用」拒绝。"""
    from labelprint import printer
    fake_win32print._status = fake_win32print.PRINTER_STATUS_PRINTING
    st = printer.status()
    assert st["ready"] is True
    assert "打印" not in st["reason"]
    assert "打印" in st["notes"]


def test_status_ready_true_when_warming_up(fake_win32print):
    """预热中同样是正常瞬时阶段，不能被判定为不可用。"""
    from labelprint import printer
    fake_win32print._status = fake_win32print.PRINTER_STATUS_WARMING_UP
    st = printer.status()
    assert st["ready"] is True
    assert st["reason"] == ""
    assert "预热" in st["notes"]


def test_status_reports_door_open_as_blocking(fake_win32print):
    """真正的「舱门未关」（0x400000）必须拦住，且中文提示里要能看到「门」。
    brief 原始实现把这一位错标成了 0x400（实际是「正在打印」），本用例
    专门锁定真实位号，防止再错。"""
    from labelprint import printer
    fake_win32print._status = fake_win32print.PRINTER_STATUS_DOOR_OPEN
    st = printer.status()
    assert st["ready"] is False
    assert "门" in st["reason"]


def test_status_reason_lists_all_blocking_bits_when_combined(fake_win32print):
    """多个阻断位同时置位时，reason 要把每一条都列出来，不能只报其中一条。"""
    from labelprint import printer
    fake_win32print._status = (
        fake_win32print.PRINTER_STATUS_PAPER_OUT
        | fake_win32print.PRINTER_STATUS_DOOR_OPEN
    )
    st = printer.status()
    assert st["ready"] is False
    assert "缺纸" in st["reason"]
    assert "门" in st["reason"]


def test_status_reports_offline_via_attributes_not_status_bits(fake_win32print):
    """目标机真机实测过的真实案例：打印机已注册但物理离线（USB 拔线/关机）
    时，Status 位域恒为 0，跟正常在线的打印机完全一样——GetPrinter 测不出
    这件事，唯一的信号是 Attributes 位域里的 PRINTER_ATTRIBUTE_WORK_OFFLINE。
    这条用例专门锁定这个此前测不出来的假绿灯：Status 保持 0（正常），只把
    Attributes 加上 WORK_OFFLINE 位，ready 必须变 False。
    """
    from labelprint import printer
    fake_win32print._status = 0
    fake_win32print._attributes = 0x1a40 | fake_win32print.PRINTER_ATTRIBUTE_WORK_OFFLINE
    st = printer.status()
    assert st["ready"] is False
    assert "脱机" in st["reason"]


def test_status_ready_when_online_attributes_have_no_offline_bit(fake_win32print):
    """对照组：Attributes 不含 WORK_OFFLINE 位（默认基线）时不受影响，
    ready 仍为 True——确认新增的这一位检查没有误伤正常在线的打印机。"""
    from labelprint import printer
    fake_win32print._status = 0
    st = printer.status()
    assert st["ready"] is True
    assert st["reason"] == ""
