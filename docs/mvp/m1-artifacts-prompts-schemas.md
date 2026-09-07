# MVP-1 Artifacts、Prompts、Schemas 实施方案

日期：2026-09-03

## 1. 目标

MVP-1 固定长任务的文件协议。所有阶段只通过明确的输入产物、输出产物和 prompt 模板衔接，Temporal history 只保存状态、路径和摘要。

## 2. 交付文件

建议创建：

```text
apps/pi-agent-platform/
  artifacts/
    tasks/
      .gitkeep
  prompts/
    normalize-requirements.md
    analyze-requirements.md
    codegraph-impact.md
    write-implementation-plan.md
    write-tests.md
    implement-code.md
    fix-test-failures.md
    review-diff.md
    publish-final-report.md
  schemas/
    requirements.schema.json
    impact.schema.json
    implementation-plan.schema.json
    test-cases.schema.json
    test-result.schema.json
    final-report.schema.json
  src/
    artifacts/
      ArtifactStore.ts
      LocalArtifactStore.ts
      TaskArtifactPaths.ts
    __tests__/
      artifacts/
        task-artifact-paths.test.ts
        local-artifact-store.test.ts
```

## 3. 任务目录结构

每个任务使用固定目录：

```text
artifacts/tasks/<task-id>/
  input.md
  task.json
  events.jsonl
  requirements.json
  requirements.md
  requirement-analysis.md
  codegraph-impact.json
  codegraph-impact.md
  implementation-plan.json
  implementation-plan.md
  test-cases.json
  test-cases.md
  implementation-notes.md
  diff.patch
  test-result.json
  test-output.log
  review.md
  final-report.json
  final-report.md
```

`events.jsonl` 每行一个事件：

```json
{"taskId":"TASK-MVP-001","stage":"normalize_requirements","event":"stage.completed","createdAt":"2026-09-03T08:00:00.000Z","summary":"Requirements normalized."}
```

## 4. ArtifactStore 接口

`ArtifactStore.ts`：

```ts
export interface ArtifactStore {
  ensureTask(taskId: string): Promise<void>;
  writeText(taskId: string, relativePath: string, content: string): Promise<void>;
  readText(taskId: string, relativePath: string): Promise<string>;
  writeJson<T>(taskId: string, relativePath: string, value: T): Promise<void>;
  readJson<T>(taskId: string, relativePath: string): Promise<T>;
  exists(taskId: string, relativePath: string): Promise<boolean>;
  appendEvent(taskId: string, event: TaskEvent): Promise<void>;
}

export interface TaskEvent {
  taskId: string;
  stage?: string;
  event: string;
  createdAt: string;
  summary: string;
  data?: Record<string, unknown>;
}
```

`TaskArtifactPaths.ts`：

```ts
export function taskArtifactRoot(taskId: string): string {
  return `artifacts/tasks/${taskId}`;
}

export function taskArtifactPath(taskId: string, filename: string): string {
  return `${taskArtifactRoot(taskId)}/${filename}`;
}
```

## 5. JSON Schema 最小字段

`requirements.schema.json` 必须要求：

```json
{
  "type": "object",
  "required": ["background", "goals", "non_goals", "functional_requirements", "constraints", "acceptance_criteria", "open_questions"],
  "properties": {
    "background": { "type": "string" },
    "goals": { "type": "array", "items": { "type": "string" } },
    "non_goals": { "type": "array", "items": { "type": "string" } },
    "functional_requirements": { "type": "array", "items": { "type": "string" } },
    "non_functional_requirements": { "type": "array", "items": { "type": "string" } },
    "constraints": { "type": "array", "items": { "type": "string" } },
    "acceptance_criteria": { "type": "array", "items": { "type": "string" } },
    "open_questions": { "type": "array", "items": { "type": "string" } }
  },
  "additionalProperties": false
}
```

`impact.schema.json` 必须要求：

```json
{
  "type": "object",
  "required": ["entrypoints", "symbols", "callers", "callees", "affected_files", "test_targets", "risks"],
  "properties": {
    "entrypoints": { "type": "array", "items": { "type": "string" } },
    "symbols": { "type": "array", "items": { "type": "string" } },
    "callers": { "type": "array", "items": { "type": "string" } },
    "callees": { "type": "array", "items": { "type": "string" } },
    "affected_files": { "type": "array", "items": { "type": "string" } },
    "test_targets": { "type": "array", "items": { "type": "string" } },
    "risks": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["level", "description"],
        "properties": {
          "level": { "type": "string", "enum": ["low", "medium", "high"] },
          "description": { "type": "string" }
        },
        "additionalProperties": false
      }
    }
  },
  "additionalProperties": false
}
```

`test-result.schema.json` 必须要求：

```json
{
  "type": "object",
  "required": ["passed", "commands", "failed_tests", "log_file"],
  "properties": {
    "passed": { "type": "boolean" },
    "commands": { "type": "array", "items": { "type": "string" } },
    "failed_tests": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["name", "message"],
        "properties": {
          "name": { "type": "string" },
          "message": { "type": "string" }
        },
        "additionalProperties": false
      }
    },
    "log_file": { "type": "string" }
  },
  "additionalProperties": false
}
```

`implementation-plan.schema.json` 必须要求：

```json
{
  "type": "object",
  "required": ["summary", "files_to_change", "steps", "test_strategy", "risks", "rollback"],
  "properties": {
    "summary": { "type": "string" },
    "files_to_change": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["path", "reason", "change_type"],
        "properties": {
          "path": { "type": "string" },
          "reason": { "type": "string" },
          "change_type": { "type": "string", "enum": ["create", "modify", "delete"] }
        },
        "additionalProperties": false
      }
    },
    "steps": { "type": "array", "items": { "type": "string" } },
    "test_strategy": { "type": "array", "items": { "type": "string" } },
    "risks": { "type": "array", "items": { "type": "string" } },
    "rollback": { "type": "string" }
  },
  "additionalProperties": false
}
```

`test-cases.schema.json` 必须要求：

```json
{
  "type": "object",
  "required": ["cases"],
  "properties": {
    "cases": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["name", "requirement", "type", "expected"],
        "properties": {
          "name": { "type": "string" },
          "requirement": { "type": "string" },
          "type": { "type": "string", "enum": ["unit", "integration", "e2e", "manual"] },
          "expected": { "type": "string" }
        },
        "additionalProperties": false
      }
    }
  },
  "additionalProperties": false
}
```

`final-report.schema.json` 必须要求：

```json
{
  "type": "object",
  "required": ["task_id", "status", "summary", "changed_files", "test_commands", "test_passed", "risks"],
  "properties": {
    "task_id": { "type": "string" },
    "status": { "type": "string", "enum": ["completed", "failed", "blocked"] },
    "summary": { "type": "string" },
    "changed_files": { "type": "array", "items": { "type": "string" } },
    "test_commands": { "type": "array", "items": { "type": "string" } },
    "test_passed": { "type": "boolean" },
    "risks": { "type": "array", "items": { "type": "string" } }
  },
  "additionalProperties": false
}
```

## 6. Prompt 模板规范

每个 prompt 必须包含这些段落：

```text
# Stage
# Inputs
# Required Outputs
# Allowed Tools
# Sandbox
# Forbidden Actions
# Completion Criteria
```

`prompts/normalize-requirements.md`：

```markdown
# Stage

You are running the normalize_requirements stage for task ${taskId}.

# Inputs

- ${artifactRoot}/input.md

# Required Outputs

- ${artifactRoot}/requirements.json
- ${artifactRoot}/requirements.md

# Allowed Tools

- read_file
- write_artifact only for the required output paths

# Sandbox

read-only for repository source files. Artifact writes are allowed only for declared required outputs.

# Forbidden Actions

- Do not change code.
- Do not create branches.
- Do not install dependencies.
- Do not continue implementation if open questions remain.

# Completion Criteria

- requirements.json matches schemas/requirements.schema.json.
- requirements.md contains background, goals, non-goals, constraints, acceptance criteria, and open questions.
```

`prompts/implement-code.md`：

```markdown
# Stage

You are running the implement_code stage for task ${taskId}.

# Inputs

- ${artifactRoot}/requirements.json
- ${artifactRoot}/codegraph-impact.json
- ${artifactRoot}/implementation-plan.md
- ${worktreePath}

# Required Outputs

- ${artifactRoot}/implementation-notes.md
- ${artifactRoot}/diff.patch

# Allowed Tools

- read_file
- write_file
- patch
- terminal for local inspection and test commands

# Sandbox

workspace-write. Only modify files inside ${worktreePath}.

# Forbidden Actions

- Do not push to remote.
- Do not create PRs.
- Do not modify CI unless approval includes modify_ci.
- Do not install dependencies unless approval includes install_dep.
- Do not make unrelated refactors.

# Completion Criteria

- Code changes match implementation-plan.md.
- diff.patch contains the current git diff.
- implementation-notes.md lists changed files and key decisions.
```

## 7. 测试任务拆解

### Task M1-1：Artifact Paths

验证点：

- `taskArtifactRoot("TASK-1")` 返回 `artifacts/tasks/TASK-1`。
- `taskArtifactPath("TASK-1", "input.md")` 返回 `artifacts/tasks/TASK-1/input.md`。
- task id 为空字符串时报错。

测试命令：

```bash
pnpm vitest run src/__tests__/artifacts/task-artifact-paths.test.ts
```

### Task M1-2：Local Artifact Store

验证点：

- `ensureTask()` 创建任务目录。
- `writeText()` 和 `readText()` 往返一致。
- `writeJson()` 写入格式化 JSON。
- `appendEvent()` 追加 JSONL，不覆盖既有事件。

测试命令：

```bash
pnpm vitest run src/__tests__/artifacts/local-artifact-store.test.ts
```

### Task M1-3：Schema Fixtures

创建 fixtures：

```text
src/__tests__/fixtures/
  valid-requirements.json
  invalid-requirements-missing-goals.json
  valid-impact.json
  invalid-impact-risk-level.json
  valid-test-result.json
  valid-final-report.json
```

验证点：

- valid fixtures 通过 AJV 校验。
- invalid fixtures 给出字段级错误。

测试命令：

```bash
pnpm vitest run src/__tests__/capability/output-validator.test.ts
```

## 8. MVP-1 完成标准

运行：

```bash
pnpm vitest run src/__tests__/artifacts src/__tests__/capability/output-validator.test.ts
```

必须全部通过。随后手工创建：

```text
artifacts/tasks/TASK-MVP-001/input.md
```

运行：

```bash
pnpm pi-agent-platform run-stage normalize_requirements --task TASK-MVP-001 --runtime mock
pnpm pi-agent-platform run-stage publish_final_report --task TASK-MVP-001 --runtime mock
```

期望：

- 所有 required artifact 文件存在。
- JSON 产物通过 schema 校验。
- `events.jsonl` 至少包含两个 `stage.completed` 事件。
