# blocker-diagnostician

[한국어](README.md) | English

A Codex skill that groups recurring failures by stable fingerprints and selects the next check that can distinguish between causal hypotheses. It does not implement fixes or deploy changes based on the diagnosis, and it does not repeat the same check without new information.

## Requirements

- Node.js 22 or later
- pnpm 11 for development and lockfile reproducibility

## Run directly

```bash
node scripts/cluster-failures.mjs --input tests/fixtures/same-failure.json
node scripts/digest-request.mjs --input tests/fixtures/same-failure.json
node scripts/cli.mjs --input tests/fixtures/same-failure.json
node scripts/cli.mjs < tests/fixtures/same-failure.json
```

The caller that reads the evidence supplies the candidate hypotheses and the meaning of each check. The CLI deterministically calculates fingerprints, excludes checks already performed with the same input, evaluates whether result branches can distinguish between hypotheses, and ranks checks by permission and information value. Each candidate and prior check must include a `checkInput` describing what will be executed. Because `inputDigest` is recalculated from the canonical JSON of `checkId + checkInput`, changing only the digest, question wording, or score cannot make the same check eligible again.

Permissions are applied in this order: denied, approval required, and explicitly allowed. Read-only checks are not allowed automatically. Every evidence-binding relationship must also appear accurately in the hypothesis's `supportingEvidence` or `contradictingEvidence`. Evidence for a confirmed cause must exist in the episode inventory, and its artifact digest and hypothesis ID must be bound by a `supports` relationship. A cause cannot be confirmed if any `refutes` binding exists. A report cannot confirm more than one hypothesis. The skill does not execute the check it proposes.

Validate a generated report as follows:

```bash
node scripts/validate-report.mjs --request tests/fixtures/same-failure.json --request-digest "sha256:..." --report diagnosis.json
```

First, freeze the `requestArtifactDigest` emitted by `digest-request.mjs` in the workflow or caller state. Pass that exact value to `--request-digest` during validation. The validator checks both the original request's canonical digest and the report's `requestArtifactDigest`. A report cannot pass validation if its request was altered to permit a destructive or unapproved check. For stdin, provide `{ "request": ..., "requestArtifactDigest": "sha256:...", "report": ... }`.

## Validation

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm validate
```

## Integration

This skill works on its own and does not depend on the suite or MCP. It can also be included in the [Agent Governance Suite](https://github.com/jaeseongs95/agent-governance-suite) and used with the other governance skills.

`integration/skill-descriptor.json` is the selection adapter for Agent Governance Suite. In an integrated environment, run this skill in a separate recovery workflow instead of modifying the failed run.
