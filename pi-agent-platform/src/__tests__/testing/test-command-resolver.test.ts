import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { mkdir, rm, writeFile } from "fs/promises";
import { resolve } from "path";
import { FileBasedTestCommandResolver } from "../../testing/TestCommandResolver.js";

describe("TestCommandResolver", () => {
  const testDir = resolve(process.cwd(), "test-resolver-tmp");

  beforeAll(async () => {
    await mkdir(testDir, { recursive: true });
  });

  afterAll(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it("detects pnpm test from package.json with pnpm-lock.yaml", async () => {
    await writeFile(resolve(testDir, "package.json"), JSON.stringify({
      scripts: { test: "vitest run", typecheck: "tsc --noEmit" }
    }), "utf-8");
    await writeFile(resolve(testDir, "pnpm-lock.yaml"), "lockfileVersion: 5.4\n", "utf-8");

    const resolver = new FileBasedTestCommandResolver();
    const cmds = await resolver.resolve(testDir);
    expect(cmds.length).toBe(2);
    expect(cmds[0].command).toContain("pnpm test");
    expect(cmds[1].command).toContain("pnpm run typecheck");
  });

  it("detects pytest from pyproject.toml", async () => {
    await writeFile(resolve(testDir, "pyproject.toml"), "[tool.pytest]\n", "utf-8");
    const resolver = new FileBasedTestCommandResolver();
    const cmds = await resolver.resolve(testDir);
    expect(cmds.some(c => c.command === "pytest")).toBe(true);
  });

  it("detects go test from go.mod", async () => {
    await writeFile(resolve(testDir, "go.mod"), "module test\n", "utf-8");
    const resolver = new FileBasedTestCommandResolver();
    const cmds = await resolver.resolve(testDir);
    expect(cmds.some(c => c.command === "go test ./...")).toBe(true);
  });

  it("detects cargo test from Cargo.toml", async () => {
    await writeFile(resolve(testDir, "Cargo.toml"), "[package]\n", "utf-8");
    const resolver = new FileBasedTestCommandResolver();
    const cmds = await resolver.resolve(testDir);
    expect(cmds.some(c => c.command === "cargo test")).toBe(true);
  });

  it("detects mvn test from pom.xml", async () => {
    await writeFile(resolve(testDir, "pom.xml"), "<project></project>\n", "utf-8");
    const resolver = new FileBasedTestCommandResolver();
    const cmds = await resolver.resolve(testDir);
    expect(cmds.some(c => c.command === "mvn test")).toBe(true);
  });

  it("detects gradle test from build.gradle", async () => {
    await writeFile(resolve(testDir, "build.gradle"), "plugins { id 'java' }\n", "utf-8");
    const resolver = new FileBasedTestCommandResolver();
    const cmds = await resolver.resolve(testDir);
    expect(cmds.some(c => c.command === "gradle test")).toBe(true);
  });

  it("detects gradle test from build.gradle.kts", async () => {
    await writeFile(resolve(testDir, "build.gradle.kts"), "plugins { java }\n", "utf-8");
    const resolver = new FileBasedTestCommandResolver();
    const cmds = await resolver.resolve(testDir);
    expect(cmds.some(c => c.command === "gradle test")).toBe(true);
  });

  it("returns empty when no known project files exist", async () => {
    const emptyDir = resolve(testDir, "empty");
    await mkdir(emptyDir, { recursive: true });
    const resolver = new FileBasedTestCommandResolver();
    const cmds = await resolver.resolve(emptyDir);
    expect(cmds).toEqual([]);
  });
});
