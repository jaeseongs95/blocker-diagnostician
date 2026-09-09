import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { analyzeDiagnosis, clusterFailures, InputError, validateReport } from "../scripts/core.mjs";
import { compileAllSchemas } from "../scripts/schema-validation.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixture = async (name) => JSON.parse(await readFile(path.join(root, "tests", "fixtures", `${name}.json`), "utf8"));

test("normal: volatile tuple fields do not split the same failure", async () => {
  const input = await fixture("same-failure");
  const clusters = clusterFailures(input);
  assert.equal(clusters.length, 1);
  assert.deepEqual(clusters[0].episodeIds, ["attempt-1", "attempt-2"]);
  assert.equal(clusters[0].stableFailureTuple.timestamp, undefined);
});

test("normal: chooses the highest-information authorized discriminating test", async () => {
  const input = await fixture("same-failure");
  const report = analyzeDiagnosis(input);
  assert.equal(report.verdict, "NEXT_TEST");
  assert.equal(report.nextDiscriminatingTest.checkId, "read-cache-acl");
  assert.deepEqual(validateReport(report, input), []);
});

test("boundary: same message in different environments stays separate", async () => {
  const clusters = clusterFailures(await fixture("similar-message"));
  assert.equal(clusters.length, 2);
});

test("normal: confirmed cause requires and preserves direct evidence", async () => {
  const report = analyzeDiagnosis(await fixture("confirmed"));
  assert.equal(report.verdict, "CAUSE_CONFIRMED");
  assert.deepEqual(report.confirmedCause.evidenceRefs, ["tool:file-stat"]);
});

test("boundary: an external check without approval is not selected as executable", async () => {
  const report = analyzeDiagnosis(await fixture("approval-needed"));
  assert.equal(report.verdict, "NEEDS_APPROVAL");
  assert.equal(report.nextDiscriminatingTest.checkId, "production-read");
});

test("authorization is explicit even for read-only checks", async () => {
  const input = await fixture("same-failure");
  input.authorization.allowedChecks = [];
  const report = analyzeDiagnosis(input);
  assert.equal(report.verdict, "NEEDS_APPROVAL");
  assert.equal(report.nextDiscriminatingTest.checkId, "read-cache-acl");
});

test("prohibited authorization overrides approval and allowed lists", async () => {
  const input = await fixture("same-failure");
  input.authorization.approvalRequired.push("read-cache-acl");
  input.authorization.prohibitedChecks.push("read-cache-acl");
  const report = analyzeDiagnosis(input);
  assert.equal(report.verdict, "NEEDS_INPUT");
  assert.equal(report.nextDiscriminatingTest, null);
  assert.ok(report.limitations.some((item) => item.includes("prohibited")));
});

test("expected failure: unchanged attempted check is not repeated", async () => {
  const report = analyzeDiagnosis(await fixture("duplicate-check"));
  assert.equal(report.verdict, "NEEDS_INPUT");
  assert.equal(report.nextDiscriminatingTest, null);
  assert.match(report.limitations[0], /Already attempted/u);
});

test("expected failure: non-discriminating outcomes are rejected", async () => {
  const input = await fixture("same-failure");
  input.candidateTests[0].outcomes[1] = structuredClone(input.candidateTests[0].outcomes[0]);
  assert.throws(() => analyzeDiagnosis(input), InputError);
});

test("report validator detects a repeated proposed test", async () => {
  const input = await fixture("same-failure");
  const report = analyzeDiagnosis(input);
  input.attemptedChecks.push({ checkId: "read-cache-acl", inputDigest: "input:acl-v1", resultDigest: "result:new" });
  assert.ok(validateReport(report, input).some((item) => item.includes("repeats")));
});

test("JSON CLI accepts a Windows-style absolute path", async () => {
  const file = path.join(root, "tests", "fixtures", "same-failure.json");
  const run = spawnSync(process.execPath, [path.join(root, "scripts", "cli.mjs"), "--input", file], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.equal(JSON.parse(run.stdout).verdict, "NEXT_TEST");
});

test("JSON CLI reads stdin and writes only JSON", async () => {
  const input = await fixture("same-failure");
  const run = spawnSync(process.execPath, [path.join(root, "scripts", "cli.mjs")], { encoding: "utf8", input: JSON.stringify(input) });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.equal(JSON.parse(run.stdout).verdict, "NEXT_TEST");
});

test("expected failure: contradicted cause cannot be confirmed", async () => {
  const input = await fixture("confirmed");
  input.candidateHypotheses[0].contradictingEvidence.push("tool:counterexample");
  assert.throws(() => analyzeDiagnosis(input), InputError);
});

test("expected failure: confirmed evidence must exist in the episode inventory", async () => {
  const input = await fixture("confirmed");
  input.candidateHypotheses[0].supportingEvidence = ["tool:fabricated"];
  assert.throws(() => analyzeDiagnosis(input), /outside the failure episode inventory/u);
  const run = spawnSync(process.execPath, [path.join(root, "scripts", "cli.mjs")], { encoding: "utf8", input: JSON.stringify(input) });
  assert.equal(run.status, 2);
  assert.equal(JSON.parse(run.stdout).error.code, "INVALID_INPUT");
});

test("input schema rejects omitted lastKnownGood and episode changeSummary", async () => {
  const missingLastKnownGood = await fixture("same-failure");
  delete missingLastKnownGood.lastKnownGood;
  assert.throws(() => analyzeDiagnosis(missingLastKnownGood), /FailureEpisodeSet.v1 validation failed/u);

  const missingChange = await fixture("same-failure");
  delete missingChange.episodes[0].changeSummary;
  const run = spawnSync(process.execPath, [path.join(root, "scripts", "cli.mjs")], { encoding: "utf8", input: JSON.stringify(missingChange) });
  assert.equal(run.status, 2);
  assert.equal(JSON.parse(run.stdout).error.code, "INVALID_INPUT");
});

test("report validator rechecks authorization and cluster fingerprints", async () => {
  const input = await fixture("same-failure");
  const report = analyzeDiagnosis(input);
  const prohibitedReport = structuredClone(report);
  prohibitedReport.nextDiscriminatingTest.checkId = "delete-cache";
  assert.ok(validateReport(prohibitedReport, input).some((item) => item.includes("authorization")));

  input.authorization.prohibitedChecks.push("read-cache-acl");
  let errors = validateReport(report, input);
  assert.ok(errors.some((item) => item.includes("authorization")));
  const run = spawnSync(process.execPath, [path.join(root, "scripts", "validate-report.mjs")], {
    encoding: "utf8",
    input: JSON.stringify({ request: input, report })
  });
  assert.equal(run.status, 1);
  assert.equal(JSON.parse(run.stdout).valid, false);

  const cleanInput = await fixture("same-failure");
  const forged = analyzeDiagnosis(cleanInput);
  forged.failureClusters[0].fingerprint = "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";
  errors = validateReport(forged, cleanInput);
  assert.ok(errors.some((item) => item.includes("fingerprints")));
});

test("all JSON Schemas compile in strict Ajv mode", () => {
  assert.doesNotThrow(() => compileAllSchemas());
});

test("runtime scripts do not import Agent Governance Suite", async () => {
  const files = ["core.mjs", "cli.mjs", "cluster-failures.mjs", "validate-report.mjs"];
  for (const file of files) {
    const content = await readFile(path.join(root, "scripts", file), "utf8");
    assert.equal(content.includes("agent-governance-suite/"), false);
  }
});
