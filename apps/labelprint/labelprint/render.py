# -*- coding: utf-8 -*-
"""标签渲染：LabelRow -> 单色位图。

画布来源：截获的 BarTender spool 首行 `SIZE 59.5 mm, 15.1 mm`，
59.5mm x 15.1mm @ 300dpi = 703 x 178 点。
"""
import re

from PIL import Image, ImageDraw, ImageFont

from labelprint import fonts
from labelprint.model import LabelRow


class LabelTooLongError(ValueError):
    """样品名太长，无法排入标签。"""
    pass


LABEL_W = 703
LABEL_H = 178
TWO_UP_GAP = 1
SLOT_W = (LABEL_W - TWO_UP_GAP) // 2

# 纸张尺寸以毫米为准（界面标注、预览外框都用这组数），点阵只用于渲染。
DPI = 300
_mm = lambda dots: dots * 25.4 / DPI
MEDIA = {
    "dpi": DPI,
    "width_mm": round(_mm(LABEL_W), 1),
    "height_mm": round(_mm(LABEL_H), 1),
    "slot_width_mm": round(_mm(SLOT_W), 1),
    "slot_height_mm": round(_mm(LABEL_H), 1),
    "columns": 2,
}

MARGIN_X = 15          # 左右边距
MARGIN_TOP = 10        # 上边距
NAME_MAX_PT = 75       # 样品名最大字号
NAME_MIN_PT = 20       # 样品名最小字号（改为 20 以容纳更多文字）
LINE2_PT = 34          # 第二行字号
LINE2_MIN_PT = 22      # 第二行最小字号（用于超长内容收缩）
GAP_Y = 8              # 两行间距
LINE_SPACING = 20      # 左右内容最小间隔（点）
# 30 mm 格内四周留白：300 dpi 下 12 点约 1.0 mm。实测旧值（左右 10、上 5）
# 时长名称与首字几乎贴住白标边缘，照片上「蛋」字左上角被压掉一部分，所以
# 上下左右统一留到 1 mm 以上；左右取 15 点（1.27 mm）给打印机的物理偏移留
# 余量，视觉上仍约 1 mm。宁可字号略小也不把字顶到纸边。
SLOT_MARGIN_X = 15
SLOT_MARGIN_TOP = 14
SLOT_MARGIN_BOTTOM = 14
SLOT_LINE_GAP = 2

# 内置模板：同一份行数据用不同字号与是否显示字段来排版。
# 画布固定 703×178 点（59.5×15.1 mm @300dpi），每格 351 点宽、四周留白 15/14 点；
# 模板只改字号，不改纸张：
#   name-detail 名称 34pt（超宽自动缩到 18）、字段 20pt（缩到 13）
#   uniform    名称与字段同为 22pt（缩到 16/13）
#   name-only  只有名称，46pt（缩到 24），不排字段
TEMPLATES = {
    "name-detail": {"name_pt": 34, "name_min": 18, "detail_pt": 20, "detail_min": 13, "details": True},
    "uniform": {"name_pt": 22, "name_min": 16, "detail_pt": 22, "detail_min": 13, "details": True},
    "name-only": {"name_pt": 46, "name_min": 24, "detail_pt": 20, "detail_min": 13, "details": False},
}
DEFAULT_TEMPLATE = "name-detail"

_BOLD_PATH, _BOLD_IDX, _REG_PATH, _REG_IDX = fonts.resolve()


def _bold(size):
    return ImageFont.truetype(_BOLD_PATH, size, index=_BOLD_IDX)


def _regular(size):
    return ImageFont.truetype(_REG_PATH, size, index=_REG_IDX)


def _text_width(text, font):
    return font.getbbox(text)[2] - font.getbbox(text)[0]


def fit_font_size(text, max_width, start_size, min_size=NAME_MIN_PT):
    """从 start_size 逐级缩小，直到文本宽度不超过 max_width。返回值永不低于 min_size。"""
    size = start_size
    while size > min_size and _text_width(text, _bold(size)) > max_width:
        size -= 2
    # 修正 off-by-one：确保返回值不低于 min_size
    if size < min_size:
        size = min_size
    return size


def build_second_line(row: LabelRow, date_str: str):
    """组装第二行，返回 (左侧内容, 右侧日期)。空字段自动跳过。"""
    parts = []
    if row.conc.strip():
        parts.append("%s ng/uL" % row.conc.strip())
    if row.ratio.strip():
        parts.append("260/280 %s" % row.ratio.strip())
    if row.note.strip():
        parts.append(row.note.strip())
    return "   ".join(parts), date_str


def _fit_and_truncate_line(text, max_width, start_size, min_size):
    """收缩并截断文本：优先按宽度缩字号，缩到下限后尾部截断加省略号。

    返回 (最终文本, 使用字号)。
    """
    size = start_size
    # 逐级缩小直到合适
    while size > min_size and _text_width(text, _regular(size)) > max_width:
        size -= 2

    # 修正 clamp：确保返回值不低于 min_size
    if size < min_size:
        size = min_size

    # 到下限了仍然放不下，则截断加省略号
    if _text_width(text, _regular(size)) > max_width:
        font = _regular(size)
        # 逐字符截断直到加上省略号后能放下
        for end in range(len(text), 0, -1):
            truncated = text[:end] + "…"
            if _text_width(truncated, font) <= max_width:
                return truncated, size
        # 极端情况：连一个字都放不下，返回省略号或空
        return "…", size

    return text, size


def _render_label(row: LabelRow, date_str: str, width: int) -> Image.Image:
    """在指定宽度的标签格内渲染一张标签。"""
    img = Image.new("1", (width, LABEL_H), 1)
    draw = ImageDraw.Draw(img)
    usable = width - 2 * MARGIN_X

    # 处理样品名：宁可不打，绝不打错
    name = row.sample.strip()
    name_pt = fit_font_size(name, usable, NAME_MAX_PT)
    name_font = _bold(name_pt)

    # 检查：即使在最小字号下也放不下，则报错
    if _text_width(name, name_font) > usable:
        left, right = 0, len(name) - 1
        char_limit = 0
        while left <= right:
            mid = (left + right) // 2
            truncated = name[:mid]
            if _text_width(truncated, name_font) <= usable:
                char_limit = mid
                left = mid + 1
            else:
                right = mid - 1
        raise LabelTooLongError(
            f'样品名「{name}」太长，排不进标签（当前 {len(name)} 字符，'
            f'最多 {char_limit} 字符），请缩短后重试'
        )

    draw.text((MARGIN_X, MARGIN_TOP), name, font=name_font, fill=0)

    name_bottom = MARGIN_TOP + name_font.getbbox(name)[3]
    left_raw, right_text = build_second_line(row, date_str)
    y2 = name_bottom + GAP_Y
    right_font = _regular(LINE2_PT)
    right_width = _text_width(right_text, right_font) if right_text else 0
    left_max_width = usable - right_width - LINE_SPACING if right_width > 0 else usable

    left_final = left_font = None
    if left_raw:
        left_final, left_pt = _fit_and_truncate_line(left_raw, left_max_width, LINE2_PT, LINE2_MIN_PT)
        left_font = _regular(left_pt)

    line2_bottom = y2
    if left_final:
        line2_bottom = max(line2_bottom, y2 + left_font.getbbox(left_final)[3])
    if right_text:
        line2_bottom = max(line2_bottom, y2 + right_font.getbbox(right_text)[3])
    if line2_bottom > LABEL_H:
        raise LabelTooLongError(
            f'样品名「{name}」在当前字体下把第二行挤出了画布'
            f'（需要到 y={line2_bottom}，画布高度只有 {LABEL_H}），'
            f'请缩短样品名或第二行内容后重试'
        )

    if left_final:
        draw.text((MARGIN_X, y2), left_final, font=left_font, fill=0)
    if right_text:
        right_x = width - MARGIN_X - right_width
        draw.text((right_x, y2), right_text, font=right_font, fill=0)
    return img


def render_label(row: LabelRow, date_str: str) -> Image.Image:
    """渲染一张兼容旧接口的整幅标签。mode '1'：0 = 黑（打印），1 = 白。

    若样品名在最小字号下仍超出可用宽度，抛 LabelTooLongError。
    """
    return _render_label(row, date_str, LABEL_W)


SLOT_MAX_NAME_LINES = 3     # 名称最多三行，超过就缩字号
SLOT_MAX_DETAIL_LINES = 2   # 单条字段最多两行，超过先缩字号再截断
SLOT_NAME_GAP = 4           # 名称与字段之间的间距


# 英文/数字连写（0.2ml、PCR、SFPES013122SI）算一个整体，中文逐字断；
# 折行时优先在空格或中英文交界处断，避免把 PCR 拆成 PC / R。
_TOKEN_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9._+\-/×]*|[\u4e00-\u9fff]|\s+|[^\s]")


def _tokens(text: str) -> list[str]:
    return _TOKEN_RE.findall(text)


def _join_tokens(tokens: list[str]) -> str:
    out, pending = "", False
    for tok in tokens:
        if tok.isspace():
            pending = True
            continue
        out += (" " if pending and out else "") + tok
        pending = False
    return out


def _balance_two(text: str, font, max_width: int):
    """两行时挑选左右宽度最接近的断点，避免「……试剂 / 盒」这种尾巴。"""
    toks = _tokens(text.strip())
    best = None
    for k in range(1, len(toks)):
        left, right = _join_tokens(toks[:k]), _join_tokens(toks[k:])
        if not left.strip() or not right.strip():
            continue
        wl, wr = _text_width(left, font), _text_width(right, font)
        if wl <= max_width and wr <= max_width:
            diff = abs(wl - wr)
            if best is None or diff < best[0]:
                best = (diff, [left, right])
    return best[1] if best else None


def _wrap_lines(text: str, font, max_width: int, max_lines: int):
    """按宽度折行，放不进 max_lines 行时返回 None。"""
    tokens = _tokens(text.strip())
    lines, cur = [], ""
    pending_space = False
    for tok in tokens:
        if tok.isspace():
            pending_space = True
            continue
        joined = cur + (" " if pending_space and cur else "") + tok
        if _text_width(joined, font) <= max_width:
            cur = joined
            pending_space = False
            continue
        if cur.strip():
            lines.append(cur.rstrip())
            if len(lines) >= max_lines:
                return None
            cur = ""
        pending_space = False
        # 单词单独一行也放不下时逐字拆
        for ch in tok:
            if _text_width(cur + ch, font) <= max_width or not cur:
                cur += ch
            else:
                lines.append(cur)
                if len(lines) >= max_lines:
                    return None
                cur = ch
    if cur.strip():
        lines.append(cur.rstrip())
    if len(lines) > max_lines:
        return None
    if len(lines) == 2:
        balanced = _balance_two(text, font, max_width)
        if balanced:
            return balanced
    return lines


def _line_height(font) -> int:
    ascent, descent = font.getmetrics()
    return ascent + descent


def _measure(lines: list[str], font, gap: int = 0) -> int:
    if not lines:
        return 0
    return len(lines) * _line_height(font) + (len(lines) - 1) * gap


def _render_compact_slot(row: LabelRow, template: str = DEFAULT_TEMPLATE) -> Image.Image:
    """渲染 30 mm 双列纸的一格。

    名称最多两行、字段最多两行，按可用高度整体垂直居中；先按大字号排版，
    放不下再逐步缩字号，避免短名称被顶在上边、下面空掉一大片。
    """
    style = TEMPLATES.get(template, TEMPLATES[DEFAULT_TEMPLATE])
    img = Image.new("1", (SLOT_W, LABEL_H), 1)
    draw = ImageDraw.Draw(img)
    usable_w = SLOT_W - 2 * SLOT_MARGIN_X
    usable_h = LABEL_H - SLOT_MARGIN_TOP - SLOT_MARGIN_BOTTOM
    name = row.sample.strip()

    details: list[str] = []
    if style["details"]:
        if row.conc.strip():
            details.append(f"浓度：{row.conc.strip()}")
        if row.ratio.strip():
            details.append(f"260/280：{row.ratio.strip()}")
        if row.note.strip():
            details.extend(part.strip() for part in row.note.replace("\n", "；").split("；") if part.strip())

    name_pt = style["name_pt"]
    detail_pt = style["detail_pt"]
    chosen = None
    while name_pt >= style["name_min"]:
        name_font = _bold(name_pt)
        name_lines = _wrap_lines(name, name_font, usable_w, SLOT_MAX_NAME_LINES)
        if name_lines is not None:
            for size in range(style["detail_pt"], style["detail_min"] - 1, -1):
                font = _regular(size)
                wrapped = [_wrap_lines(d, font, usable_w, SLOT_MAX_DETAIL_LINES) for d in details]
                if any(w is None for w in wrapped):
                    continue
                height = _measure(name_lines, name_font) + (SLOT_NAME_GAP if details else 0)
                height += sum(_measure(w, font, SLOT_LINE_GAP) for w in wrapped)
                if height <= usable_h:
                    chosen = (name_lines, name_font, wrapped, font, height)
                    detail_pt = size
                    break
        if chosen:
            break
        name_pt -= 2
        detail_pt = style["detail_pt"]

    if chosen is None:
        # 最小字号仍排不下：名称不动，字段截断到一行能放下的量
        name_font = _bold(style["name_min"])
        name_lines = _wrap_lines(name, name_font, usable_w, SLOT_MAX_NAME_LINES)
        if name_lines is None:
            raise LabelTooLongError(
                f'样品名「{name}」太长，排不进 30 mm 标签（当前 {len(name)} 字符），请缩短后重试'
            )
        font = _regular(style["detail_min"])
        wrapped = []
        for d in details:
            w = _wrap_lines(d, font, usable_w, 1)
            if w is None:
                d, _ = _fit_and_truncate_line(d, usable_w, style["detail_min"], style["detail_min"])
                w = [d]
            wrapped.append(w)
        height = _measure(name_lines, name_font) + (SLOT_NAME_GAP if details else 0)
        height += sum(_measure(w, font, SLOT_LINE_GAP) for w in wrapped)
        while height > usable_h and wrapped:
            wrapped.pop()
            height = _measure(name_lines, name_font) + (SLOT_NAME_GAP if wrapped else 0)
            height += sum(_measure(w, font, SLOT_LINE_GAP) for w in wrapped)
        chosen = (name_lines, name_font, wrapped, font, height)

    name_lines, name_font, wrapped, detail_font, height = chosen
    y = SLOT_MARGIN_TOP + max(0, (usable_h - height) // 2)
    for line in name_lines:
        draw.text((SLOT_MARGIN_X, y), line, font=name_font, fill=0)
        y += _line_height(name_font)
    if wrapped:
        y += SLOT_NAME_GAP
        for lines in wrapped:
            for line in lines:
                draw.text((SLOT_MARGIN_X, y), line, font=detail_font, fill=0)
                y += _line_height(detail_font)
            y += SLOT_LINE_GAP
    return img


def render_two_up(rows: list[LabelRow], date_str: str, template: str = DEFAULT_TEMPLATE) -> Image.Image:
    """把最多两张标签排在同一张双列载体上，奇数时右列保持空白。"""
    if not 1 <= len(rows) <= 2:
        raise ValueError("双列标签一次需要 1 至 2 行")
    media = Image.new("1", (LABEL_W, LABEL_H), 1)
    for index, row in enumerate(rows):
        x = 0 if index == 0 else SLOT_W + TWO_UP_GAP
        media.paste(_render_compact_slot(row, template), (x, 0))
    return media
