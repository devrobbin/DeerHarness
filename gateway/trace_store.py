"""Trace 存储：SQLite（评审遗留：JSON 读改写并发丢数据 + O(n) 全量重写）。

Python 标准库 sqlite3，无新增依赖。线程安全（单写者 + WAL）。
"""

from __future__ import annotations

import json
import os
import sqlite3
import threading
import time
import uuid

_DB_FILE = os.path.join(os.path.dirname(__file__), "..", "config", "traces.db")

_lock = threading.Lock()
_conn: sqlite3.Connection | None = None


def _get_conn() -> sqlite3.Connection:
    global _conn
    if _conn is None:
        os.makedirs(os.path.dirname(_DB_FILE), exist_ok=True)
        _conn = sqlite3.connect(_DB_FILE, check_same_thread=False)
        _conn.execute("PRAGMA journal_mode=WAL")
        _conn.execute(
            """
            CREATE TABLE IF NOT EXISTS traces (
                trace_id TEXT PRIMARY KEY,
                agent_id TEXT NOT NULL,
                status TEXT NOT NULL,
                task_goal TEXT DEFAULT '',
                cost REAL,
                received_at REAL NOT NULL,
                meta TEXT DEFAULT '{}'
            )
            """
        )
        _conn.execute("CREATE INDEX IF NOT EXISTS idx_traces_agent ON traces(agent_id)")
        _conn.execute("CREATE INDEX IF NOT EXISTS idx_traces_time ON traces(received_at)")
        _conn.commit()
    return _conn


def record_trace(agent_id: str, status: str, **extra) -> dict:
    """写入一条轨迹，返回记录。线程安全。"""
    trace = {
        "trace_id": str(uuid.uuid4()),
        "agent_id": agent_id,
        "status": status,
        "task_goal": extra.pop("task_goal", ""),
        "cost": extra.pop("cost", None),
        "received_at": time.time(),
        **extra,
    }
    meta = {k: v for k, v in trace.items() if k not in
            ("trace_id", "agent_id", "status", "task_goal", "cost", "received_at")}
    with _lock:
        conn = _get_conn()
        conn.execute(
            "INSERT INTO traces (trace_id, agent_id, status, task_goal, cost, received_at, meta)"
            " VALUES (?, ?, ?, ?, ?, ?, ?)",
            (
                trace["trace_id"],
                trace["agent_id"],
                trace["status"],
                trace["task_goal"],
                trace["cost"],
                trace["received_at"],
                json.dumps(meta, ensure_ascii=False),
            ),
        )
        conn.commit()
    return trace


def list_traces(limit: int = 50, agent_id: str | None = None, status: str | None = None) -> list[dict]:
    """查询轨迹（按时间倒序）。"""
    sql = "SELECT * FROM traces"
    conds, params = [], []
    if agent_id:
        conds.append("agent_id = ?")
        params.append(agent_id)
    if status:
        conds.append("status = ?")
        params.append(status)
    if conds:
        sql += " WHERE " + " AND ".join(conds)
    sql += " ORDER BY received_at DESC LIMIT ?"
    params.append(limit)

    with _lock:
        rows = _get_conn().execute(sql, params).fetchall()
    out = []
    for row in rows:
        record = {
            "trace_id": row[0],
            "agent_id": row[1],
            "status": row[2],
            "task_goal": row[3],
            "cost": row[4],
            "received_at": row[5],
        }
        try:
            record.update(json.loads(row[6] or "{}"))
        except json.JSONDecodeError:
            pass
        out.append(record)
    return out


def get_trace(trace_id: str) -> dict | None:
    with _lock:
        row = _get_conn().execute(
            "SELECT * FROM traces WHERE trace_id = ?", (trace_id,)
        ).fetchone()
    if row is None:
        return None
    record = {
        "trace_id": row[0],
        "agent_id": row[1],
        "status": row[2],
        "task_goal": row[3],
        "cost": row[4],
        "received_at": row[5],
    }
    try:
        record.update(json.loads(row[6] or "{}"))
    except json.JSONDecodeError:
        pass
    return record


def delete_trace(trace_id: str) -> None:
    with _lock:
        _get_conn().execute("DELETE FROM traces WHERE trace_id = ?", (trace_id,))
        _get_conn().commit()


def count_traces(status: str | None = None) -> int:
    sql = "SELECT COUNT(*) FROM traces"
    if status:
        sql += " WHERE status = ?"
        with _lock:
            row = _get_conn().execute(sql, (status,)).fetchone()
    else:
        with _lock:
            row = _get_conn().execute(sql).fetchone()
    return row[0] if row else 0


def cost_summary(days: int | None = None) -> dict:
    """按 Agent 聚合成本；days 限制最近 N 天。"""
    cutoff = (time.time() - days * 86400) if days else 0
    sql = (
        "SELECT agent_id, COUNT(*), COALESCE(SUM(cost), 0) FROM traces"
        + (" WHERE received_at >= ?" if cutoff else "")
        + " GROUP BY agent_id ORDER BY 3 DESC"
    )
    params = (cutoff,) if cutoff else ()
    with _lock:
        rows = _get_conn().execute(sql, params).fetchall()
    return {
        agent: {"count": count, "cost": round(cost or 0, 4)}
        for agent, count, cost in rows
    }
