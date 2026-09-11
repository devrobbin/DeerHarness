"""评审缺口 G9/G10 护栏单测。

G9：定时巡检护栏——cron 频率解析、interval 下限、blocked_domains 过滤、prompt 长度。
G10：模板导入供应链——soul 截断 + 来源包装。
"""
import pytest
from fastapi import HTTPException

from routes import fusion


class TestCronMinInterval:
    def test_daily_fixed_time(self):
        assert fusion._cron_min_interval_minutes("0 9 * * *") == 1440

    def test_hourly_step(self):
        # */30 = 每 30 分钟一次（低于 1h 下限，由护栏 422 拒绝；解析值 30）
        assert fusion._cron_min_interval_minutes("*/30 * * * *") == 30

    def test_hourly_fixed_minute(self):
        assert fusion._cron_min_interval_minutes("30 * * * *") == 60

    def test_every_n_hours(self):
        assert fusion._cron_min_interval_minutes("0 */6 * * *") == 360

    def test_unparseable_returns_none(self):
        assert fusion._cron_min_interval_minutes("复杂表达式") is None


class TestScheduleGuardrails:
    @pytest.mark.asyncio
    async def test_interval_too_frequent_rejected(self, monkeypatch):
        async def _ok(*a, **k):
            return []
        monkeypatch.setattr(fusion, "_proxy_df", _ok)
        with pytest.raises(HTTPException) as exc:
            await fusion._schedule_guardrails("interval", {"interval_seconds": 60}, "任务")
        assert exc.value.status_code == 422

    @pytest.mark.asyncio
    async def test_cron_subhourly_rejected(self, monkeypatch):
        async def _ok(*a, **k):
            return []
        monkeypatch.setattr(fusion, "_proxy_df", _ok)
        with pytest.raises(HTTPException) as exc:
            await fusion._schedule_guardrails("cron", {"cron": "*/5 * * * *"}, "任务")
        assert exc.value.status_code == 422

    @pytest.mark.asyncio
    async def test_hourly_cron_allowed(self, monkeypatch):
        async def _ok(*a, **k):
            return []
        monkeypatch.setattr(fusion, "_proxy_df", _ok)
        await fusion._schedule_guardrails("cron", {"cron": "0 9 * * *"}, "日常巡检任务")

    @pytest.mark.asyncio
    async def test_blocked_domain_rejected(self, monkeypatch):
        async def _ok(*a, **k):
            return []
        monkeypatch.setattr(fusion, "_proxy_df", _ok)
        import routes.settings as settings_mod
        monkeypatch.setattr(
            settings_mod, "_load_config",
            lambda: {"safety": {"blocked_domains": ["赌博"]}},
        )
        with pytest.raises(HTTPException) as exc:
            await fusion._schedule_guardrails("cron", {"cron": "0 9 * * *"}, "帮我对接赌博网站")
        assert exc.value.status_code == 422

    @pytest.mark.asyncio
    async def test_prompt_too_long_rejected(self, monkeypatch):
        async def _ok(*a, **k):
            return []
        monkeypatch.setattr(fusion, "_proxy_df", _ok)
        with pytest.raises(HTTPException) as exc:
            await fusion._schedule_guardrails("cron", {"cron": "0 9 * * *"}, "长" * 9000)
        assert exc.value.status_code == 422


class TestTemplateImportSupplyChain:
    def test_import_wraps_and_keeps_source(self, tmp_path, monkeypatch):
        import asyncio
        monkeypatch.setattr(fusion, "TEMPLATE_DIR", str(tmp_path))
        req = fusion.TemplateImportRequest(
            name="supply-team", soul="你是业务专家。",
            workflows=[{"id": "w", "label": "L", "task": "T"}],
            source="community",
        )
        asyncio.run(fusion.fusion_team_template_import(req))
        t = fusion._get_template("supply-team")
        assert "soul-v" not in t["soul"]
        assert "你是业务专家。" in t["soul"]
        assert "外部导入" in t["soul"]  # 来源包装存在
        assert "community" in t["soul"]  # 来源标记注入包装
        assert t["source"] == "community"

    def test_import_truncates_oversize_soul(self, tmp_path, monkeypatch):
        import asyncio
        monkeypatch.setattr(fusion, "TEMPLATE_DIR", str(tmp_path))
        long_soul = "x" * (fusion._MAX_PROMPT_CHARS + 100)
        req = fusion.TemplateImportRequest(
            name="big-team", soul=long_soul,
            workflows=[{"id": "w", "label": "L", "task": "T"}],
        )
        asyncio.run(fusion.fusion_team_template_import(req))
        t = fusion._get_template("big-team")
        # 包装前缀 + 截断到上限（总长 <= 前缀 + 上限）
        assert len(t["soul"]) <= fusion._MAX_PROMPT_CHARS + 200
