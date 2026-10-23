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

# 多打印机目录只保存设备标识和 Windows 打印队列名，不保存凭证。
# 例如：[{"id":"brady-bbp12","name":"Brady BBP12","printer_name":"Brady BBP12"}]
DEFAULT_PRINTERS = [{"id": "brady-bbp12", "name": "Brady BBP12", "printer_name": "Brady BBP12"}]


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
            out.append({"id": item.strip(), "name": item.strip(), "printer_name": item.strip()})
        elif isinstance(item, dict):
            ident = str(item.get("id", "")).strip()
            name = str(item.get("name", ident)).strip()
            printer_name = str(item.get("printer_name", name)).strip()
            if ident and name and printer_name:
                out.append({"id": ident, "name": name, "printer_name": printer_name})
    return out or DEFAULT_PRINTERS
