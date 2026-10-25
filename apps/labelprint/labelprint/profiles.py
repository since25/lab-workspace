# -*- coding: utf-8 -*-
"""打印介质与版面配置（LabelProfile）。

定义每款打印机对应的物理介质规格、点阵尺寸、排版留白与指令集后端（TSPL / EPL）。
"""
from dataclasses import dataclass
from typing import Tuple


@dataclass(frozen=True)
class LabelProfile:
    id: str
    name: str
    command_set: str          # "tspl" | "epl"
    media_w: int              # 整幅宽度（点，300dpi）
    media_h: int              # 标签高度（点，300dpi）
    slot_w: int               # 单格宽度（点）
    slot_h: int               # 单格高度（点）
    slot_gap: int             # 双列之间的间隙（点）
    gap_y: int                # 行间距/进纸间隙（点）
    margins: Tuple[int, int]  # (左右边距, 上边距)
    dpi: int = 300
    columns: int = 2
    # 毫米物理尺寸（供网页画布、标尺及 CSS 预览）
    width_mm: float = 59.5
    height_mm: float = 15.1
    slot_width_mm: float = 29.7
    slot_height_mm: float = 15.1

    def to_media_dict(self) -> dict:
        """转为供网页前端使用的规格字典。"""
        return {
            "dpi": self.dpi,
            "width_mm": self.width_mm,
            "height_mm": self.height_mm,
            "slot_width_mm": self.slot_width_mm,
            "slot_height_mm": self.slot_height_mm,
            "columns": self.columns,
            "media_w": self.media_w,
            "media_h": self.media_h,
            "command_set": self.command_set,
            "profile_id": self.id,
        }


# Brady BBP12（首台打印机）：59.5×15.1 mm，TSPL 指令集
# 703×178 点 @300dpi，每格 351 点，间隙 1 点
BRADY_30x15_TSPL = LabelProfile(
    id="brady-30x15",
    name="Brady BBP12 (59.5×15.1 mm)",
    command_set="tspl",
    media_w=703,
    media_h=178,
    slot_w=351,
    slot_h=178,
    slot_gap=1,
    gap_y=24,
    margins=(15, 14),
    dpi=300,
    columns=2,
    width_mm=59.5,
    height_mm=15.1,
    slot_width_mm=29.7,
    slot_height_mm=15.1,
)

# POSTEK C168/300s（第二台打印机）：62×20 mm，EPL 指令集
# 736×236 点 @300dpi，92 字节整字节对齐无填充位；单格 354 点（30 mm），列间隙 28 点（2.37 mm）
POSTEK_30x20_EPL = LabelProfile(
    id="postek-30x20",
    name="POSTEK C168/300s (62×20 mm)",
    command_set="epl",
    media_w=736,
    media_h=236,
    slot_w=354,
    slot_h=236,
    slot_gap=28,
    gap_y=24,
    margins=(15, 14),
    dpi=300,
    columns=2,
    width_mm=62.0,
    height_mm=20.0,
    slot_width_mm=30.0,
    slot_height_mm=20.0,
)

PROFILES = {
    BRADY_30x15_TSPL.id: BRADY_30x15_TSPL,
    POSTEK_30x20_EPL.id: POSTEK_30x20_EPL,
}

DEFAULT_PROFILE = BRADY_30x15_TSPL


def get_profile(profile_id: str | None) -> LabelProfile:
    """根据标识返回 Profile；空或未知时回退默认 Brady。"""
    ident = (profile_id or "").strip()
    return PROFILES.get(ident, DEFAULT_PROFILE)
