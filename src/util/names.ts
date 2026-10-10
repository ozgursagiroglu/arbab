import { ArbabError } from "./errors";

// Lane names and resource types become directory names, branch names and env-var suffixes.
const NAME = /^[a-z0-9][a-z0-9-]{0,47}$/;

export function isValidName(name: unknown): name is string {
  return typeof name === "string" && NAME.test(name);
}

export function assertValidName(name: unknown, what = "name"): string {
  if (!isValidName(name)) {
    throw new ArbabError("usage", `${what} ${JSON.stringify(name)} must match ${NAME.source}`);
  }
  return name;
}

/** "redis-db" → "REDIS_DB", for ARBAB_<TYPE>_<i> environment names. */
export function envSuffix(name: string): string {
  return assertValidName(name).replace(/-/g, "_").toUpperCase();
}
