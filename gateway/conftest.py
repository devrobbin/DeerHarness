"""pytest 环境：先注入必需环境变量，再导入 gateway 模块。"""

import os
import sys

# config.py 在导入时校验必填环境变量（评审 A：fail-fast）
os.environ.setdefault("PENGUIN_API", "http://penguin.test:7368")
os.environ.setdefault("PENGUIN_USER_ID", "admin")
os.environ.setdefault("PENGUIN_PASSWORD", "test-penguin-pass")
os.environ.setdefault("DEERFLOW_API", "http://deerflow.test:2026")
os.environ.setdefault("DEERFLOW_EMAIL", "admin@test.local")
os.environ.setdefault("DEERFLOW_PASSWORD", "test-deerflow-pass")
os.environ.setdefault("ADMIN_API_KEY", "test-admin-key")

sys.path.insert(0, os.path.dirname(__file__))  # gateway/ 加入 path

import pytest  # noqa: E402


@pytest.fixture(autouse=True)
def isolate_storage(tmp_path, monkeypatch):
    """测试隔离（评审 P2-9）：所有存储文件重定向到 tmp_path，杜绝污染真实库。"""
    import trace_store
    import evolution_store
    import agent_prefs
    from routes import settings as settings_mod

    monkeypatch.setattr(trace_store, "_DB_FILE", str(tmp_path / "traces.db"))
    monkeypatch.setattr(trace_store, "_conn", None)  # 重置惰性连接缓存
    monkeypatch.setattr(evolution_store, "DB_FILE", str(tmp_path / "evolution.db"))
    monkeypatch.setattr(evolution_store, "_initialized", False)
    monkeypatch.setattr(agent_prefs, "PREF_FILE", str(tmp_path / "agent_prefs.json"))
    monkeypatch.setattr(settings_mod, "CONFIG_FILE", str(tmp_path / "settings.json"))
    monkeypatch.setattr("auth.USERS_FILE", str(tmp_path / "users.json"))
    yield
