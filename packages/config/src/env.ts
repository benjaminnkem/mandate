import type { z } from "zod";

export class EnvValidationError extends Error {
  readonly issues: readonly string[];

  constructor(scope: string, issues: readonly string[]) {
    super(`Invalid ${scope} environment:\n - ${issues.join("\n - ")}`);
    this.name = "EnvValidationError";
    this.issues = issues;
  }
}

/**
 * Parse an environment source against a schema. Error messages name the offending
 * variables and the failed rule but never echo the supplied values, because values
 * may be secrets (database URLs, API keys, keypair paths).
 */
export function parseEnv<S extends z.ZodType>(
  scope: string,
  schema: S,
  source: Record<string, string | undefined> = process.env,
): z.output<S> {
  const result = schema.safeParse(source);
  if (result.success) return result.data;
  const issues = result.error.issues.map((issue) => {
    const key = issue.path.join(".") || "(root)";
    return `${key}: ${issue.message}`;
  });
  throw new EnvValidationError(scope, issues);
}
