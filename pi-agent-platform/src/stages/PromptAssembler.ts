import { readFile } from "fs/promises";
import { resolve } from "path";
import type { StageCapabilityManifest } from "../capability/StageCapabilityManifest.js";
import type { SkillLoadResult } from "../capability/SkillLoader.js";

export interface PromptAssemblerInput {
  manifest: StageCapabilityManifest;
  vars: Record<string, string>;
  skillResults?: SkillLoadResult[];
  context?: Record<string, unknown>;
}

export class PromptAssembler {
  constructor(private readonly rootDir = process.cwd()) {}

  async assemble(input: PromptAssemblerInput): Promise<string> {
    const { manifest, vars, skillResults, context } = input;
    const sections: string[] = [this.buildPlatformContract(manifest)];

    const includeContents = await this.readTemplates(manifest.promptIncludes ?? [], vars);
    if (includeContents.length > 0) {
      sections.push(this.section("Global Rules", includeContents.join("\n\n")));
    }

    const stageTemplate = await this.readTemplate(manifest.promptTemplate, vars);
    sections.push(this.section("Stage Instructions", stageTemplate));

    if (skillResults && skillResults.length > 0) {
      sections.push(this.section("Skills Context", this.renderSkills(skillResults)));
    }

    if (context && Object.keys(context).length > 0) {
      sections.push(this.section("Runtime Context", `\`\`\`json\n${stableStringify(context)}\n\`\`\``));
    }

    return sections.map((section) => section.trim()).join("\n\n") + "\n";
  }

  private async readTemplates(paths: string[], vars: Record<string, string>): Promise<string[]> {
    const templates: string[] = [];
    for (const path of paths) {
      templates.push(await this.readTemplate(path, vars));
    }
    return templates;
  }

  private async readTemplate(path: string, vars: Record<string, string>): Promise<string> {
    const template = await readFile(resolve(this.rootDir, path), "utf-8");
    return renderTemplate(template, vars);
  }

  private buildPlatformContract(manifest: StageCapabilityManifest): string {
    const requiredOutputs = manifest.outputs
      .filter((output) => output.required)
      .map((output) => `- ${output.path}${output.schema ? ` (schema: ${output.schema})` : ""}`)
      .join("\n") || "- None";
    const optionalOutputs = manifest.outputs
      .filter((output) => !output.required)
      .map((output) => `- ${output.path}${output.schema ? ` (schema: ${output.schema})` : ""}`)
      .join("\n") || "- None";

    return this.section(
      "Platform Contract",
      [
        `- Stage: ${manifest.stage}`,
        `- Sandbox: ${manifest.sandbox}`,
        `- Native tools: ${manifest.tools.native.join(", ") || "none"}`,
        `- MCP tools: ${manifest.tools.mcp.join(", ") || "none"}`,
        `- Skills: ${manifest.tools.skills.join(", ") || "none"}`,
        `- Require output file: ${manifest.constraints.requireOutputFile ? "yes" : "no"}`,
        `- Validate output schema: ${manifest.constraints.validateOutputSchema ? "yes" : "no"}`,
        "",
        "Required outputs:",
        requiredOutputs,
        "",
        "Optional outputs:",
        optionalOutputs,
      ].join("\n")
    );
  }

  private renderSkills(skillResults: SkillLoadResult[]): string {
    return skillResults
      .filter((skill) => skill.content)
      .map((skill) => `<skill name="${skill.name}">\n${skill.content.trim()}\n</skill>`)
      .join("\n\n");
  }

  private section(title: string, body: string): string {
    return `# ${title}\n\n${body.trim()}`;
  }
}

function renderTemplate(template: string, vars: Record<string, string>): string {
  let rendered = template;
  for (const [key, value] of Object.entries(vars)) {
    rendered = rendered.replaceAll(`\${${key}}`, value);
  }
  return rendered;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortJsonValue(value), null, 2);
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJsonValue);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nestedValue]) => [key, sortJsonValue(nestedValue)])
    );
  }

  return value;
}
