# -*- coding: utf-8 -*-
"""打印历史。只存数据不存图片——需要看当时样式时用相同数据重新渲染即可。"""
import os
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime

from labelprint.model import LabelRow

_SCHEMA = """
CREATE TABLE IF NOT EXISTS print_log (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_id  TEXT    NOT NULL,
    ts        TEXT    NOT NULL,
    operator  TEXT    NOT NULL DEFAULT '',
    client_ip TEXT    NOT NULL DEFAULT '',
    sample    TEXT    NOT NULL,
    conc      TEXT    NOT NULL DEFAULT '',
    ratio     TEXT    NOT NULL DEFAULT '',
    note      TEXT    NOT NULL DEFAULT '',
    copies    INTEGER NOT NULL DEFAULT 1,
    ok        INTEGER NOT NULL,
    err       TEXT    NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_ts ON print_log(ts DESC);
CREATE INDEX IF NOT EXISTS idx_sample ON print_log(sample);
CREATE INDEX IF NOT EXISTS idx_batch ON print_log(batch_id);
"""


class Store:
    def __init__(self, db_path: str):
        self.db_path = db_path
        # 数据库现在放在包目录外的 data\ 下，目标机上这个目录首次部署时还
        # 不存在——sqlite3.connect 不会自动创建父目录，不建会直接报
        # "unable to open database file"。用 exist_ok=True 保证重复调用安全，
        # 只在 db_path 带目录部分时才建（测试里传的相对文件名可能没有目录）。
        db_dir = os.path.dirname(db_path)
        if db_dir:
            os.makedirs(db_dir, exist_ok=True)
        with self._conn() as c:
            c.executescript(_SCHEMA)

    @contextmanager
    def _conn(self):
        # 确保连接被正确关闭，防止文件描述符泄漏
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    def log(self, rows, copies, operator, client_ip, ok, err="") -> str:
        batch_id = uuid.uuid4().hex
        ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        with self._conn() as c:
            c.executemany(
                "INSERT INTO print_log"
                "(batch_id, ts, operator, client_ip, sample, conc, ratio, note,"
                " copies, ok, err) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                [(batch_id, ts, operator, client_ip, r.sample, r.conc, r.ratio,
                  r.note, copies, 1 if ok else 0, err) for r in rows],
            )
        return batch_id

    def recent(self, limit=100):
        with self._conn() as c:
            cur = c.execute(
                "SELECT * FROM print_log ORDER BY id DESC LIMIT ?", (limit,))
            return [dict(r) for r in cur.fetchall()]

    def search(self, keyword, limit=100):
        # 转义 LIKE 通配符以防止 _ 和 % 被当成特殊字符
        escaped = keyword.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        with self._conn() as c:
            cur = c.execute(
                "SELECT * FROM print_log WHERE sample LIKE ? ESCAPE '\\' "
                "ORDER BY id DESC LIMIT ?", ("%" + escaped + "%", limit))
            return [dict(r) for r in cur.fetchall()]

    def batch(self, batch_id):
        with self._conn() as c:
            # ORDER BY id 不可删：SQLite 不承诺"没有 ORDER BY 时结果按写入
            # 顺序返回"，删掉这一句在多数情况下看起来仍然正常（碰巧顺序没变），
            # 但不受保证，一旦跑出乱序，重打这一批的标签顺序就会跟原始顺序对
            # 不上，而且现有测试测不出这种偶发问题。
            cur = c.execute(
                "SELECT sample, conc, ratio, note FROM print_log "
                "WHERE batch_id = ? ORDER BY id", (batch_id,))
            return [LabelRow(sample=r["sample"], conc=r["conc"],
                             ratio=r["ratio"], note=r["note"])
                    for r in cur.fetchall()]
