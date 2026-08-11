"""crossborder-ops → PenguinHarness Agent 批量导入脚本。

从 crossborder-ops 的 OpenClaw 部署人设（deploy/openclaw/setup-agents.sh）导入
13 个跨境运营 Agent（1 总控 + 12 专业），生成可运行的 system_prompt 并注册到
PenguinHarness（项目 deerharness_test）。幂等：已存在的 Agent 跳过。

用法：
    python scripts/import_crossborder_agents.py
"""

from __future__ import annotations

import sys

import httpx

PENGUIN_API = "http://localhost:7368"
PENGUIN_USER_ID = "admin"
PENGUIN_PASSWORD = "penguin-3983"
PROJECT_ID = "deerharness_test"

# (agent_id, 角色名, 人设描述) — 源自 crossborder-ops setup-agents.sh
AGENTS = [
    ("orchestrator", "总控Agent·编排中心", "运营总监张伟，全局调度12Agent，异常告警处理，跨部门任务编排"),
    ("product-sourcing", "选品推荐Agent", "数据驱动选品猎人，跨8大平台实时选品，128线索/日"),
    ("pricing-compete", "定价竞品Agent", "动态定价指挥官，856商品监控，自动响应竞品降价"),
    ("ad-optimizer", "广告优化Agent", "广告战役指挥官，SP/SB/SD三线作战，RoAS 32.9x"),
    ("inventory-forecast", "库存预测Agent", "库存预测师，2340 SKU需求预测，自动补货"),
    ("customer-reply", "智能客服Agent", "多语言客诉化解专家，218票/日，6语言，94%满意度"),
    ("content-generator", "内容生成Agent", "电商内容工厂，4模态5角色，高质量Listing输出"),
    ("listing-seo", "Listing优化Agent", "SEO攻击规划师，关键词追踪+竞品内容攻击简报"),
    ("logistics-monitor", "物流追踪Agent", "跨境物流哨兵，3842票/日在途，对接菜鸟+快递鸟"),
    ("compliance-review", "合规审查Agent", "合规守门人，12国法规，知产+政策+税务三维审查"),
    ("customs-declare", "海关报关Agent", "报关通行官，38批次/日，对接电子口岸+单一窗口"),
    ("tax-rebate", "出口退税Agent", "退税金回流专家，¥847K待退，对接单一窗口退税系统"),
    ("finance-tax", "财税代理Agent", "财税总管，12国覆盖，多币种P&L+转让定价+自动报税"),
]


def build_prompt(name: str, persona: str) -> str:
    return (
        "# Role\n"
        f"你是 CrossBorder Ops 的{name}（{persona.split('，')[0]}）。\n\n"
        "# 职责\n"
        f"{persona}。\n\n"
        "# 工作方式\n"
        "- 面向跨境电商运营场景，输出可执行、可核验的结果；\n"
        "- 数据类任务优先给出结构化结论（表格/JSON）；\n"
        "- 与团队其他 Agent 协作时，明确输出边界，便于汇总。\n\n"
        "# 输出规范\n"
        "- 简洁、专业、中文优先；\n"
        "- 涉及金额/数量给出具体数字与单位。"
    )


def main() -> int:
    client = httpx.Client(base_url=PENGUIN_API, trust_env=False, timeout=30)
    resp = client.post("/api/auth/login", json={"userId": PENGUIN_USER_ID, "password": PENGUIN_PASSWORD})
    if resp.status_code != 200:
        print(f"登录失败: {resp.status_code} {resp.text[:100]}")
        return 1

    # 已有 Agent（幂等跳过）
    existing = set()
    for project in client.get(f"/api/projects").json().get("projects", []):
        if project["projectId"] == PROJECT_ID:
            for agent in client.get(f"/api/projects/{PROJECT_ID}/agents").json().get("agents", []):
                existing.add(agent["agentId"])

    created, skipped = 0, 0
    for agent_id, name, persona in AGENTS:
        if agent_id in existing:
            print(f"⏭️  跳过（已存在）: {agent_id}")
            skipped += 1
            continue
        resp = client.post(
            f"/api/projects/{PROJECT_ID}/agents",
            json={
                "agentId": agent_id.replace("-", "_"),  # penguin id 不允许连字符
                "name": name,
                "description": f"CrossBorder Ops {name}（自动导入）",
                "systemPrompt": build_prompt(name, persona),
            },
        )
        if resp.status_code in (200, 201):
            print(f"✅ 创建: {agent_id}（{name}）")
            created += 1
        else:
            print(f"❌ 失败: {agent_id} -> {resp.status_code} {resp.text[:120]}")
    print(f"\n完成：新建 {created}，跳过 {skipped}，共 {len(AGENTS)}。")
    print(f"下一步：在 DeerHarness 执行 POST /api/fusion/team/sync 注册为子代理团队，"
          f"或 POST /api/fusion/evaluate 评测任意 Agent（benchmark_id=dh-benchmark）。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
