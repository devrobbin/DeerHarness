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


_SCHEMA_VERSION = 1


def _migrate(conn: sqlite3.Connection) -> None:
    """基于 PRAGMA user_version 的顺序迁移链（评审：占位标记 → 可演进）。"""
    version = conn.execute("PRAGMA user_version").fetchone()[0]
    # 示例：未来加列时在此追加
    # if version < 2:
    #     conn.execute("ALTER TABLE traces ADD COLUMN ...")
    #     version = 2
    if version < _SCHEMA_VERSION:
        conn.execute(f"PRAGMA user_version={_SCHEMA_VERSION}")
    conn.commit()


def _get_conn() -> sqlite3.Connection:
    global _conn
    if _conn is None:
        os.makedirs(os.path.dirname(_DB_FILE), exist_ok=True)
        _conn = sqlite3.connect(_DB_FILE, check_same_thread=False, timeout=30)
        _conn.execute("PRAGMA journal_mode=WAL")
        _migrate(_conn)
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


def aggregate_stats() -> dict:
    """SQL 端聚合：总成本/任务/成败/团队（替代全表拉取的 O(n) 扫描）。"""
    with _lock:
        conn = _get_conn()
        total_cost = conn.execute("SELECT COALESCE(SUM(cost),0) FROM traces").fetchone()[0]
        traces_n = conn.execute("SELECT COUNT(*) FROM traces").fetchone()[0]
        # 任务口径：task_goal 非空且排除评测/进化轨迹
        tasks_n = conn.execute(
            "SELECT COUNT(*) FROM traces WHERE task_goal != ''"
            " AND agent_id NOT LIKE 'eval:%' AND agent_id NOT LIKE 'evolve:%'"
        ).fetchone()[0]
        success = conn.execute(
            "SELECT COUNT(*) FROM traces WHERE status='success' AND task_goal != ''"
            " AND agent_id NOT LIKE 'eval:%' AND agent_id NOT LIKE 'evolve:%'"
        ).fetchone()[0]
        failed = conn.execute(
            "SELECT COUNT(*) FROM traces WHERE status='failed' AND task_goal != ''"
            " AND agent_id NOT LIKE 'eval:%' AND agent_id NOT LIKE 'evolve:%'"
        ).fetchone()[0]
        team_runs = conn.execute("SELECT COUNT(*) FROM traces WHERE agent_id LIKE 'dh-team%'").fetchone()[0]
        team_delegations = conn.execute(
            "SELECT COALESCE(SUM(CAST(meta->>'$.delegations' AS INTEGER)),0) FROM traces WHERE agent_id LIKE 'dh-team%'"
        ).fetchone()[0]
        team_delegations_failed = conn.execute(
            "SELECT COALESCE(SUM(CAST(meta->>'$.delegations_failed' AS INTEGER)),0) FROM traces WHERE agent_id LIKE 'dh-team%'"
        ).fetchone()[0]
    return {
        "total_cost": round(float(total_cost or 0), 4),
        "traces": traces_n,
        "tasks": tasks_n,
        "tasks_success": success,
        "tasks_failed": failed,
        "team": {
            "runs": team_runs,
            "delegations": team_delegations,
            "delegations_failed": team_delegations_failed,
        },
    }


def cost_by_day(days: int = 7) -> list[dict]:
    """按自然日聚合成本（标签为当天日期，修复滚动窗口起点标签）。

    分组键与标签统一为 MM-DD，避免 'YYYY-MM-DD' vs 'MM-DD' 格式错位导致全零。
    """
    cutoff = time.time() - (days - 1) * 86400
    with _lock:
        conn = _get_conn()
        rows = conn.execute(
            "SELECT strftime('%m-%d', received_at, 'unixepoch', 'localtime') AS day,"
            " COALESCE(SUM(cost),0)"
            " FROM traces WHERE received_at >= ? GROUP BY day ORDER BY day",
            (cutoff,),
        ).fetchall()
    by_day = {r[0]: float(r[1]) for r in rows}
    out = []
    for i in range(days - 1, -1, -1):
        day = time.localtime(time.time() - i * 86400)
        label = time.strftime("%m-%d", day)
        out.append({"day": label, "cost": round(by_day.get(label, 0.0), 4)})
    return out


def recent_scores(limit: int = 8) -> list[dict]:
    """最近 N 条评测得分（eval:/evolve: 前缀，按时间倒序）。"""
    with _lock:
        conn = _get_conn()
        rows = conn.execute(
            "SELECT agent_id, CAST(meta->>'$.score' AS REAL) AS score, received_at FROM traces"
            " WHERE (agent_id LIKE 'eval:%' OR agent_id LIKE 'evolve:%')"
            " AND meta LIKE '%score%' ORDER BY received_at DESC LIMIT ?",
            (limit,),
        ).fetchall()
    return [{"agent_id": r[0], "score": r[1], "received_at": r[2]} for r in rows if r[1] is not None]


def agent_cost_row(agent_id: str) -> dict | None:
    """单 Agent 的 (count, cost) SQL 聚合。"""
    with _lock:
        row = _get_conn().execute(
            "SELECT COUNT(*), COALESCE(SUM(cost),0) FROM traces WHERE agent_id = ?",
            (agent_id,),
        ).fetchone()
    return {"count": row[0], "cost": float(row[1] or 0)} if row else None
