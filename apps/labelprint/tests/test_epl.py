# -*- coding: utf-8 -*-
from PIL import Image
import pytest

from labelprint import epl, profiles


def _postek_blank():
    return Image.new("1", (736, 236), 1)


def test_epl_job_structure():
    img = _postek_blank()
    job = epl.build_job([img], copies=1, profile=profiles.POSTEK_30x20_EPL).decode("latin-1")
    assert "N\r\n" in job
    assert "q736\r\n" in job
    assert "Q236,24\r\n" in job
    assert "S3\r\n" in job
    assert "D15\r\n" in job
    assert "ZT\r\n" in job
    assert "GW0,0,92,236," in job
    assert "P1\r\n" in job


def test_epl_copies():
    img = _postek_blank()
    job = epl.build_job([img], copies=4, profile=profiles.POSTEK_30x20_EPL).decode("latin-1")
    assert "P4\r\n" in job


def test_epl_payload_size_and_polarity():
    # 736 / 8 = 92 字节/行，共 236 行 = 21712 字节
    img = _postek_blank()
    job = epl.build_job([img], copies=1, profile=profiles.POSTEK_30x20_EPL)
    marker = b"GW0,0,92,236,"
    start = job.index(marker) + len(marker)
    expected_len = 92 * 236
    payload = job[start:start + expected_len]
    assert len(payload) == expected_len
    # 默认白底：PIL mode 1 全为 1（0xFF，不加热留白），与 TSPL 一致
    assert payload == b"\xff" * expected_len
    # 校验紧跟 \r\nP1\r\n
    assert job[start + expected_len:start + expected_len + 6] == b"\r\nP1\r\n"


def test_epl_invert():
    img = _postek_blank()
    # invert=True 时取反变为 0x00（黑底反白）
    job = epl.build_job([img], copies=1, profile=profiles.POSTEK_30x20_EPL, invert=True)
    marker = b"GW0,0,92,236,"
    start = job.index(marker) + len(marker)
    expected_len = 92 * 236
    payload = job[start:start + expected_len]
    assert payload == b"\x00" * expected_len


def test_epl_multiple_images():
    img1 = _postek_blank()
    img2 = _postek_blank()
    job = epl.build_job([img1, img2], copies=1, profile=profiles.POSTEK_30x20_EPL).decode("latin-1")
    assert job.count("N\r\n") == 2
    assert job.count("GW0,0,92,236,") == 2
    assert job.count("P1\r\n") == 2


def test_epl_invalid_size():
    bad_img = Image.new("1", (700, 200), 1)
    with pytest.raises(ValueError, match="位图尺寸必须为 736x236"):
        epl.build_job([bad_img], profile=profiles.POSTEK_30x20_EPL)


def test_epl_invalid_copies():
    img = _postek_blank()
    with pytest.raises(ValueError, match="份数必须 >= 1"):
        epl.build_job([img], copies=0)
