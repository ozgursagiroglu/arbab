import { execFileSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";

// Default effects for resolveBinary; the logic in resolve.ts takes them as parameters.

export function runVersion(path: string, args: string[]): string {
  return execFileSync(path, args, { encoding: "utf8", timeout: 30_000, stdio: ["ignore", "pipe", "pipe"] });
}

export function pathExists(p: string): boolean {
  return existsSync(p);
}

export function realpath(p: string): string {
  return realpathSync(p);
}
