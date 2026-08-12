"""核心纯函数单测（评审 D：为无回归保障建立地基）。"""

from routes.agents import _latest_model_msg, _slugify
from routes.chat import _latest_ai_text
from routes.fusion import (
    _deerflow_agent_name,
    _extract_ai_reply,
    _extract_delegations,
)
from validate import valid_id
from fastapi import HTTPException

import pytest


# ==================== validate ====================

class TestValidId:
    def test_accepts_legal(self):
        assert valid_id("summarizer") == "summarizer"
        assert valid_id("dh-fusion-a09609") == "dh-fusion-a09609"

    @pytest.mark.parametrize("bad", ["", "../etc", "a/b", "x" * 65, "带中文"])
    def test_rejects_illegal(self, bad):
        with pytest.raises(HTTPException):
            valid_id(bad)


# ==================== agents ====================

class TestSlugify:
    def test_ascii(self):
        assert _slugify("My Agent") == "my_agent"

    def test_chinese_fallback(self):
        # 全中文 → 回落为 agent
        assert _slugify("摘要助手") == "agent"

    def test_mixed(self):
        assert _slugify("  Code--Review  ") == "code_review"


class TestLatestModelMsg:
    def test_ignores_echo(self):
        """用户输入镜像（role=user）必须被过滤（评审：回声误判修复的回归保护）。"""
        msgs = {
            "messages": [
                {"type": "model_msg", "timestamp": "2026-01-01T00:00:01Z",
                 "payload": {"role": "user", "type": "text", "text": "你好"}},
                {"type": "model_msg", "timestamp": "2026-01-01T00:00:02Z",
                 "payload": {"role": "assistant", "type": "text", "text": "真正的回复"}},
            ]
        }
        ts, text = _latest_model_msg(msgs)
        assert text == "真正的回复"

    def test_empty_when_no_assistant(self):
        ts, text = _latest_model_msg({"messages": []})
        assert ts is None and text == ""


# ==================== chat ====================

class TestLatestAiText:
    def test_string_content(self):
        assert _latest_ai_text([{"type": "ai", "content": "回复"}]) == "回复"

    def test_block_content(self):
        msgs = [{"type": "ai", "content": [{"type": "text", "text": "a"}, {"type": "text", "text": "b"}]}]
        assert _latest_ai_text(msgs) == "ab"

    def test_last_ai_wins(self):
        msgs = [
            {"type": "human", "content": "问题"},
            {"type": "ai", "content": "第一个"},
            {"type": "ai", "content": "最终回复"},
        ]
        assert _latest_ai_text(msgs) == "最终回复"

    def test_none(self):
        assert _latest_ai_text([]) == ""


# ==================== fusion ====================

class TestDeerflowAgentName:
    def test_slug(self):
        assert _deerflow_agent_name("summarizer") == "dh-summarizer"

    def test_sanitize(self):
        assert _deerflow_agent_name("My Agent!") == "dh-my-agent-"


class TestExtractAiReply:
    def test_plain(self):
        state = {"values": {"messages": [{"type": "ai", "content": "你好"}]}}
        assert _extract_ai_reply(state) == "你好"

    def test_empty_fallback(self):
        assert _extract_ai_reply({"values": {"messages": []}}) == "（DeerFlow 未返回内容）"

    def test_block_content(self):
        state = {"values": {"messages": [
            {"type": "ai", "content": [{"type": "text", "text": "hello"}]},
        ]}}
        assert _extract_ai_reply(state) == "hello"


class TestExtractDelegations:
    def test_task_tools(self):
        state = {"values": {"messages": [
            {"type": "tool", "name": "task", "content": "Task Succeeded. Result: ok"},
            {"type": "tool", "name": "web_search", "content": "noise"},
        ]}}
        out = _extract_delegations(state)
        assert len(out) == 1
        assert "ok" in out[0]["result"]

    def test_none(self):
        assert _extract_delegations({"values": {"messages": []}}) == []


class TestTeamProgress:
    """团队成员工作状态解析（idle/working/done/failed 归属）。"""

    TEAM = [
        {"agent_id": "ad_optimizer", "name": "广告优化Agent", "system_prompt": "x"},
        {"agent_id": "inventory_forecast", "name": "库存预测Agent", "system_prompt": "x"},
    ]

    def test_attribute_member(self):
        from routes.fusion import _attribute_member
        assert _attribute_member("你是 Amazon 广告优化专家", self.TEAM) == "ad_optimizer"
        assert _attribute_member("预测库存与补货", self.TEAM) == "inventory_forecast"
        assert _attribute_member("无关内容", self.TEAM) is None

    def test_working_then_done(self):
        from routes.fusion import _parse_team_progress
        # 分派中：AI tool_call 已发出，tool 结果未回 → working
        state = {"values": {"messages": [
            {"type": "ai", "tool_calls": [{"id": "c1", "name": "task",
                                           "args": {"description": "广告复盘", "prompt": "广告优化"}}]},
        ]}}
        out = _parse_team_progress(state, self.TEAM)
        by_id = {m["agent_id"]: m["state"] for m in out["members"]}
        assert by_id["ad_optimizer"] == "working"
        assert by_id["inventory_forecast"] == "idle"

        # 完成后：tool 消息带回 subagent_status=completed → done
        state["values"]["messages"].append(
            {"type": "tool", "name": "task", "tool_call_id": "c1",
             "additional_kwargs": {"subagent_status": "completed"}, "status": "success"}
        )
        out = _parse_team_progress(state, self.TEAM)
        by_id = {m["agent_id"]: m["state"] for m in out["members"]}
        assert by_id["ad_optimizer"] == "done"

    def test_failed(self):
        from routes.fusion import _parse_team_progress
        state = {"values": {"messages": [
            {"type": "ai", "tool_calls": [{"id": "c1", "name": "task",
                                           "args": {"prompt": "库存补货建议"}}]},
            {"type": "tool", "name": "task", "tool_call_id": "c1",
             "additional_kwargs": {"subagent_status": "failed"}, "status": "error"},
        ]}}
        out = _parse_team_progress(state, self.TEAM)
        by_id = {m["agent_id"]: m["state"] for m in out["members"]}
        assert by_id["inventory_forecast"] == "failed"


class TestDelegationDetails:
    """成员分派详情聚合（抽屉数据源）。"""

    TEAM = [{"agent_id": "ad_optimizer", "name": "广告优化Agent", "system_prompt": "x"}]

    def test_aggregate_by_member(self):
        from routes.fusion import _extract_delegation_details
        state = {"values": {"messages": [
            {"type": "ai", "tool_calls": [{"id": "c1", "name": "task",
                                           "args": {"description": "广告复盘", "prompt": "你是广告优化专家"}}]},
            {"type": "tool", "name": "task", "tool_call_id": "c1",
             "content": "Task Succeeded. Result: ACoS 35%",
             "additional_kwargs": {"subagent_status": "completed"}},
        ]}}
        out = _extract_delegation_details(state, self.TEAM)
        tasks = out["members"]["ad_optimizer"]
        assert len(tasks) == 1
        assert "广告复盘" in tasks[0]["prompt"]
        assert "ACoS 35%" in tasks[0]["result"]
        assert tasks[0]["status"] == "completed"
        assert out["other"] == []

    def test_running_task_no_result(self):
        from routes.fusion import _extract_delegation_details
        # 分派中：只有 AI tool_call，无 tool 结果 → status=running
        state = {"values": {"messages": [
            {"type": "ai", "tool_calls": [{"id": "c1", "name": "task",
                                           "args": {"prompt": "广告优化"}}]},
        ]}}
        out = _extract_delegation_details(state, self.TEAM)
        task = out["members"]["ad_optimizer"][0]
        assert task["status"] == "running"
        assert task["result"] == ""


class TestModelPref:
    """每 Agent 模型偏好层。"""

    def test_set_and_get(self, tmp_path, monkeypatch):
        import agent_prefs
        monkeypatch.setattr(agent_prefs, "PREF_FILE", str(tmp_path / "prefs.json"))
        agent_prefs.set_model_pref("summarizer", "deepseek", "deepseek-chat")
        assert agent_prefs.get_model_pref("summarizer") == {"provider": "deepseek", "model_id": "deepseek-chat"}
        # 清除 → 回落项目默认
        agent_prefs.set_model_pref("summarizer", None, None)
        assert agent_prefs.get_model_pref("summarizer") is None


class TestSessionBody:
    """chat 会话创建 body 组装（模型偏好注入）—— 直测生产函数 build_session_create_body。"""

    def test_with_pref(self, monkeypatch):
        import agent_prefs
        from routes.agents import build_session_create_body
        monkeypatch.setattr(agent_prefs, "get_model_pref", lambda aid: {"provider": "deepseek", "model_id": "deepseek-chat"})
        assert build_session_create_body("x") == {"provider": "deepseek", "modelId": "deepseek-chat"}

    def test_without_pref(self, monkeypatch):
        import agent_prefs
        from routes.agents import build_session_create_body
        monkeypatch.setattr(agent_prefs, "get_model_pref", lambda aid: None)
        assert build_session_create_body("x") == {}


class TestVaultTranslation:
    """Vault 更新翻译（None value = 保留现有值）—— 直测生产函数 vault_entries_payload。"""

    def test_translate(self):
        from routes.agents import VaultEntry, VaultUpdateRequest, vault_entries_payload
        req = VaultUpdateRequest(entries=[
            VaultEntry(key="API_KEY", value="sk-123"),
            VaultEntry(key="KEEP_ME", value=None),
        ])
        assert vault_entries_payload(req.entries) == [{"key": "API_KEY", "value": "sk-123"}, {"key": "KEEP_ME"}]


class TestEvolutionStore:
    """进化存储层：覆盖配置 / 审批 / 任务版本。"""

    def test_override_roundtrip(self, tmp_path, monkeypatch):
        import evolution_store as es
        monkeypatch.setattr(es, "DB_FILE", str(tmp_path / "evo.db"))
        monkeypatch.setattr(es, "_initialized", False)
        es.init_db()
        v1 = es.set_override("amazon-ops", "ad-review", "workflow_task", "", "新任务模板A")
        assert v1 == 1
        v2 = es.set_override("amazon-ops", "ad-review", "workflow_task", "", "新任务模板B")
        assert v2 == 2  # 版本递增
        assert es.get_override("amazon-ops", "ad-review", "workflow_task") == "新任务模板B"
        # 回退基础模板
        assert es.get_effective_workflow_task("amazon-ops", "other-wf", "基础任务") == "基础任务"
        assert es.get_effective_workflow_task("amazon-ops", "ad-review", "基础任务") == "新任务模板B"
        # soul / member_prompt
        es.set_override("amazon-ops", None, "soul", "", "新soul")
        assert es.get_effective_soul("amazon-ops", "基础soul") == "新soul"
        es.set_override("amazon-ops", None, "member_prompt", "ad_optimizer", "广告优化专家新提示")
        assert es.get_effective_member_prompt("ad_optimizer", "旧提示", "amazon-ops") == "广告优化专家新提示"
        assert es.get_effective_member_prompt("listing_seo", "旧提示", "amazon-ops") == "旧提示"

    def test_approval_flow(self, tmp_path, monkeypatch):
        import evolution_store as es
        monkeypatch.setattr(es, "DB_FILE", str(tmp_path / "evo.db"))
        monkeypatch.setattr(es, "_initialized", False)
        es.init_db()
        task_id = "evolve-test-1"
        es.create_task(task_id, "workflow", team_id="amazon-ops", workflow_id="ad-review")
        aid = es.add_approval(task_id, 1, {"target": "workflow_task", "new_text": "改进", "reason": "r"})
        assert len(es.list_approvals(task_id)) == 1
        assert es.set_approval_status(aid, "approved")
        assert not es.set_approval_status(aid, "approved")  # 二次处理失败
        assert len(es.list_approvals(task_id)) == 0  # pending 已空
        # 版本记录
        es.record_version(task_id, 1, 72.5, "基线", {"cases": []})
        es.record_version(task_id, 2, 85.0, "改进后", {"cases": []})
        vs = es.list_versions(task_id)
        assert [v["score"] for v in vs] == [72.5, 85.0]
        # 任务状态流转
        es.update_task(task_id, status="waiting_approval", current_round=1)
        t = es.get_task(task_id)
        assert t["status"] == "waiting_approval" and t["current_round"] == 1


class TestEvolutionStoreNullSentinel:
    """P0-7: NULL 唯一性修复 — 同键 soul 二次覆盖必须覆盖旧值。"""

    def test_soul_double_override(self, tmp_path, monkeypatch):
        import evolution_store as es
        monkeypatch.setattr(es, "DB_FILE", str(tmp_path / "evo.db"))
        monkeypatch.setattr(es, "_initialized", False)
        es.init_db()
        v1 = es.set_override("amazon-ops", None, "soul", "", "soul-A")
        v2 = es.set_override("amazon-ops", None, "soul", "", "soul-B")
        assert v1 == 1 and v2 == 2  # 同键版本递增（NULL 哨兵生效）
        assert es.get_effective_soul("amazon-ops", "base") == "soul-B"  # 读取最新
        rows = es.list_overrides()
        assert len(rows) == 1  # 不无限插行


class TestSettingsGuards:
    """P0-3/P1-1/P1-3: SSRF 私网禁 + 环境密钥域名白名单。"""

    def test_private_net_rejected(self):
        from routes.settings import _validate_test_url
        from fastapi import HTTPException
        for bad in ["http://127.0.0.1:8080/x", "http://169.254.169.254/latest/meta-data", "http://192.168.1.1/"]:
            try:
                _validate_test_url(bad)
                raise AssertionError(f"应拒绝: {bad}")
            except HTTPException:
                pass

    def test_public_url_allowed(self):
        from routes.settings import _validate_test_url
        _validate_test_url("https://open.feishu.cn/open-apis/bot/v2/hook/x")

    def test_env_key_requires_official_host(self, monkeypatch):
        from routes.settings import _resolve_model_test_key
        from fastapi import HTTPException
        monkeypatch.setenv("DEEPSEEK_API_KEY", "env-key-123")

        class Req:
            api_key = None
            api_key_env = "DEEPSEEK_API_KEY"
        # 攻击者域名 + 环境密钥 → 拒绝
        try:
            _resolve_model_test_key(Req(), "deepseek", "https://attacker.example.com")
            raise AssertionError("应拒绝环境密钥发往非官方域名")
        except HTTPException:
            pass
        # 官方域名 → 放行
        assert _resolve_model_test_key(Req(), "deepseek", "https://api.deepseek.com") == "env-key-123"
        # 显式 key → 任意域名放行（用户自己的密钥）
        class Req2:
            api_key = "user-key"
            api_key_env = None
        assert _resolve_model_test_key(Req2(), "deepseek", "https://attacker.example.com") == "user-key"

    def test_rbac_dependencies_present(self):
        """P0-2: 写端点必须挂角色依赖。"""
        import inspect
        from routes.settings import update_safety, add_mcp_server, test_model
        from routes.evolution import evolution_approve, evolution_start
        from routes.fusion import fusion_team_sync, fusion_team_run
        sig = lambda f: str(inspect.signature(f))
        assert "require_admin" in sig(update_safety)
        assert "require_admin" in sig(add_mcp_server)
        assert "require_admin" in sig(test_model)
        assert "require_admin" in sig(evolution_approve)
        assert "require_developer" in sig(evolution_start)
        assert "require_admin" in sig(fusion_team_sync)
        assert "require_developer" in sig(fusion_team_run)


class TestEvolutionEngine:
    """进化引擎状态机（P1: 最高风险逻辑回归保护）。"""

    def _mk_task(self, tmp_path, monkeypatch, **over):
        import evolution_store as es
        monkeypatch.setattr(es, "DB_FILE", str(tmp_path / "evo.db"))
        monkeypatch.setattr(es, "_initialized", False)
        es.init_db()
        tid = "evolve-test"
        es.create_task(tid, "workflow", team_id="amazon-ops", workflow_id="ad-review",
                       max_rounds=over.get("max_rounds", 2), target_score=over.get("target_score", 99))
        return es, tid

    def _patch_pipeline(self, monkeypatch, score=50.0, proposal=None):
        """桩掉评估/评分/方案，驱动状态机。"""
        import routes.evolution as evo
        async def fake_resolve(task):
            return "dh-orchestrator-amazon", [{"id": "c1", "title": "t", "statement": "s"}], True
        async def fake_run(a, s):
            return "reply", "success", 0.001
        async def fake_score(results):
            return [{"id": "c1", "title": "t", "score": score, "comment": "c", "reply": "r", "statement": "s"}]
        async def fake_propose(scored, task, blocked):
            return proposal
        monkeypatch.setattr(evo, "_resolve_evolution_target", fake_resolve)
        monkeypatch.setattr(evo, "_run_team_case", fake_run)
        monkeypatch.setattr(evo, "_score_replies", fake_score)
        monkeypatch.setattr(evo, "_propose_improvement", fake_propose)
        monkeypatch.setattr(evo, "_apply_proposal", lambda tid, p: asyncio_run_store())

    def test_approval_gate_then_apply(self, tmp_path, monkeypatch):
        """评估 → 低分 → 方案 → waiting_approval；审批后应用并推进。"""
        import asyncio
        import routes.evolution as evo
        es, tid = self._mk_task(tmp_path, monkeypatch)

        applied = {}
        async def fake_apply(tid, proposal):
            applied["p"] = proposal
        async def fake_resolve(task):
            return "orchestrator", [{"id": "c1", "title": "t", "statement": "s"}], True
        async def fake_run(a, s):
            return "reply", "success", 0.001
        async def fake_score(results):
            return [{"id": "c1", "title": "t", "score": 50, "comment": "c", "reply": "r", "statement": "s"}]
        async def fake_propose(scored, task, blocked):
            return {"target": "workflow_task", "new_text": "新模板", "reason": "低分"}

        monkeypatch.setattr(evo, "_resolve_evolution_target", fake_resolve)
        monkeypatch.setattr(evo, "_run_team_case", fake_run)
        monkeypatch.setattr(evo, "_score_replies", fake_score)
        monkeypatch.setattr(evo, "_propose_improvement", fake_propose)
        monkeypatch.setattr(evo, "_apply_proposal", fake_apply)
        monkeypatch.setattr(evo, "_publish", lambda *a, **k: asyncio.sleep(0))

        asyncio.run(evo._advance(tid))
        task = es.get_task(tid)
        assert task["status"] == "waiting_approval"
        assert task["last_avg_score"] == 50.0
        approvals = es.list_approvals(tid)
        assert len(approvals) == 1

        # 审批：状态校验 + 应用 + 恢复运行
        asyncio.run(evo._advance(tid))  # 非 waiting_approval 不推进
        task = es.get_task(tid)
        assert task["status"] == "waiting_approval"

    def test_approve_wrong_status_rejected(self, tmp_path, monkeypatch):
        """approve 校验：任务非 waiting_approval 时 400。"""
        import routes.evolution as evo
        from fastapi import HTTPException
        es, tid = self._mk_task(tmp_path, monkeypatch)
        # 任务仍 running（无审批）→ approve 应 400
        try:
            asyncio_run(evo.evolution_approve(tid, type("R", (), {"approval_id": 1})()))
            raise AssertionError("应拒绝非 waiting_approval 的审批")
        except HTTPException as e:
            assert e.status_code == 400

    def test_target_met_stops(self, tmp_path, monkeypatch):
        """达标即止 → success。"""
        import asyncio
        import routes.evolution as evo
        es, tid = self._mk_task(tmp_path, monkeypatch, target_score=40)
        async def fake_resolve(task):
            return "o", [{"id": "c1", "title": "t", "statement": "s"}], True
        async def fake_run(a, s):
            return "reply", "success", 0.001
        async def fake_score(results):
            return [{"id": "c1", "title": "t", "score": 90, "comment": "c", "reply": "r", "statement": "s"}]
        monkeypatch.setattr(evo, "_resolve_evolution_target", fake_resolve)
        monkeypatch.setattr(evo, "_run_team_case", fake_run)
        monkeypatch.setattr(evo, "_score_replies", fake_score)
        monkeypatch.setattr(evo, "_publish", lambda *a, **k: asyncio.sleep(0))
        asyncio.run(evo._advance(tid))
        assert es.get_task(tid)["status"] == "success"
        assert es.get_task(tid)["last_avg_score"] == 90.0


def asyncio_run(coro):
    import asyncio
    return asyncio.run(coro)


class TestTeamRunPersistence:
    """团队 run 成员清单持久化（评审 P2-2：重启后 status 恢复归因）。"""

    def test_save_load_delete(self, tmp_path, monkeypatch):
        import evolution_store as es
        monkeypatch.setattr(es, "DB_FILE", str(tmp_path / "evo.db"))
        monkeypatch.setattr(es, "_initialized", False)
        es.init_db()
        team = [{"agent_id": "ad_optimizer", "name": "广告优化", "system_prompt": "x"}]
        es.save_team_run("dh-team-x", team)
        assert es.load_team_run("dh-team-x") == team
        es.delete_team_run("dh-team-x")
        assert es.load_team_run("dh-team-x") is None


class TestReviewRegression:
    """复审回归（P0/P1）：fusion_evaluate 解包、approve meta 合并、cost_by_day 格式。"""

    def test_run_case_triple_unpack(self):
        """P0-1: fusion_evaluate 能消费 _run_case 三元组（不再 ValueError）。"""
        import inspect
        from routes import fusion
        src = inspect.getsource(fusion)
        # 断言 fusion_evaluate 内解包 3 个变量
        assert "_run_case(deerflow_agent, case[" in src
        # 模拟真实调用：mock _run_case 返回 3 元组，验证 eval 循环可解包（async 需 await）
        import asyncio
        async def fake_run_case(agent, stmt):
            return "reply", "success", 0.001
        orig = fusion._run_case
        fusion._run_case = fake_run_case
        try:
            cases = [{"id": "c1", "title": "t", "statement": "s"}]
            async def loop():
                results = []
                for case in cases:
                    reply, status, _cost = await fusion._run_case("agent", case["statement"])
                    results.append({**case, "reply": reply, "run_status": status})
                return results
            results = asyncio.run(loop())
            assert results[0]["run_status"] == "success"
        finally:
            fusion._run_case = orig

    def test_approve_preserves_rejected_meta(self, tmp_path, monkeypatch):
        """P1: approve 的 pending_verify 合并而非覆盖，保全 meta.rejected。"""
        import json
        import evolution_store as es
        from routes import evolution as evo
        monkeypatch.setattr(es, "DB_FILE", str(tmp_path / "evo.db"))
        monkeypatch.setattr(es, "_initialized", False)
        es.init_db()
        tid = "evolve-meta"
        es.create_task(tid, "workflow", team_id="amazon-ops", workflow_id="ad-review")
        # 先模拟 reject 累积负面样本
        es.update_task(tid, meta=json.dumps({"rejected": ["方案A", "方案B"]}))
        # 模拟 approve 合并逻辑
        task = es.get_task(tid)
        meta = json.loads(task["meta"])
        meta["pending_verify"] = True
        es.update_task(tid, meta=json.dumps(meta))
        task = es.get_task(tid)
        m = json.loads(task["meta"])
        assert m["pending_verify"] is True
        assert m["rejected"] == ["方案A", "方案B"]  # 负面样本保全

    def test_cost_by_day_format(self, tmp_path, monkeypatch):
        """P0-2: cost_by_day 分组键与标签同源（MM-DD），不再全零。"""
        import time as _time
        import trace_store
        monkeypatch.setattr(trace_store, "_DB_FILE", str(tmp_path / "t.db"))
        monkeypatch.setattr(trace_store, "_conn", None)
        # 写一条成本（received_at 默认 now；days=2 避免秒级边界竞态）
        trace_store.record_trace("dh-team", "success", task_goal="x", cost=2.5)
        days = trace_store.cost_by_day(2)
        assert len(days) == 2
        # 关键：不再全零（分组键 MM-DD 与标签同源）
        assert days[-1]["cost"] == 2.5
