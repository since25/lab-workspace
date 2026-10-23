# -*- coding: utf-8 -*-
import io
import pytest
from openpyxl import Workbook
from labelprint.sources import tabular


def _xlsx_bytes(rows):
    wb = Workbook()
    ws = wb.active
    for r in rows:
        ws.append(r)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def test_parse_csv_utf8():
    data = "样品名称,浓度(ng/uL),260/280,备注\nG1_WT-1_U,128.5,1.85,第一批\n".encode("utf-8")
    rows = tabular.parse(data, "a.csv")
    assert len(rows) == 1
    assert rows[0].sample == "G1_WT-1_U"
    assert rows[0].conc == "128.5"
    assert rows[0].ratio == "1.85"
    assert rows[0].note == "第一批"


def test_parse_csv_gbk():
    data = "样品名称,备注\nS1,中文备注\n".encode("gbk")
    rows = tabular.parse(data, "a.csv")
    assert rows[0].note == "中文备注"


def test_parse_xlsx():
    data = _xlsx_bytes([["样品名称", "浓度(ng/uL)", "260/280", "备注"],
                        ["G1_WT-2_U", 96.2, 1.79, ""]])
    rows = tabular.parse(data, "b.xlsx")
    assert rows[0].sample == "G1_WT-2_U"
    assert rows[0].conc == "96.2"
    assert rows[0].note == ""


def test_numbers_become_trimmed_strings():
    """Excel 里 128.50 读出来不应变成 '128.5' 之外的怪东西，也不带 .0 尾巴。"""
    data = _xlsx_bytes([["样品名称", "浓度(ng/uL)"], ["S1", 128]])
    rows = tabular.parse(data, "c.xlsx")
    assert rows[0].conc == "128"


def test_float_precision_noise_is_cleaned_up():
    """公式算出来的数常带二进制浮点表示误差（比如 260/280 用 =A2/B2 算），
    原样转字符串会把这类噪音整段打到标签上，把这一行占满、备注被挤没。
    最终整支审查 C8.2：格式化到最多 6 位小数并去掉尾随零，不改变数值本身。
    """
    data = _xlsx_bytes([
        ["样品名称", "浓度(ng/uL)", "260/280"],
        ["S1", 128.5, 1.8299999999999998],  # 浮点噪音：应清理成 1.83
        ["S2", 0.000123, ""],                # 已经是精确值，不应受影响
    ])
    rows = tabular.parse(data, "noise.xlsx")
    assert rows[0].conc == "128.5"
    assert rows[0].ratio == "1.83"
    assert rows[1].conc == "0.000123"


def test_blank_rows_are_dropped():
    data = "样品名称,备注\nS1,x\n,\n  ,\nS2,y\n".encode("utf-8")
    rows = tabular.parse(data, "d.csv")
    assert [r.sample for r in rows] == ["S1", "S2"]


def test_missing_required_column_raises_chinese_message():
    data = "浓度(ng/uL),备注\n1,2\n".encode("utf-8")
    with pytest.raises(tabular.MissingColumnError) as e:
        tabular.parse(data, "e.csv")
    assert "样品名称" in e.value.message


def test_column_names_tolerate_whitespace_and_aliases():
    data = "  样品名称 ,浓度,260-280\nS1,10,1.9\n".encode("utf-8")
    rows = tabular.parse(data, "f.csv")
    assert rows[0].sample == "S1"
    assert rows[0].conc == "10"
    assert rows[0].ratio == "1.9"


def test_unsupported_extension_raises():
    with pytest.raises(ValueError):
        tabular.parse(b"x", "g.txt")


def test_parse_xls_with_numeric_sample_names():
    """测试 xlrd 路径：纯数字样品名存储为 float 时，应转换为字符串而不带 .0"""
    import os
    fixture_path = os.path.join(os.path.dirname(__file__), 'fixtures', 'numeric.xls')
    with open(fixture_path, 'rb') as f:
        data = f.read()
    rows = tabular.parse(data, "numeric.xls")
    # Row 1: 2024001.0 -> "2024001", 128.0 -> "128"
    assert rows[0].sample == "2024001"
    assert rows[0].conc == "128"
    # Row 2: "S2", 96.5 -> "96.5"
    assert rows[1].sample == "S2"
    assert rows[1].conc == "96.5"
    assert rows[1].ratio == "1.79"
    # Row 3: "S3", 200.0 -> "200"
    assert rows[2].sample == "S3"
    assert rows[2].conc == "200"
    # Row 4: only sample name, rest empty
    assert rows[3].sample == "S4"
    assert rows[3].conc == ""
    assert rows[3].ratio == ""
    assert rows[3].note == ""


def test_ragged_csv_rows_do_not_crash():
    """CSV 行长度不一致时，缺失字段应读为空字符串而不是崩溃。

    真实场景：Excel/表格软件导出 CSV 时常省略行尾的空单元格。
    """
    # 行长度分别为：4 列、2 列、1 列
    data = "样品名称,浓度(ng/uL),260/280,备注\nS1,10,1.9,备注甲\nS2,20\nS3\n".encode("utf-8")
    rows = tabular.parse(data, "ragged.csv")
    assert len(rows) == 3
    # S1: 完整数据
    assert rows[0].sample == "S1"
    assert rows[0].conc == "10"
    assert rows[0].ratio == "1.9"
    assert rows[0].note == "备注甲"
    # S2: 缺 260/280 和备注
    assert rows[1].sample == "S2"
    assert rows[1].conc == "20"
    assert rows[1].ratio == ""
    assert rows[1].note == ""
    # S3: 只有样品名
    assert rows[2].sample == "S3"
    assert rows[2].conc == ""
    assert rows[2].ratio == ""
    assert rows[2].note == ""


def test_cell_values_with_leading_trailing_spaces():
    """单元格值带前后空格时，应被去除。"""
    data = "样品名称,浓度(ng/uL),260/280,备注\n  S1  ,  100  ,  1.8  ,  备注  \n".encode("utf-8")
    rows = tabular.parse(data, "spaces.csv")
    assert rows[0].sample == "S1"
    assert rows[0].conc == "100"
    assert rows[0].ratio == "1.8"
    assert rows[0].note == "备注"


def test_column_headers_with_internal_spaces_are_normalized():
    """表头中文字间有空格时，应被 _norm() 删除后才能正确匹配别名。

    比如 "样 品 名 称" 规范化后应匹配 "样品名称" 别名。
    """
    # 列名中有内部空格，_norm 应删除这些空格后匹配
    data = "样 品 名 称,浓 度,260/280,备 注\nS1,50,1.9,x\n".encode("utf-8")
    rows = tabular.parse(data, "internal_spaces.csv")
    assert rows[0].sample == "S1"
    assert rows[0].conc == "50"
    assert rows[0].ratio == "1.9"
    assert rows[0].note == "x"
