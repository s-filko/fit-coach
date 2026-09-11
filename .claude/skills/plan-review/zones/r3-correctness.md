## Finding format (required)

One line per finding:

`SEVERITY | ZONE | file:line | rule | finding`

- `SEVERITY` is `blocking` or `advisory`.
- **`blocking` requires `file:line` AND a named rule** — an AC-####, BR-*, INV-*, a rule
  from `docs/SUPERPOWERS_INTEGRATION.md`, or an ADR. A finding without both is
  `advisory` by definition. No exceptions: severity is earned by evidence, not by how
  serious it feels.
- `advisory` is an improvement that violates nothing. It will not be fixed on this
  branch — it goes to `docs/BACKLOG.md`. Do not argue for fixing it here.

Report findings only. Do not edit any file. Do not propose a diff.
Stay inside your zone: findings outside it belong to another reviewer and will be discarded.

# Zone R3 — Correctness and proof

Read the diff for behaviour, then check that the behaviour is proven.

Check:

- **Logic and edge cases**: empty input, boundary values, error paths, concurrent or
  repeated execution where relevant.
- **Every AC has a test.** For each `AC-####` the plan claims, find the test that covers
  it. A claimed AC with no test is blocking, cited by its AC id.
- **Test naming**: `describe/it` names carry BR/AC references per
  `docs/CONTRIBUTING_AI.md`.
- **Verification commands were run.** The plan states a verification command per task.
  Confirm it was actually executed with output — not judged by reading. If the evidence
  is absent, that is blocking.
- **Thin-test zones** get heightened attention, because tests there are weak by nature:
  `drizzle/` migrations, `deploy/deploy.sh`, env handling, `docker-compose.yml`.

Out of zone: architecture (R1), duplication (R2), doc currency (R4).
