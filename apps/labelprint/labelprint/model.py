# -*- coding: utf-8 -*-
"""标签数据行。"""
from dataclasses import dataclass


@dataclass
class LabelRow:
    """一行样品数据，对应一张标签。"""
    sample: str            # 样品名称
    conc: str = ""         # 浓度(ng/uL)
    ratio: str = ""        # 260/280
    note: str = ""         # 备注

    def is_empty(self) -> bool:
        """样品名为空即视为空行，不出标签。"""
        return not self.sample.strip()
