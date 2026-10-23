# -*- coding: utf-8 -*-
import pytest
from labelprint.model import LabelRow
from labelprint.store import Store


@pytest.fixture
def st(tmp_path):
    return Store(str(tmp_path / "t.db"))


def test_log_returns_batch_id_and_persists_each_row(st):
    rows = [LabelRow(sample="S1", conc="10"), LabelRow(sample="S2")]
    bid = st.log(rows, copies=2, operator="王", client_ip="192.168.7.11", ok=True)
    assert bid
    recs = st.recent()
    assert len(recs) == 2
    assert {r["sample"] for r in recs} == {"S1", "S2"}
    assert all(r["copies"] == 2 for r in recs)
    assert all(r["operator"] == "王" for r in recs)
    assert all(r["ok"] == 1 for r in recs)
    assert all(r["client_ip"] == "192.168.7.11" for r in recs)


def test_failure_records_reason(st):
    st.log([LabelRow(sample="S1")], copies=1, operator="", client_ip="1.2.3.4",
           ok=False, err="打印机离线")
    rec = st.recent()[0]
    assert rec["err"] == "打印机离线"
    assert rec["ok"] == 0


def test_recent_is_newest_first(st):
    st.log([LabelRow(sample="OLD")], 1, "", "1.1.1.1", True)
    st.log([LabelRow(sample="NEW")], 1, "", "1.1.1.1", True)
    assert st.recent()[0]["sample"] == "NEW"


def test_search_matches_sample_name(st):
    # 测试模糊搜索，同时包含诱饵数据验证 _ 不被当成单字符通配符
    st.log([LabelRow(sample="G1_WT-1_U"), LabelRow(sample="G2_KO-1_T"),
            LabelRow(sample="G1XWT-1_U")],  # 诱饵：X 替代了 _，如果不转义会误匹配
           1, "", "1.1.1.1", True)
    results = [r["sample"] for r in st.search("G1_WT")]
    assert results == ["G1_WT-1_U"]  # 只应该找到真正包含 "G1_WT" 的行


def test_batch_returns_rows_for_reprint(st):
    # 多批次、多行测试，验证 WHERE batch_id 和 ORDER BY 的完整性
    # 批次 A：3 行，写入顺序刻意打乱（最后、最先、中间）
    bid_a = st.log([
        LabelRow(sample="A3", conc="30", ratio="1.0", note="last"),
        LabelRow(sample="A1", conc="10", ratio="1.8", note="first"),
        LabelRow(sample="A2", conc="20", ratio="1.5", note="mid"),
    ], 1, "", "1.1.1.1", True)

    # 批次 B：2 行，完全不同的数据
    bid_b = st.log([
        LabelRow(sample="B1", conc="100", ratio="2.0", note="b1"),
        LabelRow(sample="B2", conc="200", ratio="2.1", note="b2"),
    ], 1, "", "1.1.1.1", True)

    # 验证批次 A：应该只返回 A 的行，且按写入顺序
    rows_a = st.batch(bid_a)
    assert len(rows_a) == 3
    assert rows_a == [
        LabelRow(sample="A3", conc="30", ratio="1.0", note="last"),
        LabelRow(sample="A1", conc="10", ratio="1.8", note="first"),
        LabelRow(sample="A2", conc="20", ratio="1.5", note="mid"),
    ]

    # 验证批次 B：应该只返回 B 的行，不含 A 的任何行
    rows_b = st.batch(bid_b)
    assert len(rows_b) == 2
    assert rows_b == [
        LabelRow(sample="B1", conc="100", ratio="2.0", note="b1"),
        LabelRow(sample="B2", conc="200", ratio="2.1", note="b2"),
    ]


def test_reopening_existing_db_does_not_lose_data(tmp_path):
    p = str(tmp_path / "t.db")
    Store(p).log([LabelRow(sample="S1")], 1, "", "1.1.1.1", True)
    assert len(Store(p).recent()) == 1
