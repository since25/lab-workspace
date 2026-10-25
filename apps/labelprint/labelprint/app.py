# -*- coding: utf-8 -*-
"""Flask 网页服务。

pywin32 相关调用集中在 _printer_status / _send_raw 两个薄封装里，
并延迟导入，使 macOS 上不装 pywin32 也能测试除打印外的全部逻辑。
"""
import base64
import io
import json
from datetime import date

from flask import Flask, jsonify, render_template, request

from labelprint import config, epl, profiles, render, tspl
from labelprint.model import LabelRow
from labelprint.sources import tabular
from labelprint.store import Store


def _printer_status(printer_name=None):
    from labelprint import printer
    return printer.status(printer_name)


def _send_raw(data: bytes, doc_name: str, printer_name=None) -> int:
    from labelprint import printer
    return printer.send_raw(data, doc_name, printer_name)


def _status_for(printer_name=None):
    if not printer_name:
        return _printer_status()
    try:
        return _printer_status(printer_name)
    except TypeError:
        return _printer_status()


def _send_for(data: bytes, doc_name: str, printer_name=None):
    if not printer_name:
        return _send_raw(data, doc_name)
    try:
        return _send_raw(data, doc_name, printer_name)
    except TypeError:
        return _send_raw(data, doc_name)


def _resolve_printer_name(printer_id):
    ident = (printer_id or "").strip()
    if not ident:
        return None
    p_cfg = config.get_printer_config(ident)
    return p_cfg.get("printer_name") or ident


def _rows_from_json(payload):
    """把前端提交的 JSON 行数据转成 LabelRow 列表，样品名为空的行直接丢弃。"""
    rows = []
    for item in payload or []:
        rows.append(LabelRow(
            sample=str(item.get("sample", "")).strip(),
            conc=str(item.get("conc", "")).strip(),
            ratio=str(item.get("ratio", "")).strip(),
            note=str(item.get("note", "")).strip(),
        ))
    return [r for r in rows if not r.is_empty()]


def _row_to_json(r: LabelRow):
    return {"sample": r.sample, "conc": r.conc, "ratio": r.ratio, "note": r.note}


def _parse_style(payload, template):
    """工作台自定义模板传来的字号/行距；没传返回 None（按内置模板），不合法抛 ValueError。"""
    raw = payload.get("style")
    if raw is None:
        return None
    if not isinstance(raw, dict):
        raise ValueError("模板样式格式不正确")
    return render.custom_style(template, raw)


def _render_images(rows, date_str, layout, template="name-detail", style=None, profile=None):
    """按布局与模板生成位图；two-up 按输入顺序填左、右列。"""
    if layout == "two-up":
        images = []
        for index in range(0, len(rows), 2):
            try:
                images.append(render.render_two_up(rows[index:index + 2], date_str, template, style, profile=profile))
            except render.LabelTooLongError as exc:
                raise render.LabelTooLongError(f"第 {index + 1} 个有效行：{exc}") from exc
        return images
    images = []
    for index, row in enumerate(rows):
        try:
            images.append(render.render_label(row, date_str))
        except render.LabelTooLongError as exc:
            raise render.LabelTooLongError(f"第 {index + 1} 个有效行：{exc}") from exc
    return images


def create_app():
    app = Flask(__name__)
    # 上传体积上限：这台机同时跑着 MariaDB、NanoDrop，可用内存有限，
    # /api/parse 会把整个上传文件读进内存（f.read()），不设上限的话一个
    # 异常大的文件就可能把内存吃紧。10MB 对表格文件（.xls/.xlsx/.csv）
    # 来说远超正常样品表的大小。
    app.config["MAX_CONTENT_LENGTH"] = 10 * 1024 * 1024
    store = Store(config.DB_PATH)

    @app.errorhandler(413)
    def _upload_too_large(exc):
        return jsonify({"error": "上传文件过大，超过 10MB 上限"}), 413

    @app.get("/")
    def index():
        return render_template("index.html")

    @app.get("/history")
    def history_page():
        return render_template("history.html")

    @app.get("/api/status")
    def api_status():
        printer_id = (request.args.get("printer_id") or "").strip()
        # 状态查询本身失败（如本机没装 pywin32）也不能让页面崩，统一转成中文提示
        # version 与工作台同一个 app\VERSION，安装脚本据此确认两端是同一版本
        try:
            return jsonify({**_status_for(_resolve_printer_name(printer_id)), "version": config.VERSION})
        except Exception as exc:
            return jsonify({"ready": False, "reason": "无法查询打印机：%s" % exc,
                            "jobs": 0, "notes": "", "printer_id": printer_id,
                            "version": config.VERSION}), 200

    @app.get("/api/media")
    def api_media():
        printer_id = (request.args.get("printer_id") or "").strip()
        p_cfg = config.get_printer_config(printer_id)
        prof = profiles.get_profile(p_cfg.get("profile"))
        return jsonify(prof.to_media_dict())

    @app.get("/api/printers")
    def api_printers():
        printers = []
        for item in config.configured_printers():
            try:
                state = _status_for(item["printer_name"])
            except Exception as exc:
                state = {"ready": False, "reason": "无法查询打印机：%s" % exc, "jobs": 0, "notes": ""}
            printers.append({
                "id": item["id"],
                "name": item["name"],
                "printer_name": item["printer_name"],
                "command_set": item.get("command_set", "tspl"),
                "profile": item.get("profile", "brady-30x15"),
                **state
            })
        return jsonify({"printers": printers})

    @app.post("/api/parse")
    def api_parse():
        f = request.files.get("file")
        if f is None:
            return jsonify({"error": "没有收到文件"}), 400
        try:
            rows = tabular.parse(f.read(), f.filename or "")
        except tabular.MissingColumnError as exc:
            return jsonify({"error": exc.message}), 400
        except ValueError as exc:
            return jsonify({"error": str(exc)}), 400
        except Exception as exc:
            # 兜底：文件损坏、伪装成 .xlsx 的非法 zip、xlrd 无法识别格式等未预料到的
            # 解析异常都可能发生（仪器导出异常、传输截断、扩展名对不上实际内容），
            # 不能让这些异常直接穿透到 Flask 默认的英文 500 页面
            return jsonify({"error": "文件无法读取，可能已损坏或不是有效的 Excel/CSV 文件（技术信息：%s）" % exc}), 400
        if len(rows) > config.MAX_ROWS:
            return jsonify({"error": "行数 %d 超过上限 %d" % (len(rows), config.MAX_ROWS)}), 400
        return jsonify({"rows": [_row_to_json(r) for r in rows]})

    @app.post("/api/preview")
    def api_preview():
        payload = request.json or {}
        rows = _rows_from_json(payload.get("rows"))
        layout = str(payload.get("layout", "single")).strip().lower()
        if layout not in ("single", "two-up"):
            return jsonify({"error": "不支持的标签布局"}), 400
        template = str(payload.get("template", "name-detail")).strip().lower()
        if template not in render.TEMPLATES:
            return jsonify({"error": "不支持的标签模板"}), 400
        try:
            style = _parse_style(payload, template)
        except ValueError as exc:
            return jsonify({"error": "模板样式不合法：%s" % exc}), 400
        # 手工录入不经过 /api/parse，这里必须重复校验一次，否则网页上手动加一千行
        # 就能绕开上传时的行数上限，一次渲染一千张图
        if len(rows) > config.MAX_ROWS:
            return jsonify({"error": "行数 %d 超过上限 %d" % (len(rows), config.MAX_ROWS)}), 400
        printer_id = (payload.get("printer_id") or "").strip()
        p_cfg = config.get_printer_config(printer_id)
        prof = profiles.get_profile(p_cfg.get("profile"))
        today = date.today().strftime("%Y-%m-%d")
        images = []
        try:
            for image in _render_images(rows, today, layout, template, style, profile=prof):
                buf = io.BytesIO()
                image.save(buf, format="PNG")
                images.append(base64.b64encode(buf.getvalue()).decode("ascii"))
        except render.LabelTooLongError as exc:
            # 异常消息本身已经是可直接展示的中文，只是补上是第几行——两行同名
            # 又都超长时，光看消息本身分不出是哪一行
            return jsonify({"error": str(exc)}), 400
        return jsonify({
            "images": images,
            "count": len(rows),
            "media_count": len(images),
            "layout": layout,
            "template": template,
            "media": prof.to_media_dict(),
        })

    @app.post("/api/print")
    def api_print():
        payload = request.json or {}
        rows = _rows_from_json(payload.get("rows"))
        layout = str(payload.get("layout", "single")).strip().lower()
        if layout not in ("single", "two-up"):
            return jsonify({"error": "不支持的标签布局"}), 400
        template = str(payload.get("template", "name-detail")).strip().lower()
        if template not in render.TEMPLATES:
            return jsonify({"error": "不支持的标签模板"}), 400
        try:
            style = _parse_style(payload, template)
        except ValueError as exc:
            return jsonify({"error": "模板样式不合法：%s" % exc}), 400
        operator = str(payload.get("operator", "")).strip()
        printer_id = str(payload.get("printer_id", "")).strip()
        p_cfg = config.get_printer_config(printer_id)
        prof = profiles.get_profile(p_cfg.get("profile"))
        printer_queue = p_cfg.get("printer_name") if printer_id else None
        client_ip = request.remote_addr or ""
        try:
            copies = int(payload.get("copies", 1))
        except (TypeError, ValueError):
            return jsonify({"error": "份数必须是数字"}), 400

        if not rows:
            return jsonify({"error": "没有勾选任何要打印的行"}), 400
        if len(rows) > config.MAX_ROWS:
            return jsonify({"error": "行数 %d 超过上限 %d" % (len(rows), config.MAX_ROWS)}), 400
        if not (1 <= copies <= config.MAX_COPIES):
            return jsonify({"error": "份数必须在 1 到 %d 之间" % config.MAX_COPIES}), 400

        # 打印前必须查打印机状态；查询本身失败（如本机没装 pywin32）也要给中文提示，
        # 不能让异常一路崩到 500 页面
        try:
            st = _status_for(printer_queue)
        except Exception as exc:
            return jsonify({"error": "无法查询打印机：%s" % exc}), 409
        if not st["ready"]:
            return jsonify({"error": "打印机未就绪：%s" % st["reason"]}), 409

        today = date.today().strftime("%Y-%m-%d")
        images = []
        try:
            images = _render_images(rows, today, layout, template, style, profile=prof)
        except render.LabelTooLongError as exc:
            return jsonify({"error": str(exc)}), 400

        if p_cfg.get("command_set") == "epl":
            job = epl.build_job(images, copies=copies, profile=prof, invert=config.INVERT)
        else:
            job = tspl.build_job(images, copies=copies, invert=config.INVERT)

        try:
            _send_for(job, "labelprint", printer_queue)
        except Exception as exc:
            # 记历史失败（SQLite 被并发写锁住、磁盘满等）不能掩盖真正的错误
            # 原因——用户需要看到的是"送打印失败：xxx"，不是历史记录的异常
            try:
                store.log(rows, copies, operator, client_ip, ok=False, err=str(exc))
            except Exception:
                pass
            return jsonify({"error": "送打印失败：%s" % exc}), 500
            return jsonify({"error": "送打印失败：%s" % exc}), 500

        # 数据已经真的发给打印机了，这一步之后绝不能再让未捕获异常把请求
        # 拖到 500——那样前端会显示"打印请求失败"，用户以为没打印成功而
        # 重新点一次「打印」，同一批标签就会被打两遍。记录历史失败只降级为
        # "历史没记上"，不影响已经送出这件事本身。
        try:
            batch_id = store.log(rows, copies, operator, client_ip, ok=True)
        except Exception:
            batch_id = None
        total = len(rows) * copies

        # 送出之后复查一次队列：除了刚提交的这个作业外还有别的堆着，就是积压信号，
        # 提醒前端标红——这个复查失败不能反过来推翻已经成功的打印结果，
        # 只是拿不到积压信息而已
        queue_jobs = None
        try:
            queue_jobs = _status_for(_resolve_printer_name(printer_id)).get("jobs")
        except Exception:
            pass
        queue_backlog = bool(queue_jobs is not None and queue_jobs > 1)

        message = "已送出 %d 张（打印机是否实际出纸请以现场为准）" % total
        if batch_id is None:
            message += "；历史记录写入失败"

        return jsonify({
            "batch_id": batch_id,
            "sent": total,
            "message": message,
            "queue_jobs": queue_jobs,
            "queue_backlog": queue_backlog,
            "printer_id": printer_id or None,
            "layout": layout,
            "template": template,
            "media_count": len(images),
        })

    @app.get("/api/history")
    def api_history():
        q = (request.args.get("q") or "").strip()
        rows = store.search(q) if q else store.recent()
        return jsonify({"rows": rows})

    @app.get("/api/batch/<batch_id>")
    def api_batch(batch_id):
        return jsonify({"rows": [_row_to_json(r) for r in store.batch(batch_id)]})

    return app


if __name__ == "__main__":
    create_app().run(host=config.HOST, port=config.PORT, threaded=True)
