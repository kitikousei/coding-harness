# Codex + Temporal 长任务工程方案

日期：2026-09-03

## 1. 目标

构建一个可恢复、可审计、可人工介入的长任务工程流程，用于处理从需求输入到代码实现、测试验证、报告输出的完整软件改造任务。

该方案将 Temporal 作为可靠任务编排层，将 Codex 作为智能工程执行器，将 CodeGraph 作为结构化代码理解工具。

## 2. 总体结论

推荐方案：

```text
Temporal 负责长任务状态机、重试、超时、人工审批、恢复和审计。
Codex 负责需求理解、代码分析、计划生成、测试设计、编码、测试修复和报告生成。
CodeGraph 负责结构化代码检索、调用链分析和影响面评估。
Git branch / worktree 负责代码变更隔离。
```

不要让 Codex 自己承担生产级长任务状态管理，也不要让 Temporal 参与代码理解和代码生成。两者的边界应保持清晰：

- Temporal 是可靠编排器。
- Codex 是阶段性工程执行器。
- CodeGraph 是代码结构知识图谱。

## 3. 推荐架构

```text
User / Issue / PRD / Ticket
  -> Temporal Workflow: LongFeatureTaskWorkflow
      -> Activity: normalize_requirements
      -> Human Gate: approve_requirements
      -> Activity: codex_requirement_analysis
      -> Activity: codex_codegraph_impact_analysis
      -> Activity: codex_write_implementation_plan
      -> Human Gate: approve_plan
      -> Activity: create_branch_or_worktree
      -> Activity: codex_write_or_update_tests
      -> Activity: codex_implement_code
      -> Activity: run_unit_tests
      -> Loop: codex_fix_test_failures, max_attempts = 3
      -> Activity: codex_review_diff
      -> Activity: publish_test_report
      -> Workflow Complete
```

## 4. 职责边界

### 4.1 Temporal 负责

- 创建任务实例和任务 ID。
- 保存任务阶段状态。
- 调度每个阶段的 Activity。
- 处理 Activity 超时、失败和重试。
- 等待人工审批。
- 支持取消、暂停、恢复。
- 管理并行子任务。
- 保存审计轨迹。
- 对外提供任务状态查询。

### 4.2 Codex 负责

- 从原始需求中提取结构化需求。
- 阅读并解释需求。
- 使用 CodeGraph 分析相关代码。
- 输出改造计划。
- 输出测试用例。
- 创建或更新测试。
- 编写业务代码。
- 运行或辅助运行测试。
- 根据失败日志修复问题。
- 输出最终测试报告和风险说明。

### 4.3 CodeGraph 负责

- 查找 symbol 定义。
- 分析调用方和被调用方。
- 获取关键类、函数、模块上下文。
- 评估修改影响面。
- 减少 Codex 通过 grep 和全文读取进行盲目探索。

### 4.4 Git / Worktree 负责

- 将每个任务的代码改动隔离到独立分支或 worktree。
- 避免多个长任务同时修改同一工作区。
- 支持生成 patch、提交 commit、创建 PR。

## 5. 状态机设计

建议 Workflow 状态：

```text
created
requirements_normalized
requirements_pending_approval
requirements_approved
requirements_rejected
code_analyzed
plan_written
plan_pending_approval
plan_approved
branch_created
tests_written
implementation_started
implementation_done
tests_running
tests_failed
fixing_tests
tests_passed
review_done
report_published
completed
failed
cancelled
```

最小主路径：

```text
created
 -> requirements_normalized
 -> requirements_approved
 -> code_analyzed
 -> plan_written
 -> plan_approved
 -> branch_created
 -> tests_written
 -> implementation_done
 -> tests_passed
 -> report_published
 -> completed
```

## 6. 阶段产物

每个长任务建议有独立目录：

```text
docs/tasks/<task-id>/
  input.md
  requirements.json
  requirements.md
  requirement-analysis.md
  codegraph-impact.json
  codegraph-impact.md
  implementation-plan.md
  test-cases.md
  implementation-notes.md
  test-output.log
  review.md
  test-report.md
  final-report.md
```

大日志和中间输出不要全部塞进 Temporal Workflow history。Temporal 只保存路径、摘要、状态和少量结构化字段；大内容放文件系统、对象存储或制品仓库。

## 7. Codex 调用方式

生产编排建议优先使用 `codex exec --json` 或 Codex SDK，而不是依赖交互式 UI。

### 7.1 需求提取

```bash
codex exec --json \
  --sandbox read-only \
  --output-schema ./schemas/requirements.schema.json \
  "Read docs/tasks/TASK-123/input.md and extract normalized requirements."
```

输出：

```json
{
  "background": "...",
  "goals": [],
  "non_goals": [],
  "functional_requirements": [],
  "non_functional_requirements": [],
  "constraints": [],
  "acceptance_criteria": [],
  "open_questions": []
}
```

### 7.2 CodeGraph 影响分析

```bash
codex exec --json \
  --sandbox read-only \
  --output-schema ./schemas/impact.schema.json \
  "Use CodeGraph to analyze implementation impact for docs/tasks/TASK-123/requirements.json."
```

Codex 在该阶段应优先使用 CodeGraph：

```text
查找定义：codegraph_search / codegraph_explore
获取上下文：codegraph_context
查看调用方：codegraph_callers
查看依赖：codegraph_callees
评估影响面：codegraph_impact
```

如果项目没有 `.codegraph/`，Codex 应停止并提示先执行：

```bash
codegraph init -i
```

### 7.3 改造计划

```bash
codex exec --json \
  --sandbox read-only \
  --output-schema ./schemas/implementation-plan.schema.json \
  "Write an implementation plan using requirements and CodeGraph impact files under docs/tasks/TASK-123."
```

计划必须包含：

- 修改文件列表。
- 修改步骤。
- API / 数据结构 / 行为变化。
- 测试计划。
- 风险点。
- 回滚方式。

### 7.4 编码

编码阶段才开放写权限：

```bash
codex exec --json \
  --sandbox workspace-write \
  "Implement the approved plan in docs/tasks/TASK-123/implementation-plan.md. Keep edits scoped. Run relevant tests."
```

### 7.5 测试修复循环

```bash
codex exec --json \
  --sandbox workspace-write \
  "Tests failed. Read docs/tasks/TASK-123/test-output.log, identify the root cause, make the smallest fix, and rerun relevant tests."
```

建议最大修复次数：

```text
max_fix_attempts = 3
```

超过次数后进入人工处理：

```text
tests_failed_needs_human
```

## 8. Temporal Workflow 伪代码

```ts
export async function LongFeatureTaskWorkflow(input: LongTaskInput) {
  const task = await createTaskWorkspace(input);

  const requirements = await normalizeRequirements(task);
  await waitForApproval("requirements", requirements);

  const analysis = await analyzeRequirements(task);
  const impact = await analyzeCodeWithCodeGraph(task);

  const plan = await writeImplementationPlan(task, analysis, impact);
  await waitForApproval("implementation_plan", plan);

  await createBranchOrWorktree(task);
  await writeOrUpdateTests(task);
  await implementCode(task);

  for (let attempt = 1; attempt <= 3; attempt++) {
    const testResult = await runUnitTests(task);

    if (testResult.passed) {
      await reviewDiff(task);
      await publishTestReport(task, testResult);
      return { status: "completed", taskId: task.id };
    }

    await fixTestFailures(task, testResult, attempt);
  }

  await publishTestReport(task, { passed: false });
  return { status: "failed", reason: "tests_failed_after_retries", taskId: task.id };
}
```

## 9. Activity 设计

### 9.1 CodexActivity

输入：

```json
{
  "task_id": "TASK-123",
  "cwd": "/repo/worktree/TASK-123",
  "prompt_file": "docs/tasks/TASK-123/prompts/impact.md",
  "sandbox": "read-only",
  "output_schema": "schemas/impact.schema.json",
  "output_file": "docs/tasks/TASK-123/codegraph-impact.json"
}
```

输出：

```json
{
  "status": "succeeded",
  "thread_id": "...",
  "output_file": "docs/tasks/TASK-123/codegraph-impact.json",
  "summary": "...",
  "usage": {
    "input_tokens": 0,
    "output_tokens": 0
  }
}
```

失败输出：

```json
{
  "status": "failed",
  "error_type": "codex_failed",
  "message": "...",
  "log_file": "docs/tasks/TASK-123/codex-error.log",
  "retryable": true
}
```

### 9.2 GitActivity

职责：

- 创建分支。
- 创建 worktree。
- 应用 patch。
- 提交 commit。
- 推送远端分支。
- 创建 PR。

建议分支名：

```text
feature/<task-id>-<short-slug>
```

### 9.3 TestActivity

职责：

- 识别项目测试命令。
- 执行单元测试。
- 记录 stdout / stderr。
- 输出结构化测试结果。

输出：

```json
{
  "passed": false,
  "commands": ["npm test"],
  "failed_tests": [],
  "log_file": "docs/tasks/TASK-123/test-output.log"
}
```

## 10. 人工审批设计

建议至少保留两个审批点：

```text
需求审批：approve_requirements
计划审批：approve_plan
```

可选审批点：

```text
测试用例审批
代码 diff 审批
PR 创建审批
```

审批输入：

```json
{
  "task_id": "TASK-123",
  "stage": "implementation_plan",
  "decision": "approved",
  "comment": "计划通过，注意兼容旧 API。"
}
```

Workflow 收到审批后继续执行。被拒绝时回到对应阶段重写产物。

## 11. 并行化策略

适合并行：

- 需求格式化与背景资料摘要。
- 多模块 CodeGraph 影响分析。
- 测试用例设计。
- 文档/API 资料查证。
- diff review、安全 review、测试缺口 review。

不建议并行：

- 多个 agent 同时写同一代码区。
- 没有计划审批前直接编码。
- 测试失败后多个 agent 同时修复同一失败。

推荐并行结构：

```text
主 Workflow
  -> Child Workflow: requirements workflow
  -> Child Workflow: code analysis workflow
  -> Child Workflow: test design workflow
  -> Join
  -> implementation workflow
```

## 12. 错误处理与恢复

### 12.1 Codex 调用失败

处理方式：

- 捕获退出码。
- 保存 Codex JSONL 事件流。
- 保存最终错误消息。
- 标记是否可重试。
- 可重试错误由 Temporal 自动重试。

可重试：

- 网络超时。
- 模型服务临时不可用。
- MCP server 启动慢。
- 测试环境临时失败。

不可重试：

- 需求缺失。
- CodeGraph 未初始化。
- 权限不足。
- Git 冲突需要人工判断。
- 测试失败超过最大修复次数。

### 12.2 测试失败

流程：

```text
run tests
  -> failed
  -> codex analyze root cause
  -> smallest fix
  -> rerun relevant tests
  -> rerun full target test suite
```

要求：

- 先分析根因，再修改。
- 每次修复要记录原因。
- 超过 `max_fix_attempts` 停止并交给人工。

### 12.3 Workflow 恢复

Temporal 恢复后应根据阶段产物判断是否跳过已完成步骤。例如：

```text
requirements.json exists and valid -> skip normalize_requirements
implementation-plan.md approved -> skip plan generation
branch exists -> skip create_branch
```

Activity 应尽量幂等。

## 13. 安全与权限

Codex sandbox 建议：

```text
需求提取：read-only
需求理解：read-only
CodeGraph 分析：read-only
计划生成：read-only
测试用例设计：read-only 或 workspace-write
编码：workspace-write
测试：workspace-write
提交/推送/PR：需要显式授权
```

原则：

- 默认只读。
- 只有编码阶段开放写权限。
- Git push / PR / 删除文件 / 安装依赖需要人工审批或受控策略。
- 不把密钥放进 Codex prompt。
- CI 环境中不要把 OpenAI API key 暴露给测试命令或仓库脚本。

## 14. MVP 落地方案

第一版建议只做一个单 Worker 服务：

```text
apps/long-task-worker/
  src/workflows/LongFeatureTaskWorkflow.ts
  src/activities/CodexActivities.ts
  src/activities/GitActivities.ts
  src/activities/TestActivities.ts
  src/activities/ReportActivities.ts
  src/schemas/*.json
  src/prompts/*.md
```

MVP 能力：

- 接收一个任务输入文件。
- 创建任务目录。
- 调用 Codex 提取需求。
- 等待人工审批。
- 调用 Codex + CodeGraph 做影响分析。
- 生成改造计划。
- 等待人工审批。
- 创建分支。
- 调用 Codex 编码。
- 运行测试。
- 失败时最多自动修复 3 次。
- 输出最终报告。

暂不做：

- 多租户。
- Web UI。
- 复杂权限系统。
- 自动创建 PR。
- 多仓库事务。
- 大规模并发调度。

## 15. 推荐配置

### 15.1 AGENTS.md

在目标仓库根目录添加：

```md
## Long Task Workflow

For long-running feature work:

1. Extract and normalize requirements before reading code.
2. Use CodeGraph for structural code analysis when available.
3. Write an implementation plan before editing files.
4. Write or update tests before or alongside implementation.
5. Keep edits scoped to the approved plan.
6. Run relevant unit tests.
7. If tests fail, diagnose root cause before changing code again.
8. Produce a final report with changed files, test commands, test results, and remaining risks.

Do not skip planning or testing unless the user explicitly asks for a spike.
```

### 15.2 Codex MCP

目标仓库需要配置 CodeGraph MCP，并初始化索引：

```bash
codegraph init -i
```

如果使用项目级 Codex 配置，可在 `.codex/config.toml` 中配置 MCP server。

### 15.3 Codex 输出 Schema

至少准备：

```text
requirements.schema.json
impact.schema.json
implementation-plan.schema.json
test-result.schema.json
final-report.schema.json
```

## 16. 验收标准

一个任务完成时必须满足：

- 需求已结构化。
- 需求已被审批或明确无需审批。
- CodeGraph 影响分析已完成。
- 改造计划已生成并审批。
- 代码改动位于独立分支或 worktree。
- 测试用例已记录。
- 单元测试已运行。
- 测试失败时有修复记录。
- 最终报告已输出。
- 剩余风险已明确列出。

## 17. 最终推荐

如果这是团队级、可复用的长任务能力，推荐路线：

```text
Temporal Workflow + Codex SDK / codex exec + CodeGraph MCP + Git worktree
```

如果只是个人本地使用，简化路线：

```text
Codex /goal + AGENTS.md + CodeGraph MCP + 手动 Git branch
```

如果要接入平台、审批、任务看板、CI、PR，则使用完整路线：

```text
Temporal + Worker 服务 + Codex 非交互式调用 + CodeGraph + GitHub/GitLab API + 制品存储
```

核心原则：

```text
Temporal 管状态，Codex 干工程，CodeGraph 懂代码，Git 隔离变更。
```
