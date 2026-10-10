import type { JsonSchema, ValidationError } from "../types";

/**
 * Validates `value` against the JSON Schema subset in `JsonSchema` (DESIGN.md §6). Collects every error and never
 * throws; a node of the wrong type is reported once and not inspected further.
 */
export function validate(schema: JsonSchema, value: unknown): ValidationError[] {
  const errors: ValidationError[] = [];
  check(schema, value, "", errors);
  return errors;
}

function check(schema: JsonSchema, value: unknown, path: string, errors: ValidationError[]): void {
  if (schema.type !== undefined && !hasType(schema.type, value)) {
    errors.push({ path, message: `expected ${schema.type}, got ${describe(value)}` });
    return;
  }
  if (schema.enum !== undefined && !schema.enum.some((option) => option === value)) {
    errors.push({ path, message: `must be one of ${schema.enum.map((o) => JSON.stringify(o)).join(", ")}` });
  }
  if (isObject(value)) checkObject(schema, value, path, errors);
  if (Array.isArray(value)) checkArray(schema, value, path, errors);
}

function checkObject(schema: JsonSchema, value: Record<string, unknown>, path: string, errors: ValidationError[]): void {
  for (const key of schema.required ?? []) {
    if (!Object.hasOwn(value, key)) errors.push({ path: child(path, key), message: "is required" });
  }
  const properties = schema.properties ?? {};
  for (const [key, item] of Object.entries(value)) {
    const sub = Object.hasOwn(properties, key) ? properties[key] : undefined;
    if (sub !== undefined) check(sub, item, child(path, key), errors);
    else if (schema.additionalProperties === false) {
      errors.push({ path: child(path, key), message: "is not an allowed property" });
    }
  }
}

function checkArray(schema: JsonSchema, value: unknown[], path: string, errors: ValidationError[]): void {
  if (schema.minItems !== undefined && value.length < schema.minItems) {
    errors.push({ path, message: `must have at least ${schema.minItems} items, got ${value.length}` });
  }
  if (schema.items !== undefined) {
    const items = schema.items;
    value.forEach((item, i) => check(items, item, child(path, String(i)), errors));
  }
}

function hasType(type: NonNullable<JsonSchema["type"]>, value: unknown): boolean {
  switch (type) {
    case "object":
      return isObject(value);
    case "array":
      return Array.isArray(value);
    case "string":
      return typeof value === "string";
    case "integer":
      return Number.isInteger(value);
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "boolean":
      return typeof value === "boolean";
    case "null":
      return value === null;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function describe(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "number" && Number.isInteger(value)) return "integer";
  return typeof value;
}

// RFC 6901 escaping, so a key containing "/" cannot forge a path.
function child(path: string, key: string): string {
  return `${path}/${key.replace(/~/g, "~0").replace(/\//g, "~1")}`;
}
