# Pi Agent Platform

基于 AI Agent 的长工程任务自动化平台 — 通过 Temporal 工作流编排需求分析、代码实现、测试验证和代码审查的完整软件开发闭环。

## 架构

```mermaid
flowchart LR
    CLI[CLI / API] --> WF[Temporal Workflow<br/>9 阶段编排]
    WF --> CB[Capability Binding<br/>Manifest · 沙箱 · 校验]
    WF --> RT[Agent Runtime]
    RT --> Mock[MockRuntime]
    RT --> PiAgent[PiAgentRuntime]
    RT --> PiCLI[PiCliRuntime]
    RT --> Codex[CodexRuntime]
    RT --> WS[Workspace<br/>Git Worktree]
```

## 技术栈

TypeScript 5.7 + Node.js 22 · pnpm · Temporal · Vitest · AJV · Commander · execa · Pi Agent SDK

## 目录

```
pi-agent-platform/
├── src/
│   ├── activities/       Temporal Activities（阶段执行、测试、工作区、报告）
│   ├── agent-runtimes/   Agent 运行时抽象（Mock / PiAgent / PiCLI / Codex）
│   ├── capability/       能力绑定（Manifest、沙箱、MCP、Skill、输出校验）
│   ├── cli/              CLI 命令（create-task / run-stage / run-mvp / workflow）
│   ├── stages/           阶段执行器 + Prompt 组装
│   ├── testing/          测试命令解析 + 执行
│   ├── workflows/        Temporal 12 阶段工作流
│   ├── workspace/        Git Worktree 管理
│   └── __tests__/        19 个测试文件，93 个用例
├── prompts/              9 个阶段 Prompt 模板
├── schemas/              6 个 JSON Schema
├── skills/               Skill 文件
└── manifests/            9 个阶段 Manifest 配置
```

## 工作流阶段

| # | 阶段 | 沙箱级别 |
|---|------|---------|
| 1 | normalize_requirements | read-only |
| 2 | analyze_requirements | read-only |
| 3 | codegraph_impact | read-only (MCP) |
| 4 | write_implementation_plan | read-only |
| 5 | write_tests | workspace-write |
| 6 | implement_code | workspace-write |
| 7 | fix_test_failures | workspace-write（最多 3 轮） |
| 8 | review_diff | read-only |
| 9 | publish_final_report | read-only |

## 快速开始

```bash
cd pi-agent-platform
pnpm install
pnpm build
pnpm test                    # 运行测试
pnpm pi-agent-platform run-mvp --task TASK-001 --runtime mock   # Mock 端到端
pnpm pi-agent-platform run-stage --task TASK-001 --stage normalize_requirements --runtime mock
```

## 产物

任务产物在 `artifacts/tasks/<task-id>/`：`requirements.json`、`implementation-plan.json`、`codegraph-impact.json`、`test-result.json`、`diff.patch`、`final-report.md`、`events.jsonl`

## 状态

MVP 已完成：MockRuntime 全链路端到端闭环、Temporal 审批/重试、CLI 全套命令。待完成：PiAgentRuntime 真实执行、Temporal 生产部署、Web UI、GitHub PR 集成。