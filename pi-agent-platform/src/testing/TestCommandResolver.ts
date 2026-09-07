import { readFile } from "fs/promises";
import { resolve } from "path";

export interface TestCommand {
  command: string;
  cwd: string;
}

export interface TestCommandResolver {
  resolve(workspacePath: string): Promise<TestCommand[]>;
}

export class FileBasedTestCommandResolver implements TestCommandResolver {
  async resolve(workspacePath: string): Promise<TestCommand[]> {
    const commands: TestCommand[] = [];

    // Check package.json
    const pkgPath = resolve(workspacePath, "package.json");
    try {
      const raw = await readFile(pkgPath, "utf-8");
      const pkg = JSON.parse(raw);
      const scripts = pkg.scripts || {};

      const pm = await this.detectPackageManager(workspacePath);

      if (scripts.test) {
        commands.push({ command: `${pm} test`, cwd: workspacePath });
      }
      if (scripts.typecheck) {
        commands.push({ command: `${pm} run typecheck`, cwd: workspacePath });
      }
    } catch {
      // No package.json
    }

    // Check pyproject.toml
    const pyprojectPath = resolve(workspacePath, "pyproject.toml");
    try {
      await readFile(pyprojectPath, "utf-8");
      commands.push({ command: "pytest", cwd: workspacePath });
    } catch {
      // No pyproject.toml
    }

    // Check go.mod
    const goModPath = resolve(workspacePath, "go.mod");
    try {
      await readFile(goModPath, "utf-8");
      commands.push({ command: "go test ./...", cwd: workspacePath });
    } catch {
      // No go.mod
    }

    // Check Cargo.toml
    const cargoPath = resolve(workspacePath, "Cargo.toml");
    try {
      await readFile(cargoPath, "utf-8");
      commands.push({ command: "cargo test", cwd: workspacePath });
    } catch {
      // No Cargo.toml
    }

    // Check pom.xml (Maven)
    const pomPath = resolve(workspacePath, "pom.xml");
    try {
      await readFile(pomPath, "utf-8");
      commands.push({ command: "mvn test", cwd: workspacePath });
    } catch {
      // No pom.xml
    }

    // Check build.gradle / build.gradle.kts (Gradle)
    const gradlePath = resolve(workspacePath, "build.gradle");
    const gradleKtsPath = resolve(workspacePath, "build.gradle.kts");
    try {
      await readFile(gradlePath, "utf-8");
      commands.push({ command: "gradle test", cwd: workspacePath });
    } catch {
      try {
        await readFile(gradleKtsPath, "utf-8");
        commands.push({ command: "gradle test", cwd: workspacePath });
      } catch {
        // No build.gradle
      }
    }

    return commands;
  }

  private async detectPackageManager(workspacePath: string): Promise<string> {
    const lockFiles = [
      { name: "pnpm-lock.yaml", cmd: "pnpm" },
      { name: "yarn.lock", cmd: "yarn" },
      { name: "package-lock.json", cmd: "npm" },
    ];

    for (const lf of lockFiles) {
      try {
        await readFile(resolve(workspacePath, lf.name), "utf-8");
        return lf.cmd;
      } catch {
        // not found
      }
    }
    return "pnpm";
  }
}
