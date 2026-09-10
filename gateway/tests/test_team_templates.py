"""团队模板资产化 + 版本管理单测（P3/P5）。

用临时目录验证：导入创建 v1、二次导入 → v2 且归档历史、
_custom_template_names 排除 history 文件、内置名导入被拒、合并读取。
"""
import os
import tempfile

import pytest
from fastapi import HTTPException

from routes import fusion


@pytest.fixture()
def tmp_template_dir(monkeypatch):
    tmpdir = tempfile.mkdtemp()
    monkeypatch.setattr(fusion, "TEMPLATE_DIR", tmpdir)
    return tmpdir


def _import(name: str, soul: str = "soul-v1"):
    req = fusion.TemplateImportRequest(
        name=name, soul=soul, workflows=[{"id": "wf1", "label": "巡检", "task": "做巡检"}]
    )
    return req


def test_import_creates_v1(tmp_template_dir):
    import asyncio
    r = asyncio.run(fusion.fusion_team_template_import(_import("my-team")))
    assert r["version"] == 1 and r["custom"] is True
    t = fusion._get_template("my-team")
    assert t and t["soul"] == "soul-v1" and t["version"] == 1


def test_reimport_bumps_version_and_archives(tmp_template_dir):
    import asyncio
    asyncio.run(fusion.fusion_team_template_import(_import("my-team", "soul-v1")))
    r2 = asyncio.run(fusion.fusion_team_template_import(_import("my-team", "soul-v2")))
    assert r2["version"] == 2
    assert fusion._get_template("my-team")["soul"] == "soul-v2"
    history = fusion._read_template_history("my-team")
    assert len(history) == 1 and history[0]["version"] == 1 and history[0]["soul"] == "soul-v1"


def test_history_files_not_listed_as_templates(tmp_template_dir):
    import asyncio
    asyncio.run(fusion.fusion_team_template_import(_import("my-team", "a")))
    asyncio.run(fusion.fusion_team_template_import(_import("my-team", "b")))
    names = fusion._custom_template_names()
    assert names == ["my-team"], names  # 不含 my-team.history


def test_builtin_name_rejected(tmp_template_dir):
    import asyncio
    with pytest.raises(HTTPException) as exc:
        asyncio.run(fusion.fusion_team_template_import(_import("amazon-ops")))
    assert exc.value.status_code == 409


def test_all_templates_merges_builtin_and_custom(tmp_template_dir):
    import asyncio
    asyncio.run(fusion.fusion_team_template_import(_import("my-team")))
    merged = fusion._all_templates()
    assert "amazon-ops" in merged  # 内置
    assert "my-team" in merged     # 自定义
    assert "research-ops" in merged  # P3 通用模板


def test_rollback_restores_history_version(tmp_template_dir):
    import asyncio
    asyncio.run(fusion.fusion_team_template_import(_import("my-team", "soul-v1")))
    asyncio.run(fusion.fusion_team_template_import(_import("my-team", "soul-v2")))
    asyncio.run(fusion.fusion_team_template_import(_import("my-team", "soul-v3")))
    # 回填到 v1 → 新版本 v4，内容为 soul-v1
    r = asyncio.run(
        fusion.fusion_team_template_rollback("my-team", fusion.TemplateRollbackRequest(version=1))
    )
    assert r["version"] == 4 and r["restored_from"] == 1
    assert fusion._get_template("my-team")["soul"] == "soul-v1"


def test_rollback_unknown_version_rejected(tmp_template_dir):
    import asyncio
    asyncio.run(fusion.fusion_team_template_import(_import("my-team")))
    with pytest.raises(HTTPException) as exc:
        asyncio.run(
            fusion.fusion_team_template_rollback("my-team", fusion.TemplateRollbackRequest(version=99))
        )
    assert exc.value.status_code == 400


def test_rollback_builtin_rejected(tmp_template_dir):
    import asyncio
    with pytest.raises(HTTPException) as exc:
        asyncio.run(
            fusion.fusion_team_template_rollback("amazon-ops", fusion.TemplateRollbackRequest(version=1))
        )
    assert exc.value.status_code == 400

