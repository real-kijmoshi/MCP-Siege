/**
 * Runtime input validation.
 *
 * The JSON Schemas tell the agent what to send; these checks make sure the
 * simulation never acts on anything else. A schema is documentation to the
 * caller, not a guarantee to the callee.
 */

export class InputError extends Error {
  public constructor(
    message: string,
    public readonly suggestions: string[] = [],
  ) {
    super(message);
    this.name = 'InputError';
  }
}

export function asObject(input: unknown): Record<string, unknown> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new InputError('Expected an object of parameters.');
  }
  return input as Record<string, unknown>;
}

/** Rejects anything the schema did not declare, mirroring additionalProperties. */
export function rejectUnknown(input: Record<string, unknown>, allowed: readonly string[]): void {
  const unknown = Object.keys(input).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) {
    throw new InputError(`Unknown parameter(s): ${unknown.join(', ')}.`, [
      `Accepted parameters: ${allowed.join(', ')}.`,
    ]);
  }
}

export function requireString(
  input: Record<string, unknown>,
  key: string,
  maxLength = 200,
): string {
  const value = input[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new InputError(`"${key}" must be a non-empty string.`);
  }
  if (value.length > maxLength) {
    throw new InputError(`"${key}" must be at most ${maxLength} characters.`);
  }
  return value;
}

export function optionalString(
  input: Record<string, unknown>,
  key: string,
  maxLength = 200,
): string | undefined {
  return input[key] === undefined ? undefined : requireString(input, key, maxLength);
}

export function requireEnum<T extends string>(
  input: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
): T {
  const value = input[key];
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    throw new InputError(`"${key}" must be one of: ${allowed.join(', ')}.`);
  }
  return value as T;
}

export function optionalEnum<T extends string>(
  input: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
): T | undefined {
  return input[key] === undefined ? undefined : requireEnum(input, key, allowed);
}

export function requireStringArray(
  input: Record<string, unknown>,
  key: string,
  min = 1,
  max = 20,
): string[] {
  const value = input[key];
  if (!Array.isArray(value)) throw new InputError(`"${key}" must be an array of strings.`);
  if (value.length < min || value.length > max) {
    throw new InputError(`"${key}" must contain between ${min} and ${max} entries.`);
  }
  const result: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string' || entry.length === 0) {
      throw new InputError(`"${key}" must contain only non-empty strings.`);
    }
    if (result.includes(entry)) throw new InputError(`"${key}" must not contain duplicates.`);
    result.push(entry);
  }
  return result;
}

export function requireInteger(
  input: Record<string, unknown>,
  key: string,
  min: number,
  max: number,
): number {
  const value = input[key];
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new InputError(`"${key}" must be an integer between ${min} and ${max}.`);
  }
  return value;
}

export function requireNumber(
  input: Record<string, unknown>,
  key: string,
  min: number,
  max: number,
): number {
  const value = input[key];
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new InputError(`"${key}" must be a number between ${min} and ${max}.`);
  }
  return value;
}
