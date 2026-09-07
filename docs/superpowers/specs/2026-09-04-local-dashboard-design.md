# Local Dashboard Design

Date: 2026-09-04

## Context

`pi-agent-platform` can start long engineering tasks in Temporal and already has two observability primitives:

- Task-level artifact events in `artifacts/tasks/<taskId>/events.jsonl`.
- Pi SDK runtime events in `artifacts/tasks/<taskId>/<stage>.events.jsonl`.

It also already has a Temporal `status` query and an `approval` signal for workflow approval gates. The missing piece is a local web surface that combines these signals into one view and lets the developer approve or reject waiting workflow stages without switching back to CLI commands.

This design targets local or intranet single-developer use. It is not a hosted product design.

## Goals

- Show current Temporal workflow status for an existing task.
- Show workflow progress across the known engineering stages.
- Show historical and live logs from task artifacts and Pi runtime event files.
- Surface existing human approval gates in the browser.
- Let the developer approve or reject those gates and continue the workflow through Temporal signals.
- Keep the first implementation small, local, and easy to start.

## Non-Goals

- No login, multi-user access control, or tenant isolation.
- No cloud artifact store.
- No workflow creation form in the first version.
- No generic Pi SDK `tool_call` confirmation channel in the first version.
- No persistent database beyond existing artifact files and Temporal state.
- No React/Vite build pipeline in the first version.

## Recommended Approach

Add a local dashboard command:

```bash
pnpm pi-agent-platform dashboard --port 8787
```

The command starts a local HTTP server using Node built-in modules. It serves a static HTML/CSS/JS dashboard and JSON/SSE API endpoints. This avoids adding a frontend framework before the product surface needs one.

The dashboard observes existing workflows by `taskId` and `workflowId`. By default, the UI maps `taskId` to `pi-agent-<taskId>`, matching the existing CLI convention.

## Architecture

### CLI Entry

Add a `dashboard` CLI command under `src/cli/commands/dashboard.ts` and register it in `src/cli/index.ts`.

The command options are:

```text
--port <port>              default 8787
--host <host>              default 127.0.0.1
--artifact-root <path>     default process.cwd()/artifacts/tasks
--temporal-address <addr>  default TEMPORAL_ADDRESS or localhost:7233
```

The default host is `127.0.0.1` because this is a single-user local tool. A developer can opt into LAN access by passing `--host 0.0.0.0`.

### Backend Modules

Add focused modules under `src/dashboard/`:

- `server.ts`: starts HTTP server, routes API requests, serves static assets.
- `task-store.ts`: lists task artifact directories and reads task metadata/log files.
- `event-stream.ts`: tails artifact files and writes Server-Sent Events.
- `temporal-client.ts`: wraps Temporal Client status query and approval signal.
- `types.ts`: shared dashboard API types.
- `public/`: static HTML, CSS, and browser JavaScript.

These modules should not import workflow code into browser-facing files. They can share string constants for query/signal names when it does not create Temporal bundling issues.

### Workflow Event Logging

Temporal workflow code cannot write directly to the local filesystem. Add an activity such as `recordTaskEventActivity` that uses `LocalArtifactStore.appendEvent()`.

The workflow should call this activity at important orchestration boundaries:

- workflow started
- stage started
- stage succeeded
- stage failed, blocked, or needs input
- waiting for approval
- approval received
- workflow completed

This complements Pi runtime event logs. It should not duplicate every SDK event.

### Frontend Layout

The first screen is the actual dashboard, not a landing page.

Recommended layout:

- Left rail: task list with task id, last modified time, and coarse status when available.
- Main header: selected task id, workflow id, status, current stage, refresh state.
- Progress row: known stages in order, with `pending`, `running`, `waiting`, `failed`, and `completed` visual states.
- Approval panel: visible only when the current stage is an approval wait state.
- Log panel: combined event stream with filters for workflow events, agent events, tool events, stderr, and errors.
- Artifact links: quick links to generated files such as requirements, analysis, plan, diff, report, and logs.

The UI should be dense and operational. It should prioritize scanning, filtering, and repeated debugging over a marketing-style layout.

## Data Model

Expose a normalized dashboard event shape to the browser:

```ts
interface DashboardEvent {
  id: string;
  taskId: string;
  source: "workflow" | "agent" | "stderr";
  stage?: string;
  level: "debug" | "info" | "warn" | "error";
  event: string;
  createdAt: string;
  summary: string;
  data?: Record<string, unknown>;
}
```

`events.jsonl` already mostly matches this shape. Pi runtime events should be mapped into concise summaries before they reach the UI, for example:

- `tool_execution_start` -> `Tool started: <toolName>`
- `tool_execution_end` with `isError` -> `Tool failed: <toolName>`
- `bash_execution_update` -> command output line or chunk
- `message_update` with visible text deltas -> assistant text stream
- `agent_settled` -> `Agent settled`

The raw event should remain available in `data` for debugging, but the UI should not require users to read raw JSON first.

## API

```text
GET  /api/tasks
GET  /api/tasks/:taskId
GET  /api/tasks/:taskId/events
GET  /api/tasks/:taskId/stream
GET  /api/workflows/:workflowId/status
POST /api/workflows/:workflowId/approval
```

### `GET /api/tasks`

Returns known task directories from the artifact root. Each item includes:

- `taskId`
- `createdAt` when known
- `updatedAt` from filesystem metadata
- `workflowId` defaulting to `pi-agent-<taskId>`
- `artifactRoot`

### `GET /api/tasks/:taskId`

Returns task metadata, artifact file list, and best-effort workflow status if Temporal is reachable.

If Temporal is unavailable, the endpoint should still return artifact information with a clear `temporalAvailable: false` flag.

### `GET /api/tasks/:taskId/events`

Returns historical normalized events. It reads:

- `events.jsonl`
- all `*.events.jsonl`
- all `*.stderr.log`

The endpoint should cap the default response, for example last 2000 normalized events, with optional query parameters for `source`, `stage`, and `limit`.

### `GET /api/tasks/:taskId/stream`

SSE endpoint for live events. It should:

- send an initial `snapshot` event with recent events
- poll known log files every 1 second
- discover new stage log files while the task is running
- send normalized `event` messages for new lines
- send heartbeat comments to keep the connection alive
- clean up timers when the client disconnects

Polling is preferred over `fs.watch` for the first version because it is easier to reason about across local filesystems and generated artifact files.

### `GET /api/workflows/:workflowId/status`

Uses Temporal Client to query the workflow's `status` query. Response includes:

- `workflowId`
- `taskId`
- `status`
- `stage`
- `comment`
- `temporalStatus` from `handle.describe()` when available

### `POST /api/workflows/:workflowId/approval`

Request:

```ts
interface ApprovalRequest {
  taskId: string;
  stage: "requirements" | "plan" | "diff" | "pr";
  decision: "approved" | "rejected";
  comment?: string;
  reviewer?: string;
}
```

The backend fills `reviewer` with `dashboard` when omitted and sets `decidedAt` server-side. It sends the existing Temporal `approval` signal.

## Approval Flow

The first version supports the existing workflow approval stages:

- `waiting_for_requirements_approval` maps to approval stage `requirements`.
- `waiting_for_plan_approval` maps to approval stage `plan`.

When the workflow status query reports one of these stages, the UI shows:

- current approval target
- relevant artifact links, such as requirements or implementation plan
- comment input
- approve and reject actions

On submit, the frontend posts to `/api/workflows/:workflowId/approval`. The backend sends the Temporal signal. The UI then resumes polling or streaming status until the workflow moves to the next stage.

If a stage returns `needs_input` or `blocked`, the first version displays the blocked state and summary. Generic "enter arbitrary instruction and resume this stage" is out of scope for version one because it needs a workflow and runtime contract for resuming or retrying blocked stages.

## Progress Model

Use the current workflow stages as the canonical stage list:

1. `normalize_requirements`
2. `waiting_for_requirements_approval`
3. `analyze_requirements`
4. `codegraph_impact`
5. `write_implementation_plan`
6. `waiting_for_plan_approval`
7. `prepare_workspace`
8. `write_tests`
9. `implement_code`
10. `collect_diff`
11. `testing`
12. `fix_test_failures_attempt_1`
13. `fix_test_failures_attempt_2`
14. `fix_test_failures`
15. `review_diff`
16. `publish_final_report`
17. `completed`

The dashboard derives visual states from the current stage and final status:

- stages before current: completed
- current stage: running or waiting
- failed/blocked workflow status: current stage failed
- completed workflow status: all completed
- unknown Temporal status: artifact-only mode

## Error Handling

The dashboard must remain useful when parts of the system are down.

- Temporal unreachable: show artifact logs and mark workflow status unavailable.
- Missing task artifacts: show a clear 404 response and a useful empty state.
- Malformed JSONL line: display a warning event and continue reading later lines.
- Approval signal failure: show the backend error text in the approval panel.
- SSE disconnect: reconnect from the browser with a small backoff.
- Large logs: cap initial response size and stream only new lines.

## Testing Strategy

Add focused tests rather than browser end-to-end tests for version one:

- `task-store` lists tasks and reads mixed log files.
- event normalization maps known Pi SDK events to concise dashboard events.
- malformed JSONL does not crash event loading.
- `temporal-client` approval request builds the existing signal shape.
- dashboard API routes return expected JSON for fake task directories.

Manual verification should cover:

- start Temporal dev server and worker
- start a mock or real workflow
- open dashboard
- observe logs updating
- approve requirements
- approve plan
- watch workflow continue

## Implementation Constraints

- Keep all first-version dashboard code inside `pi-agent-platform/src/dashboard` plus one CLI registration file.
- Use existing `@temporalio/client` dependency.
- Avoid adding frontend dependencies unless the static UI becomes unmaintainable.
- Do not block the agent loop on slow log writes.
- Preserve existing CLI workflows.
- Treat artifact files as append-only logs.

## Future Iteration Backlog

1. Add workflow creation and start form.
2. Add a task detail route that deep-links directly to `/#/tasks/<taskId>`.
3. Add generic blocked-stage resume support with an explicit workflow signal and retry contract.
4. Add Pi SDK `tool_call` human confirmation for dangerous commands through a pending-confirmation channel.
5. Add artifact preview panes for requirements, impact analysis, implementation plan, diff, and final report.
6. Add richer log filters: stage, tool name, event level, only errors, text search.
7. Add a compact cost and token usage panel from runtime event state.
8. Add workflow cancellation and retry buttons.
9. Add LAN sharing hardening: bind warning, optional bearer token, and CORS restrictions.
10. Add GitHub PR integration status once PR creation exists.
11. Add downloadable diagnostic bundle for a task.
12. Add browser notifications for waiting approval and terminal failures.
13. Add WebSocket mode if bidirectional runtime confirmation becomes too awkward with SSE plus POST.
14. Add retained UI preferences in local storage.
15. Add Playwright smoke tests after the UI becomes stable enough to justify browser test maintenance.

## Acceptance Criteria

- `pnpm pi-agent-platform dashboard --port 8787` starts a local web dashboard.
- The dashboard lists artifact-backed tasks.
- Selecting a task shows current workflow status when Temporal is reachable.
- Selecting a task shows historical workflow and agent logs.
- The log view updates while a workflow is running.
- When a workflow waits for requirements or plan approval, the page can approve or reject it.
- Approval submits the existing Temporal `approval` signal and the workflow continues or fails according to the decision.
- Temporal outage does not prevent viewing local artifact logs.
- Existing CLI commands and tests continue to work.
