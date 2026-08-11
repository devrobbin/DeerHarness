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
