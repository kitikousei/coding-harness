import { readFile } from "fs/promises";
import { resolve } from "path";
import type { StageCapabilityManifest } from "./StageCapabilityManifest.js";

export interface SkillLoadResult {
  name: string;
  content: string;
  warnings: string[];
}

export interface SkillLoader {
  loadSkills(skillNames: string[]): Promise<SkillLoadResult[]>;
}

export class FileSkillLoader implements SkillLoader {
  private skillsDir: string;

  constructor(skillsDir?: string) {
    this.skillsDir = skillsDir ?? resolve(process.cwd(), "skills");
  }

  async loadSkills(skillNames: string[]): Promise<SkillLoadResult[]> {
    const results: SkillLoadResult[] = [];

    for (const name of skillNames) {
      const warnings: string[] = [];
      const skillPath = resolve(this.skillsDir, name, "SKILL.md");

      try {
        const content = await readFile(skillPath, "utf-8");
        results.push({ name, content, warnings });
      } catch {
        warnings.push(`Skill '${name}' not found at ${skillPath}`);
        results.push({ name, content: "", warnings });
      }
    }

    return results;
  }
}
