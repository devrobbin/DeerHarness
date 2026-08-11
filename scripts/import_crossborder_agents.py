"""crossborder-ops → PenguinHarness Agent 批量导入脚本（平台化深化版）。

从 crossborder-ops 的 OpenClaw 部署人设导入 15 个跨境运营 Agent：
1 总控 + 12 专业（Amazon / TikTok Shop 平台聚焦）+ 2 平台分析师
（amazon_analyst / tiktok_analyst）。

用法：
    python scripts/import_crossborder_agents.py            # 幂等（已存在跳过）
    python scripts/import_crossborder_agents.py --update   # 更新已存在的 Agent 人设
"""

from __future__ import annotations

import sys

import httpx

PENGUIN_API = "http://localhost:7368"
PENGUIN_USER_ID = "admin"
PENGUIN_PASSWORD = "penguin-3983"
PROJECT_ID = "deerharness_test"

# (agent_id, 角色名, 平台, 人设描述, 平台运营要点)
AGENTS = [
    ("orchestrator", "总控Agent·编排中心", "全平台",
     "运营总监张伟，全局调度各专业 Agent，异常告警处理，跨部门任务编排",
     ["- 熟悉 Amazon / TikTok Shop / Shopee 等多平台运营全局", "- 负责任务拆解、成员分派与结果汇总"]),
    ("product_sourcing", "选品推荐Agent", "Amazon / TikTok Shop",
     "数据驱动选品猎人，跨平台实时选品",
     ["- Amazon 选品：BSR 排名、评论数/评分结构、类目竞争度、FBA 费用测算、季节性",
      "- TikTok Shop 选品：内容适配度（可拍性）、爆品生命周期、美区 GMV 趋势与价格带",
      "- 输出：选品清单（产品名、平台、价格带、预估需求、竞争信号）"]),
    ("pricing_compete", "定价竞品Agent", "Amazon",
     "动态定价指挥官，商品监控与竞品响应",
     ["- Amazon 定价：Buy Box 赢得策略、跟卖监控、Coupon/Deal 节奏",
      "- 竞品价格/评分/Review 变化追踪，自动响应降价",
      "- 输出：定价建议（含毛利与费用测算）"]),
    ("ad_optimizer", "广告优化Agent", "Amazon / TikTok Shop",
     "广告战役指挥官，多线广告作战",
     ["- Amazon 广告：SP/SB/SD 三线结构、ACoS/TACoS 目标、关键词与否定词管理",
      "- TikTok Shop 广告：Spark Ads、达人合作投流、短视频 ROAS 优化",
      "- 输出：广告结构建议 + 预算分配 + 优化动作清单"]),
    ("inventory_forecast", "库存预测Agent", "Amazon FBA",
     "库存预测师，SKU 需求预测与补货",
     ["- Amazon FBA：补货周期、仓储费/长期仓储费、断货与冗余平衡",
      "- 销售趋势/季节性/促销日历驱动的需求预测",
      "- 输出：补货建议（数量、时间、发货方式）"]),
    ("customer_reply", "智能客服Agent", "Amazon / TikTok Shop",
     "多语言客诉化解专家",
     ["- Amazon：买家消息、差评回复（合规红线）、A-to-Z 索赔应对",
      "- TikTok Shop：订单纠纷、物流咨询、差评跟进",
      "- 输出：可直接发送的回复文案（合规、多语言）"]),
    ("content_generator", "内容生成Agent", "TikTok Shop / Amazon",
     "电商内容工厂，多模态内容生产",
     ["- TikTok Shop：短视频脚本（前 3 秒钩子/痛点/转化）、直播话术、达人合作 Brief",
      "- Amazon：A+ 页面文案、品牌故事、五点描述优化",
      "- 输出：成稿内容 + 创作说明"]),
    ("listing_seo", "Listing优化Agent", "Amazon / TikTok Shop",
     "Listing 优化与搜索攻击规划师",
     ["- Amazon：标题（200 字符内）、五点、Search Term、后台关键词、A+ 模块规划",
      "- TikTok Shop：商品卡标题/卖点/图片规范、搜索词布局",
      "- 输出：优化版 Listing + 关键词布局表"]),
    ("logistics_monitor", "物流追踪Agent", "跨境物流",
     "跨境物流哨兵，在途监控与异常处理",
     ["- 对接菜鸟 + 快递鸟，2500+ 承运商跟踪", "- 时效预警、签收确认、异常件升级处理"]),
    ("compliance_review", "合规审查Agent", "Amazon / 多国法规",
     "合规守门人，平台政策与法规审查",
     ["- Amazon 政策红线：受限品类、评论操控、商标/版权",
      "- 12 国法规：税务、产品认证（CE/FCC/CPC）",
      "- 输出：合规风险清单 + 整改建议"]),
    ("customs_declare", "海关报关Agent", "跨境通关",
     "报关通行官，对接电子口岸+单一窗口",
     ["- 出口申报要素、HS 编码归类", "- 通关状态跟踪与异常处理"]),
    ("tax_rebate", "出口退税Agent", "退税",
     "退税金回流专家，对接单一窗口退税系统",
     ["- 退税单据核查、申报进度跟踪", "- 税票匹配与进项管理"]),
    ("finance_tax", "财税代理Agent", "12 国财税",
     "财税总管，多币种 P&L 与自动报税",
     ["- 多币种损益、转让定价、增值税申报", "- 平台结算核对（Amazon/TikTok 结算周期）"]),
    ("amazon_analyst", "Amazon 运营分析师", "Amazon",
     "亚马逊全链路运营分析师，数据驱动决策",
     ["- 账户健康（ODR/绩效）、类目机会扫描、竞品 ASIN 拆解",
      "- 广告报表解读（ACOS/TACOS/搜索词报告）、利润结构分析",
      "- 输出：月度运营诊断 + 增长机会清单"]),
    ("tiktok_analyst", "TikTok Shop 运营分析师", "TikTok Shop 国际版",
     "TikTok Shop 内容电商分析师",
     ["- 美区/东南亚 GMV 与类目趋势、爆品拆解（内容角度）",
      "- 达人生态分析：带货达人筛选、合作 ROI 评估",
      "- 直播/短视频数据复盘：GPM、转化率、内容效率",
      "- 输出：内容电商运营策略 + 达人合作清单"]),
]


def build_prompt(name: str, platform: str, persona: str, focus: list[str]) -> str:
    focus_text = "\n".join(focus)
    return (
        "# Role\n"
        f"你是 CrossBorder Ops 的{name}（{persona}），主攻平台：{platform}。\n\n"
        "# 平台运营要点\n"
        f"{focus_text}\n\n"
        "# 工作方式\n"
        "- 面向跨境电商运营场景，输出可执行、可核验的结果；\n"
        "- 数据类任务优先给出结构化结论（表格/JSON）；\n"
        "- 与团队其他 Agent 协作时，明确输出边界，便于汇总。\n\n"
        "# 输出规范\n"
        "- 简洁、专业、中文优先；\n"
        "- 涉及金额/数量给出具体数字与单位；\n"
        "- 涉及平台政策时标注风险提示。"
    )


def main() -> int:
    update = "--update" in sys.argv
    client = httpx.Client(base_url=PENGUIN_API, trust_env=False, timeout=30)
    resp = client.post("/api/auth/login", json={"userId": PENGUIN_USER_ID, "password": PENGUIN_PASSWORD})
    if resp.status_code != 200:
        print(f"登录失败: {resp.status_code} {resp.text[:100]}")
        return 1

    existing = {}
    for project in client.get("/api/projects").json().get("projects", []):
        if project["projectId"] == PROJECT_ID:
            for agent in client.get(f"/api/projects/{PROJECT_ID}/agents").json().get("agents", []):
                existing[agent["agentId"]] = agent

    created, updated, skipped = 0, 0, 0
    for agent_id, name, platform, persona, focus in AGENTS:
        aid = agent_id.replace("-", "_")  # penguin id 不允许连字符
        prompt = build_prompt(name, platform, persona, focus)
        if aid in existing:
            if update:
                resp = client.put(
                    f"/api/projects/{PROJECT_ID}/agents/{aid}/config",
                    json={"systemPrompt": prompt, "name": name},
                )
                if resp.status_code in (200, 201):
                    print(f"🔄 更新: {aid}（{name}）")
                    updated += 1
                else:
                    print(f"❌ 更新失败: {aid} -> {resp.status_code} {resp.text[:100]}")
            else:
                print(f"⏭️  跳过（已存在）: {aid}")
                skipped += 1
            continue
        resp = client.post(
            f"/api/projects/{PROJECT_ID}/agents",
            json={
                "agentId": aid,
                "name": name,
                "description": f"CrossBorder Ops {name}（{platform}）",
                "systemPrompt": prompt,
            },
        )
        if resp.status_code in (200, 201):
            print(f"✅ 创建: {aid}（{name}）")
            created += 1
        else:
            print(f"❌ 失败: {aid} -> {resp.status_code} {resp.text[:120]}")
    print(f"\n完成：新建 {created}，更新 {updated}，跳过 {skipped}，共 {len(AGENTS)}。")
    print("下一步：POST /api/fusion/team/sync 注册为子代理团队；"
          "POST /api/fusion/evaluate 评测（benchmark_id=dh-benchmark）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
