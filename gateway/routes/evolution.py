from __future__ import annotations
from auth import User, require_admin, require_developer
"""进化实验室：agent / workflow / team 三层进化，审批队列闭环。

闭环：评估 → LLM 改进建议 → 审批门（require_human_approval）→ 应用 → 下一轮复测。
- workflow 级：进化 {team, workflow} 的 task 模板（同团队不同工作流）
- team 级：进化团队主代理 soul 与成员人设（不同团队）
- agent 级：复用 fusion/evaluate 管道，按轮次循环

护栏：max_evolution_rounds / max_cost_per_evolution / blocked_domains（从安全设置读取）。
实时进度通过 WS 频道 evolution:{task_id} 推送（LiveEvolutionTracker / EvolutionLog 消费）。
"""


import asyncio
import json
import re
import time
import uuid
from typing import Optional

import httpx
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel

import config
import evolution_store as store

from .fusion import (
    TEAM_TEMPLATES,
    DEFAULT_MODEL,
    POLL_INTERVAL,
    _BUILTIN_BENCHMARKS,
    _extract_ai_reply,
    _estimate_run_cost,
    _proxy_df,
    _read_penguin_agent_defs,
    _restart_deerflow_gateway,
    _run_case,
    _score_replies,
    _sync_agent,
    _sync_orchestrator,
    _write_subagents_config,
)
from .settings import _load_config as _load_settings_config
from .traces import record_trace
from ws import push_event


router = APIRouter()

# 单 case 执行与评分的成本估算（USD，DeepSeek 量级；用于 max_cost_per_evolution 护栏）
_EST_CASE_COST = 0.002
_EST_SCORE_COST = 0.001

# 团队专属评测用例（工作流 task 本身也是评测语句）
_TEAM_CASES: dict[str, list[str]] = {
    "amazon-ops": ["AMZ-001-listing"],
    "tiktok-shop": ["TT-001-sourcing"],
    "content-studio": ["AMZ-001-listing"],
    "crossborder-ops": ["AMZ-001-listing", "TT-001-sourcing"],
    "ops-support": [],
}

_GENERIC_CASE_IDS = ["DH-001-summary", "DH-003-json"]


def _builtin_cases(case_ids: list[str]) -> list[dict]:
    """从 dh-benchmark 取内置用例（_BUILTIN_BENCHMARKS 是 list）。"""
    bench = _BUILTIN_BENCHMARKS.get("dh-benchmark", [])
    return [c for c in bench if c["id"] in case_ids]


class EvolutionStartRequest(BaseModel):
    target_type: str  # agent / workflow / team
    team_id: Optional[str] = None
    workflow_id: Optional[str] = None
    agent_id: Optional[str] = None
    max_rounds: int = 3
    target_score: int = 85


class ApprovalRequest(BaseModel):
    approval_id: int


async def _publish(task_id: str, event: str, data: dict):
    await push_event(event, data, f"evolution:{task_id}")


# 任务级互斥：防止 approve/reject/start 并发触发双轮执行（评审 P1-10）
_task_locks: dict[str, asyncio.Lock] = {}


def _task_lock(task_id: str) -> asyncio.Lock:
    return _task_locks.setdefault(task_id, asyncio.Lock())


def _rejected_proposals(task: dict) -> list[str]:
    """已拒绝方案的 reason 摘要（负面样本，防止下一轮原样再提）。"""
    try:
        meta = json.loads(task.get("meta") or "{}")
        return meta.get("rejected", [])
    except (json.JSONDecodeError, TypeError):
        return []


# ==================== 目标解析 ====================


async def _resolve_evolution_target(task: dict) -> tuple[str, list[dict], bool]:
    """返回 (runner_agent, cases, team_mode)。workflow/team 目标会先同步团队配置。"""
    ttype = task["target_type"]
    if ttype == "agent":
        from .agents import _find_agent_project
        agent_id = task["agent_id"]
        project_id = await _find_agent_project(agent_id)
        runner = await _sync_agent(agent_id, project_id)  # dh-<agent>
        cases = _builtin_cases(_GENERIC_CASE_IDS + ["AMZ-001-listing"])
        return runner, cases, False

    # workflow / team：同步团队 + 主代理
    team_id = task["team_id"]
    spec = TEAM_TEMPLATES.get(team_id)
    if not spec:
        raise HTTPException(status_code=404, detail=f"未知团队模板: {team_id}")
    team = await _read_penguin_agent_defs()
    allowed = spec.get("members")
    if allowed is not None:
        team = [m for m in team if m["agent_id"] in allowed]
    from .fusion import _apply_member_overrides
    _apply_member_overrides(team, team_id)
    synced, changed = _write_subagents_config(team)
    if changed:
        await _restart_deerflow_gateway()
    runner = await _sync_orchestrator(team_id, team)

    if ttype == "workflow":
        wf = next((w for w in spec.get("workflows", []) if w["id"] == task["workflow_id"]), None)
        if not wf:
            raise HTTPException(status_code=404, detail=f"未知工作流: {task['workflow_id']}")
        statement = store.get_effective_workflow_task(team_id, wf["id"], wf["task"])
        cases = [{"id": f"WF-{wf['id']}", "title": f"工作流：{wf['label']}", "statement": statement}]
        cases += _builtin_cases(_GENERIC_CASE_IDS)
    else:  # team
        cases = _builtin_cases(_TEAM_CASES.get(team_id, []) + _GENERIC_CASE_IDS)
    return runner, cases, True


async def _run_team_case(deerflow_agent: str, statement: str) -> tuple[str, str, float]:
    """团队模式评测：主代理 + 子代理真实执行，返回 (reply, status, cost)。"""
    if not statement:
        return "(无题目内容)", "skipped", 0.0
    thread_id = f"dh-eval-{uuid.uuid4().hex[:12]}"
    try:
        await _proxy_df("POST", "/api/threads", json={"thread_id": thread_id})
        run = await _proxy_df(
            "POST",
            f"/api/threads/{thread_id}/runs",
            json={
                "assistant_id": deerflow_agent,
                "input": {"messages": [{"role": "user", "content": statement}]},
                "config": {"recursion_limit": 1000},
                "context": {
                    "model_name": DEFAULT_MODEL,
                    "mode": "ultra",
                    "subagent_enabled": True,
                },
            },
        )
        run_id = run.get("run_id")
        deadline = time.monotonic() + 240
        status = run.get("status", "pending")
        detail: dict = run
        while status in ("pending", "running", "queued"):
            if time.monotonic() > deadline:
                return "(评测超时)", "timeout", 0.0
            await asyncio.sleep(POLL_INTERVAL)
            detail = await _proxy_df("GET", f"/api/threads/{thread_id}/runs/{run_id}")
            status = detail.get("status", status)
        if status in ("failed", "error", "cancelled"):
            return f"(run 状态: {status})", status, 0.0
        state = await _proxy_df("GET", f"/api/threads/{thread_id}/state")
        return _extract_ai_reply(state), status, _estimate_run_cost(detail)
    except HTTPException as exc:
        return f"(执行失败: {exc.detail})", "error", 0.0


# ==================== 改进方案 ====================

_TARGETS = {"workflow_task", "soul", "member_prompt"}


async def _propose_improvement(
    scored: list[dict], task: dict, blocked_domains: list[str]
) -> Optional[dict]:
    """LLM 生成结构化改进方案；无 key / 无低分项 / 命中禁入领域 → None。"""
    if not config.DEEPSEEK_API_KEY:
        return None
    low = [c for c in scored if c.get("score", 0) < 60]
    if not low:
        return {"target": "none", "reason": "全部用例得分良好，无需改进"}
    lines = "\n".join(
        f"- [{c['id']}] 得分 {c.get('score', 0)}：\n  题目: {str(c.get('statement', ''))[:300]}\n"
        f"  评论: {c.get('comment', '')[:200]}\n  回复: {str(c.get('reply', ''))[:400]}"
        for c in low
    )
    target_hint = {
        "workflow": "改进目标：该工作流的 task 模板文本（让主代理按模板执行时产出更高质量结果）。"
        "target 固定为 workflow_task，new_text 为改进后的完整任务模板（保留结构、补齐薄弱环节、中文）。",
        "team": "改进目标：团队主代理 soul 或成员人设。若问题在编排/分派 → target=soul；"
        "若问题在特定成员产出 → target=member_prompt 且 member_id 填该成员 agent_id。new_text 为改进后的完整文本。",
        "agent": "改进目标：该 agent 的系统提示。target 固定为 member_prompt，member_id 填 agent_id。",
    }[task["target_type"]]
    rejected = _rejected_proposals(task)
    rejected_hint = (
        "\n以下方案已被人工拒绝，请勿重复或近似重复：\n- " + "\n- ".join(rejected[:5])
        if rejected else ""
    )
    prompt = (
        "你是进化工程师。基于以下团队评测的低分用例，生成一个改进方案。\n"
        f"目标类型：{task['target_type']}（team={task['team_id']} workflow={task['workflow_id']} agent={task['agent_id']}）\n"
        f"{target_hint}\n"
        "低分用例：\n" + lines + "\n"
        "输出严格 JSON（不要代码块）：{\"target\": \"workflow_task\"|\"soul\"|\"member_prompt\", "
        "\"member_id\": \"\", \"new_text\": \"改进后的完整文本\", \"reason\": \"一句话理由\"}\n"
        "约束：new_text 必须完整可替换（不是片段）；不改变核心业务目标；中文；长度不超过 2500 字符。"
        + (" 若 target=soul：必须原样保留 {team_members} 占位符（运行时注入成员清单）。" if task["target_type"] == "team" else "")
        + rejected_hint
    )
    try:
        resp = httpx.post(
            "https://api.deepseek.com/chat/completions",
            headers={"Authorization": f"Bearer {config.DEEPSEEK_API_KEY}"},
            json={
                "model": "deepseek-v4-flash",
                "messages": [{"role": "user", "content": prompt}],
                "temperature": 0.4,
                "max_tokens": 3000,
            },
            timeout=90,
            trust_env=False,
        )
        text = resp.json()["choices"][0]["message"]["content"]
        proposal = _parse_proposal_json(text)
        if not proposal or proposal.get("target") not in _TARGETS:
            return None
        # 禁入领域过滤
        blob = f"{proposal.get('new_text', '')} {proposal.get('reason', '')}"
        for domain in blocked_domains:
            if domain and domain.strip() and domain.strip() in blob:
                return None
        return proposal
    except Exception:
        return None


def _parse_proposal_json(text: str) -> Optional[dict]:
    """解析 LLM 返回的 JSON（容错代码块包裹与前后杂质）。"""
    text = re.sub(r"```(?:json)?", "", text).strip()
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end < start:
        return None
    try:
        return json.loads(text[start : end + 1])
    except json.JSONDecodeError:
        return None


# ==================== 应用与版本 ====================


async def _apply_proposal(task_id: str, proposal: dict) -> None:
    task = store.get_task(task_id)
    target = proposal.get("target", "")
    reason = proposal.get("reason", "")[:200]
    new_text = proposal.get("new_text", "")
    if target == "workflow_task":
        v = store.set_override(task["team_id"], task["workflow_id"], "workflow_task", "", new_text)
        summary = f"工作流模板 v{v}：{reason}"
    elif target == "soul":
        v = store.set_override(task["team_id"], None, "soul", "", new_text)
        summary = f"主代理 soul v{v}：{reason}"
    elif target == "member_prompt":
        member = proposal.get("member_id", "") or task["agent_id"] or ""
        if task["target_type"] == "agent":
            # agent 型进化：直接写回 penguin agent config（_sync_agent 下次同步即生效）
            from .agents import _find_agent_project, _proxy as _agents_proxy
            project_id = await _find_agent_project(member)
            await _agents_proxy(
                "PUT",
                f"/api/projects/{project_id}/agents/{member}/config",
                json={"config": {"systemPrompt": new_text}},
            )
            summary = f"Agent 人设 {member}：{reason}"
        else:
            v = store.set_override(task["team_id"], None, "member_prompt", member, new_text)
            summary = f"成员人设 {member} v{v}：{reason}"
    else:
        summary = "无改进"
    store.record_version(
        task_id, task["current_round"], None, summary,
        {"target": target, "proposal": proposal},
    )
    await _publish(task_id, "proposal_applied", {"target": target, "summary": summary})
    # 观测闭环：应用轨迹
    record_trace(
        f"evolve:{task_id}", "success",
        task_goal=f"应用改进[{target}] {task['team_id']}",
        meta_summary=summary,
    )


# ==================== 单轮推进（可恢复：审批后再次调用） ====================


async def _advance(task_id: str) -> None:
    async with _task_lock(task_id):
        try:
            await _advance_inner(task_id)
        except Exception as exc:
            import logging
            logging.getLogger("deerharness").error("evolution %s failed: %s", task_id, exc)
            store.update_task(task_id, status="failed")
            try:
                await _publish(task_id, "evolution_done", {"status": "failed", "reason": str(exc)[:200]})
            except Exception:
                pass


async def _advance_inner(task_id: str) -> None:
    task = store.get_task(task_id)
    if not task or task["status"] != "running":
        return
    safety = _load_settings_config().get("safety") or {}
    max_rounds = task["max_rounds"] or int(safety.get("max_evolution_rounds", 10))
    max_cost = float(safety.get("max_cost_per_evolution", 5.0))
    require_approval = bool(safety.get("require_human_approval", True))
    blocked = safety.get("blocked_domains", []) or []

    round_no = task["current_round"] + 1
    if round_no > max_rounds:
        store.update_task(task_id, status="success")
        await _publish(task_id, "evolution_done", {"status": "success", "reason": "达到轮次上限"})
        return
    store.update_task(task_id, current_round=round_no, status="running")
    await _publish(task_id, "evolution_round_start", {"current_round": round_no, "max_rounds": max_rounds})

    # 1. 评估
    runner, cases, team_mode = await _resolve_evolution_target(task)
    cost = float(task.get("cost") or 0)
    if cost >= max_cost:
        store.update_task(task_id, status="stopped")
        await _publish(task_id, "evolution_done", {"status": "stopped", "reason": "超出成本预算"})
        return
    results = []
    for case in cases:
        if team_mode:
            reply, status, case_cost = await _run_team_case(runner, case["statement"])
        else:
            reply, status, case_cost = await _run_case(runner, case["statement"])
        results.append({
            "id": case["id"],
            "title": case["title"],
            "statement": case["statement"],
            "reply": reply,
            "status": status,
        })
        cost += case_cost

    # 2. 评分
    scored = await _score_replies([{k: r[k] for k in ("id", "title", "statement", "reply")} for r in results])
    avg = round(sum(c.get("score", 0) for c in scored) / max(1, len(scored)), 1)
    cost += _EST_SCORE_COST * len(scored)
    store.update_task(task_id, cost=round(cost, 6), last_avg_score=avg)
    store.record_version(
        task_id, round_no, avg,
        f"第 {round_no} 轮评估（{len(scored)} 用例）",
        {"cases": scored, "team_mode": team_mode},
    )
    record_trace(
        f"eval:{task_id}", "success",
        task_goal=f"进化[{task['target_type']}] 第{round_no}轮",
        score=avg, benchmark_id="evolution", version_baseline=round_no,
        cost=round(cost, 6),
    )
    await _publish(task_id, "evolution_progress", {
        "current_round": round_no, "max_rounds": max_rounds, "avg_score": avg,
    })

    # 2.5 验证轮：刚应用过改进（approve 标记 pending_verify）→ 本轮即验证，
    #      评估后直接结束，不再生成/审批新方案（评审 P2-4：保证改进被评测）
    try:
        meta = json.loads(task.get("meta") or "{}")
    except (json.JSONDecodeError, TypeError):
        meta = {}
    if meta.pop("pending_verify", False):
        store.update_task(task_id, status="success", meta=json.dumps(meta, ensure_ascii=False))
        await _publish(task_id, "evolution_done", {"status": "success", "reason": f"改进验证完成（第 {round_no} 轮，{avg} 分）"})
        return

    # 3. 达标即止
    target_score = task["target_score"] or 85
    if avg >= target_score:
        store.update_task(task_id, status="success")
        await _publish(task_id, "evolution_done", {"status": "success", "reason": f"达标 {avg} ≥ {target_score}"})
        return

    # 4. 改进建议
    proposal = await _propose_improvement(scored, task, blocked)
    if not proposal or proposal.get("target") == "none":
        store.update_task(task_id, status="success")
        await _publish(task_id, "evolution_done", {"status": "success", "reason": "无低分项或无法生成方案"})
        return

    # 5. 审批门
    if require_approval:
        approval_id = store.add_approval(task_id, round_no, proposal)
        store.update_task(task_id, status="waiting_approval")
        await _publish(task_id, "waiting_approval", {
            "approval_id": approval_id, "round": round_no, "proposal": proposal,
        })
        return

    # 6. 自动应用并继续
    await _apply_proposal(task_id, proposal)
    asyncio.create_task(_advance(task_id))


async def reconcile_stale_tasks() -> None:
    """启动时恢复：进程重启后 running 任务续跑（评审 P1-3）。

    在 main lifespan 调用；waiting_approval 任务保持等待（审批数据持久化）。
    """
    for t in store.list_tasks(limit=100):
        if t.get("status") == "running":
            asyncio.create_task(_advance(t["task_id"]))


# ==================== HTTP 端点 ====================


@router.post("/start")
async def evolution_start(req: EvolutionStartRequest, user: User = Depends(require_developer)):
    """启动进化任务（后台逐轮推进；审批模式下每轮挂起等审批）。"""
    if req.target_type not in ("agent", "workflow", "team"):
        raise HTTPException(status_code=400, detail="target_type 必须为 agent / workflow / team")
    if req.target_type in ("workflow", "team") and not req.team_id:
        raise HTTPException(status_code=400, detail="workflow/team 进化需要 team_id")
    if req.target_type == "workflow" and not req.workflow_id:
        raise HTTPException(status_code=400, detail="workflow 进化需要 workflow_id")
    if req.target_type == "agent" and not req.agent_id:
        raise HTTPException(status_code=400, detail="agent 进化需要 agent_id")
    if not (1 <= req.max_rounds <= 20):
        raise HTTPException(status_code=400, detail="max_rounds 范围 1-20")
    if not (1 <= req.target_score <= 100):
        raise HTTPException(status_code=400, detail="target_score 范围 1-100")

    task_id = f"evolve-{uuid.uuid4().hex[:12]}"
    store.create_task(
        task_id, req.target_type, team_id=req.team_id or "",
        workflow_id=req.workflow_id or "", agent_id=req.agent_id or "",
        max_rounds=req.max_rounds, target_score=req.target_score,
    )
    asyncio.create_task(_advance(task_id))
    return {"success": True, "task_id": task_id}


@router.get("/tasks")
async def evolution_tasks():
    """进化任务列表（含目标与状态）。"""
    tasks = store.list_tasks()
    out = []
    for t in tasks:
        if t["target_type"] == "workflow":
            label = f"{t['team_id']}/{t['workflow_id']}"
        elif t["target_type"] == "team":
            label = t["team_id"]
        else:
            label = t["agent_id"]
        out.append({
            "task_id": t["task_id"],
            "target_type": t["target_type"],
            "target": label,
            "team_id": t["team_id"],
            "workflow_id": t["workflow_id"],
            "agent_id": t["agent_id"],
            "max_rounds": t["max_rounds"],
            "target_score": t["target_score"],
            "status": t["status"],
            "current_round": t["current_round"],
            "last_avg_score": t["last_avg_score"],
            "cost": t["cost"],
            "created_at": t["created_at"],
        })
    return {"tasks": out}


@router.get("/tasks/{task_id}/status")
async def evolution_status(task_id: str):
    task = store.get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="进化任务不存在")
    return {
        "task_id": task_id, "status": task["status"], "current_round": task["current_round"],
        "max_rounds": task["max_rounds"], "last_avg_score": task["last_avg_score"],
        "cost": task["cost"], "pending_approvals": len(store.list_approvals(task_id)),
    }


@router.get("/tasks/{task_id}/versions")
async def evolution_versions(task_id: str):
    """版本得分对比（ScoreChart 数据源）。"""
    if not store.get_task(task_id):
        raise HTTPException(status_code=404, detail="进化任务不存在")
    versions = [
        {"version": v["version"], "score": v["score"],
         "change_summary": v["change_summary"], "applied_at": v["applied_at"]}
        for v in store.list_versions(task_id)
    ]
    return {"task_id": task_id, "versions": versions}


@router.get("/tasks/{task_id}/approvals")
async def evolution_approvals(task_id: str):
    """待审批改进方案队列。"""
    return {"approvals": store.list_approvals(task_id, "pending")}


@router.post("/tasks/{task_id}/approve")
async def evolution_approve(task_id: str, req: ApprovalRequest, user: User = Depends(require_admin)):
    """审批通过：应用改进方案并继续下一轮。"""
    task = store.get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="进化任务不存在")
    if task["status"] != "waiting_approval":
        raise HTTPException(status_code=400, detail=f"任务当前状态 {task['status']}，不可审批")
    # approval 必须属于本任务（防跨任务误置位）
    pending = store.list_approvals(task_id, "pending")
    if not any(a["id"] == req.approval_id for a in pending):
        raise HTTPException(status_code=400, detail="审批不存在或不属于该任务")
    ok = store.set_approval_status(req.approval_id, "approved")
    if not ok:
        raise HTTPException(status_code=400, detail="审批不存在或已处理")
    proposal = next(a["proposal"] for a in pending if a["id"] == req.approval_id)
    try:
        await _apply_proposal(task_id, proposal)
    except Exception:
        # 应用失败 → 回滚审批为 pending，任务保持 waiting_approval，可重试
        store.set_approval_status(req.approval_id, "pending")
        store.update_task(task_id, status="waiting_approval")
        raise
    # 应用后标记验证轮：下一轮评估改进效果后直接结束（评审 P2-4）
    store.update_task(task_id, status="running", meta='{"pending_verify": true}')
    asyncio.create_task(_advance(task_id))
    return {"success": True}


@router.post("/tasks/{task_id}/reject")
async def evolution_reject(task_id: str, req: ApprovalRequest, user: User = Depends(require_admin)):
    """拒绝改进方案：跳过本方案，继续下一轮评估。"""
    task = store.get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="进化任务不存在")
    pending = store.list_approvals(task_id, "pending")
    proposal = next((a["proposal"] for a in pending if a["id"] == req.approval_id), None)
    ok = store.set_approval_status(req.approval_id, "rejected")
    if not ok:
        raise HTTPException(status_code=400, detail="审批不存在或已处理")
    # 记录负面样本，防止下一轮原样再提
    if proposal and proposal.get("reason"):
        try:
            meta = json.loads(task.get("meta") or "{}")
            rejected = list(meta.get("rejected", []))
            rejected.append(str(proposal["reason"])[:120])
            meta["rejected"] = rejected[-10:]
            store.update_task(task_id, meta=json.dumps(meta, ensure_ascii=False))
        except (json.JSONDecodeError, TypeError):
            pass
    store.update_task(task_id, status="running")
    asyncio.create_task(_advance(task_id))
    return {"success": True}


@router.post("/tasks/{task_id}/stop")
async def evolution_stop(task_id: str, user: User = Depends(require_developer)):
    """停止进化任务。"""
    if not store.get_task(task_id):
        raise HTTPException(status_code=404, detail="进化任务不存在")
    store.update_task(task_id, status="stopped")
    return {"success": True}
