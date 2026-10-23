# -*- coding: utf-8 -*-
"""Windows 打印适配层——本项目唯一依赖 pywin32 的模块。

RAW 通道为单向下发，打印机不回传结果：只能确认作业进入队列，
不能确认标签实际印出。对外用语一律为「送出」。
"""
import os

import win32print

PRINTER_NAME = os.environ.get("LABELPRINT_PRINTER_NAME", "Brady BBP12")

# 阻断性故障：命中任意一条，ready 必须为 False，需要人工处理才能继续打印。
# 位号一律引用 win32print.PRINTER_STATUS_* 常量，不手写十六进制，防止位号抄错。
_BLOCKING_STATUS = [
    (win32print.PRINTER_STATUS_PAUSED, "打印机被暂停"),
    (win32print.PRINTER_STATUS_ERROR, "打印机报错"),
    (win32print.PRINTER_STATUS_PENDING_DELETION, "正在删除作业"),
    (win32print.PRINTER_STATUS_PAPER_JAM, "卡纸"),
    (win32print.PRINTER_STATUS_PAPER_OUT, "缺纸或缺标签"),
    (win32print.PRINTER_STATUS_PAPER_PROBLEM, "纸张异常"),
    (win32print.PRINTER_STATUS_OFFLINE, "打印机离线"),
    (win32print.PRINTER_STATUS_OUTPUT_BIN_FULL, "出纸槽已满"),
    (win32print.PRINTER_STATUS_NOT_AVAILABLE, "打印机不可用"),
    (win32print.PRINTER_STATUS_NO_TONER, "缺色带"),
    (win32print.PRINTER_STATUS_PAGE_PUNT, "页面处理失败"),
    (win32print.PRINTER_STATUS_USER_INTERVENTION, "需要人工处理"),
    (win32print.PRINTER_STATUS_OUT_OF_MEMORY, "打印机内存不足"),
    (win32print.PRINTER_STATUS_DOOR_OPEN, "舱门未关闭"),
    (win32print.PRINTER_STATUS_SERVER_UNKNOWN, "打印服务器状态未知"),
]

# 正常瞬时状态：打印过程中会经过的正常阶段，不影响 ready。
# 否则「上一批还在打」会被误判成「打印机不可用」，把下一批正常提交挡在外面。
_TRANSIENT_STATUS = [
    (win32print.PRINTER_STATUS_IO_ACTIVE, "正在通信"),
    (win32print.PRINTER_STATUS_BUSY, "忙碌"),
    (win32print.PRINTER_STATUS_PRINTING, "正在打印"),
    (win32print.PRINTER_STATUS_WAITING, "等待中"),
    (win32print.PRINTER_STATUS_PROCESSING, "正在处理"),
    (win32print.PRINTER_STATUS_INITIALIZING, "正在初始化"),
    (win32print.PRINTER_STATUS_WARMING_UP, "正在预热"),
    (win32print.PRINTER_STATUS_POWER_SAVE, "节能模式"),
]

# 非阻断提示：值得让人知道，但不足以拒绝提交。
_NOTICE_STATUS = [
    (win32print.PRINTER_STATUS_TONER_LOW, "色带余量偏低"),
    (win32print.PRINTER_STATUS_MANUAL_FEED, "等待手动进纸"),
]


def _printer_name(name: str | None) -> str:
    return (name or PRINTER_NAME).strip() or PRINTER_NAME


def send_raw(data: bytes, doc_name: str = "labelprint", printer_name: str | None = None) -> int:
    """把 TSPL 字节流以 RAW 提交到打印队列，返回作业 id。"""
    handle = win32print.OpenPrinter(_printer_name(printer_name))
    try:
        job = win32print.StartDocPrinter(handle, 1, (doc_name, None, "RAW"))
        win32print.StartPagePrinter(handle)
        win32print.WritePrinter(handle, data)
        win32print.EndPagePrinter(handle)
        win32print.EndDocPrinter(handle)
        return job
    finally:
        win32print.ClosePrinter(handle)


def status(printer_name: str | None = None) -> dict:
    """查询打印机状态。

    ready 只由「阻断性故障」决定：「正在打印」「预热中」等正常工作阶段不会
    让 ready 变 False——否则上一批标签还在打印时，下一批提交就会被误判为
    「不可用」而拒绝，还会附带一条与实际情况无关的假故障提示。
    reason 只汇总阻断性故障，可直接作为拒绝提交的理由展示给用户；
    notes 汇总正常工作阶段与不阻断的提示，仅供参考，不作为拒绝依据。

    「已注册但物理离线」是 Status 位域测不出来的一种阻断性故障：在目标机
    上实测过两台确认已拔线/关机的打印机（POSTEK C168/300s、HP Color
    Laser 150），GetPrinter 返回的 Status 位域是 0——跟一台正常在线的
    打印机完全一样，PRINTER_STATUS_OFFLINE 那一位并不会因为物理断开而
    置位。真正反映这件事的是 Attributes 位域里的
    PRINTER_ATTRIBUTE_WORK_OFFLINE（两台断开的打印机上都置位，在线的
    没有），这里单独查这一位——它跟 Status 是两个不同的位域，含义不能
    混在同一张表里判断。不查这一位的后果：send_raw() 对物理离线的打印机
    仍会正常把作业塞进 spool 队列（Windows 假脱机服务不检查物理连通性），
    调用方会以为提交成功，但纸永远不会出来。
    """
    handle = win32print.OpenPrinter(_printer_name(printer_name))
    try:
        info = win32print.GetPrinter(handle, 2)
    finally:
        win32print.ClosePrinter(handle)

    code = info["Status"]
    jobs = info["cJobs"]
    reasons = [text for bit, text in _BLOCKING_STATUS if code & bit]
    if info["Attributes"] & win32print.PRINTER_ATTRIBUTE_WORK_OFFLINE:
        reasons.append("打印机处于脱机状态（已断开或未开机）")
    notes = [text for bit, text in _TRANSIENT_STATUS + _NOTICE_STATUS if code & bit]
    return {
        "status": code,
        "jobs": jobs,
        "ready": len(reasons) == 0,
        "reason": "；".join(reasons),
        "notes": "；".join(notes),
    }
