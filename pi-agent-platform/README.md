# Pi Agent Platform

基于 AI Agent 的长工程任务自动化平台，通过 Temporal 工作流编排需求分析、代码实现、测试验证和代码审查的完整软件开发闭环。

## 架构

```
┌─────────────────────────────────────────────────────────┐
│                      CLI / API                          │
│  create-task │ run-stage │ run-mvp │ approve │ workflow │
├─────────────────────────────────────────────────────────┤
│                  Temporal Workflow                       │
│          LongEngineeringTaskWorkflow                     │
├──────┬──────┬──────┬──────┬──────┬──────┬──────┬───────┤
│Stage │Stage │Stage │Stage │Stage │Stage │Stage │ Stage │
│  1   │  2   │  3   │  4   │  5   │  6   │  7   │  8    │
│Normalize│Analyze│Code-│Write │Write │Implement│Fix │Review │
│Req's │Req's │Graph │Plan  │Tests │ Code  │Tests │Diff  │
├──────┴──────┴──────┴──────┴──────┴──────┴──────┴───────┤
│              Agent Runtime Layer                        │
│  MockRuntime │ PiAgentRuntime │ PiCliRuntime │ CodexRuntime
├─────────────────────────────────────────────────────────┤
│          Capability & Enforcement                       │
│  Manifest │ Registry │ Enforcer │ OutputValidator │ MCP │
├─────────────────────────────────────────────────────────┤
│              Workspace & Testing                        │
│  Git Worktree │ TestRunner │ TestCommandResolver        │
├─────────────────────────────────────────────────────────┤
│              Artifacts & Reports                        │
│  ArtifactStore │ Schemas │ Prompts │ FinalReport        │
└─────────────────────────────────────────────────────────┘
```

## 技术选型

| 领域 | 技术 | 说明 |
|------|------|------|
| 语言 | TypeScript 5.7 + ESM | 类型安全，模块化管理 |
| 运行时 | Node.js 22 LTS | 长期支持版本 |
| 包管理 | pnpm | 快速、磁盘效率高 |
| 测试 | Vitest 3 | 快速、原生 ESM 支持 |
| 工作流 | Temporal TypeScript SDK | 分布式工作流，审批 signal，worker 重启恢复 |
| Schema 校验 | AJV 8 | JSON Schema 验证 |
| 进程调用 | execa 9 | 现代子进程管理 |
| CLI | Commander 13 | 命令行框架 |
| Agent SDK | @earendil-works/pi-coding-agent@0.83.0 | Pi 编码代理集成 |
| 代码理解 | CodeGraph MCP | 代码影响分析 |

## 代码目录结构

```
pi-agent-platform/
├── src/
│   ├── activities/              # Temporal Activities（工作流原子操作）
│   │   ├── stage-activities.ts    # 阶段执行、工作区准备
│   │   ├── test-activities.ts     # 测试执行
│   │   ├── workspace-activities.ts # 工作区管理
│   │   └── report-activities.ts   # Diff 采集、最终报告生成
│   │
│   ├── agent-runtimes/          # Agent 运行时抽象
│   │   ├── AgentRuntime.ts        # 接口定义 (AgentRunInput/Result)
│   │   ├── MockRuntime.ts         # Mock 实现，产出合规假数据
│   │   ├── PiAgentRuntime.ts      # Pi SDK 集成（custom tools、MCP、事件流）
│   │   ├── PiCliRuntime.ts        # Pi CLI 兼容模式
│   │   ├── CodexRuntime.ts        # OpenAI Codex CLI 集成
│   │   └── RuntimeFactory.ts      # 工厂函数
│   │
│   ├── artifacts/               # 产物管理
│   │   ├── LocalArtifactStore.ts  # 本地文件系统存储
│   │   └── TaskArtifactPaths.ts   # 路径工具函数
│   │
│   ├── capability/              # 能力绑定与沙箱
│   │   ├── StageCapabilityManifest.ts  # 阶段能力清单类型
│   │   ├── CapabilityRegistry.ts       # Manifest 加载与校验
│   │   ├── StageEnforcer.ts            # 工具白名单、沙箱拦截
│   │   ├── MCPServerManager.ts         # MCP 服务器生命周期
│   │   ├── SkillLoader.ts              # Skill 文件加载
│   │   ├── OutputValidator.ts          # 输出文件存在性/大小/Schema 校验
│   │   └── errors.ts                   # 结构化异常类
│   │
│   ├── cli/                     # 命令行接口
│   │   ├── index.ts               # 入口
│   │   ├── worker.ts              # Temporal Worker 启动
│   │   └── commands/
│   │       ├── create-task.ts     # 创建任务
│   │       ├── run-stage.ts       # 运行单个阶段
│   │       ├── run-mvp.ts         # 端到端 MVP 工作流
│   │       ├── approve.ts         # 审批命令
│   │       └── workflow.ts        # 工作流管理（start/status/signal/cancel）
│   │
│   ├── codegraph/               # CodeGraph 集成
│   │   └── CodeGraphCLI.ts        # CodeGraph CLI 封装
│   │
│   ├── stages/                  # 阶段执行
│   │   ├── runStage.ts            # 通用阶段执行器（8步协议）
│   │   ├── buildPrompt.ts         # Prompt 构建
│   │   ├── PromptAssembler.ts     # Prompt 组装
│   │   └── StageResult.ts         # 阶段结果类型
│   │
│   ├── testing/                 # 测试基础设施
│   │   ├── TestCommandResolver.ts # 自动识别测试命令
│   │   └── TestRunner.ts          # 执行测试、收集结果
│   │
│   ├── workflows/               # Temporal 工作流定义
│   │   └── LongEngineeringTaskWorkflow.ts  # 12阶段工作流
│   │
│   ├── workspace/               # 工作区管理
│   │   └── WorkspaceManager.ts    # Git Worktree 创建/diff采集/清理
│   │
│   └── __tests__/               # 单元测试（19文件，93测试）
│
├── prompts/                     # 9 个阶段 Prompt 模板
├── schemas/                     # 6 个 JSON Schema（requirements/impact/plan/tests/report）
├── skills/                      # Skill 文件
├── src/capability/manifests/    # 9 个阶段 Manifest 配置
│
├── package.json
├── tsconfig.json
└── README.md
```

## 功能清单

### 已完成

| 模块 | 功能 |
|------|------|
| **Capability Binding** | 9 阶段 Manifest 加载、工具白名单、沙箱三级（read-only/workspace-write/full-access）、敏感操作审批、MCP 服务器管理、Skill 加载、输出 Schema 校验 |
| **Artifacts & Prompts** | 任务级 artifact 目录、JSONL 事件流、6 个输出 Schema（AJV 校验）、9 个 Prompt 模板、Prompt 组装（含 skill 注入） |
| **Agent Runtimes** | MockRuntime（9 阶段全覆盖）、PiAgentRuntime（SDK 集成、custom write_artifact、CodeGraph tools、事件订阅）、PiCliRuntime（CLI 兼容）、CodexRuntime、RuntimeFactory |
| **Workflow** | Temporal 12 阶段工作流、approval signal（requirements/plan）、3 轮测试修复循环、worker 重启恢复、status query |
| **Workspace** | Git worktree 创建（feature/ 分支）、diff 采集、分支清理 |
| **Testing** | 自动识别测试命令（pnpm/npm/yarn/pytest/cargo/go test）、执行测试、保存日志和结构化结果 |
| **CLI** | create-task、run-stage、run-mvp（含 --wait-approval）、approve、workflow（start/status/signal/cancel）、codegraph |
| **Reports** | Diff 采集写入 diff.patch、Final Report 聚合生成（JSON + Markdown） |

### 工作流 9 个阶段

1. **normalize_requirements** - 将原始需求结构化（read-only）
2. **analyze_requirements** - 可行性、复杂度分析（read-only）
3. **codegraph_impact** - CodeGraph 影响分析（read-only，需 MCP）
4. **write_implementation_plan** - 编写改造计划（read-only）
5. **write_tests** - 编写测试用例（workspace-write）
6. **implement_code** - 代码实现（workspace-write）
7. **fix_test_failures** - 测试失败修复（最多 3 轮，workspace-write）
8. **review_diff** - 代码审查（read-only）
9. **publish_final_report** - 生成最终报告（read-only）

## 演进方向

### MVP 已完成
- 使用 MockRuntime 的完整端到端闭环
- PiAgentRuntime 只读阶段集成
- Temporal workflow 审批和重试机制
- CLI 全套命令

### 待完成
- **PiAgentRuntime 完整集成** - 接入本机 Pi Agent 实现写阶段（implement_code/write_tests）的真实执行
- **Temporal 生产部署** - 安装 Temporal Server，配置 worker 持久化运行
- **Web UI** - 任务创建、状态查看、审批操作的前端界面
- **GitHub PR 集成** - 自动生成 Pull Request
- **S3 Artifact Store** - 云端产物存储
- **多租户** - 任务隔离、成本统计
- **Cost Tracking** - Token 用量统计和计费

## 启动方式

### 环境准备

```bash
# Node.js 22+ 已安装
node --version

# 安装依赖
cd pi-agent-platform
pnpm install

# 构建 TypeScript
pnpm build
```

### 运行测试

```bash
pnpm test        # 一次性运行（19 文件，93 测试）
pnpm test:watch  # 监听模式
```

### CLI 使用

```bash
# 创建任务
pnpm pi-agent-platform create-task \
  --task TASK-001 \
  --repo /path/to/repo \
  --base main \
  --input ./input.md

# 运行端到端 MVP（自动审批）
pnpm pi-agent-platform run-mvp \
  --task TASK-001 \
  --runtime mock

# 运行端到端 MVP（人工审批）
pnpm pi-agent-platform run-mvp \
  --task TASK-001 \
  --runtime mock \
  --wait-approval

# 运行单个阶段
pnpm pi-agent-platform run-stage \
  --task TASK-001 \
  --stage normalize_requirements \
  --runtime mock

# 审批
pnpm pi-agent-platform approve \
  --task TASK-001 \
  --stage requirements \
  --decision approved

# 查看工作流状态
pnpm pi-agent-platform workflow status \
  --workflow-id pi-agent-TASK-001

# CodeGraph 代码分析
pnpm pi-agent-platform codegraph explore -p . -q "how does runStage work"
pnpm pi-agent-platform codegraph files -p .
```

### Temporal Worker（需要 Temporal Server）

```bash
# 安装 Temporal CLI
brew install temporal  # macOS
# 或从 https://docs.temporal.io/cli 安装

# 启动 Temporal Server
temporal server start-dev --db-filename /tmp/pi-agent-temporal-dev.db

# 在另一终端启动 Worker
pnpm worker
```

### 产物查看

任务产物存储在 `artifacts/tasks/<task-id>/` 目录：
- `input.md` - 原始需求输入
- `requirements.json` / `requirements.md` - 结构化需求
- `implementation-plan.json` / `implementation-plan.md` - 改造计划
- `codegraph-impact.json` / `codegraph-impact.md` - 影响分析
- `diff.patch` - 代码变更差异
- `test-result.json` / `test-output.log` - 测试结果
- `final-report.json` / `final-report.md` - 最终报告
- `events.jsonl` - 完整事件流
