import type { StageCapabilityManifest } from "../capability/StageCapabilityManifest.js";
import type { SkillLoadResult } from "../capability/SkillLoader.js";
import { PromptAssembler } from "./PromptAssembler.js";

export async function buildPrompt(
  manifest: StageCapabilityManifest,
  vars: Record<string, string>,
  skillResults?: SkillLoadResult[],
  context?: Record<string, unknown>
): Promise<string> {
  return new PromptAssembler().assemble({ manifest, vars, skillResults, context });
}
