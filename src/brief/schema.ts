import type { JsonSchema } from "../types";

export const NO_SCHEMA_TEXT = "Your final answer is a short summary of what you did and what you could not do.";

export function typeName(schema: JsonSchema): string {
  if (schema.enum !== undefined && schema.enum.length > 0) return schema.enum.map((v) => JSON.stringify(v)).join(" | ");
  if (schema.type === "array") {
    if (schema.items === undefined) return "unknown[]";
    const inner = typeName(schema.items);
    return `${inner.includes(" | ") ? `(${inner})` : inner}[]`;
  }
  if (schema.type !== undefined) return schema.type;
  return schema.properties !== undefined ? "object" : "unknown";
}

function fieldLines(schema: JsonSchema, depth: number): string[] {
  const required = new Set(schema.required ?? []);
  const lines: string[] = [];
  for (const [name, field] of Object.entries(schema.properties ?? {})) {
    let line = `${"  ".repeat(depth)}- \`${name}\`: \`${typeName(field)}\``;
    if (!required.has(name)) line += " (optional)";
    const description = field.description?.replace(/\s+/g, " ").trim();
    if (description) line += ` — ${description}`;
    lines.push(line);
    const nested = field.type === "array" ? field.items : field;
    if (nested?.properties !== undefined) lines.push(...fieldLines(nested, depth + 1));
  }
  return lines;
}

/** The fields the final JSON must contain, as a Markdown bullet list. */
export function describeSchema(schema: JsonSchema | null): string {
  if (schema === null) return NO_SCHEMA_TEXT;
  if (schema.properties === undefined) return `- the whole answer: \`${typeName(schema)}\``;
  return fieldLines(schema, 0).join("\n");
}
