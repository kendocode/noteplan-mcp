// Runtime checking that a caller's parameters actually apply to the action
// they picked.
//
// The tool JSON schemas are flat: one property bag shared by every action of a
// tool, with applicability stated only in prose ("used by delete_lines,
// replace_lines"). Nothing enforced that prose, and the per-action zod schemas
// were used only as TypeScript types via z.infer — the dispatcher passed raw
// `args` straight through. So a parameter that an action does not implement was
// accepted and silently dropped, and the caller had no way to tell an honoured
// safety flag from an ignored one: `dryRun: true` on an action without a dryRun
// implementation performed the write.
//
// This module answers "does this key apply here?" from the zod schemas
// themselves, so the check cannot drift from the schemas it enforces.

import { z } from 'zod';

export const ERR_UNSUPPORTED_PARAM = 'ERR_UNSUPPORTED_PARAM';

export type ParamCheckResult =
  | { ok: true }
  | { ok: false; error: string; code: typeof ERR_UNSUPPORTED_PARAM; unsupported: string[] };

/**
 * The parameter names a schema accepts.
 *
 * Unwraps the effect wrappers that `.superRefine()` / `.refine()` / `.default()`
 * put around an object schema; returns an empty list for anything that is not
 * ultimately an object.
 */
export function schemaKeys(schema: z.ZodTypeAny): string[] {
  let current: z.ZodTypeAny = schema;
  // Bounded so a pathological schema cannot spin here.
  for (let depth = 0; depth < 10; depth++) {
    if (current instanceof z.ZodObject) {
      return Object.keys(current.shape as Record<string, unknown>);
    }
    if (current instanceof z.ZodEffects) {
      current = current.innerType();
      continue;
    }
    if (current instanceof z.ZodOptional || current instanceof z.ZodNullable) {
      current = current.unwrap();
      continue;
    }
    if (current instanceof z.ZodDefault) {
      current = current.removeDefault();
      continue;
    }
    break;
  }
  return [];
}

/**
 * Reject parameters the chosen action does not implement.
 *
 * `envelopeKeys` are the keys the dispatcher consumes itself before calling the
 * tool function (`action`, and anything it folds into another parameter), so
 * they are legal on every action of that tool.
 *
 * Keys whose value is `undefined` or `null` are ignored: the caller has not
 * actually asked for anything, and MCP clients routinely send null for unset
 * optional fields.
 */
export function checkApplicableParams(options: {
  tool: string;
  action: string;
  args: Record<string, unknown>;
  schemas: Record<string, z.ZodTypeAny>;
  envelopeKeys?: readonly string[];
}): ParamCheckResult {
  const { tool, action, args, schemas, envelopeKeys = [] } = options;

  const schema = schemas[action];
  if (!schema) return { ok: true }; // Unknown actions are the dispatcher's to report.

  const accepted = new Set([...schemaKeys(schema), ...envelopeKeys]);

  const unsupported = Object.keys(args).filter((key) => {
    if (accepted.has(key)) return false;
    const value = args[key];
    return value !== undefined && value !== null;
  });

  if (unsupported.length === 0) return { ok: true };

  const details = unsupported.map((key) => {
    const alsoIn = Object.keys(schemas).filter(
      (other) => other !== action && schemaKeys(schemas[other]).includes(key)
    );
    return alsoIn.length > 0
      ? `"${key}" (supported by: ${alsoIn.join(', ')})`
      : `"${key}" (not a parameter of ${tool})`;
  });

  return {
    ok: false,
    code: ERR_UNSUPPORTED_PARAM,
    unsupported,
    error:
      `${tool} action "${action}" does not support ${details.join('; ')}. ` +
      `It was previously accepted and silently ignored, so the call did not do what the parameter asked for. ` +
      `Supported parameters for "${action}": ${[...accepted].sort().join(', ')}.`,
  };
}
