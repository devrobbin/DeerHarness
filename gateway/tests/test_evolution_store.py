"""evolution_store 覆盖历史与回滚逻辑单测（P2-3）。

用临时 DB 验证：set_override 记录历史、get_override_before_version 定位、
delete_override 回退基础模板、workflow_task 带 workflow_id 场景。
"""
import os
import tempfile

import pytest

import evolution_store as store


@pytest.fixture()
def tmp_store(monkeypatch):
    """把 evolution_store 指向临时 DB。"""
    tmpdir = tempfile.mkdtemp()
    db_path = os.path.join(tmpdir, "test-evolution.db")
    monkeypatch.setattr(store, "DB_FILE", db_path)
    store._initialized = False
    store.init_db()
    return store


def test_set_override_history_and_rollback(tmp_store):
    v1 = tmp_store.set_override("amazon-ops", None, "soul", "", "soul-v1")
    v2 = tmp_store.set_override("amazon-ops", None, "soul", "", "soul-v2")
    v3 = tmp_store.set_override("amazon-ops", None, "soul", "", "soul-v3")
    assert (v1, v2, v3) == (1, 2, 3)
    assert tmp_store.get_override("amazon-ops", None, "soul") == "soul-v3"

    # 回滚到 v2 之前 → soul-v1
    old = tmp_store.get_override_before_version(
        "amazon-ops", "soul", "", before_version=2, workflow_id=None
    )
    assert old == "soul-v1"
    # 回滚到 v1 之前 → 无历史（覆盖首次写入前没有旧值）
    assert (
        tmp_store.get_override_before_version(
            "amazon-ops", "soul", "", before_version=1, workflow_id=None
        )
        is None
    )


def test_workflow_task_history_with_workflow_id(tmp_store):
    tmp_store.set_override("amazon-ops", "ad-review", "workflow_task", "", "task-v1")
    tmp_store.set_override("amazon-ops", "ad-review", "workflow_task", "", "task-v2")
    old = tmp_store.get_override_before_version(
        "amazon-ops", "workflow_task", "", before_version=2, workflow_id="ad-review"
    )
    assert old == "task-v1"
    # 用错误 workflow_id（空）查不到
    assert (
        tmp_store.get_override_before_version(
            "amazon-ops", "workflow_task", "", before_version=2, workflow_id=None
        )
        is None
    )


def test_delete_override_falls_back_to_base(tmp_store):
    tmp_store.set_override("amazon-ops", None, "member_prompt", "ad_optimizer", "p-v1")
    assert tmp_store.get_override("amazon-ops", None, "member_prompt", "ad_optimizer") == "p-v1"
    tmp_store.delete_override("amazon-ops", None, "member_prompt", "ad_optimizer")
    assert (
        tmp_store.get_override("amazon-ops", None, "member_prompt", "ad_optimizer") is None
    )


def test_history_ignored_when_value_unchanged(tmp_store):
    tmp_store.set_override("amazon-ops", None, "soul", "", "same")
    tmp_store.set_override("amazon-ops", None, "soul", "", "same")
    # 值未变化不写历史 → 回滚到 v2 之前无旧值
    assert (
        tmp_store.get_override_before_version(
            "amazon-ops", "soul", "", before_version=2, workflow_id=None
        )
        is None
    )
