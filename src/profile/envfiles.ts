import type { GitRunner } from "../run";

/**
 * Absolute paths of the env files to deny one by one when `fence.readableEnvFiles` lifts the blanket `**\/.env*` deny:
 * every `.env*` file in the worktree and the main checkout that is not a listed tracked template (DESIGN.md §21).
 * A stub until the fence lane fills it in; the attempt calls it only when `readable` is non-empty.
 */
export function envFileDenies(input: { projectRoot: string; worktree: string; readable: string[]; git: GitRunner }): string[] {
  void input;
  return [];
}
