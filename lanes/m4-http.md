# M4 · raw HTTP for researcher lanes (src/http, `arbab http`, lane `domains`)

## Task

Implement REQUIREMENTS FR-14 as specified in DESIGN.md §18: a raw HTTP tool that researcher workers may run inside
their sandbox, reaching only the domains their lane lists.

1. **`src/http/`** (export from `index.ts`):
   - `parseHttpArgs(argv: string[]): { url: URL; method: "GET" | "HEAD"; headers: Record<string, string>; userAgent:
     string; maxBytes: number; maxRedirects: number }`:
     - http and https only;
     - header lines are `k:v` (names checked against the token syntax);
     - defaults: user agent `arbab-research/1.0 (+https://github.com)`, max bytes 200 000, max redirects 3;
     - errors are usage errors.
   - `fetchRaw(opts, fetchImpl = fetch): Promise<string>`:
     - follow redirects manually (`redirect: "manual"`) up to the limit, printing each hop as
       `HTTP <status> <statusText>` plus its headers;
     - after the last hop, print the body as text, cut at `maxBytes` with a marker that says how many bytes were
       left;
     - a relative `Location` resolves against the current URL;
     - a redirect to a non-http(s) scheme stops with an error.
   - `needsProxyFlag(env, execArgv): boolean`: true when `HTTPS_PROXY` or `HTTP_PROXY` is set and `execArgv` lacks
     `--use-env-proxy`. Measured: inside the sandbox, Node's fetch needs that flag to use the proxy.
2. **`src/commands/http.ts`**: export `runHttp(argv, ctx)`. When `needsProxyFlag`, re-run the same script with
   `--use-env-proxy` (spawn `process.execPath` with the flag, the script path and the same arguments, stdio
   inherited) and return its status. Otherwise call `fetchRaw` and print the result. Do **not** edit
   `src/commands/index.ts`: the orchestrator registers the command.
3. **The lane field `domains`** (`LaneSpec.domains`, already in `src/types.ts`):
   - `src/config/lane.ts` validates it: only for role `researcher`; non-empty strings that are hostnames or `*.`
     wildcards (no schemes, paths or ports); at most 50 entries.
   - `src/profile/compile.ts`: when `ProfileInput.domains` is non-empty, set
     `sandbox.network.allowedDomains` to the list. When `ProfileInput.httpCommand` is set too, add `Bash` to the
     tools and allow exactly one Bash rule: the `httpCommand` words joined with spaces, then ` *`. Lint
     (`src/profile/lint.ts`) refuses `domains` on any other role (code `domains-role`) and a researcher Bash rule
     other than that one (code `researcher-bash`).
   - `src/shepherd/attempt.ts`: when the lane has `domains`, pass `domains` and
     `httpCommand: [process.execPath, "--use-env-proxy", <this script>, "http"]` into the profile input. The script
     path comes from a new optional `ShepherdDeps.scriptPath`; `defaultDeps` sets it from `process.argv[1]`.
   - The brief's tool belt (`src/brief/toolbelt.ts`) names the command and the domains for a researcher that has
     them.

## Scope

You own `src/http/**`, `src/commands/http.ts`, and the `domains`/`httpCommand` parts of `src/config/lane.ts`,
`src/profile/compile.ts`, `src/profile/lint.ts`, `src/shepherd/attempt.ts`, `src/shepherd/index.ts`
(`ShepherdDeps.scriptPath`) and `src/brief/toolbelt.ts`, each with tests. Change nothing else.

## Facts

- Measured on CLI 2.1.295 with Node 24 (research/native-claude-code.md, "Measured during M3/M4"):
  - with `sandbox.network.allowedDomains: ["example.com"]`, curl reaches example.com (200) and other hosts get a
    CONNECT 403 with a sandbox violation;
  - the sandbox sets the `HTTP(S)_PROXY` and `ALL_PROXY` variables;
  - Node's fetch fails with ENOTFOUND unless it runs with `--use-env-proxy`; then the allowed host returns 200 and
    others are refused.
- project-b's research workers re-verified everything with their own fetch script, because WebFetch got 403s and could
  not return raw status or XML.
- A researcher has no local file tools. With `domains` it gets Bash for exactly one command.

## Acceptance

- [ ] Everything above, with tests: argument parsing; redirects and the cut body with an injected fetch; the
      re-exec decision; lane validation; the compiled researcher profile with and without `domains`; both lint codes;
      the shepherd passing `domains`/`httpCommand` (with injected deps); the tool belt line.
- [ ] `pnpm typecheck`, `pnpm test` and `pnpm build` exit 0.
