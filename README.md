# 🦌🐧 DeerHarness

**Fusion of PenguinHarness and DeerFlow — Self-evolving Agent construction meets robust multi-agent orchestration.**

DeerHarness 是 **PenguinHarness**（自进化 Agent 构建工具）与 **ByteDance DeerFlow**（长链路多智能体执行框架）的融合项目。

本项目旨在实现 Harness Engineering 的终极形态：

> **用 PenguinHarness 解决"Agent 从哪里来、如何变强"的问题，用 DeerFlow 解决"Agent 如何协作、如何稳定干活"的问题。**

两个上游项目分别对应 AI Agent 工程化链条上的互补环节：

| | PenguinHarness | DeerFlow |
|---|---|---|
| 定位 | "Agent 工厂 + 训练场" | "Agent 操作系统 + 工作台" |
| 解决痛点 | Agent 开发成本高、迭代慢、难以自动优化 | 长任务中 Agent 易失忆、上下文混乱 |
| 核心理念 | 让 Agent 自己造 Agent，还能自己变强 | 让 Agent 自己跑几个小时，也能跑对 |
| 上游仓库 | [Prism-Shadow/penguin-harness](https://github.com/Prism-Shadow/penguin-harness) | [bytedance/deer-flow](https://github.com/bytedance/deer-flow) |
| 许可证 | Apache-2.0 | MIT |

## 🌟 核心特性

- **🔄 自进化闭环**：DeerFlow 产生的真实执行轨迹（Trace）自动反馈给 PenguinHarness，实现 Agent 的持续自我优化，形成"生产 — 反馈 — 进化 — 灰度发布"飞轮。
- **🏗️ 松耦合架构**：PenguinHarness 作为 Agent Provider，DeerFlow 作为 Orchestrator & Runtime，通过标准 API / MCP 接口通信，无需硬合并上游源码。
- **🛡️ 生产级稳定性**：结合 DeerFlow 的沙箱执行、长期记忆与安全护栏（Guardrails），确保复杂任务的稳定交付。
- **📡 双上游同步**：同时关联两个上游仓库，可持续同步官方更新。

## 🏛️ 架构说明

```
┌─────────────────────────────────────────────────────────────┐
│                        Data Pipeline                        │
│   Trace 收集器 → 反馈过滤器 → 进化队列 → 灰度发布             │
└─────────────────────────────────────────────────────────────┘
        ▲                                                        │
        │ 执行反馈（任务目标 / 工具调用链 / 产出 / 评分）          │ 新版 Agent
        │                                                        ▼
┌───────────────────────┐              ┌──────────────────────────────┐
│  Agent Factory        │   API/MCP    │  Orchestrator & Runtime      │
│  (PenguinHarness)     │ ◄──────────► │  (DeerFlow)                  │
│  · 低成本生成 Agent    │              │  · LangGraph 多智能体编排     │
│  · 版本管理            │              │  · 沙箱 / 权限控制            │
│  · 自进化训练          │              │  · 长期记忆 / 技能插件        │
└───────────────────────┘              └──────────────────────────────┘
```

1. **Agent Factory (PenguinHarness)**：负责低成本生成、版本管理和自进化训练，输出符合子代理规范的 Agent 定义（System Prompt、Tools 列表、Memory Schema）。
2. **Execution Runtime (DeerFlow)**：负责多智能体编排、工具调用、状态机管理和安全护栏；新增 `DynamicAgentLoader` 节点按需拉取最新优化的 Agent。
3. **Data Pipeline**：Trace 收集器 → 反馈过滤器 → 进化队列 → 灰度发布（如 10% 流量切新版，对比指标后全量）。

## 📁 目录结构

```
deerHarness/
├── main.py                    # 入口：离线演示数据闭环
├── config.example.yaml        # 配置示例（Agent Factory / Orchestrator / Pipeline）
├── requirements.txt           # 运行时依赖
├── deerharness/
│   ├── config.py              # 配置加载
│   ├── models.py              # 数据契约：AgentSpec / TraceRecord / EvolutionJob
│   ├── pipeline.py            # 数据闭环：Trace 收集 → 反馈过滤 → 进化队列 → 灰度发布
│   ├── agent_factory.py       # PenguinHarness 客户端（Agent Provider）
│   └── orchestrator.py        # DeerFlow 集成：DynamicAgentLoader 按需加载
├── README.md                  # 项目说明
├── LICENSE                    # 许可证（待确认上游兼容性后补充）
└── .gitignore                 # 忽略规则
```

## 🚀 快速开始

```bash
# 1. 安装依赖
pip install -r requirements.txt

# 2. 离线演示数据闭环（不访问任何外部服务）
python main.py demo

# 3. 接入真实服务：复制配置并修改
cp config.example.yaml config.yaml
#    编辑 config.yaml：填入你的 PenguinHarness / DeerFlow 服务地址
python main.py demo --config config.yaml
```

`demo` 模式会完整演示融合架构的核心闭环：Trace 反馈过滤 → 动态加载 Agent（灰度/稳定分流）→ 进化任务触发 → 灰度观察与全量发布。

## 🔄 同步上游更新

本项目基于两个上游仓库融合，可随时拉取官方更新：

```bash
# 查看已关联的仓库
git remote -v

# 同步 PenguinHarness 的更新
git fetch upstream-penguin
git merge upstream-penguin/main --allow-unrelated-histories

# 同步 DeerFlow 的更新
git fetch upstream-deerflow
git merge upstream-deerflow/main --allow-unrelated-histories
```

## 🗺️ 路线图

| 阶段 | 目标 | 关键动作 |
|---|---|---|
| **Phase 0: 验证** | 跑通最小闭环 | 选 1 个简单子任务，用 PenguinHarness 生成 Agent，手动导入 DeerFlow 替换原节点，对比效果 |
| **Phase 1: 自动化** | 打通数据流 | 部署 Trace 收集器 + 反馈过滤器，实现 DeerFlow → PenguinHarness 数据自动同步 |
| **Phase 2: 自适应** | 动态路由 | 按任务复杂度/类型动态选择不同版本的 Agent，达到成本与效果最优平衡 |
| **Phase 3: 自洽** | 端到端自治 | PenguinHarness 基于执行瓶颈自动生成新 Tool / 优化 Prompt 模板，形成完全自主的改进循环 |

## 🛡️ 避坑指南

- **进化污染执行**：对进化版 Agent 输出做二次校验，保留安全护栏，不因追求进化指标牺牲生产稳定性。
- **版本一致性**：以"Agent 团队"为单位联合进化，避免单个子代理进化导致协作协议破裂。
- **成本失控**：设置进化预算上限，与业务价值挂钩（如任务周执行 >1000 次且成功率 <80% 才触发进化）。
- **许可证合规**：融合前确认两个上游许可证兼容性（详见 LICENSE）。

## 🤝 贡献指南

欢迎提交 Issue 和 Pull Request！请确保你的贡献不影响与上游的同步能力。

## 📄 许可证

本项目为两个上游开源项目的融合：

- **PenguinHarness**：[Apache-2.0](https://github.com/Prism-Shadow/penguin-harness)
- **DeerFlow**：[MIT](https://github.com/bytedance/deer-flow)

两者均为宽松许可证（permissive），可兼容使用。本项目融合代码的许可证待正式确定后补充（详见 [LICENSE](LICENSE)）。
