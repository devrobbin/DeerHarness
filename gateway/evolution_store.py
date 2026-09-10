"""进化实验室存储层：SQLite 持久化进化任务、版本、审批队列与配置覆盖。

核心概念：
- 进化目标三层：agent / workflow（{team, workflow}）/ team
- config_overrides：进化产物（改进后的配置）持久化在这里，
  fusion 读取时"基础模板 + 覆盖"合并 → 进化立即被团队编排使用
- 每个版本保存配置快照，可追溯、可回滚
"""

from __future__ import annotations

import json
import os
import sqlite3
import threading
import time
from typing import Optional

DB_FILE = os.path.join(os.path.dirname(__file__), "..", "config", "evolution.db")

_lock = threading.Lock()

_SCHEMA = """
CREATE TABLE IF NOT EXISTS evolution_tasks (
    task_id TEXT PRIMARY KEY,
    target_type TEXT NOT NULL,          -- agent / workflow / team
    team_id TEXT DEFAULT '',
    workflow_id TEXT DEFAULT '',
    agent_id TEXT DEFAULT '',
    max_rounds INTEGER DEFAULT 3,
    target_score INTEGER DEFAULT 85,
    status TEXT DEFAULT 'running',      -- running / waiting_approval / success / stopped / failed
    current_round INTEGER DEFAULT 0,
    last_avg_score REAL,
    cost REAL DEFAULT 0,
    created_at REAL,
    updated_at REAL,
    meta TEXT DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS evolution_versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id TEXT NOT NULL,
    version INTEGER NOT NULL,
    score REAL,
    change_summary TEXT DEFAULT '',
    snapshot TEXT DEFAULT '{}',
    applied_at REAL
);
CREATE TABLE IF NOT EXISTS evolution_approvals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id TEXT NOT NULL,
    version INTEGER NOT NULL,
    proposal TEXT NOT NULL,             -- JSON {target, member_id, new_text, reason}
    status TEXT DEFAULT 'pending',      -- pending / approved / rejected
    created_at REAL
);
CREATE TABLE IF NOT EXISTS team_runs (
    thread_id TEXT PRIMARY KEY,
    team_json TEXT NOT NULL,
    started_at REAL
);
CREATE TABLE IF NOT EXISTS config_overrides (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    team_id TEXT NOT NULL,
    workflow_id TEXT,                   -- NULL = 团队级覆盖
    field TEXT NOT NULL,                -- workflow_task / soul / member_prompt
    member_id TEXT DEFAULT '',
    value TEXT NOT NULL,
    version INTEGER NOT NULL,
    applied_at REAL,
    UNIQUE(team_id, workflow_id, field, member_id)
);
CREATE TABLE IF NOT EXISTS override_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    team_id TEXT NOT NULL,
    workflow_id TEXT NOT NULL DEFAULT '',
    field TEXT NOT NULL,
    member_id TEXT NOT NULL DEFAULT '',
    version INTEGER NOT NULL,
    value TEXT NOT NULL,
    applied_at REAL,
    action TEXT NOT NULL DEFAULT 'set'   -- set / rollback
);
"""


def _connect() -> sqlite3.Connection:
    _ensure_initialized()
    os.makedirs(os.path.dirname(DB_FILE), exist_ok=True)
    conn = sqlite3.connect(DB_FILE, timeout=15)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA user_version=1")
    return conn


def init_db():
    with _lock:
        conn = _connect()
        try:
            conn.executescript(_SCHEMA)
            conn.commit()
        finally:
            conn.close()


_initialized = False


_SCHEMA_VERSION = 1


def _migrate(conn) -> None:
    """基于 user_version 的顺序迁移链（评审：占位标记 → 可演进）。"""
    version = conn.execute("PRAGMA user_version").fetchone()[0]
    # 未来加表/加列在此追加 if version < N 分支
    if version < _SCHEMA_VERSION:
        conn.execute(f"PRAGMA user_version={_SCHEMA_VERSION}")
    conn.commit()


def _migrate_legacy_nulls(conn):
    """迁移旧数据：历史 soul/成员覆盖的 workflow_id=NULL → ''（哨兵化）。"""
    try:
        conn.execute("UPDATE config_overrides SET workflow_id='' WHERE workflow_id IS NULL")
        conn.commit()
    except sqlite3.Error:
        pass


def _ensure_initialized():
    """懒初始化：首次访问时建表（修复：import 副作用污染真实库）。"""
    global _initialized
    if _initialized:
        return
    with _lock:
        if not _initialized:
            conn = sqlite3.connect(DB_FILE, timeout=15)
            try:
                conn.executescript(_SCHEMA)
                _migrate_legacy_nulls(conn)
                _migrate(conn)
            finally:
                conn.close()
            _initialized = True


def init_db():
    """显式初始化（测试用：monkeypatch DB_FILE 后调用）。"""
    _ensure_initialized()


# ==================== 进化任务 ====================


def create_task(
    task_id: str,
    target_type: str,
    team_id: str = "",
    workflow_id: str = "",
    agent_id: str = "",
    max_rounds: int = 3,
    target_score: int = 85,
) -> dict:
    now = time.time()
    with _lock:
        conn = _connect()
        try:
            conn.execute(
                "INSERT INTO evolution_tasks (task_id, target_type, team_id, workflow_id,"
                " agent_id, max_rounds, target_score, status, current_round, cost, created_at, updated_at)"
                " VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                (task_id, target_type, team_id, workflow_id, agent_id,
                 max_rounds, target_score, "running", 0, 0.0, now, now),
            )
            conn.commit()
            return get_task(task_id) or {}
        finally:
            conn.close()


def get_task(task_id: str) -> Optional[dict]:
    conn = _connect()
    try:
        row = conn.execute("SELECT * FROM evolution_tasks WHERE task_id=?", (task_id,)).fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def update_task(task_id: str, **fields) -> None:
    fields["updated_at"] = time.time()
    sets = ", ".join(f"{k}=?" for k in fields)
    with _lock:
        conn = _connect()
        try:
            conn.execute(f"UPDATE evolution_tasks SET {sets} WHERE task_id=?",
                         (*fields.values(), task_id))
            conn.commit()
        finally:
            conn.close()


def list_tasks(limit: int = 50) -> list[dict]:
    conn = _connect()
    try:
        rows = conn.execute(
            "SELECT * FROM evolution_tasks ORDER BY created_at DESC LIMIT ?", (limit,)
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


# ==================== 版本 ====================


def record_version(task_id: str, version: int, score: Optional[float], change_summary: str,
                   snapshot: dict) -> None:
    with _lock:
        conn = _connect()
        try:
            conn.execute(
                "INSERT INTO evolution_versions (task_id, version, score, change_summary, snapshot, applied_at)"
                " VALUES (?,?,?,?,?,?)",
                (task_id, version, score, change_summary, json.dumps(snapshot, ensure_ascii=False), time.time()),
            )
            conn.commit()
        finally:
            conn.close()


def list_versions(task_id: str) -> list[dict]:
    conn = _connect()
    try:
        rows = conn.execute(
            "SELECT * FROM evolution_versions WHERE task_id=? ORDER BY version", (task_id,)
        ).fetchall()
        out = []
        for r in rows:
            d = dict(r)
            d["snapshot"] = json.loads(d.get("snapshot") or "{}")
            out.append(d)
        return out
    finally:
        conn.close()


# ==================== 审批队列 ====================


def add_approval(task_id: str, version: int, proposal: dict) -> int:
    with _lock:
        conn = _connect()
        try:
            cur = conn.execute(
                "INSERT INTO evolution_approvals (task_id, version, proposal, status, created_at)"
                " VALUES (?,?,?,?,?)",
                (task_id, version, json.dumps(proposal, ensure_ascii=False), "pending", time.time()),
            )
            conn.commit()
            return cur.lastrowid
        finally:
            conn.close()


def list_approvals(task_id: str, status: str = "pending") -> list[dict]:
    conn = _connect()
    try:
        rows = conn.execute(
            "SELECT * FROM evolution_approvals WHERE task_id=? AND status=? ORDER BY id",
            (task_id, status),
        ).fetchall()
        out = []
        for r in rows:
            d = dict(r)
            d["proposal"] = json.loads(d.get("proposal") or "{}")
            out.append(d)
        return out
    finally:
        conn.close()


def set_approval_status(approval_id: int, status: str) -> bool:
    with _lock:
        conn = _connect()
        try:
            cur = conn.execute(
                "UPDATE evolution_approvals SET status=? WHERE id=? AND status='pending'",
                (status, approval_id),
            )
            conn.commit()
            return cur.rowcount > 0
        finally:
            conn.close()


# ==================== 配置覆盖（进化产物） ====================


def set_override(team_id: str, workflow_id: Optional[str], field: str,
                 member_id: str, value: str, *, action: str = "set") -> int:
    """写入配置覆盖，返回新版本号。workflow_id=None + field=soul = 团队主代理覆盖。

    哨兵约定：workflow_id 用 '' 而非 NULL —— SQLite UNIQUE 约束对 NULL 互不相等，
    会导致 soul 等无 workflow 的覆盖二次写入永远插新行、读取永远命中旧值。

    每次写入前把旧值（若有）记入 override_history，保证可回滚可追溯。
    """
    wf = workflow_id or ""
    with _lock:
        conn = _connect()
        try:
            row = conn.execute(
                "SELECT version, value FROM config_overrides WHERE team_id=? AND workflow_id=? AND field=? AND member_id=?",
                (team_id, wf, field, member_id),
            ).fetchone()
            version = (row["version"] + 1) if row else 1
            if row and row["value"] != value:
                conn.execute(
                    "INSERT INTO override_history (team_id, workflow_id, field, member_id, version, value, applied_at, action)"
                    " VALUES (?,?,?,?,?,?,?,?)",
                    (team_id, wf, field, member_id, version - 1, row["value"], time.time(), "set"),
                )
            conn.execute(
                "INSERT INTO config_overrides (team_id, workflow_id, field, member_id, value, version, applied_at)"
                " VALUES (?,?,?,?,?,?,?)"
                " ON CONFLICT(team_id, workflow_id, field, member_id) DO UPDATE SET value=excluded.value,"
                " version=excluded.version, applied_at=excluded.applied_at",
                (team_id, wf, field, member_id, value, version, time.time()),
            )
            conn.commit()
            return version
        finally:
            conn.close()


def get_override(team_id: str, workflow_id: Optional[str], field: str,
                 member_id: str = "") -> Optional[str]:
    """读取覆盖值；不存在返回 None（调用方回退基础模板）。"""
    wf = workflow_id or ""
    conn = _connect()
    try:
        row = conn.execute(
            "SELECT value FROM config_overrides WHERE team_id=? AND workflow_id=? AND field=? AND member_id=?",
            (team_id, wf, field, member_id),
        ).fetchone()
        return row["value"] if row else None
    finally:
        conn.close()


def list_override_history(team_id: str, field: str, member_id: str = "",
                          workflow_id: Optional[str] = None) -> list[dict]:
    """列出某配置键的历史变更（version 升序），供回滚定位。

    workflow_id 传入实际值（workflow_task 覆盖的 workflow_id 非空）；
    未传默认 ''（soul / member_prompt 等团队级覆盖）。
    """
    wf = workflow_id or ""
    conn = _connect()
    try:
        rows = conn.execute(
            "SELECT version, value, action, applied_at FROM override_history"
            " WHERE team_id=? AND workflow_id=? AND field=? AND member_id=?"
            " ORDER BY version ASC",
            (team_id, wf, field, member_id),
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def get_override_before_version(team_id: str, field: str, member_id: str = "",
                                before_version: int = 0,
                                workflow_id: Optional[str] = None) -> Optional[str]:
    """回滚到目标版本：返回该配置键在目标版本之前最后一次生效的值。

    override_history 记录了每次 set 之前的旧值（version = 旧版本号）。
    回滚到版本 V = 取 history 中 version < V 的最新一条 value；
    若没有历史（覆盖从未改过）返回 None（表示回退到基础模板，调用方删除覆盖）。
    """
    wf = workflow_id or ""
    conn = _connect()
    try:
        row = conn.execute(
            "SELECT value FROM override_history"
            " WHERE team_id=? AND workflow_id=? AND field=? AND member_id=? AND version < ?"
            " ORDER BY version DESC LIMIT 1",
            (team_id, wf, field, member_id, before_version),
        ).fetchone()
        return row["value"] if row else None
    finally:
        conn.close()


def delete_override(team_id: str, workflow_id: Optional[str], field: str,
                    member_id: str = "") -> None:
    """删除配置覆盖（回滚到基础模板）。"""
    wf = workflow_id or ""
    with _lock:
        conn = _connect()
        try:
            row = conn.execute(
                "SELECT value FROM config_overrides WHERE team_id=? AND workflow_id=? AND field=? AND member_id=?",
                (team_id, wf, field, member_id),
            ).fetchone()
            if row:
                conn.execute(
                    "INSERT INTO override_history (team_id, workflow_id, field, member_id, version, value, applied_at, action)"
                    " VALUES (?,?,?,?,?,?,?,?)",
                    (team_id, wf, field, member_id, 0, row["value"], time.time(), "rollback"),
                )
                conn.execute(
                    "DELETE FROM config_overrides WHERE team_id=? AND workflow_id=? AND field=? AND member_id=?",
                    (team_id, wf, field, member_id),
                )
                conn.commit()
        finally:
            conn.close()


def get_effective_workflow_task(team_id: str, workflow_id: str, base_task: str) -> str:
    """工作流 task 合并：覆盖优先，回退基础模板。"""
    return get_override(team_id, workflow_id, "workflow_task") or base_task


def get_effective_soul(team_id: str, base_soul: str) -> str:
    """团队主代理 soul 合并。"""
    return get_override(team_id, None, "soul") or base_soul


def get_effective_member_prompt(agent_id: str, base_prompt: str, team_id: str) -> str:
    """成员人设合并（团队作用域内覆盖）。"""
    return get_override(team_id, None, "member_prompt", member_id=agent_id) or base_prompt


def list_overrides() -> list[dict]:
    conn = _connect()
    try:
        rows = conn.execute(
            "SELECT * FROM config_overrides ORDER BY applied_at DESC LIMIT 100"
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


# ==================== 团队 run 成员清单持久化（评审 P2-2：重启后 status 恢复） ====================


def save_team_run(thread_id: str, team: list[dict]) -> None:
    with _lock:
        conn = _connect()
        try:
            conn.execute(
                "INSERT INTO team_runs (thread_id, team_json, started_at) VALUES (?,?,?)"
                " ON CONFLICT(thread_id) DO UPDATE SET team_json=excluded.team_json, started_at=excluded.started_at",
                (thread_id, json.dumps(team, ensure_ascii=False), time.time()),
            )
            conn.commit()
        finally:
            conn.close()


def load_team_run(thread_id: str) -> list[dict] | None:
    conn = _connect()
    try:
        row = conn.execute("SELECT team_json FROM team_runs WHERE thread_id=?", (thread_id,)).fetchone()
        if not row:
            return None
        try:
            return json.loads(row["team_json"])
        except (json.JSONDecodeError, TypeError):
            return []
    finally:
        conn.close()


def delete_team_run(thread_id: str) -> None:
    with _lock:
        conn = _connect()
        try:
            conn.execute("DELETE FROM team_runs WHERE thread_id=?", (thread_id,))
            conn.commit()
        finally:
            conn.close()
