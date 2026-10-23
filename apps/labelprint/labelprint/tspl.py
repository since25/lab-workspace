# -*- coding: utf-8 -*-
"""位图 -> TSPL 指令字节流。

参数逐字沿用截获的 BarTender spool，不自行发挥；BarTender 未发 GAP，
此处同样不发，标签间距由打印机自身设置控制。
"""
from PIL import Image

from labelprint.render import LABEL_H, LABEL_W

BYTES_PER_ROW = (LABEL_W + 7) // 8      # 703 -> 88

_HEADER = (
    "SIZE 59.5 mm, 15.1 mm\r\n"
    "SPEED 3\r\n"
    "DENSITY 15\r\n"
    "DIRECTION 0,0\r\n"
    "REFERENCE 0,0\r\n"
    "OFFSET 0 mm\r\n"
    "SET PEEL OFF\r\n"
    "SET CUTTER OFF\r\n"
    "SET PARTIAL_CUTTER OFF\r\n"
    "SET TEAR ON\r\n"
)


def _bitmap_payload(img: Image.Image, invert: bool) -> bytes:
    """把 PIL 图像编码为 TSPL BITMAP 有效负载。

    PIL mode '1' 的 tobytes() 产生按行字节对齐的 1bpp 数据。LABEL_W=703
    位会产生 88 字节/行，其中最后一个字节的第 8 位（bit 0）是填充位。
    PIL 恒置填充位为 0，但标签背景是白色（1），填充位必须为 1 否则该列会有墨。
    此处必须设置填充位为 1。删除这段代码会导致标签右侧竖线 bug。
    """
    if img.mode != "1":
        img = img.convert("1")
    if img.size != (LABEL_W, LABEL_H):
        raise ValueError("位图尺寸必须为 %dx%d，实际 %s" % (LABEL_W, LABEL_H, img.size))
    data = img.tobytes()
    if len(data) != BYTES_PER_ROW * LABEL_H:
        raise ValueError("位图字节数异常：%d" % len(data))

    # 处理填充位：LABEL_W=703，每行最后一个字节的低 1 位是填充位
    # 需要确保填充位为 1（对应白色背景）
    remainder = LABEL_W % 8
    if remainder != 0:
        padding_mask = (1 << (8 - remainder)) - 1
        data_list = bytearray(data)
        for row in range(LABEL_H):
            last_byte_idx = (row + 1) * BYTES_PER_ROW - 1
            data_list[last_byte_idx] |= padding_mask
        data = bytes(data_list)

    if invert:
        data = bytes(b ^ 0xFF for b in data)
    return data


def build_job(images, copies: int = 1, invert: bool = False) -> bytes:
    """把若干张标签位图拼成一个完整 TSPL 作业。"""
    if copies < 1:
        raise ValueError("份数必须 >= 1")
    out = bytearray(_HEADER.encode("ascii"))
    for img in images:
        out += b"CLS\r\n"
        out += ("BITMAP 0,0,%d,%d,0," % (BYTES_PER_ROW, LABEL_H)).encode("ascii")
        out += _bitmap_payload(img, invert)
        out += b"\r\n"
        out += ("PRINT 1,%d\r\n" % copies).encode("ascii")
    return bytes(out)
