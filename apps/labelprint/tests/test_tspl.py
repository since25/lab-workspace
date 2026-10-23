# -*- coding: utf-8 -*-
from PIL import Image
from labelprint import tspl


def _blank():
    return Image.new("1", (703, 178), 1)


def test_header_matches_bartender_parameters():
    """打印参数必须逐字沿用 BarTender 实测值。"""
    job = tspl.build_job([_blank()]).decode("latin-1")
    assert "SIZE 59.5 mm, 15.1 mm" in job
    assert "SPEED 3" in job
    assert "DENSITY 15" in job
    assert "DIRECTION 0,0" in job
    assert "REFERENCE 0,0" in job
    assert "OFFSET 0 mm" in job
    assert "SET PEEL OFF" in job
    assert "SET CUTTER OFF" in job
    assert "SET PARTIAL_CUTTER OFF" in job
    assert "SET TEAR ON" in job


def test_no_gap_command():
    """BarTender 未发 GAP，我们也不发，避免改变走纸行为。"""
    assert "GAP" not in tspl.build_job([_blank()]).decode("latin-1")


def test_bitmap_command_geometry():
    job = tspl.build_job([_blank()]).decode("latin-1")
    assert "BITMAP 0,0,88,178,0," in job


def test_each_label_has_cls_and_print():
    job = tspl.build_job([_blank(), _blank()]).decode("latin-1")
    assert job.count("CLS") == 2
    assert job.count("PRINT 1,1") == 2


def test_copies_render_as_print_1_n():
    job = tspl.build_job([_blank()], copies=3).decode("latin-1")
    assert "PRINT 1,3" in job


def test_bitmap_payload_length():
    """位图数据长度必须精确为 88*178 字节，且紧跟 \r\nPRINT。"""
    job = tspl.build_job([_blank()])
    marker = b"BITMAP 0,0,88,178,0,"
    start = job.index(marker) + len(marker)
    payload_end = start + 88 * 178
    # 检查 payload 内容精确匹配
    assert job[start:payload_end] == b"\xff" * (88 * 178)
    # 检查 payload 之后紧跟 \r\nPRINT（确保没有多拼或少拼字节）
    assert job[payload_end:payload_end + 8] == b"\r\nPRINT "


def test_invert_flips_polarity():
    normal = tspl.build_job([_blank()], invert=False)
    flipped = tspl.build_job([_blank()], invert=True)
    marker = b"BITMAP 0,0,88,178,0,"
    s1 = normal.index(marker) + len(marker)
    s2 = flipped.index(marker) + len(marker)
    assert normal[s1:s1 + 4] == b"\xff\xff\xff\xff"
    assert flipped[s2:s2 + 4] == b"\x00\x00\x00\x00"


def test_header_only_once():
    """header 必须恰好发一次，多张标签时不重复。"""
    job_single = tspl.build_job([_blank()]).decode("latin-1")
    job_double = tspl.build_job([_blank(), _blank()]).decode("latin-1")
    # 单张标签时 SIZE 出现 1 次
    assert job_single.count("SIZE 59.5 mm, 15.1 mm") == 1
    # 多张标签时 SIZE 也只出现 1 次（不在循环内）
    assert job_double.count("SIZE 59.5 mm, 15.1 mm") == 1
    # SET TEAR ON 同样只出现 1 次
    assert job_single.count("SET TEAR ON") == 1
    assert job_double.count("SET TEAR ON") == 1
