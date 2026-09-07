# Pi Agent MVP 实施方案

日期：2026-09-03

## 1. 文档定位

本文是 `Pi Agent 二开方案` 的 MVP 执行入口。主方案保持架构、边界和决策说明，本目录承载可执行任务拆解、交付物、验收路径和阶段顺序。

阅读顺序：

```text
1. mvp/README.md
2. mvp/m0-capability-binding.md
3. mvp/m1-artifacts-prompts-schemas.md
4. mvp/m2-runtime-workspace-workflow.md
```

## 2. MVP 目标

MVP 要证明一条最小闭环可以稳定运行：

```text
输入需求
 -> 结构化需求
 -> 人工确认
 -> CodeGraph 影响分析
 -> 改造计划
 -> 人工确认
 -> 创建独立 worktree
 -> Runtime Adapter 执行实现阶段（MVP 先用 MockRuntime，随后接入本机 Pi Agent）
 -> 运行测试
 -> 最多 3 轮修复
 -> 输出 final-report.md
```

MVP 不追求复杂 UI、多租户、自动合并 PR、成本计费、插件市场和生产发布。

## 3. 技术假设

如果后续接入的真实 Pi Agent 仓库已有明确技术栈，以现有仓库为准；在没有现有实现约束时，MVP 默认采用：

```text
语言：TypeScript
运行时：Node.js 22 LTS
包管理：pnpm
测试：Vitest
Workflow：Temporal TypeScript SDK
Schema 校验：AJV
进程调用：execa
产物存储：本地文件系统
代码理解：CodeGraph MCP
Agent 执行：MockRuntime 先跑通，PiAgentRuntime 使用 Pi SDK custom-agent；PiCliRuntime/CodexRuntime 只作为可选兼容 adapter
```

说明：

- MVP 第一优先级是用 `MockRuntime` 跑通平台协议、workflow、artifact 和权限控制。
- 第二优先级是用 `PiAgentRuntime` 通过 `@earendil-works/pi-coding-agent` SDK 创建 custom-agent session，验证真实 agent 执行链路。
- `PiCliRuntime` 仅保留为本机 `pi` CLI 兼容模式；`CodexRuntime`、`HermesRuntime` 等只作为可选 adapter，不是 MVP 主路径。
- SDK runtime 的模型、认证、默认工具和沙箱能力必须以本机 Pi Agent 安装环境为准。

MVP 的工程根目录：

```text
apps/pi-agent-platform/
```

## 3.1 本机 Pi Agent 环境准备

MVP 默认通过 Pi SDK 集成。依赖版本固定在经验证的基线版本，避免自动漂移到未核对 API 的新版本：

安装：

```bash
pnpm add @earendil-works/pi-coding-agent@0.83.0 typebox
```

如果需要使用 `--runtime pi-cli` 兼容模式，再安装本机 CLI，并确认它能在目标 workspace 内以非交互方式完成一次只读任务：

```bash
npm install -g --ignore-scripts @earendil-works/pi-coding-agent@0.83.0
```

环境检查：

```bash
node --version
npm --version
command -v pi
pi --version
pi list
```

认证检查：

```bash
pi auth check --provider <provider> --json --no-refresh
```

其中 `<provider>` 按本机实际配置选择，例如 `google`、`openai`、`openai-codex`、`anthropic` 或其他 Pi 支持的 provider。

非交互只读 smoke test：

```bash
pi --mode json --print --no-session --tools read,grep,find,ls "List the files in the current project."
```

本机环境达到以下条件后，才进入 `PiAgentRuntime` 真实验收：

- `pi --version` 正常输出版本。
- 至少一个 provider 的 `pi auth check` 返回 ready。
- `pi --mode json --print` 可以完成只读任务。
- 如果 MVP 需要扩展/MCP 能力，`pi list` 或项目 `.pi/settings.json` 能显示对应 package 已安装。
- SDK runtime 已把 `codegraph-mcp` 的 `codegraph_context`、`codegraph_explore`、`codegraph_impact` 封装为只读 custom tools；其他 MCP server 配置仍会 fail-fast，需要先封装成 Pi extension/custom tool。

## 4. MVP 交付边界

必须交付：

| 能力 | MVP 交付形态 |
| --- | --- |
| 任务输入 | 本地 CLI 或 API 创建任务，写入 `artifacts/tasks/<task-id>/input.md` |
| 阶段协议 | `runStage()` 执行 manifest、工具白名单、沙箱、输出校验 |
| Capability Binding | 9 个阶段 manifest，至少 3 个阶段可真实运行 |
| 产物规范 | 任务目录、JSON Schema、prompt 模板和样例产物 |
| Runtime | `MockRuntime` 全链路；`PiAgentRuntime` 跑通需求提取和计划生成 |
| Workspace | 本地 repo checkout 或 worktree，生成 diff |
| 测试 | 自动执行配置的测试命令，保存日志和结构化结果 |
| Workflow | Temporal workflow 支持审批 signal、失败重试、worker 重启恢复 |
| 报告 | 聚合产物生成 `final-report.md` |

可延后：

| 能力 | 延后原因 |
| --- | --- |
| Web UI | CLI/API 足够验证闭环 |
| S3 Artifact Store | 本地文件系统足够验证协议 |
| GitHub PR | MVP 只要求生成 diff 和报告 |
| 多 Runtime 并发调度 | 先验证单任务串行闭环 |
| 成本统计 | 先保留 usage 字段，不做计费 |

## 5. 实施阶段

### MVP-0：Capability Binding

目标：让每个阶段先有可执行约束，而不是只依赖 prompt。

实施文档：`mvp/m0-capability-binding.md`

完成标准：

- `StageCapabilityManifest` 类型落地。
- 9 个阶段 manifest 可被加载。
- 未授权工具调用会被拦截。
- `read-only` 阶段不能写源码文件，只能写 manifest 声明的 artifact 输出。
- CodeGraph MCP 标记为 required 时，启动失败会让阶段进入 blocked。
- 输出文件缺失、过小或 schema 不通过时，阶段失败。

### MVP-1：Artifacts、Prompts、Schemas

目标：把 agent 每一步输入输出固定下来，避免长任务恢复时丢上下文。

实施文档：`mvp/m1-artifacts-prompts-schemas.md`

完成标准：

- 每个任务有独立 artifact 目录。
- `requirements.json`、`impact.json`、`test-result.json`、`final-report.json` 有 schema。
- 每个阶段有独立 prompt 模板。
- 可以不跑 agent，仅手工填文件完成一次文档流转。

### MVP-2：Runtime、Workspace、Workflow

目标：用最小运行时跑通端到端 POC。

实施文档：`mvp/m2-runtime-workspace-workflow.md`

完成标准：

- `MockRuntime` 可以跑完整 workflow。
- `PiAgentRuntime` 可以执行至少两个只读阶段：需求提取、改造计划。
- `PiAgentRuntime` 使用 custom `write_artifact` 工具，仅允许写 manifest 声明的输出文件。
- 每个任务使用独立 worktree。
- Temporal worker 重启后，任务从已完成阶段继续。
- 失败测试最多自动修复 3 次，超过后进入 `tests_failed_needs_human`。
- 产出 `final-report.md`、`diff.patch`、`test-output.log`。

## 6. 推荐任务顺序

```text
Task 1  建立 apps/pi-agent-platform TypeScript 工程骨架
Task 2  实现 StageCapabilityManifest 与 manifest loader
Task 3  实现 CapabilityRegistry 和 StageEnforcer
Task 4  实现 OutputValidator 与 schema 校验
Task 5  定义 artifacts 目录结构和 schema
Task 6  编写 9 个 prompt 模板
Task 7  实现 MockRuntime
Task 8  实现 runStage() 通用阶段执行器
Task 9  实现 WorkspaceManager 和 WorktreeManager
Task 10 实现 TestRunner
Task 11 接入 PiAgentRuntime 的只读阶段
Task 12 接入 Temporal workflow 和 approval signal
Task 13 跑通本地端到端 POC
Task 14 输出最终报告和 MVP 验收记录
```

## 7. MVP 验收场景

准备一个小型测试仓库，输入需求：

```text
为项目新增一个字符串 slugify 工具函数。
要求支持空格转横线、小写转换、去除首尾横线。
需要补充单元测试。
```

期望结果：

- 任务目录中生成完整阶段产物。
- CodeGraph 阶段能识别目标模块；如果测试仓库未初始化 CodeGraph，任务进入明确 blocked 状态。
- 计划阶段明确修改文件、测试文件和验证命令。
- 实现阶段只修改计划范围内文件。
- 测试命令执行并保存日志。
- 最终报告包含需求摘要、修改文件、测试结果、剩余风险。

## 8. 退出条件

满足以下条件后，MVP 才算完成：

- 使用 `MockRuntime` 的 workflow 端到端通过。
- 使用 `PiAgentRuntime` 的只读阶段通过。
- 至少一个真实 repo 的 worktree 创建、diff 采集、测试运行通过。
- 人工审批可以暂停和恢复 workflow。
- Worker 重启后任务状态没有丢失。
- 所有阶段产物可以从 artifact 目录恢复上下文。
- 每个失败状态都有明确错误原因和下一步动作。
