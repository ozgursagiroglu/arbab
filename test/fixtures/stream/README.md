# Stream fixtures

`claude -p --output-format stream-json --verbose` output for tests. No private data: home and scratchpad paths are replaced
(`/Users/dev`, `/work/...`), skill and command lists are trimmed, and startup timing is removed.

| File | Source | What it exercises |
| --- | --- | --- |
| probe-strict | real, w0, CLI 2.1.295, haiku | strict fence; `subcommandResults` denials; sandbox network refusal; Read deny; structured output |
| probe-walls | real, w0 | sandbox-auto fence; EPERM writes/reads; dontAsk denials under auto-allow |
| probe-params | real, w0 | `Bash(run_in_background:true)` parameter deny rule (`decision_reason_type: rule`) |
| probe-tools | real, w0 | `--tools` naming Agent/Monitor/ToolSearch; one-turn run |
| probe-unrestricted | real, w0 | no `--restricted`: `memory_paths` and `messaging_socket_path` present |
| smoke-opus | real, w0, opus high | one real tool call, then the answer |
| research | real, w0, opus medium (tool results truncated to 200 chars) | WebFetch-heavy researcher; structured output |
| usage-limit | synthetic, shapes from a real 2.1.295 limit stop | `rate_limit_event` warning then `rejected`; result `success` + `is_error` + 429 |
| unsupported-cli | synthetic, from machine 2's evidence | 400 "or newer is required" |
| budget | synthetic | `error_max_budget_usd` |
| structured-retries | synthetic | `error_max_structured_output_retries` |
| background-multi-result | synthetic | two `result` events around a background task notification |
| truncated | synthetic | a live stream whose last line is cut |
| refusals | synthetic, texts from real runs | analyzer, needs-approval, sleep-guard, input, dontAsk, scope, sandbox, Read deny, real failure |
