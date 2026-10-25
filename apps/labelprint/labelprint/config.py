# -*- coding: utf-8 -*-
"""集中配置。"""
import os

HOST = os.environ.get("LABELPRINT_HOST", "127.0.0.1")
PORT = int(os.environ.get("LABELPRINT_PORT", "8080"))
# 数据库放在包目录（labelprint\）外面的 data\ 子目录下，不能放包目录里面：
# 升级时整个代码目录会被替换，如果数据库文件混在包目录里，容易被连同旧代码
# 一起删掉/覆盖，打印历史就没了。data\ 目录与代码分离，升级时只要不动 data\
# 就不会丢数据。线上由 run-labelprint.ps1 设置 LABELPRINT_DB 指向
# C:\labelprint\data\labelprint.db（代码在 C:\lab-workspace\app\labelprint，
# 每次安装都会被整体替换，不能用下面的默认路径）。
_PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB_PATH = os.environ.get("LABELPRINT_DB", os.path.join(_PROJECT_ROOT, "data", "labelprint.db"))


def _read_version():
    """与工作台共用安装包里的 app\VERSION（提交号）；开发环境没有该文件时为 dev。"""
    try:
        with open(os.path.join(os.path.dirname(_PROJECT_ROOT), "VERSION"), encoding="utf-8") as f:
            return f.read().strip() or "dev"
    except OSError:
        return "dev"


VERSION = _read_version()
MAX_ROWS = 500          # 单次提交行数上限，防止误传大表
MAX_COPIES = 20         # 单个样品份数上限
INVERT = False          # TSPL 位图是否反相；若实物验证发现黑白颠倒，改这里即可，无需改代码

# 多打印机目录保存设备标识、展示名、Windows 打印队列名、指令集及介质 profile。
# 内置支持 Brady BBP12（TSPL）与 POSTEK C168/300s（EPL）。
DEFAULT_PRINTERS = [
    {
        "id": "brady-bbp12",
        "name": "Brady BBP12",
        "printer_name": "Brady BBP12",
        "command_set": "tspl",
        "profile": "brady-30x15",
    },
    {
        "id": "postek-c168",
        "name": "POSTEK C168/300s",
        "printer_name": "POSTEK C168/300s",
        "command_set": "epl",
        "profile": "postek-30x20",
    },
]


def configured_printers():
    raw = os.environ.get("LABELPRINT_PRINTERS_JSON", "")
    if not raw.strip():
        return DEFAULT_PRINTERS
    try:
        value = __import__("json").loads(raw)
    except Exception:
        return DEFAULT_PRINTERS
    if not isinstance(value, list):
        return DEFAULT_PRINTERS
    out = []
    for item in value:
        if isinstance(item, str) and item.strip():
            s = item.strip()
            cs = "epl" if "postek" in s.lower() else "tspl"
            prof = "postek-30x20" if cs == "epl" else "brady-30x15"
            out.append({
                "id": s,
                "name": s,
                "printer_name": s,
                "command_set": cs,
                "profile": prof,
            })
        elif isinstance(item, dict):
            ident = str(item.get("id", "")).strip()
            name = str(item.get("name", ident)).strip()
            printer_name = str(item.get("printer_name", name)).strip()
            cs = str(item.get("command_set", "")).strip().lower()
            if not cs:
                cs = "epl" if ("postek" in printer_name.lower() or "postek" in ident.lower()) else "tspl"
            prof = str(item.get("profile", "")).strip()
            if not prof:
                prof = "postek-30x20" if cs == "epl" else "brady-30x15"
            if ident and name and printer_name:
                out.append({
                    "id": ident,
                    "name": name,
                    "printer_name": printer_name,
                    "command_set": cs,
                    "profile": prof,
                })
    return out or DEFAULT_PRINTERS


def get_printer_config(printer_id: str | None) -> dict:
    """根据传入的 printer_id 或队列名查找配置字典，未匹配时根据名称或回退首台。"""
    ident = (printer_id or "").strip()
    printers = configured_printers()
    if ident:
        for p in printers:
            if p["id"] == ident or p["printer_name"] == ident:
                return p
        if "postek" in ident.lower():
            return {
                "id": ident,
                "name": ident,
                "printer_name": ident,
                "command_set": "epl",
                "profile": "postek-30x20",
            }
        return {
            "id": ident,
            "name": ident,
            "printer_name": ident,
            "command_set": "tspl",
            "profile": "brady-30x15",
        }
    return printers[0] if printers else DEFAULT_PRINTERS[0]
