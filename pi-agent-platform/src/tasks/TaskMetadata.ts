import { readFile, writeFile } from "fs/promises";
import { isAbsolute, resolve } from "path";

export interface TaskMetadata {
  id?: string;
  title?: string;
  repo?: string;
  baseBranch?: string;
  createdAt?: string;
  status?: string;
}

export function taskDirectory(taskId: string, rootDir: string = process.cwd()): string {
  return resolve(rootDir, "artifacts/tasks", taskId);
}

export function normalizeOptionalPath(path: string | undefined, rootDir: string = process.cwd()): string {
  const trimmed = path?.trim();
  if (!trimmed) return "";
  return isAbsolute(trimmed) ? resolve(trimmed) : resolve(rootDir, trimmed);
}

export async function readTaskMetadata(
  taskId: string,
  rootDir: string = process.cwd()
): Promise<TaskMetadata | undefined> {
  const raw = await readFile(resolve(taskDirectory(taskId, rootDir), "task.json"), "utf-8").catch(() => "");
  if (!raw) return undefined;

  try {
    return JSON.parse(raw) as TaskMetadata;
  } catch {
    return undefined;
  }
}

export async function writeTaskMetadata(
  taskId: string,
  metadata: TaskMetadata,
  rootDir: string = process.cwd()
): Promise<void> {
  await writeFile(
    resolve(taskDirectory(taskId, rootDir), "task.json"),
    JSON.stringify(metadata, null, 2) + "\n",
    "utf-8"
  );
}

export async function resolveTaskWorktreePath(
  taskId: string,
  explicitPath?: string,
  rootDir: string = process.cwd()
): Promise<string> {
  const explicit = normalizeOptionalPath(explicitPath, rootDir);
  if (explicit) return explicit;

  const metadata = await readTaskMetadata(taskId, rootDir);
  const metadataRepo = normalizeOptionalPath(metadata?.repo, rootDir);
  return metadataRepo || rootDir;
}
