# -*- coding: utf-8 -*-
"""位图 -> EPL 指令字节流。

专为 POSTEK C168/300s 等 EPL 驱动的标签打印机设计，与 tspl.py 具有相同的 build_job 签名。
EPL2 GW 指令规范：
  GWx,y,width_bytes,height_dots,data
其中位图数据中 1=有墨（黑点），0=无墨（白点）。
PIL mode '1' 中 0=黑、1=白，因此默认需按位取反（^ 0xFF）以正确渲染黑白。
"""
from PIL import Image

from labelprint.profiles import POSTEK_30x20_EPL, LabelProfile


def _bitmap_payload(img: Image.Image, profile: LabelProfile, invert: bool) -> bytes:
    """把 PIL 图像编码为 EPL GW 有效负载。"""
    if img.mode != "1":
        img = img.convert("1")
    if img.size != (profile.media_w, profile.media_h):
        raise ValueError(
            "位图尺寸必须为 %dx%d，实际 %s" % (profile.media_w, profile.media_h, img.size)
        )
    bytes_per_row = (profile.media_w + 7) // 8
    data = img.tobytes()
    expected_len = bytes_per_row * profile.media_h
    if len(data) != expected_len:
        raise ValueError("位图字节数异常：期望 %d，实际 %d" % (expected_len, len(data)))

    # EPL 规则：1=黑，0=白。PIL mode '1' 默认 0=黑，1=白，因此默认需取反
    # 若 invert=True，则保持原样不反转
    if not invert:
        data = bytes(b ^ 0xFF for b in data)

    # 处理最后字节填充位（EPL 中填充位必须为 0，防止右侧打出黑条）
    remainder = profile.media_w % 8
    if remainder != 0:
        padding_mask = (1 << (8 - remainder)) - 1
        data_list = bytearray(data)
        for row in range(profile.media_h):
            last_byte_idx = (row + 1) * bytes_per_row - 1
            data_list[last_byte_idx] &= ~padding_mask
        data = bytes(data_list)

    return data


def build_job(
    images,
    copies: int = 1,
    profile: LabelProfile | None = None,
    invert: bool = False,
    speed: int = 3,
    density: int = 15,
) -> bytes:
    """把若干张标签位图拼成一个完整 EPL 作业。"""
    if copies < 1:
        raise ValueError("份数必须 >= 1")
    prof = profile or POSTEK_30x20_EPL
    bytes_per_row = (prof.media_w + 7) // 8

    out = bytearray()
    for img in images:
        out += b"N\r\n"
        out += ("q%d\r\n" % prof.media_w).encode("ascii")
        out += ("Q%d,%d\r\n" % (prof.media_h, prof.gap_y)).encode("ascii")
        out += ("S%d\r\n" % speed).encode("ascii")
        out += ("D%d\r\n" % density).encode("ascii")
        out += b"ZT\r\n"
        out += ("GW0,0,%d,%d," % (bytes_per_row, prof.media_h)).encode("ascii")
        out += _bitmap_payload(img, prof, invert)
        out += b"\r\n"
        out += ("P%d\r\n" % copies).encode("ascii")

    return bytes(out)
