import { spawn } from "child_process";
import { createWriteStream, readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { mkdir } from "fs/promises";

const prompt = readFileSync(
  "/home/kitikousei/vs_code/pi-agent/pi-agent-platform/artifacts/tasks/TASK-MERCHANT-BATCH-V11/normalize_requirements.prompt.md",
  "utf-8"
);

const artifactRoot = "/home/kitikousei/vs_code/pi-agent/pi-agent-platform/artifacts/tasks/TASK-MERCHANT-BATCH-V11";
const stdoutLog = resolve(artifactRoot, "test-spawn.stdout.jsonl");
const stderrLog = resolve(artifactRoot, "test-spawn.stderr.log");
const promptFile = "/tmp/pi-prompt-test.txt";

await mkdir(dirname(stdoutLog), { recursive: true });
writeFileSync(promptFile, prompt, "utf-8");

const stdoutStream = createWriteStream(stdoutLog);
const stderrStream = createWriteStream(stderrLog);

const child = spawn("pi", [
  "--mode", "json",
  "--print",
  "--no-session",
  "--tools", "read,write",
  "@" + promptFile,
], {
  cwd: "/home/kitikousei/vs_code/pi-agent/pi-agent-platform",
  stdio: ["pipe", "pipe", "pipe"],
});

child.stdout!.pipe(stdoutStream);
child.stderr!.pipe(stderrStream);

console.log("Pi PID:", child.pid);

child.on("error", (err) => {
  console.error("Spawn error:", err.message);
});

const exitCode = await new Promise<number | null>((resolve) => {
  child.on("close", (code) => resolve(code));
});

await new Promise<void>((r) => stdoutStream.end(r));
await new Promise<void>((r) => stderrStream.end(r));

console.log("Exit code:", exitCode);

const { readFileSync } = await import("fs");
try {
  const output = readFileSync(stdoutLog, "utf-8");
  const lines = output.split("\n").filter(l => l.trim());
  console.log("Output lines:", lines.length);
  if (lines.length > 0) {
    console.log("Last line (first 200 chars):", lines[lines.length - 1].slice(0, 200));
  }
} catch (e) {
  console.log("Cannot read stdout log:", e);
}
