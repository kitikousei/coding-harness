const stages = [
  "normalize_requirements",
  "waiting_for_requirements_approval",
  "analyze_requirements",
  "codegraph_impact",
  "write_implementation_plan",
  "waiting_for_plan_approval",
  "prepare_workspace",
  "write_tests",
  "implement_code",
  "collect_diff",
  "testing",
  "fix_test_failures_attempt_1",
  "fix_test_failures_attempt_2",
  "fix_test_failures",
  "review_diff",
  "publish_final_report",
  "completed",
];

const approvalStages = {
  waiting_for_requirements_approval: "requirements",
  waiting_for_plan_approval: "plan",
};

let selectedTask = undefined;
let workflow = undefined;
let events = [];
let stream = undefined;
let statusTimer = undefined;
let renderPending = false;

const taskList = document.querySelector("#taskList");
const selectedTaskEl = document.querySelector("#selectedTask");
const workflowLine = document.querySelector("#workflowLine");
const statusBadge = document.querySelector("#statusBadge");
const progress = document.querySelector("#progress");
const approvalPanel = document.querySelector("#approvalPanel");
const approvalTitle = document.querySelector("#approvalTitle");
const approvalSummary = document.querySelector("#approvalSummary");
const approvalComment = document.querySelector("#approvalComment");
const approvalError = document.querySelector("#approvalError");
const logList = document.querySelector("#logList");
const sourceFilter = document.querySelector("#sourceFilter");
const stageFilter = document.querySelector("#stageFilter");
const errorsOnly = document.querySelector("#errorsOnly");
const showDebug = document.querySelector("#showDebug");
const artifactsContent = document.querySelector("#artifactsContent");
const costContent = document.querySelector("#costContent");

// Approximate pricing per 1M tokens (USD) — frontend estimation only
const MODEL_PRICING = {
  "claude-sonnet-4-20250514": { input: 3.0, output: 15.0 },
  "claude-3-5-sonnet-20241022": { input: 3.0, output: 15.0 },
  "claude-3-5-haiku-20241022": { input: 0.8, output: 4.0 },
  "gpt-4o": { input: 2.5, output: 10.0 },
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  "deepseek-chat": { input: 0.27, output: 1.1 },
};
const DEFAULT_PRICING = { input: 3.0, output: 15.0 };

// Populate stage filter dropdown
stageFilter.replaceChildren(
  Object.assign(document.createElement("option"), { value: "", textContent: "All stages" }),
  ...stages.map((s) => Object.assign(document.createElement("option"), { value: s, textContent: s }))
);

document.querySelector("#refreshTasks").addEventListener("click", () => void loadTasks());
document.querySelector("#clearLogs").addEventListener("click", () => {
  events = [];
  renderLogs();
});
document.querySelector("#approveButton").addEventListener("click", () => void submitApproval("approved"));
document.querySelector("#rejectButton").addEventListener("click", () => void submitApproval("rejected"));
sourceFilter.addEventListener("change", renderLogs);
stageFilter.addEventListener("change", renderLogs);
errorsOnly.addEventListener("change", renderLogs);
showDebug.addEventListener("change", () => {
  logList.classList.toggle("show-debug", showDebug.checked);
  renderLogs();
});

void loadTasks();
setInterval(() => void loadTasks(), 3000);

async function loadTasks() {
  const response = await fetch("/api/tasks");
  const data = await response.json();
  renderTasks(data.tasks || []);
  if (!selectedTask && data.tasks?.[0]) {
    await selectTask(data.tasks[0]);
  }
}

function renderTasks(tasks) {
  taskList.replaceChildren(...tasks.map((task) => {
    const button = document.createElement("button");
    button.className = `task-item${selectedTask?.taskId === task.taskId ? " active" : ""}`;
    button.type = "button";
    button.innerHTML = `<strong>${escapeHtml(task.taskId)}</strong><div class="muted">${escapeHtml(task.updatedAt || "")}</div>`;
    button.addEventListener("click", () => void selectTask(task));
    return button;
  }));
}

async function selectTask(task) {
  selectedTask = task;
  events = [];
  workflow = undefined;
  if (stream) stream.close();
  if (statusTimer) clearInterval(statusTimer);

  selectedTaskEl.textContent = task.taskId;
  workflowLine.textContent = task.workflowId;
  await refreshSelectedTask();
  openStream(task.taskId);
  statusTimer = setInterval(() => void refreshStatus(), 2000);
  await loadTasks();
}

async function refreshSelectedTask() {
  if (!selectedTask) return;
  const response = await fetch(`/api/tasks/${encodeURIComponent(selectedTask.taskId)}`);
  const detail = await response.json();
  selectedTask = { ...selectedTask, ...detail };
  workflow = detail.workflow;
  statusBadge.textContent = workflow?.status || "unknown";
  workflowLine.textContent = `${selectedTask.workflowId}${workflow?.stage ? ` / ${workflow.stage}` : ""}`;
  renderProgress();
  renderApproval();
  renderArtifacts();
  renderCost();
}

async function refreshStatus() {
  if (!selectedTask) return;
  const response = await fetch(`/api/workflows/${encodeURIComponent(selectedTask.workflowId)}/status`);
  workflow = await response.json();
  statusBadge.textContent = workflow.status || "unknown";
  workflowLine.textContent = `${selectedTask.workflowId}${workflow.stage ? ` / ${workflow.stage}` : ""}`;
  renderProgress();
  renderApproval();
  renderCost();
}

function openStream(taskId) {
  stream = new EventSource(`/api/tasks/${encodeURIComponent(taskId)}/stream`);
  stream.addEventListener("event", (message) => {
    events.push(JSON.parse(message.data));
    if (events.length > 3000) events = events.slice(-3000);
    scheduleRender();
  });
  stream.onerror = () => {
    statusBadge.textContent = "reconnecting";
  };
}

// Throttle rendering to at most once per animation frame
function scheduleRender() {
  if (renderPending) return;
  renderPending = true;
  requestAnimationFrame(() => {
    renderPending = false;
    renderLogs();
  });
}

function renderProgress() {
  const current = workflow?.stage;
  const currentIndex = stages.indexOf(current);
  const failed = workflow?.status && !["running", "completed", "unavailable"].includes(workflow.status);

  progress.replaceChildren(...stages.map((stage, index) => {
    const el = document.createElement("div");
    let state = "pending";
    if (workflow?.status === "completed") state = "completed";
    else if (index < currentIndex) state = "completed";
    else if (stage === current && failed) state = "failed";
    else if (stage === current && approvalStages[stage]) state = "waiting";
    else if (stage === current) state = "running";
    el.className = `stage-pill ${state}`;
    el.textContent = stage;
    el.addEventListener("click", () => {
      stageFilter.value = stage;
      renderLogs();
    });
    return el;
  }));
}

function renderApproval() {
  const stage = workflow?.stage;
  const approvalStage = approvalStages[stage];
  if (!approvalStage || !selectedTask) {
    approvalPanel.classList.add("hidden");
    return;
  }

  approvalPanel.classList.remove("hidden");
  approvalTitle.textContent = `Approval: ${approvalStage}`;
  approvalSummary.textContent = workflow?.comment || `Workflow is waiting for ${approvalStage} approval.`;
  approvalError.textContent = "";
}

async function submitApproval(decision) {
  if (!selectedTask || !workflow?.stage) return;
  const approvalStage = approvalStages[workflow.stage];
  if (!approvalStage) return;

  approvalError.textContent = "";
  const response = await fetch(`/api/workflows/${encodeURIComponent(selectedTask.workflowId)}/approval`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      taskId: selectedTask.taskId,
      stage: approvalStage,
      decision,
      comment: approvalComment.value,
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: response.statusText }));
    approvalError.textContent = error.error || response.statusText;
    return;
  }

  approvalComment.value = "";
  await refreshStatus();
}

function renderArtifacts() {
  const files = selectedTask?.artifactFiles || [];
  if (files.length === 0) {
    artifactsContent.innerHTML = '<div class="muted">No outputs yet</div>';
    return;
  }

  const groups = {};
  const orphans = [];
  for (const file of files) {
    const stage = stages.find((s) => file.startsWith(s + "."));
    if (stage) {
      if (!groups[stage]) groups[stage] = [];
      groups[stage].push(file);
    } else {
      orphans.push(file);
    }
  }

  const sections = [];
  for (const stage of stages) {
    const stageFiles = groups[stage];
    if (!stageFiles || stageFiles.length === 0) continue;
    sections.push(`<div class="artifact-group"><span class="artifact-stage">${escapeHtml(stage)}</span>${stageFiles.map((f) => `<span class="artifact-file">${escapeHtml(f)}</span>`).join("")}</div>`);
  }
  if (orphans.length > 0) {
    sections.push(`<div class="artifact-group"><span class="artifact-stage">general</span>${orphans.map((f) => `<span class="artifact-file">${escapeHtml(f)}</span>`).join("")}</div>`);
  }

  artifactsContent.innerHTML = sections.join("");
}

function renderLogs() {
  const source = sourceFilter.value;
  const stage = stageFilter.value;
  const onlyErrors = errorsOnly.checked;
  const visible = events
    .filter((event) => !source || event.source === source)
    .filter((event) => !stage || event.stage === stage)
    .filter((event) => !onlyErrors || event.level === "error")
    .slice(-500);

  logList.replaceChildren(...visible.map((event) => {
    const row = document.createElement("div");
    row.className = `log-row ${event.level}`;
    const errorDetail = event.data?.error
      ? `<div class="error-detail">${escapeHtml(event.data.error.type || "")}: ${escapeHtml(event.data.error.message || "")}</div>`
      : "";
    row.innerHTML = [
      `<span>${escapeHtml(event.createdAt || "")}</span>`,
      `<span>${escapeHtml(event.level)}</span>`,
      `<span>${escapeHtml(event.stage || event.source)}</span>`,
      `<span class="log-summary">${escapeHtml(event.summary || event.event)}${errorDetail}</span>`,
    ].join("");
    return row;
  }));
  logList.scrollTop = logList.scrollHeight;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function renderCost() {
  if (!selectedTask) return;
  const response = await fetch(`/api/tasks/${encodeURIComponent(selectedTask.taskId)}/cost`);
  const data = await response.json();
  const summary = data.cost;

  if (!summary || !summary.stages || summary.stages.length === 0) {
    costContent.innerHTML = '<div class="muted">No cost data yet</div>';
    return;
  }

  const maxTokens = Math.max(...summary.stages.map((s) => s.totalTokens), 1);
  const model = summary.stages[0]?.model;
  const pricing = MODEL_PRICING[model] || DEFAULT_PRICING;

  const rows = summary.stages.map((s) => {
    const barWidth = Math.round((s.totalTokens / maxTokens) * 100);
    const barClass = s.totalTokens > 20000 ? "bar-high" : s.totalTokens > 5000 ? "bar-mid" : "bar-low";
    const cost = ((s.inputTokens / 1_000_000) * pricing.input + (s.outputTokens / 1_000_000) * pricing.output).toFixed(4);
    return `<div class="cost-row">
      <span class="cost-stage" title="${escapeHtml(s.stage)}">${escapeHtml(s.stage)}</span>
      <div class="cost-bar-wrap"><div class="cost-bar ${barClass}" style="width:${barWidth}%"></div></div>
      <span class="cost-tokens">${formatTokens(s.inputTokens)} in / ${formatTokens(s.outputTokens)} out</span>
      <span class="cost-usd">$${cost}</span>
    </div>`;
  }).join("");

  const totalCost = ((summary.totals.inputTokens / 1_000_000) * pricing.input + (summary.totals.outputTokens / 1_000_000) * pricing.output).toFixed(4);

  costContent.innerHTML = `<div class="cost-rows">${rows}</div>
    <div class="cost-total">
      <span>Total</span>
      <span>${formatTokens(summary.totals.inputTokens)} in / ${formatTokens(summary.totals.outputTokens)} out</span>
      <span>≈ $${totalCost}</span>
    </div>`;
}

function formatTokens(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return String(n);
}