import { mkdir, readFile, writeFile, appendFile, access } from "fs/promises";
import { resolve, dirname } from "path";
import type { TaskEvent } from "./TaskArtifactPaths.js";
import { taskArtifactRoot, taskArtifactPath } from "./TaskArtifactPaths.js";

export interface ArtifactStore {
  ensureTask(taskId: string): Promise<void>;
  writeText(taskId: string, relativePath: string, content: string): Promise<void>;
  readText(taskId: string, relativePath: string): Promise<string>;
  writeJson<T>(taskId: string, relativePath: string, value: T): Promise<void>;
  readJson<T>(taskId: string, relativePath: string): Promise<T>;
  exists(taskId: string, relativePath: string): Promise<boolean>;
  appendEvent(taskId: string, event: TaskEvent): Promise<void>;
}

export class LocalArtifactStore implements ArtifactStore {
  private root: string;

  constructor(rootDir?: string) {
    this.root = rootDir ?? process.cwd();
  }

  async ensureTask(taskId: string): Promise<void> {
    const dir = resolve(this.root, taskArtifactRoot(taskId));
    await mkdir(dir, { recursive: true });
  }

  async writeText(taskId: string, relativePath: string, content: string): Promise<void> {
    const fullPath = resolve(this.root, taskArtifactPath(taskId, relativePath));
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, content, "utf-8");
  }

  async readText(taskId: string, relativePath: string): Promise<string> {
    const fullPath = resolve(this.root, taskArtifactPath(taskId, relativePath));
    return readFile(fullPath, "utf-8");
  }

  async writeJson<T>(taskId: string, relativePath: string, value: T): Promise<void> {
    await this.writeText(taskId, relativePath, JSON.stringify(value, null, 2) + "\n");
  }

  async readJson<T>(taskId: string, relativePath: string): Promise<T> {
    const raw = await this.readText(taskId, relativePath);
    return JSON.parse(raw) as T;
  }

  async exists(taskId: string, relativePath: string): Promise<boolean> {
    try {
      await access(resolve(this.root, taskArtifactPath(taskId, relativePath)));
      return true;
    } catch {
      return false;
    }
  }

  async appendEvent(taskId: string, event: TaskEvent): Promise<void> {
    const path = taskArtifactPath(taskId, "events.jsonl");
    const fullPath = resolve(this.root, path);
    await mkdir(dirname(fullPath), { recursive: true });
    await appendFile(fullPath, JSON.stringify(event) + "\n", "utf-8");
  }
}
