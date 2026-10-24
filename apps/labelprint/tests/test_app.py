# -*- coding: utf-8 -*-
import base64
import io
import json
import pytest

from labelprint import app as app_module


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(app_module.config, "DB_PATH", str(tmp_path / "t.db"))
    application = app_module.create_app()
    application.config["TESTING"] = True
    return application.test_client()


def test_index_serves_page(client):
    r = client.get("/")
    assert r.status_code == 200
    assert "标签打印".encode("utf-8") in r.data


def test_history_page_serves(client):
    r = client.get("/history")
    assert r.status_code == 200
    assert "历史".encode("utf-8") in r.data


def test_printers_endpoint_lists_configured_devices(client, monkeypatch):
    monkeypatch.setenv("LABELPRINT_PRINTERS_JSON", '[{"id":"brady","name":"Brady A","printer_name":"Queue A"},{"id":"brady-b","name":"Brady B","printer_name":"Queue B"}]')
    monkeypatch.setattr(app_module, "_printer_status", lambda name=None: {"ready": name == "Queue A", "reason": "", "jobs": 0, "notes": ""})
    body = client.get("/api/printers").get_json()
    assert [p["id"] for p in body["printers"]] == ["brady", "brady-b"]
    assert body["printers"][0]["ready"] is True
    assert body["printers"][1]["ready"] is False


def test_status_resolves_configured_printer_id(client, monkeypatch):
    monkeypatch.setenv("LABELPRINT_PRINTERS_JSON", '[{"id":"brady","name":"Brady A","printer_name":"Queue A"}]')
    seen = []
    monkeypatch.setattr(app_module, "_printer_status", lambda name=None: seen.append(name) or {"ready": True, "reason": "", "jobs": 0, "notes": ""})
    assert client.get("/api/status?printer_id=brady").status_code == 200
    assert seen == ["Queue A"]


def test_status_reports_shared_version(client, monkeypatch):
    """状态接口带上安装包统一版本号，安装脚本据此核对两端同版本。"""
    monkeypatch.setattr(app_module.config, "VERSION", "abc1234")
    monkeypatch.setattr(app_module, "_printer_status", lambda name=None: {"ready": True, "reason": "", "jobs": 0, "notes": ""})
    assert client.get("/api/status").get_json()["version"] == "abc1234"
    monkeypatch.setattr(app_module, "_printer_status", lambda name=None: (_ for _ in ()).throw(RuntimeError("无 pywin32")))
    body = client.get("/api/status").get_json()
    assert body["ready"] is False and body["version"] == "abc1234"


def test_version_read_from_parent_version_file(tmp_path, monkeypatch):
    """代码目录的上一级（安装后即 app\\）有 VERSION 时读它，没有时为 dev。"""
    from labelprint import config
    monkeypatch.setattr(config, "_PROJECT_ROOT", str(tmp_path / "labelprint"))
    assert config._read_version() == "dev"
    (tmp_path / "VERSION").write_text("89ce90e\n", encoding="utf-8")
    assert config._read_version() == "89ce90e"


def test_print_passes_selected_printer_to_driver(client, monkeypatch):
    calls = []
    monkeypatch.setattr(app_module, "_printer_status", lambda name=None: {"ready": True, "reason": "", "jobs": 0, "notes": ""})
    monkeypatch.setattr(app_module, "_send_raw", lambda data, doc, printer=None: calls.append(printer) or 42)
    r = client.post("/api/print", json={"rows": [{"sample": "S1"}], "copies": 1, "operator": "示例", "printer_id": "Queue B"})
    assert r.status_code == 200
    assert calls == ["Queue B"]


def test_parse_endpoint_returns_rows(client):
    data = "样品名称,浓度(ng/uL)\nS1,10\n".encode("utf-8")
    r = client.post("/api/parse", data={"file": (io.BytesIO(data), "a.csv")},
                    content_type="multipart/form-data")
    body = json.loads(r.data)
    assert body["rows"] == [{"sample": "S1", "conc": "10", "ratio": "", "note": ""}]


def test_parse_missing_column_returns_chinese_error(client):
    data = "浓度,备注\n1,2\n".encode("utf-8")
    r = client.post("/api/parse", data={"file": (io.BytesIO(data), "a.csv")},
                    content_type="multipart/form-data")
    assert r.status_code == 400
    assert "样品名称" in json.loads(r.data)["error"]


def test_parse_rejects_too_many_rows(client, monkeypatch):
    # 手工把上限调到 2，用 3 行数据触发——验证 /api/parse 真的会拒绝，而不是只在文档里写着
    monkeypatch.setattr(app_module.config, "MAX_ROWS", 2)
    data = "样品名称\nS1\nS2\nS3\n".encode("utf-8")
    r = client.post("/api/parse", data={"file": (io.BytesIO(data), "a.csv")},
                    content_type="multipart/form-data")
    assert r.status_code == 400
    assert "上限" in json.loads(r.data)["error"]


def test_parse_returns_chinese_error_for_corrupted_xls(client):
    # 损坏的 .xls：不是合法 OLE2 结构，xlrd 会抛 XLRDError。这类异常之前没被
    # /api/parse 捕获，会穿透到 Flask 默认的英文 500 页面——实验室场景里，仪器导出
    # 异常、传输截断、文件被占用时复制出来，都可能产生这种"扩展名对但内容坏"的文件
    garbage = b"this is not a real xls file, just garbage bytes 12345"
    r = client.post("/api/parse", data={"file": (io.BytesIO(garbage), "broken.xls")},
                    content_type="multipart/form-data")
    assert r.status_code == 400
    assert r.content_type.startswith("application/json")  # 确认走的是 jsonify，不是崩溃页
    body = json.loads(r.data)
    assert "损坏" in body["error"] or "无法读取" in body["error"]
    assert "Traceback" not in body["error"]


def test_parse_returns_chinese_error_for_corrupted_xlsx(client):
    # 损坏的 .xlsx：伪装成 xlsx 但不是合法 zip 包，openpyxl 会抛 zipfile.BadZipFile
    garbage = b"this is not a real xlsx file, just garbage bytes 12345"
    r = client.post("/api/parse", data={"file": (io.BytesIO(garbage), "broken.xlsx")},
                    content_type="multipart/form-data")
    assert r.status_code == 400
    assert r.content_type.startswith("application/json")
    body = json.loads(r.data)
    assert "损坏" in body["error"] or "无法读取" in body["error"]
    assert "Traceback" not in body["error"]


def test_preview_returns_one_png_per_row(client):
    r = client.post("/api/preview", json={"rows": [{"sample": "S1"}, {"sample": "S2"}]})
    imgs = json.loads(r.data)["images"]
    assert len(imgs) == 2
    assert base64.b64decode(imgs[0])[:8] == b"\x89PNG\r\n\x1a\n"


def test_preview_images_correspond_to_rows_in_order(client):
    # 用互不相同的样品名，中间混一个空行，同时拆穿两类回归：
    # (1) /api/preview 内部把行序弄乱（比如改成 reversed(rows)）
    # (2) _rows_from_json 的空行过滤被去掉
    # 上面 test_preview_returns_one_png_per_row 只用了两行"几乎等价"的数据（都不带
    # conc/ratio/note），顺序颠倒或空行漏过滤都测不出来——已用变异实测确认。
    from datetime import date
    from labelprint import render
    from labelprint.model import LabelRow

    rows_in = [{"sample": "Alpha"}, {"sample": ""}, {"sample": "Beta"}, {"sample": "Gamma"}]
    r = client.post("/api/preview", json={"rows": rows_in})
    body = json.loads(r.data)
    assert body["count"] == 3  # 空行被丢弃，不是 4

    today = date.today().strftime("%Y-%m-%d")
    for i, sample in enumerate(["Alpha", "Beta", "Gamma"]):
        expected_buf = io.BytesIO()
        render.render_label(LabelRow(sample=sample), today).save(expected_buf, format="PNG")
        actual_bytes = base64.b64decode(body["images"][i])
        assert actual_bytes == expected_buf.getvalue(), (
            "第 %d 张预览图与直接渲染「%s」的结果不是字节级一致——"
            "说明图片顺序或与行的对应关系出错了" % (i, sample))


def test_two_up_preview_pairs_rows_and_reports_label_count(client):
    from datetime import date
    from labelprint import render
    from labelprint.model import LabelRow

    r = client.post("/api/preview", json={
        "layout": "two-up",
        "rows": [{"sample": "LEFT"}, {"sample": "RIGHT"}, {"sample": "ODD"}],
    })
    body = json.loads(r.data)
    assert body["count"] == 3
    assert body["media_count"] == 2
    assert body["layout"] == "two-up"
    expected = render.render_two_up([LabelRow(sample="LEFT"), LabelRow(sample="RIGHT")], date.today().strftime("%Y-%m-%d"))
    buf = io.BytesIO()
    expected.save(buf, format="PNG")
    assert base64.b64decode(body["images"][0]) == buf.getvalue()


def test_preview_rejects_too_many_rows(client, monkeypatch):
    # R5：手工录入不经过 /api/parse，MAX_ROWS 必须在 /api/preview 里独立校验一次，
    # 否则网页上手动加一千行就能绕过上传时的行数限制，一次渲染一千张图
    monkeypatch.setattr(app_module.config, "MAX_ROWS", 2)
    r = client.post("/api/preview", json={"rows": [
        {"sample": "S1"}, {"sample": "S2"}, {"sample": "S3"},
    ]})
    assert r.status_code == 400
    assert "上限" in json.loads(r.data)["error"]


def test_preview_returns_friendly_error_for_too_long_sample_name(client):
    # render_label 在样品名超长时抛 LabelTooLongError，接口必须把中文消息原样透出，
    # 不能让它变成未处理异常一路崩到 500
    too_long = "A" * 200
    r = client.post("/api/preview", json={"rows": [{"sample": too_long}]})
    assert r.status_code == 400
    assert "太长" in json.loads(r.data)["error"]


def test_preview_error_for_too_long_name_identifies_row_number(client):
    # 两行数据、第 2 行超长——错误消息必须能区分是第几行，不能让人以为是第一行。
    # 上面那条测试只用了一行数据，测不出行号对不对。
    too_long = "A" * 200
    r = client.post("/api/preview", json={"rows": [{"sample": "S1"}, {"sample": too_long}]})
    assert r.status_code == 400
    assert "第 2 个有效行" in json.loads(r.data)["error"]


def test_preview_error_row_number_counts_valid_rows_not_raw_position(client):
    # S1 是第 1 个有效样品；中间一个空行会被 _rows_from_json 过滤掉，不占行号；
    # 超长名是第 2 个有效样品——但它在这次提交里其实排在第 3 位。
    # 消息里的数字数的是"第几个有效行"，不是"表格里的第几行"，用词必须说清楚
    # 这一点，否则容易被误当成"第 3 行"来定位、找错行。
    too_long = "A" * 200
    r = client.post("/api/preview", json={
        "rows": [{"sample": "S1"}, {"sample": ""}, {"sample": too_long}],
    })
    assert r.status_code == 400
    error = json.loads(r.data)["error"]
    assert "第 2 个有效行" in error
    assert "第 3 行" not in error


def test_print_rejects_empty_selection(client):
    r = client.post("/api/print", json={"rows": [], "copies": 1, "operator": ""})
    assert r.status_code == 400
    assert "没有" in json.loads(r.data)["error"]


def test_print_rejects_copies_out_of_range(client):
    r = client.post("/api/print", json={"rows": [{"sample": "S1"}], "copies": 999})
    assert r.status_code == 400


def test_print_rejects_too_many_rows(client, monkeypatch):
    # 同上，/api/print 也必须独立校验，即便前面 /api/preview 已经拦过一次——
    # 两个接口都能被手工录入直接命中，缺一个都是漏洞
    monkeypatch.setattr(app_module.config, "MAX_ROWS", 2)
    r = client.post("/api/print", json={"rows": [
        {"sample": "S1"}, {"sample": "S2"}, {"sample": "S3"},
    ], "copies": 1})
    assert r.status_code == 400
    assert "上限" in json.loads(r.data)["error"]


def test_print_blocked_when_printer_not_ready(client, monkeypatch):
    monkeypatch.setattr(app_module, "_printer_status",
                        lambda: {"ready": False, "reason": "打印机离线", "jobs": 0})
    r = client.post("/api/print", json={"rows": [{"sample": "S1"}], "copies": 1})
    assert r.status_code == 409
    assert "离线" in json.loads(r.data)["error"]


def test_print_gives_chinese_error_when_status_query_raises(client, monkeypatch):
    # 本机没装 pywin32（或目标机打印机驱动异常）时 _printer_status() 会抛异常，
    # 点「打印」必须报中文提示而不是崩成一片 traceback —— Step 9 人工点检的硬要求
    def boom():
        raise ModuleNotFoundError("No module named 'win32print'")
    monkeypatch.setattr(app_module, "_printer_status", boom)
    r = client.post("/api/print", json={"rows": [{"sample": "S1"}], "copies": 1})
    assert r.status_code == 409
    assert r.content_type.startswith("application/json")  # 确认走的是正常 jsonify 响应而非崩溃页
    assert "无法查询打印机" in json.loads(r.data)["error"]


def test_print_returns_friendly_error_for_too_long_sample_name(client, monkeypatch):
    monkeypatch.setattr(app_module, "_printer_status",
                        lambda: {"ready": True, "reason": "", "jobs": 0})
    too_long = "A" * 200
    r = client.post("/api/print", json={"rows": [{"sample": too_long}], "copies": 1})
    assert r.status_code == 400
    assert "太长" in json.loads(r.data)["error"]
    # 排版失败发生在真正送打印之前，属于校验不通过，不是「打印失败」，不应写入历史
    hist = json.loads(client.get("/api/history").data)["rows"]
    assert hist == []


def test_print_error_for_too_long_name_identifies_row_number(client, monkeypatch):
    # 同上，/api/print 也要能区分是第几行超长，且这条路径原来是列表推导式，
    # 循环变量不会泄漏到 except 块，必须先改成显式 for 循环才能拿到行号
    monkeypatch.setattr(app_module, "_printer_status",
                        lambda: {"ready": True, "reason": "", "jobs": 0})
    too_long = "A" * 200
    r = client.post("/api/print", json={"rows": [{"sample": "S1"}, {"sample": too_long}],
                                        "copies": 1})
    assert r.status_code == 400
    assert "第 2 个有效行" in json.loads(r.data)["error"]


def test_successful_print_says_sent_not_printed(client, monkeypatch):
    monkeypatch.setattr(app_module, "_printer_status",
                        lambda: {"ready": True, "reason": "", "jobs": 0})
    monkeypatch.setattr(app_module, "_send_raw", lambda data, name: 42)
    r = client.post("/api/print",
                    json={"rows": [{"sample": "S1"}], "copies": 2, "operator": "王"})
    body = json.loads(r.data)
    assert r.status_code == 200
    assert body["sent"] == 2
    assert "送出" in body["message"]
    assert "已打印" not in body["message"]


def test_print_job_bytes_match_direct_build_with_correct_copies(client, monkeypatch):
    # 用 copies=3（不是默认值 1）、两个内容不同的样品、中间混一个空行，逐字节比对
    # 实际送去打印机的 TSPL 字节流，与"用同样的行、同样的 copies 直接调
    # tspl.build_job"算出来的结果。三类回归都能被这一个测试拆穿：
    #  (1) 调 build_job 时把 copies 写死成了 1
    #  (2) /api/print 内部把行序弄乱
    #  (3) _rows_from_json 的空行过滤被去掉
    monkeypatch.setattr(app_module, "_printer_status",
                        lambda: {"ready": True, "reason": "", "jobs": 0})
    captured = {}

    def fake_send_raw(data, name):
        captured["data"] = data
        return 1

    monkeypatch.setattr(app_module, "_send_raw", fake_send_raw)

    from datetime import date
    from labelprint import render, tspl
    from labelprint.model import LabelRow

    rows_in = [{"sample": "Alpha"}, {"sample": ""}, {"sample": "Beta"}]
    r = client.post("/api/print", json={"rows": rows_in, "copies": 3, "operator": "王"})
    assert r.status_code == 200
    assert json.loads(r.data)["sent"] == 6  # 2 个有效样品 * 3 份，不是把空行也算上的 3*3=9

    today = date.today().strftime("%Y-%m-%d")
    expected_images = [render.render_label(LabelRow(sample=s), today) for s in ["Alpha", "Beta"]]
    expected_job = tspl.build_job(expected_images, copies=3, invert=app_module.config.INVERT)
    assert captured["data"] == expected_job


def test_two_up_print_pairs_rows_but_reports_all_labels(client, monkeypatch):
    monkeypatch.setattr(app_module, "_printer_status",
                        lambda: {"ready": True, "reason": "", "jobs": 0})
    captured = {}

    def fake_send_raw(data, name):
        captured["data"] = data
        return 1

    monkeypatch.setattr(app_module, "_send_raw", fake_send_raw)
    r = client.post("/api/print", json={
        "layout": "two-up",
        "rows": [{"sample": "LEFT"}, {"sample": "RIGHT"}, {"sample": "ODD"}],
        "copies": 1,
    })
    body = json.loads(r.data)
    assert r.status_code == 200
    assert body["sent"] == 3
    assert body["media_count"] == 2
    assert body["layout"] == "two-up"
    from datetime import date
    from labelprint import render, tspl
    from labelprint.model import LabelRow
    today = date.today().strftime("%Y-%m-%d")
    expected_images = [
        render.render_two_up([LabelRow(sample="LEFT"), LabelRow(sample="RIGHT")], today),
        render.render_two_up([LabelRow(sample="ODD")], today),
    ]
    assert captured["data"] == tspl.build_job(expected_images, copies=1, invert=app_module.config.INVERT)


def test_print_is_logged_and_batch_is_reprintable(client, monkeypatch):
    monkeypatch.setattr(app_module, "_printer_status",
                        lambda: {"ready": True, "reason": "", "jobs": 0})
    monkeypatch.setattr(app_module, "_send_raw", lambda data, name: 42)

    # 第一批
    r1 = client.post("/api/print", json={"rows": [{"sample": "S1", "conc": "10"}],
                                         "copies": 1, "operator": "王"})
    batch_id_1 = json.loads(r1.data)["batch_id"]

    # 第二批：不同数据。验证重打取回的确实是「这一批」，而不是随便哪批或全部批次的并集——
    # 如果 /api/batch/<id> 忽略 batch_id 参数，这里会把 S2 也带出来或者只剩 S2
    r2 = client.post("/api/print", json={"rows": [{"sample": "S2", "conc": "20"}],
                                         "copies": 1, "operator": "王"})
    batch_id_2 = json.loads(r2.data)["batch_id"]
    assert batch_id_1 != batch_id_2

    rows_1 = json.loads(client.get("/api/batch/%s" % batch_id_1).data)["rows"]
    assert rows_1 == [{"sample": "S1", "conc": "10", "ratio": "", "note": ""}]

    rows_2 = json.loads(client.get("/api/batch/%s" % batch_id_2).data)["rows"]
    assert rows_2 == [{"sample": "S2", "conc": "20", "ratio": "", "note": ""}]


def test_failed_print_is_logged_with_reason(client, monkeypatch):
    monkeypatch.setattr(app_module, "_printer_status",
                        lambda: {"ready": True, "reason": "", "jobs": 0})

    def boom(data, name):
        raise OSError("USB 断开")

    monkeypatch.setattr(app_module, "_send_raw", boom)
    r = client.post("/api/print", json={"rows": [{"sample": "S1"}], "copies": 1})
    assert r.status_code == 500
    hist = json.loads(client.get("/api/history").data)["rows"]
    assert hist[0]["ok"] == 0
    assert "USB" in hist[0]["err"]


def test_successful_print_reports_queue_backlog(client, monkeypatch):
    # 打印后必须复查一次队列：如果除了刚提交的这一个作业还有别的排队，标记积压
    calls = {"n": 0}

    def fake_status():
        calls["n"] += 1
        if calls["n"] == 1:
            return {"ready": True, "reason": "", "jobs": 0}  # 打印前检查
        return {"ready": True, "reason": "", "jobs": 3}       # 打印后复查：还有别的作业堆着

    monkeypatch.setattr(app_module, "_printer_status", fake_status)
    monkeypatch.setattr(app_module, "_send_raw", lambda data, name: 42)
    r = client.post("/api/print", json={"rows": [{"sample": "S1"}], "copies": 1})
    body = json.loads(r.data)
    assert r.status_code == 200
    assert body["queue_jobs"] == 3
    assert body["queue_backlog"] is True


def test_successful_print_reports_no_backlog_when_queue_is_just_this_job(client, monkeypatch):
    monkeypatch.setattr(app_module, "_printer_status",
                        lambda: {"ready": True, "reason": "", "jobs": 1})
    monkeypatch.setattr(app_module, "_send_raw", lambda data, name: 42)
    r = client.post("/api/print", json={"rows": [{"sample": "S1"}], "copies": 1})
    body = json.loads(r.data)
    assert body["queue_backlog"] is False


def test_successful_print_still_returns_ok_when_history_logging_fails(client, monkeypatch):
    """最终整支审查 C4：SQLite 被并发写锁住或磁盘满时 store.log() 可能抛异常。
    这一步是在数据已经真的发给打印机之后——绝不能让这里的异常把响应拖到
    500，那样用户会以为没打印成功而重新点一次「打印」，同一批标签就会被
    打印两遍。历史记录写不进去只应该降级为一句提示，不影响"已送出"这个
    事实本身。
    """
    monkeypatch.setattr(app_module, "_printer_status",
                        lambda: {"ready": True, "reason": "", "jobs": 0})
    monkeypatch.setattr(app_module, "_send_raw", lambda data, name: 42)

    from labelprint.store import Store

    def boom(self, rows, copies, operator, client_ip, ok, err=""):
        raise OSError("database is locked")

    monkeypatch.setattr(Store, "log", boom)

    r = client.post("/api/print", json={"rows": [{"sample": "S1"}], "copies": 1})
    body = json.loads(r.data)
    assert r.status_code == 200, "记历史失败不能连累已经成功送出的打印请求本身"
    assert body["sent"] == 1
    assert body["batch_id"] is None
    assert "历史记录写入失败" in body["message"]


def test_failed_print_still_reports_original_error_when_logging_also_fails(client, monkeypatch):
    """C4 的另一半：送打印本身失败、且记录这次失败也失败（双重故障）时，
    响应必须仍然是原始的"送打印失败：xxx"，不能被 store.log 的异常掩盖
    掉，也不能整个请求变成未处理异常一路崩到通用 500 页面。
    """
    monkeypatch.setattr(app_module, "_printer_status",
                        lambda: {"ready": True, "reason": "", "jobs": 0})

    def send_boom(data, name):
        raise OSError("USB 断开")

    monkeypatch.setattr(app_module, "_send_raw", send_boom)

    from labelprint.store import Store

    def log_boom(self, rows, copies, operator, client_ip, ok, err=""):
        raise OSError("database is locked")

    monkeypatch.setattr(Store, "log", log_boom)

    r = client.post("/api/print", json={"rows": [{"sample": "S1"}], "copies": 1})
    assert r.status_code == 500
    assert r.content_type.startswith("application/json")
    body = json.loads(r.data)
    assert "USB" in body["error"]  # 原始错误原因，不是 store.log 的异常


def test_upload_rejects_file_over_size_limit(client):
    """最终整支审查 C8.1：这台机同时跑着 MariaDB、NanoDrop，可用内存有限，
    /api/parse 会把整个上传文件读进内存，必须有体积上限。上限之上应给出
    中文提示，不是 Flask 默认的英文 413 页面。
    """
    huge = b"x" * (11 * 1024 * 1024)  # 11MB，超过 10MB 上限
    r = client.post("/api/parse", data={"file": (io.BytesIO(huge), "big.csv")},
                    content_type="multipart/form-data")
    assert r.status_code == 413
    assert r.content_type.startswith("application/json")
    assert "10MB" in json.loads(r.data)["error"]


def test_history_search_filters_by_keyword(client, monkeypatch):
    monkeypatch.setattr(app_module, "_printer_status",
                        lambda: {"ready": True, "reason": "", "jobs": 0})
    monkeypatch.setattr(app_module, "_send_raw", lambda data, name: 42)
    client.post("/api/print", json={"rows": [{"sample": "苹果样本"}], "copies": 1})
    client.post("/api/print", json={"rows": [{"sample": "香蕉样本"}], "copies": 1})

    # 如果路由没把 q 传给 store.search、而是仍然调用 recent()，这里会拿到 2 条而非 1 条
    r = client.get("/api/history", query_string={"q": "苹果"})
    rows = json.loads(r.data)["rows"]
    assert len(rows) == 1
    assert rows[0]["sample"] == "苹果样本"


def test_preview_accepts_template_and_echoes_it(client):
    r = client.post("/api/preview", json={
        "layout": "two-up",
        "template": "name-only",
        "rows": [{"sample": "LEFT", "note": "编码：M-1"}, {"sample": "RIGHT"}],
    })
    body = json.loads(r.data)
    assert r.status_code == 200
    assert body["template"] == "name-only"
    assert body["media_count"] == 1


def test_preview_rejects_unknown_template(client):
    r = client.post("/api/preview", json={"layout": "two-up", "template": "fancy", "rows": [{"sample": "S"}]})
    assert r.status_code == 400
    assert "模板" in json.loads(r.data)["error"]


def test_print_rejects_unknown_template(client):
    r = client.post("/api/print", json={"layout": "two-up", "template": "fancy", "rows": [{"sample": "S"}]})
    assert r.status_code == 400
    assert "模板" in json.loads(r.data)["error"]


def test_media_endpoint_reports_paper_and_slot_size(client):
    r = client.get("/api/media")
    body = json.loads(r.data)
    assert r.status_code == 200
    assert body["dpi"] == 300
    assert body["width_mm"] == 59.5
    assert body["height_mm"] == 15.1
    assert body["columns"] == 2
    assert 29.5 <= body["slot_width_mm"] <= 30.0


def test_preview_includes_media_for_ui_frame(client):
    r = client.post("/api/preview", json={"layout": "two-up", "rows": [{"sample": "S"}]})
    body = json.loads(r.data)
    assert body["media"]["width_mm"] == 59.5


def test_preview_accepts_custom_style(client):
    rows = [{"sample": "LEFT", "note": "编码：M-1；规格：500g"}]
    plain = json.loads(client.post("/api/preview", json={"layout": "two-up", "template": "name-detail", "rows": rows}).data)
    styled = client.post("/api/preview", json={"layout": "two-up", "template": "name-detail", "rows": rows,
                                               "style": {"name_pt": 24, "detail_pt": 16, "line_gap": 10}})
    assert styled.status_code == 200
    assert json.loads(styled.data)["images"] != plain["images"]


def test_preview_and_print_reject_bad_style(client):
    for path in ("/api/preview", "/api/print"):
        r = client.post(path, json={"layout": "two-up", "template": "name-detail", "rows": [{"sample": "S"}],
                                    "style": {"name_pt": 200}})
        assert r.status_code == 400
        assert "样式" in json.loads(r.data)["error"]
