import { access, readFile, stat } from "fs/promises";
import { resolve } from "path";
import Ajv from "ajv";
import type { StageCapabilityManifest } from "./StageCapabilityManifest.js";
import { OutputValidationError } from "./errors.js";

const MIN_FILE_SIZE = 50; // bytes

export interface OutputValidator {
  validateOutputs(taskId: string, manifest: StageCapabilityManifest, artifactRoot: string): Promise<{ valid: true } | { valid: false; errors: string[] }>;
}

export class DefaultOutputValidator implements OutputValidator {
  private ajv = new Ajv({ allErrors: true });

  async validateOutputs(
    taskId: string,
    manifest: StageCapabilityManifest,
    artifactRoot: string
  ): Promise<{ valid: true } | { valid: false; errors: string[] }> {
    const errors: string[] = [];

    for (const output of manifest.outputs) {
      let resolvedPath = output.path.replace("${taskId}", taskId).replace("${artifactRoot}", artifactRoot);
      // Substitute ${attempt} if present (used by fix_test_failures stage)
      if (resolvedPath.includes("${attempt}")) {
        resolvedPath = resolvedPath.replace("${attempt}", "1");
      }
      // Output paths in manifests are relative to the project root (process.cwd()).
      // If the path is absolute, use it directly.
      const fullPath = resolvedPath.startsWith("/") ? resolvedPath : resolve(process.cwd(), resolvedPath);

      if (output.required) {
        try {
          await access(fullPath);
        } catch {
          errors.push(`Required output file missing: ${resolvedPath}`);
          continue;
        }

        // Check file size
        try {
          const s = await stat(fullPath);
          if (s.size < MIN_FILE_SIZE) {
            errors.push(`Output file too small (${s.size} bytes < ${MIN_FILE_SIZE}): ${resolvedPath}`);
            continue;
          }
        } catch {
          errors.push(`Cannot stat output file: ${resolvedPath}`);
          continue;
        }
      } else {
        // Non-required: only validate if it exists
        try {
          await access(fullPath);
        } catch {
          continue; // not required and not present, skip
        }
      }

      // Schema validation
      if (output.schema && output.required) {
        const schemaPath = output.schema.startsWith("/")
          ? output.schema
          : resolve(process.cwd(), output.schema);
        try {
          const schemaRaw = await readFile(schemaPath, "utf-8");
          const schema = JSON.parse(schemaRaw);
          const validate = this.ajv.compile(schema);

          const dataRaw = await readFile(fullPath, "utf-8");
          const data = JSON.parse(dataRaw);

          const valid = validate(data);
          if (!valid) {
            const msgs = validate.errors?.map((e) => `${e.instancePath || "/"} ${e.message}`).join("; ");
            errors.push(`Schema validation failed for ${resolvedPath}: ${msgs}`);
          }
        } catch (err: any) {
          if (err instanceof OutputValidationError) throw err;
          errors.push(`Cannot validate schema for ${resolvedPath}: ${err.message}`);
        }
      }
    }

    if (errors.length > 0) {
      return { valid: false, errors };
    }
    return { valid: true };
  }
}
