# MVP-0 Capability Binding 实施方案

日期：2026-09-03

## 1. 目标

MVP-0 负责把阶段能力、工具白名单、MCP、Skill、沙箱和输出校验落到代码层。完成后，任意阶段都必须先读取 manifest，再按统一协议执行。

## 2. 交付文件

建议创建：

```text
apps/pi-agent-platform/
  src/
    capability/
      StageCapabilityManifest.ts
      CapabilityRegistry.ts
      StageEnforcer.ts
      MCPServerManager.ts
      SkillLoader.ts
      OutputValidator.ts
      errors.ts
      manifests/
        normalize-requirements.json
        analyze-requirements.json
        codegraph-impact.json
        write-implementation-plan.json
        write-tests.json
        implement-code.json
        fix-test-failures.json
        review-diff.json
        publish-final-report.json
    __tests__/
      capability/
        capability-registry.test.ts
        stage-enforcer.test.ts
        output-validator.test.ts
        mcp-server-manager.test.ts
        skill-loader.test.ts
```

## 3. 核心接口

`StageCapabilityManifest.ts`：

```ts
export type SandboxLevel = "read-only" | "workspace-write" | "full-access";

export type SensitiveOperation =
  | "delete_file"
  | "install_dep"
  | "modify_ci"
  | "push_remote"
  | "create_pr";

export interface StageCapabilityManifest {
  stage: string;
  tools: {
    native: string[];
    mcp: string[];
    skills: string[];
  };
  mcpServers?: Array<{
    id: string;
    required: boolean;
  }>;
  sandbox: SandboxLevel;
  sensitiveOperations?: SensitiveOperation[];
  promptTemplate: string;
  outputs: Array<{
    path: string;
    schema?: string;
    required: boolean;
  }>;
  constraints: {
    maxAgentRuns: number;
    maxToolCallsPerRun: number;
    maxDurationMs: number;
    allowSubagents: boolean;
    requireOutputFile: boolean;
    validateOutputSchema: boolean;
  };
}
```

`CapabilityRegistry.ts`：

```ts
export interface CapabilityRegistry {
  loadManifest(stage: string): Promise<StageCapabilityManifest>;
  resolveAllowedTools(manifest: StageCapabilityManifest): string[];
  hasTool(toolName: string): boolean;
  hasMCPServer(serverId: string): boolean;
  hasSkill(skillName: string): boolean;
}
```

`StageEnforcer.ts`：

```ts
export interface StageEnforcer {
  assertToolAllowed(manifest: StageCapabilityManifest, toolName: string): void;
  assertSandboxAllows(
    manifest: StageCapabilityManifest,
    operation: "read_repo" | "write_repo" | "write_artifact" | "terminal"
  ): void;
  assertSensitiveOperationApproved(
    manifest: StageCapabilityManifest,
    operation: SensitiveOperation,
    approvedOperations: SensitiveOperation[]
  ): void;
}
```

沙箱语义：

| Sandbox | 允许 | 禁止 |
| --- | --- | --- |
| `read-only` | 读源码、写 manifest 声明的 artifact 输出 | 修改源码、运行会改变源码或环境的 terminal 命令 |
| `workspace-write` | 读源码、改 worktree、写 artifact、运行本地测试 | 推送远端、创建 PR、修改生产环境 |
| `full-access` | 仅在显式审批后开放敏感操作 | 默认不用于 MVP 自动阶段 |

## 4. Manifest 最小集

9 个阶段都必须有 manifest。MVP 中至少真实执行 `normalize_requirements`、`write_implementation_plan`、`publish_final_report`，其余阶段可以先由 `MockRuntime` 产出合规文件。

`normalize-requirements.json`：

```json
{
  "stage": "normalize_requirements",
  "tools": {
    "native": ["read_file", "write_artifact"],
    "mcp": [],
    "skills": []
  },
  "sandbox": "read-only",
  "promptTemplate": "prompts/normalize-requirements.md",
  "outputs": [
    {
      "path": "artifacts/tasks/${taskId}/requirements.json",
      "schema": "schemas/requirements.schema.json",
      "required": true
    },
    {
      "path": "artifacts/tasks/${taskId}/requirements.md",
      "required": true
    }
  ],
  "constraints": {
    "maxAgentRuns": 2,
    "maxToolCallsPerRun": 20,
    "maxDurationMs": 300000,
    "allowSubagents": false,
    "requireOutputFile": true,
    "validateOutputSchema": true
  }
}
```

`codegraph-impact.json`：

```json
{
  "stage": "codegraph_impact",
  "tools": {
    "native": ["read_file", "write_artifact"],
    "mcp": ["codegraph_context", "codegraph_explore", "codegraph_impact"],
    "skills": ["code-graphing"]
  },
  "mcpServers": [
    {
      "id": "codegraph-mcp",
      "required": true
    }
  ],
  "sandbox": "read-only",
  "promptTemplate": "prompts/codegraph-impact.md",
  "outputs": [
    {
      "path": "artifacts/tasks/${taskId}/codegraph-impact.json",
      "schema": "schemas/impact.schema.json",
      "required": true
    },
    {
      "path": "artifacts/tasks/${taskId}/codegraph-impact.md",
      "required": true
    }
  ],
  "constraints": {
    "maxAgentRuns": 2,
    "maxToolCallsPerRun": 40,
    "maxDurationMs": 600000,
    "allowSubagents": false,
    "requireOutputFile": true,
    "validateOutputSchema": true
  }
}
```

`implement-code.json`：

```json
{
  "stage": "implement_code",
  "tools": {
    "native": ["read_file", "write_file", "write_artifact", "patch", "terminal"],
    "mcp": [],
    "skills": []
  },
  "sandbox": "workspace-write",
  "sensitiveOperations": ["install_dep", "delete_file", "modify_ci"],
  "promptTemplate": "prompts/implement-code.md",
  "outputs": [
    {
      "path": "artifacts/tasks/${taskId}/implementation-notes.md",
      "required": true
    },
    {
      "path": "artifacts/tasks/${taskId}/diff.patch",
      "required": true
    }
  ],
  "constraints": {
    "maxAgentRuns": 1,
    "maxToolCallsPerRun": 120,
    "maxDurationMs": 1800000,
    "allowSubagents": false,
    "requireOutputFile": true,
    "validateOutputSchema": false
  }
}
```

完整 manifest 配置表：

| Stage | Native tools | MCP tools | Skills | Sandbox | Outputs | Constraints |
| --- | --- | --- | --- | --- | --- | --- |
| `normalize_requirements` | `read_file`, `write_artifact` | 无 | 无 | `read-only` | `requirements.json`、`requirements.md` | 2 runs、20 tools、300000 ms |
| `analyze_requirements` | `read_file`, `write_artifact` | 无 | 无 | `read-only` | `requirement-analysis.md` | 2 runs、20 tools、300000 ms |
| `codegraph_impact` | `read_file`, `write_artifact` | `codegraph_context`、`codegraph_explore`、`codegraph_impact` | `code-graphing` | `read-only` | `codegraph-impact.json`、`codegraph-impact.md` | 2 runs、40 tools、600000 ms |
| `write_implementation_plan` | `read_file`, `write_artifact` | `codegraph_context`、`codegraph_explore` | 无 | `read-only` | `implementation-plan.json`、`implementation-plan.md` | 2 runs、30 tools、600000 ms |
| `write_tests` | `read_file`, `write_file`, `write_artifact`, `patch`, `terminal` | 无 | `test-driven-development` | `workspace-write` | `test-cases.json`、`test-cases.md`、`diff.patch` | 1 run、80 tools、1200000 ms |
| `implement_code` | `read_file`, `write_file`, `write_artifact`, `patch`, `terminal` | 无 | 无 | `workspace-write` | `implementation-notes.md`、`diff.patch` | 1 run、120 tools、1800000 ms |
| `fix_test_failures` | `read_file`, `write_file`, `write_artifact`, `patch`, `terminal` | 无 | `test-driven-development` | `workspace-write` | `fix-attempt-${attempt}.md`、`diff.patch` | 1 run、80 tools、1200000 ms |
| `review_diff` | `read_file`, `write_artifact`, `terminal` | 无 | `requesting-code-review` | `read-only` | `review.md` | 1 run、40 tools、600000 ms |
| `publish_final_report` | `read_file`, `write_artifact` | 无 | 无 | `read-only` | `final-report.json`、`final-report.md` | 1 run、20 tools、300000 ms |

敏感操作配置：

| Stage | Sensitive operations |
| --- | --- |
| `write_tests` | `install_dep`、`delete_file`、`modify_ci` |
| `implement_code` | `install_dep`、`delete_file`、`modify_ci` |
| `fix_test_failures` | `install_dep`、`delete_file`、`modify_ci` |
| 其他阶段 | 无 |

## 5. 执行协议

`runStage()` 必须按以下顺序执行：

```text
1. loadManifest(stage)
2. startMCPServers(manifest)
3. loadSkills(manifest.tools.skills)
4. buildPrompt(manifest.promptTemplate, taskContext, loadedSkills)
5. agentRuntime.run(input)
6. validateOutput(taskId, manifest)
7. stopMCPServers(manifest)
8. recordStageEvent(result)
```

失败策略：

| 失败点 | 阶段状态 | 下一步 |
| --- | --- | --- |
| manifest 缺失 | `failed` | 修复配置后 retry |
| required MCP 启动失败 | `blocked` | 初始化或修复 MCP 后 retry |
| Skill 缺失 | `running_with_warning` | 记录 warn，继续执行 |
| 未授权工具调用 | `failed` | 调整 manifest 或 prompt |
| 沙箱越权 | `blocked` | 人工审查 |
| 输出文件缺失 | `failed` | 重跑 agent |
| schema 校验失败 | `failed_needs_human` | 人工审查输出 |

## 6. 测试任务拆解

### Task M0-1：Manifest Loader

验证点：

- 加载存在的 manifest。
- stage name 与文件内容不一致时报错。
- manifest 缺少 `outputs`、`constraints`、`promptTemplate` 时报错。
- read-only 阶段如果声明 `write_file` 而不是 `write_artifact`，manifest 校验失败。

测试命令：

```bash
pnpm vitest run src/__tests__/capability/capability-registry.test.ts
```

### Task M0-2：Stage Enforcer

验证点：

- `read-only` 允许读源码文件，允许写 manifest 声明的 artifact，不允许写源码文件。
- `workspace-write` 允许写 workspace，不允许 `push_remote`。
- 未在 manifest 中声明的工具会被拒绝。
- 敏感操作必须出现在 `approvedOperations` 中。

测试命令：

```bash
pnpm vitest run src/__tests__/capability/stage-enforcer.test.ts
```

### Task M0-3：MCP Server Manager

验证点：

- required server 启动失败时抛出 `StageBlockedError`。
- optional server 启动失败时返回 warning。
- 阶段结束会关闭由本阶段启动的 server。
- 健康检查超时会记录错误。

测试命令：

```bash
pnpm vitest run src/__tests__/capability/mcp-server-manager.test.ts
```

### Task M0-4：Skill Loader

验证点：

- 加载 `SKILL.md`。
- frontmatter 可以解析出 `name` 和 `description`。
- 引用文件缺失时记录 warning。
- 依赖 skill 不存在时记录 warning，不阻断阶段。

测试命令：

```bash
pnpm vitest run src/__tests__/capability/skill-loader.test.ts
```

### Task M0-5：Output Validator

验证点：

- required 文件不存在时报错。
- 文件小于 50 bytes 时报错。
- JSON schema 不通过时报错。
- 无 schema 的 Markdown 文件只做存在性和大小检查。

测试命令：

```bash
pnpm vitest run src/__tests__/capability/output-validator.test.ts
```

## 7. MVP-0 完成标准

运行：

```bash
pnpm vitest run src/__tests__/capability
```

必须全部通过。随后运行一个 `MockRuntime` 阶段：

```bash
pnpm pi-agent-platform run-stage normalize_requirements --task TASK-MVP-001 --runtime mock
```

期望：

- 生成 `artifacts/tasks/TASK-MVP-001/requirements.json`。
- 生成 `artifacts/tasks/TASK-MVP-001/requirements.md`。
- 事件流记录 `stage.completed`。
- 修改 manifest 删除输出定义后，命令失败并指出缺失字段。
