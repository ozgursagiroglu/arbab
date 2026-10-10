# arbab build — run ledger

Every headless run of arbab's own build, measured from its stream, transcript and attempt files by
`bench/bootstrap/summarize.mjs` (later by arbab itself). Regenerate with `node bench/ledger.mjs`.
Costs are Claude Code's client-side, notional API-equivalent estimates (the account is on a subscription);
a resumed attempt's cost is the session total. "Failed" counts tool results with `is_error`, by cause.
Groups: w0–w2 are M1's bootstrap waves; m1–m4 are the lanes arbab launched itself, by milestone (generated
verify, review and skeptic lanes included); probes and other are standalone probes and measurements.

## w0

| Lane | Att. | Role | Model | Effort (req→got) | End | Wall min | Turns | Calls | Failed (cause) | Cost $ |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| w0-probe-opus | 1 | probe | opus-5-5 | high→high | success | 0.1 | 2 | 1 | 0 | 0.07 |
| w0-probe-params | 1 | probe | haiku-5-5 | low→low | success | 0.1 | 3 | 4 | 1 (deny-rule 1) | 0 |
| w0-probe-strict | 1 | probe | haiku-5-5 | low→low | success | 0.4 | 12 | 12 | 4 (denied-subcommandResults 2, sandbox 1, real 1) | 0.01 |
| w0-probe-tools | 2 | probe | haiku-5-5 | low→low | success | 0.1 | 1 | 0 | 0 | 0 |
| w0-probe-tools | 3 | probe | haiku-5-5 | low→low | success | 0.1 | 1 | 0 | 0 | 0 |
| w0-probe-unrestricted | 1 | probe | haiku-5-5 | low→low | success | 0.1 | 1 | 0 | 0 | 0 |
| w0-probe-walls | 1 | probe | haiku-5-5 | low→low | success | 0.5 | 16 | 16 | 7 (sandbox 5, dontAsk 2) | 0.01 |
| w0-research-claude-code | 1 | researcher | opus-5-5 | medium→medium | success | 3.2 | 13 | 39 | 0 | 1.59 |
| w0-research-plugins-sdk | 1 | researcher | opus-5-5 | medium→medium | success | 3.4 | 11 | 28 | 0 | 1.62 |

Totals: 9 attempts, 100 tool calls, 12 failed results, 11 refused by the fence (11.0% of calls).

## w1

| Lane | Att. | Role | Model | Effort (req→got) | End | Wall min | Turns | Calls | Failed (cause) | Cost $ |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| m1-brief | 1 | implementer | opus-5-5 | medium→medium | success | 5.9 | 20 | 45 | 2 (real 1, sandbox 1) | 1.54 |
| m1-config | 1 | implementer | opus-5-5 | medium→medium | success | 5.3 | 21 | 41 | 0 | 1.57 |
| m1-profile | 1 | implementer | opus-5-5 | high→high | success | 4.9 | 23 | 45 | 1 (real 1) | 1.37 |
| m1-registry | 1 | implementer | opus-5-5 | medium→medium | success | 5.4 | 17 | 33 | 1 (real 1) | 1.42 |
| m1-run | 1 | implementer | opus-5-5 | high→high | success | 8.4 | 26 | 54 | 1 (real 1) | 2.22 |
| m1-stream | 1 | implementer | opus-5-5 | high→high | success | 5.5 | 28 | 51 | 1 (dontAsk 1) | 1.74 |
| preflight-w1 | 1 | probe | haiku-5-5 | low→low | success | 0.3 | 7 | 7 | 2 (denied-subcommandResults 2) | 0 |

Totals: 7 attempts, 276 tool calls, 8 failed results, 4 refused by the fence (1.4% of calls).

## w2

| Lane | Att. | Role | Model | Effort (req→got) | End | Wall min | Turns | Calls | Failed (cause) | Cost $ |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| m1-cli | 1 | implementer | opus-5-5 | high→high | success | 17.1 | 60 | 123 | 4 (real 3, dontAsk 1) | 5.71 |
| m1-shepherd | 1 | implementer | opus-5-5 | high→high | success | 19.6 | 42 | 100 | 2 (real 1, sandbox 1) | 4.26 |
| m1-skill | 1 | implementer | opus-5-5 | medium→medium | success | 4.1 | 26 | 39 | 1 (real 1) | 1.43 |

Totals: 3 attempts, 262 tool calls, 7 failed results, 2 refused by the fence (0.8% of calls).

## m1

| Lane | Att. | Role | Model | Effort (req→got) | End | Wall min | Turns | Calls | Failed (cause) | Cost $ |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| m1-e2e | 1 | implementer | opus-5-5 | high→high | success | 11.6 | 50 | 102 | 2 (real 2) | 3.83 |
| m1-e2e-pf-model | 1 | implementer | opus-5-5 | high→high | success | 0.1 | 2 | 1 | 0 | 0.1 |
| m1-e2e-pf-tools | 1 | implementer | haiku-5-5 | low→low | success | 0.3 | 2 | 2 | 0 | 0 |
| m1-fix-cli | 1 | implementer | opus-5-5 | high→high | success | 6.8 | 39 | 91 | 4 (real 3, subcommand 1) | 2.48 |
| m1-fix-fence | 1 | implementer | opus-5-5 | high→high | success | 5.5 | 38 | 88 | 1 (sandbox 1) | 2.29 |
| m1-fix-lifecycle | 1 | implementer | opus-5-5 | high→high | success | 20.8 | 68 | 159 | 1 (real 1) | 7.32 |
| m1-probe-gitwrite | 1 | probe | haiku-5-5 | low→low | success | 0.2 | 2 | 7 | 6 (dontAsk 6) | 0 |
| m1-probe-gitwrite2 | 1 | probe | haiku-5-5 | low→low | success | 0.1 | 3 | 2 | 0 | 0 |
| m1-probe-gitwrite3 | 1 | probe | haiku-5-5 | low→low | success | 0.1 | 3 | 2 | 0 | 0 |
| m1-review-contracts | 1 | reviewer | opus-5-5 | high→high | success | 6.8 | 44 | 90 | 1 (sandbox 1) | 3.43 |
| m1-review-lifecycle | 1 | reviewer | opus-5-5 | high→high | success | 5.8 | 20 | 49 | 1 (sandbox 1) | 2.04 |
| m1-review-security | 1 | reviewer | opus-5-5 | high→high | success | 6.8 | 18 | 57 | 1 (sandbox 1) | 2.28 |

Totals: 12 attempts, 650 tool calls, 17 failed results, 11 refused by the fence (1.7% of calls).

## m2

| Lane | Att. | Role | Model | Effort (req→got) | End | Wall min | Turns | Calls | Failed (cause) | Cost $ |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| m2-digest | 1 | implementer | opus-5-5 | medium→medium | success | 2.9 | 14 | 21 | 1 (real 1) | 0.58 |
| m2-fix-lint | 1 | implementer | opus-5-5 | medium→medium | success | 3.1 | 12 | 25 | 2 (real 2) | 0.71 |
| m2-fix-run | 1 | implementer | opus-5-5 | high→high | success | 10.6 | 52 | 111 | 2 (real 1, analyzer 1) | 4.03 |
| m2-lint-skill | 1 | implementer | opus-5-5 | medium→medium | success | 4.3 | 27 | 54 | 2 (real 2) | 1.29 |
| m2-plan | 1 | implementer | opus-5-5 | high→high | success | 6.1 | 21 | 39 | 1 (real 1) | 1.58 |
| m2-real-a | 1 | probe | haiku-5-5 | low→low | success | 0.1 | 3 | 2 | 0 | 0 |
| m2-real-b | 1 | probe | haiku-5-5 | low→low | success | 0.1 | 3 | 2 | 0 | 0 |
| m2-real2-a | 1 | probe | haiku-5-5 | low→low | success | 0.1 | 2 | 1 | 0 | 0 |
| m2-real2-b | 1 | probe | haiku-5-5 | low→low | success | 0.1 | 3 | 2 | 0 | 0 |
| m2-review | 1 | reviewer | opus-5-5 | high→high | success | 6.5 | 28 | 43 | 1 (sandbox 1) | 1.96 |
| m2-wire | 1 | implementer | opus-5-5 | high→high | success | 12.2 | 58 | 116 | 2 (real 2) | 5.01 |

Totals: 11 attempts, 416 tool calls, 11 failed results, 2 refused by the fence (0.5% of calls).

## m3

| Lane | Att. | Role | Model | Effort (req→got) | End | Wall min | Turns | Calls | Failed (cause) | Cost $ |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| m3-fix-borrowers | 1 | implementer | opus-5-5 | high→high | success | 3.3 | 23 | 47 | 1 (real 1) | 0.97 |
| m3-fix-cleanup | 1 | implementer | opus-5-5 | high→high | success | 5.9 | 28 | 48 | 3 (real 2, dontAsk 1) | 1.81 |
| m3-fix-cmd | 1 | implementer | opus-5-5 | high→high | success | 10.8 | 58 | 108 | 2 (real 2) | 3.9 |
| m3-fix-generated | 1 | implementer | opus-5-5 | high→high | success | 11.5 | 60 | 122 | 6 (real 6) | 4.54 |
| m3-fix-git | 1 | implementer | opus-5-5 | high→high | success | 9.8 | 45 | 90 | 4 (dontAsk 1, real 3) | 2.57 |
| m3-fix-hostgit | 1 | implementer | opus-5-5 | high→high | success | 13.5 | 59 | 127 | 4 (real 4) | 4.12 |
| m3-fix-integrate | 1 | implementer | opus-5-5 | high→high | success | 8.5 | 36 | 69 | 2 (real 2) | 2.52 |
| m3-fix-quota | 1 | implementer | opus-5-5 | high→high | success | 6.9 | 33 | 65 | 1 (real 1) | 1.86 |
| m3-fix-records | 1 | implementer | opus-5-5 | high→high | success | 4.7 | 30 | 49 | 1 (real 1) | 1.31 |
| m3-fix-reuse | 1 | implementer | opus-5-5 | high→high | success | 14.6 | 70 | 129 | 6 (real 6) | 4.89 |
| m3-fix-trust | 1 | implementer | opus-5-5 | high→high | success | 14.9 | 54 | 110 | 3 (real 3) | 4.14 |
| m3-fix-verify | 1 | implementer | opus-5-5 | high→high | success | 7.9 | 51 | 100 | 0 | 2.91 |
| m3-integrate | 1 | implementer | opus-5-5 | high→high | success | 5.8 | 23 | 39 | 1 (real 1) | 1.52 |
| m3-land-cleanup | 1 | implementer | opus-5-5 | high→high | success | 8.5 | 31 | 65 | 1 (real 1) | 2.35 |
| m3-main-verify | 1 | probe | haiku-5-5 | low→low | success | 1.6 | 4 | 3 | 0 | 0 |
| m3-package | 1 | implementer | opus-5-5 | medium→medium | success | 2.1 | 14 | 30 | 0 | 0.45 |
| m3-readiness | 1 | implementer | opus-5-5 | medium→medium | success | 3.2 | 11 | 17 | 0 | 0.68 |
| m3-review | 1 | implementer | opus-5-5 | medium→medium | success | 4.8 | 23 | 40 | 1 (real 1) | 1.36 |
| m3-review-contracts | 1 | reviewer | opus-5-5 | high→high | success | 7 | 25 | 43 | 1 (sandbox 1) | 2.29 |
| m3-review-contracts | 2 | reviewer | opus-5-5 | high→high | success | 7.6 | 39 | 54 | 2 (deny-rule 1, sandbox 1) | 2.62 |
| m3-review-contracts | 3 | reviewer | opus-5-5 | high→high | success | 6.8 | 47 | 63 | 2 (deny-rule 1, sandbox 1) | 3.14 |
| m3-review-contracts | 4 | reviewer | opus-5-5 | high→high | success | 6.8 | 35 | 53 | 1 (sandbox 1) | 3.03 |
| m3-review-contracts | 5 | reviewer | opus-5-5 | high→high | success | 7.7 | 38 | 52 | 1 (sandbox 1) | 3.16 |
| m3-review-contracts | 6 | reviewer | opus-5-5 | high→high | success | 6.6 | 38 | 52 | 2 (sandbox 1, dontAsk 1) | 3.06 |
| m3-review-contracts | 7 | reviewer | opus-5-5 | high→high | success | 13.1 | 39 | 53 | 1 (sandbox 1) | 3.48 |
| m3-review-contracts | 8 | reviewer | opus-5-5 | high→high | success | 5.9 | 38 | 52 | 0 | 3.17 |
| m3-review-contracts | 9 | reviewer | opus-5-5 | high→high | success | 6.2 | 39 | 59 | 1 (deny-rule 1) | 3.49 |
| m3-review-contracts | 10 | reviewer | opus-5-5 | high→high | success | 10.2 | 41 | 56 | 1 (sandbox 1) | 3.7 |
| m3-review-correctness | 1 | reviewer | opus-5-5 | high→high | success | 6.6 | 31 | 42 | 2 (deny-rule 1, sandbox 1) | 2.1 |
| m3-review-correctness | 2 | reviewer | opus-5-5 | high→high | success | 6.9 | 25 | 38 | 2 (deny-rule 1, sandbox 1) | 2.12 |
| m3-review-correctness | 3 | reviewer | opus-5-5 | high→high | success | 8.1 | 29 | 45 | 1 (sandbox 1) | 2.84 |
| m3-review-correctness | 4 | reviewer | opus-5-5 | high→high | success | 7.7 | 24 | 37 | 1 (sandbox 1) | 2.63 |
| m3-review-correctness | 5 | reviewer | opus-5-5 | high→high | success | 8.1 | 25 | 39 | 1 (sandbox 1) | 2.66 |
| m3-review-correctness | 6 | reviewer | opus-5-5 | high→high | success | 5.1 | 27 | 37 | 0 | 2.34 |
| m3-review-correctness | 7 | reviewer | opus-5-5 | high→high | success | 7.7 | 26 | 37 | 2 (deny-rule 1, sandbox 1) | 2.52 |
| m3-review-correctness | 8 | reviewer | opus-5-5 | high→high | success | 9 | 28 | 39 | 1 (sandbox 1) | 2.85 |
| m3-review-correctness | 9 | reviewer | opus-5-5 | high→high | success | 9.5 | 26 | 42 | 2 (deny-rule 1, sandbox 1) | 3.03 |
| m3-review-correctness | 10 | reviewer | opus-5-5 | high→high | success | 6.7 | 27 | 40 | 0 | 2.8 |
| m3-review-security | 1 | reviewer | opus-5-5 | high→high | success | 5 | 27 | 44 | 2 (deny-rule 1, real 1) | 1.88 |
| m3-review-security | 2 | reviewer | opus-5-5 | high→high | success | 4.3 | 19 | 32 | 1 (deny-rule 1) | 1.57 |
| m3-review-security | 3 | reviewer | opus-5-5 | high→high | success | 5.3 | 24 | 35 | 1 (deny-rule 1) | 2.17 |
| m3-review-security | 4 | reviewer | opus-5-5 | high→high | success | 5.1 | 20 | 30 | 1 (deny-rule 1) | 1.95 |
| m3-review-security | 5 | reviewer | opus-5-5 | high→high | success | 7.8 | 34 | 46 | 1 (deny-rule 1) | 3.13 |
| m3-review-security | 6 | reviewer | opus-5-5 | high→high | success | 8 | 32 | 43 | 1 (deny-rule 1) | 3.01 |
| m3-review-security | 7 | reviewer | opus-5-5 | high→high | success | 9.3 | 25 | 38 | 0 | 3.22 |
| m3-review-security | 8 | reviewer | opus-5-5 | high→high | success | 9 | 33 | 46 | 1 (deny-rule 1) | 3.4 |
| m3-review-security | 9 | reviewer | opus-5-5 | high→high | success | 9.3 | 18 | 32 | 0 | 2.86 |
| m3-review-security | 10 | reviewer | opus-5-5 | high→high | success | 8.3 | 23 | 37 | 0 | 2.77 |
| m3-review-security | 11 | reviewer | opus-5-5 | high→high | success | 8.3 | 25 | 37 | 1 (sandbox 1) | 2.69 |
| m3-review-security | 12 | reviewer | opus-5-5 | high→high | success | 10.8 | 35 | 48 | 0 | 3.66 |
| m3-review-security | 13 | reviewer | opus-5-5 | high→high | success | 8.7 | 29 | 46 | 0 | 3.62 |
| m3-review-security | 14 | reviewer | opus-5-5 | high→high | success | 7.7 | 29 | 41 | 1 (deny-rule 1) | 2.84 |
| m3-skeptic-contracts | 1 | reviewer | opus-5-5 | high→high | success | 2.1 | 17 | 26 | 0 | 0.88 |
| m3-skeptic-contracts | 2 | reviewer | opus-5-5 | high→high | success | 0.9 | 8 | 14 | 0 | 0.34 |
| m3-skeptic-contracts | 3 | reviewer | opus-5-5 | high→high | success | 1.2 | 12 | 19 | 0 | 0.58 |
| m3-skeptic-contracts | 4 | reviewer | opus-5-5 | high→high | success | 0.6 | 7 | 9 | 0 | 0.29 |
| m3-skeptic-contracts | 5 | reviewer | opus-5-5 | high→high | success | 1.6 | 13 | 17 | 0 | 0.51 |
| m3-skeptic-contracts | 6 | reviewer | opus-5-5 | high→high | success | 0.5 | 6 | 8 | 0 | 0.33 |
| m3-skeptic-contracts | 7 | reviewer | opus-5-5 | high→high | success | 0.5 | 5 | 6 | 1 (real 1) | 0.28 |
| m3-skeptic-contracts | 8 | reviewer | opus-5-5 | high→high | success | 0.5 | 7 | 9 | 0 | 0.29 |
| m3-skeptic-contracts | 9 | reviewer | opus-5-5 | high→high | success | 1 | 10 | 14 | 1 (real 1) | 0.39 |
| m3-skeptic-correctness | 1 | reviewer | opus-5-5 | high→high | success | 0.9 | 6 | 12 | 0 | 0.36 |
| m3-skeptic-correctness | 2 | reviewer | opus-5-5 | high→high | success | 1.7 | 13 | 22 | 0 | 0.85 |
| m3-skeptic-correctness | 3 | reviewer | opus-5-5 | high→high | success | 1.9 | 15 | 22 | 0 | 0.93 |
| m3-skeptic-correctness | 4 | reviewer | opus-5-5 | high→high | success | 0.6 | 6 | 9 | 0 | 0.28 |
| m3-skeptic-correctness | 5 | reviewer | opus-5-5 | high→high | success | 0.6 | 7 | 11 | 1 (real 1) | 0.26 |
| m3-skeptic-correctness | 6 | reviewer | opus-5-5 | high→high | success | 1.2 | 14 | 15 | 0 | 0.54 |
| m3-skeptic-correctness | 7 | reviewer | opus-5-5 | high→high | success | 1.4 | 13 | 14 | 0 | 0.54 |
| m3-skeptic-correctness | 8 | reviewer | opus-5-5 | high→high | success | 1.2 | 10 | 11 | 0 | 0.48 |
| m3-skeptic-correctness | 9 | reviewer | opus-5-5 | high→high | success | 0.6 | 5 | 7 | 0 | 0.2 |
| m3-skeptic-correctness | 10 | reviewer | opus-5-5 | high→high | success | 0.9 | 7 | 12 | 0 | 0.36 |
| m3-skeptic-security | 1 | reviewer | opus-5-5 | high→high | success | 1.3 | 9 | 16 | 0 | 0.59 |
| m3-skeptic-security | 2 | reviewer | opus-5-5 | high→high | success | 1.4 | 11 | 17 | 0 | 0.64 |
| m3-skeptic-security | 3 | reviewer | opus-5-5 | high→high | success | 1.8 | 9 | 14 | 0 | 0.7 |
| m3-skeptic-security | 4 | reviewer | opus-5-5 | high→high | success | 2.5 | 14 | 18 | 0 | 0.9 |
| m3-skeptic-security | 5 | reviewer | opus-5-5 | high→high | success | 1.5 | 15 | 20 | 0 | 0.56 |
| m3-skeptic-security | 6 | reviewer | opus-5-5 | high→high | success | 0.7 | 6 | 8 | 0 | 0.37 |
| m3-skeptic-security | 7 | reviewer | opus-5-5 | high→high | success | 0.9 | 9 | 12 | 0 | 0.51 |
| m3-skeptic-security | 8 | reviewer | opus-5-5 | high→high | success | 0.6 | 5 | 5 | 0 | 0.34 |
| m3-skeptic-security | 9 | reviewer | opus-5-5 | high→high | success | 1.5 | 9 | 13 | 0 | 0.58 |
| m3-skeptic-security | 10 | reviewer | opus-5-5 | high→high | success | 1.1 | 7 | 10 | 0 | 0.36 |
| m3-skeptic-security | 11 | reviewer | opus-5-5 | high→high | success | 0.7 | 7 | 10 | 1 (dontAsk 1) | 0.32 |
| m3-skeptic-security | 12 | reviewer | opus-5-5 | high→high | success | 0.9 | 8 | 13 | 0 | 0.44 |
| m3-skeptic-security | 13 | reviewer | opus-5-5 | high→high | success | 0.8 | 7 | 12 | 0 | 0.46 |
| m3-skeptic-security | 14 | reviewer | opus-5-5 | high→high | success | 0.9 | 6 | 9 | 0 | 0.31 |
| m3-verify | 1 | implementer | opus-5-5 | medium→medium | success | 3.1 | 13 | 23 | 1 (real 1) | 0.75 |
| m3-verify | 2 | probe | haiku-5-5 | low→low | success | 1.1 | 4 | 3 | 0 | 0 |
| m3-verify | 3 | probe | haiku-5-5 | low→low | success | 1.1 | 2 | 3 | 0 | 0 |
| m3-verify | 4 | probe | haiku-5-5 | low→low | success | 1.4 | 4 | 3 | 0 | 0 |
| m3-verify | 5 | probe | haiku-5-5 | low→low | success | 0.8 | 4 | 3 | 0 | 0 |
| m3-verify | 6 | probe | haiku-5-5 | low→low | success | 0.8 | 3 | 3 | 0 | 0 |
| m3-verify | 7 | probe | haiku-5-5 | low→low | success | 0.9 | 3 | 3 | 0 | 0 |
| m3-verify | 8 | probe | haiku-5-5 | low→low | success | 1 | 5 | 3 | 0 | 0 |
| m3-verify | 9 | probe | haiku-5-5 | low→low | success | 1.1 | 3 | 3 | 0 | 0 |
| m3-verify | 10 | probe | haiku-5-5 | low→low | success | 1.5 | 4 | 3 | 0 | 0 |
| m3-verify | 11 | probe | haiku-5-5 | low→low | success | 1.1 | 4 | 3 | 0 | 0 |
| m3-verify | 12 | probe | haiku-5-5 | low→low | success | 1.2 | 3 | 3 | 0 | 0 |
| m3-verify | 13 | probe | haiku-5-5 | low→low | success | 1.4 | 5 | 3 | 0 | 0 |
| m3-verify | 14 | probe | haiku-5-5 | low→low | success | 1.1 | 4 | 3 | 0 | 0 |
| m3-verify | 15 | probe | haiku-5-5 | low→low | success | 1.2 | 4 | 3 | 0 | 0 |
| m3-verify | 16 | probe | haiku-5-5 | low→low | success | 1.2 | 4 | 3 | 0 | 0 |
| m3-wire | 1 | implementer | opus-5-5 | high→high | success | 17.9 | 77 | 128 | 1 (dontAsk 1) | 7.61 |

Totals: 102 attempts, 3376 tool calls, 76 failed results, 37 refused by the fence (1.1% of calls).

## other

| Lane | Att. | Role | Model | Effort (req→got) | End | Wall min | Turns | Calls | Failed (cause) | Cost $ |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| probe-denywrite | 1 | probe | haiku-5-5 | low→low | success | 0.1 | 3 | 5 | 0 | 0 |
| probe-http | 1 | probe | haiku-5-5 | low→low | success | 0.2 | 6 | 6 | 1 (sandbox 1) | 0 |

Totals: 2 attempts, 11 tool calls, 1 failed results, 1 refused by the fence (9.1% of calls).
