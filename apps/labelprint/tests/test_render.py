# -*- coding: utf-8 -*-
import pytest
from PIL import Image
from labelprint.model import LabelRow
from labelprint import render


def test_canvas_size_and_mode():
    img = render.render_label(LabelRow(sample="G1_WT-1_U"), "2026-09-02")
    assert img.size == (703, 178)
    assert img.mode == "1"


def test_two_up_renders_left_and_right_slots_and_leaves_odd_right_blank():
    left = render.render_two_up([LabelRow(sample="LEFT")], "2026-09-02")
    assert left.size == (render.LABEL_W, render.LABEL_H)
    assert left.mode == "1"
    assert 0 in left.crop((0, 0, render.SLOT_W, render.LABEL_H)).getdata()
    assert 0 not in left.crop((render.SLOT_W + render.TWO_UP_GAP, 0, render.LABEL_W, render.LABEL_H)).getdata()

    pair = render.render_two_up([LabelRow(sample="LEFT"), LabelRow(sample="RIGHT")], "2026-09-02")
    assert 0 in pair.crop((0, 0, render.SLOT_W, render.LABEL_H)).getdata()
    assert 0 in pair.crop((render.SLOT_W + render.TWO_UP_GAP, 0, render.LABEL_W, render.LABEL_H)).getdata()


def test_bytes_are_row_aligned():
    """TSPL BITMAP 要求每行按字节对齐：703 位 -> 88 字节/行。"""
    img = render.render_label(LabelRow(sample="G1_WT-1_U"), "2026-09-02")
    assert len(img.tobytes()) == 88 * 178


def test_something_is_drawn():
    """渲染后必须有黑点，否则等于打了张白标签。"""
    img = render.render_label(LabelRow(sample="G1_WT-1_U"), "2026-09-02")
    assert 0 in img.getdata(), "画布全白，说明没画上去"


def test_blank_fields_are_skipped():
    """浓度与比值为空时，第二行不应出现 ng/uL 或 260/280 字样。"""
    only_name = render.build_second_line(LabelRow(sample="S1"), "2026-09-02")
    assert only_name == ("", "2026-09-02")

    full = render.build_second_line(
        LabelRow(sample="S1", conc="128.5", ratio="1.85"), "2026-09-02")
    assert full == ("128.5 ng/uL   260/280 1.85", "2026-09-02")


def test_note_is_appended_when_present():
    left, _ = render.build_second_line(
        LabelRow(sample="S1", conc="128.5", note="第二批"), "2026-09-02")
    assert left == "128.5 ng/uL   第二批"


def test_fit_font_size_never_below_min():
    """fit_font_size 返回值永不低于 min_size。"""
    long_name = "G1_WT_KNOCKOUT_REPLICATE_12_UNTREATED_LONG"
    size = render.fit_font_size(long_name, max_width=673,
                                start_size=render.NAME_MAX_PT,
                                min_size=render.NAME_MIN_PT)
    assert size >= render.NAME_MIN_PT, f"返回值 {size} 低于 min_size {render.NAME_MIN_PT}"


def test_long_sample_name_shrinks_to_fit():
    """超长样品名必须缩字号。实际像素宽度必须不超过可用宽度。"""
    long_name = "G1_WT_KNOCKOUT_REPLICATE_12_UNTREATED_LONG"
    size = render.fit_font_size(long_name, max_width=673,
                                start_size=render.NAME_MAX_PT)
    assert size < render.NAME_MAX_PT

    # 实测：渲染所用字号下样品名宽度必须 <= 可用宽度
    img = render.render_label(LabelRow(sample=long_name), "2026-09-02")
    assert img.size == (703, 178)

    # 验证像素宽度
    from PIL import ImageFont
    bold_path, bold_idx, _, _ = render.fonts.resolve()
    font = ImageFont.truetype(bold_path, size, index=bold_idx)
    actual_width = font.getbbox(long_name)[2] - font.getbbox(long_name)[0]
    usable_width = render.LABEL_W - 2 * render.MARGIN_X
    assert actual_width <= usable_width, \
        f"样品名宽度 {actual_width} > 可用宽度 {usable_width}"


def test_extremely_long_name_raises_error():
    """超长到下限也放不下的样品名应抛异常，不得静默截断。"""
    # 用一个极其长的名字，无论怎么缩都放不下
    too_long = "A" * 200
    with pytest.raises(render.LabelTooLongError) as exc_info:
        render.render_label(LabelRow(sample=too_long), "2026-09-02")

    # 异常消息应包含样品名和可读的提示
    err_msg = str(exc_info.value)
    assert too_long[:20] in err_msg, "异常消息应包含样品名"
    assert "字符" in err_msg, "异常消息应提示字符数"


def test_long_note_triggers_truncation():
    """长备注触发第二行截断加省略号，结果必须以 … 结尾且宽度合适。"""
    from PIL import ImageFont
    # 一个很长的备注，拼上浓度后会溢出
    long_note = "样本轻微降解建议尽快复测并留意后续结果可能偏低"
    row = LabelRow(sample="S1", conc="128.5", note=long_note)

    # 调用 build_second_line 得到原始内容
    left_raw, right = render.build_second_line(row, "2026-09-02")

    # 计算实际可用宽度（同 render_label 中的逻辑）
    _, _, reg_path, reg_idx = render.fonts.resolve()
    right_font = ImageFont.truetype(reg_path, render.LINE2_PT, index=reg_idx)
    right_width = right_font.getbbox(right)[2] - right_font.getbbox(right)[0]
    usable = render.LABEL_W - 2 * render.MARGIN_X
    left_max_width = usable - right_width - render.LINE_SPACING

    # 调用截断函数获取实际结果
    left_final, left_pt = render._fit_and_truncate_line(
        left_raw, left_max_width, render.LINE2_PT, render.LINE2_MIN_PT
    )

    # 验证：如果被截断了，必须以 … 结尾
    if len(left_final) < len(left_raw):
        assert left_final.endswith("…"), f"截断后应以 … 结尾，实际：{left_final}"

    # 验证：实际宽度必须不超过可用宽度
    left_font = ImageFont.truetype(reg_path, left_pt, index=reg_idx)
    actual_width = left_font.getbbox(left_final)[2] - left_font.getbbox(left_final)[0]
    assert actual_width <= left_max_width, \
        f"宽度溢出：{actual_width} > {left_max_width}"

    # 验证渲染不抛异常
    img = render.render_label(row, "2026-09-02")
    assert img.size == (703, 178)


def test_fit_and_truncate_line_never_below_min():
    """_fit_and_truncate_line 返回字号永不低于 min_size。"""
    text = "这是一个很长的文本" * 10
    size = render._fit_and_truncate_line(text, max_width=100,
                                         start_size=34, min_size=22)[1]
    assert size >= 22, f"返回字号 {size} 低于 min_size 22"


def test_label_too_long_error_char_limit_is_feasible():
    """LabelTooLongError 提示的字符数应该是可行的。"""
    from PIL import ImageFont
    # 一个极长的名字，会触发异常
    long_name = "A" * 200
    try:
        render.render_label(LabelRow(sample=long_name), "2026-09-02")
        assert False, "应该抛异常"
    except render.LabelTooLongError as e:
        # 从异常消息中提取最多字符数
        msg = str(e)
        # 消息格式：... 最多 N 字符 ...
        import re
        match = re.search(r'最多 (\d+) 字符', msg)
        assert match, f"无法从异常消息中提取字符数：{msg}"
        char_limit = int(match.group(1))

        # 验证：截断到这个长度的名字应该能成功渲染
        truncated_name = long_name[:char_limit]
        img = render.render_label(LabelRow(sample=truncated_name), "2026-09-02")
        assert img.size == (703, 178)

        # 验证：再多一个字就会失败
        longer_name = long_name[:char_limit + 1]
        with pytest.raises(render.LabelTooLongError):
            render.render_label(LabelRow(sample=longer_name), "2026-09-02")


def test_line2_left_and_right_do_not_overlap():
    """第二行左侧与右侧日期不重叠：左边界 + 宽度 + 最小间隔 <= 右边界。"""
    from PIL import ImageFont
    # 构造一个会导致左侧内容很长的行
    row = LabelRow(sample="S1", conc="999.99", ratio="2.50",
                   note="长备注内容")

    # 调用 build_second_line 得到原始内容
    left_raw, right = render.build_second_line(row, "2026-09-02")

    # 读取字体和尺寸信息
    _, _, reg_path, reg_idx = render.fonts.resolve()
    right_font = ImageFont.truetype(reg_path, render.LINE2_PT, index=reg_idx)

    # 计算实际左侧和右侧
    right_width = right_font.getbbox(right)[2] - right_font.getbbox(right)[0]
    usable = render.LABEL_W - 2 * render.MARGIN_X
    left_max_width = usable - right_width - render.LINE_SPACING

    # 获取实际渲染的左侧内容和字号
    left_final, left_pt = render._fit_and_truncate_line(
        left_raw, left_max_width, render.LINE2_PT, render.LINE2_MIN_PT
    )
    left_font = ImageFont.truetype(reg_path, left_pt, index=reg_idx)
    left_width = left_font.getbbox(left_final)[2] - left_font.getbbox(left_final)[0]

    # 计算实际的 x 坐标
    left_x = render.MARGIN_X
    left_right_boundary = left_x + left_width  # 左侧文本的右边界
    right_x = render.LABEL_W - render.MARGIN_X - right_width  # 右侧日期的左边界

    # 验证：左侧右边界 + 最小间隔 <= 右侧左边界
    assert left_right_boundary + render.LINE_SPACING <= right_x, \
        f"重叠：左侧右边界 {left_right_boundary} + 间隔 {render.LINE_SPACING} = {left_right_boundary + render.LINE_SPACING} > " \
        f"右侧左边界 {right_x}"

    # 渲染验证
    img = render.render_label(row, "2026-09-02")
    assert img.size == (703, 178)


def _row_is_blank(img, y):
    """整行像素是否全白（mode '1'：1=白，0=黑）。"""
    return 0 not in img.crop((0, y, img.width, y + 1)).get_flattened_data()


def test_second_line_does_not_collide_with_name_descender():
    """样品名末尾若有下划线等下伸部分，不能跟第二行文字糊在一起。

    真实发生过的错标：第二行起始位置若按标称字号（NAME_MAX_PT）估算，
    在生产字体微软雅黑加粗下会比样品名的真实字形矮一大截——下划线被压进
    第二行、跟第二行文字重叠成一团黑影，G1_WT-1_U 因此在标签上被印成
    看不出下划线的 G1 WT-1 U。开发机的华文黑体在这段文字上恰好还有余量，
    所以这个 bug 只在生产字体上才会暴露。

    断言与具体用哪款字体无关：用「这台机器实际解析到的字体」（而不是
    某个写死的字号数字）量出样品名的真实字形下边界，要求这一行往下、
    到第二行真正起笔之前，必须能找到连续的空白像素行。
    """
    row = LabelRow(sample="G1_WT-1_U", conc="128.5", ratio="1.85")
    date_str = "2026-09-02"
    usable = render.LABEL_W - 2 * render.MARGIN_X
    name = row.sample.strip()
    name_pt = render.fit_font_size(name, usable, render.NAME_MAX_PT)
    name_bottom = render.MARGIN_TOP + render._bold(name_pt).getbbox(name)[3]
    assert name_bottom < render.LABEL_H, "样品名本身已经超出画布，不该发生"

    img = render.render_label(row, date_str)

    gap = 0
    y = name_bottom
    while y < render.LABEL_H and _row_is_blank(img, y):
        gap += 1
        y += 1
    assert gap >= 2, (
        f"样品名真实字形下边界（y={name_bottom}）往下没能找到空白间隙"
        f"（只有 {gap} 行空白），说明下划线等下伸部分与第二行文字发生了重叠"
    )


def test_second_line_does_not_overflow_canvas_bottom():
    """第二行自身也不能被真实字形挤出画布底部——溢出不会报错，PIL 只会
    静默裁掉文字下半截，比不打印更危险，必须在渲染阶段主动拦截。

    用样品名接近最大字号、且第二行内容拉满（浓度+比值+长备注）的场景，
    这是第二行离画布底部最近的真实情形。
    """
    row = LabelRow(sample="G1_WT-1_U", conc="999.99", ratio="2.50",
                   note="长备注内容用于压测垂直空间")
    img = render.render_label(row, "2026-09-02")
    assert img.size == (703, 178)
    # 画布最后一行不应该有被硬生生切断的笔画——用"最后一行是否全白"做
    # 一个廉价的兜底信号：正常版式里第二行不会画到贴着画布最下沿。
    assert _row_is_blank(img, render.LABEL_H - 1), (
        "画布最后一行出现墨迹，第二行的文字可能已经被画布下边界裁切"
    )


@pytest.mark.parametrize("name", ["蛋白胨", "无内毒素质粒大提试剂盒", "DH5α 感受态细胞"])
def test_two_up_slots_keep_one_mm_margin(name):
    """双列每一格四周至少留 1 mm（300 dpi 下约 12 点）。

    实测教训：旧版上边只留 5 点、左留 10 点，实物上「蛋」字左上角被白标边缘
    压掉一部分，长名称也顶到格边。这里直接量墨迹包围盒，避免以后改字号或
    行距时又把文字顶回纸边。
    """
    row = LabelRow(sample=name, note="物料编码：M-10033；规格型号：500g")
    media = render.render_two_up([row, row], "2026-10-23")
    cells = [
        media.crop((0, 0, render.SLOT_W, render.LABEL_H)),
        media.crop((render.SLOT_W + render.TWO_UP_GAP, 0, render.LABEL_W, render.LABEL_H)),
    ]
    for cell in cells:
        bbox = cell.convert("L").point(lambda p: 255 - p).getbbox()
        assert bbox is not None, "格内没有墨迹"
        left, top = bbox[0], bbox[1]
        right, bottom = render.SLOT_W - bbox[2], render.LABEL_H - bbox[3]
        assert min(left, top, right, bottom) >= 11, (
            f"「{name}」在 30 mm 格内的墨迹边距不足 1 mm："
            f"左 {left} 上 {top} 右 {right} 下 {bottom}（单位：点，1 mm≈11.8 点）"
        )


def _ink_bbox(img):
    return img.convert("L").point(lambda p: 255 - p).getbbox()


def test_templates_change_name_size_and_details():
    """三个内置模板要真的不同：仅名称字号最大，名称+字段次之，等宽最小。"""
    only_name = LabelRow(sample="示例耗材")

    def name_height(template):
        img = render.render_two_up([only_name], "2026-10-23", template).crop((0, 0, render.SLOT_W, render.LABEL_H))
        box = _ink_bbox(img)
        return box[3] - box[1]

    assert name_height("name-only") > name_height("name-detail") > name_height("uniform")

    # 仅名称模板不排字段：带备注渲染出来的格子与不带备注完全一致
    with_note = LabelRow(sample="示例耗材", note="物料编码：M-1；规格型号：500g；品牌：示例品牌")
    plain = render.render_two_up([only_name], "2026-10-23", "name-only").crop((0, 0, render.SLOT_W, render.LABEL_H))
    noted = render.render_two_up([with_note], "2026-10-23", "name-only").crop((0, 0, render.SLOT_W, render.LABEL_H))
    assert noted.tobytes() == plain.tobytes()


def test_unknown_template_falls_back_to_default():
    row = LabelRow(sample="示例耗材")
    fallback = render.render_two_up([row], "2026-10-23", "no-such-template").crop((0, 0, render.SLOT_W, render.LABEL_H))
    default = render.render_two_up([row], "2026-10-23").crop((0, 0, render.SLOT_W, render.LABEL_H))
    assert fallback.tobytes() == default.tobytes()


def test_wrap_keeps_latin_words_intact_and_balances_lines():
    font = render._bold(34)
    width = render.SLOT_W - 2 * render.SLOT_MARGIN_X
    lines = render._wrap_lines("0.1ml 0.2ml离心管盒96孔PCR管盒", font, width, 3)
    assert len(lines) == 2
    assert any("PCR" in line for line in lines), f"PCR 被拆开了：{lines}"
    assert not any(line.endswith("PC") for line in lines)


def test_long_name_wraps_instead_of_shrinking_to_minimum():
    """两行能排下时要用大字换行，不能一直缩字号。"""
    long_name = "0.1ml 0.2ml离心管盒96孔PCR管盒"
    media = render.render_two_up([LabelRow(sample=long_name)], "2026-10-23").crop((0, 0, render.SLOT_W, render.LABEL_H))
    box = _ink_bbox(media)
    # 两行名称的总高度应该明显大于最小字号（18）的单行高度
    assert (box[3] - box[1]) > 55


def test_short_name_is_vertically_centered():
    media = render.render_two_up([LabelRow(sample="琼脂糖", note="规格型号：500g")], "2026-10-23").crop((0, 0, render.SLOT_W, render.LABEL_H))
    box = _ink_bbox(media)
    top, bottom = box[1], render.LABEL_H - box[3]
    assert abs(top - bottom) <= 8, f"内容没有垂直居中：上 {top} 下 {bottom}"
