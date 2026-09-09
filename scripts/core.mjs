import { createHash } from "node:crypto";
import { validateInputSchema, validateReportSchema } from "./schema-validation.mjs";

export class InputError extends Error {
  constructor(message, details = null) {
    super(message);
    this.name = "InputError";
    this.details = details;
  }
}

const volatileKeys = new Set([
  "attemptId", "createdAt", "observedAt", "randomId", "requestId", "tempPath",
  "temporaryPath", "time", "timestamp", "traceId", "updatedAt"
]);

export function normalizeStableValue(value) {
  if (Array.isArray(value)) return value.map(normalizeStableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !volatileKeys.has(key))
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, normalizeStableValue(item)])
    );
  }
  return value;
}

export function canonicalJson(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  throw new InputError("Input contains a non-JSON value.");
}

function sha256(value) {
  return `sha256:${createHash("sha256").update(canonicalJson(value), "utf8").digest("hex")}`;
}

function nonEmptyString(value, name) {
  if (typeof value !== "string" || value.trim().length === 0) throw new InputError(`${name} must be a non-empty string.`);
}

function stringArray(value, name, { min = 0 } = {}) {
  if (!Array.isArray(value) || value.length < min || value.some((item) => typeof item !== "string" || item.trim().length === 0)) {
    throw new InputError(`${name} must be an array of non-empty strings.`);
  }
  if (new Set(value).size !== value.length) throw new InputError(`${name} must not contain duplicates.`);
}

export function validateInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new InputError("Input must be an object.");
  if (!validateInputSchema(input)) throw new InputError("FailureEpisodeSet.v1 validation failed.", { errors: structuredClone(validateInputSchema.errors) });
  if (input.schemaVersion !== "1.0.0") throw new InputError("schemaVersion must be 1.0.0.");
  nonEmptyString(input.objective, "objective");
  nonEmptyString(input.expectedBehavior, "expectedBehavior");
  if (!Array.isArray(input.episodes) || input.episodes.length === 0) throw new InputError("episodes must be a non-empty array.");
  const episodeIds = new Set();
  for (const episode of input.episodes) {
    nonEmptyString(episode.attemptId, "episode.attemptId");
    if (episodeIds.has(episode.attemptId)) throw new InputError(`Duplicate attemptId: ${episode.attemptId}`);
    episodeIds.add(episode.attemptId);
    nonEmptyString(episode.operation, `episode ${episode.attemptId} operation`);
    if (!episode.stableFailureTuple || typeof episode.stableFailureTuple !== "object" || Array.isArray(episode.stableFailureTuple) || Object.keys(episode.stableFailureTuple).length === 0) {
      throw new InputError(`episode ${episode.attemptId} stableFailureTuple must be a non-empty object.`);
    }
    nonEmptyString(episode.environmentDigest, `episode ${episode.attemptId} environmentDigest`);
    stringArray(episode.evidenceRefs, `episode ${episode.attemptId} evidenceRefs`, { min: 1 });
  }
  stringArray(input.constraints, "constraints");
  stringArray(input.accessBlockers, "accessBlockers");
  if (!input.authorization || typeof input.authorization !== "object") throw new InputError("authorization is required.");
  for (const key of ["allowedChecks", "approvalRequired", "prohibitedChecks"]) stringArray(input.authorization[key], `authorization.${key}`);
  if (!Array.isArray(input.attemptedChecks) || !Array.isArray(input.candidateHypotheses) || !Array.isArray(input.candidateTests)) {
    throw new InputError("attemptedChecks, candidateHypotheses, and candidateTests must be arrays.");
  }
  const hypothesisIds = new Set();
  const evidenceInventory = new Set(input.episodes.flatMap((episode) => episode.evidenceRefs));
  for (const hypothesis of input.candidateHypotheses) {
    nonEmptyString(hypothesis.id, "hypothesis.id");
    if (hypothesisIds.has(hypothesis.id)) throw new InputError(`Duplicate hypothesis id: ${hypothesis.id}`);
    hypothesisIds.add(hypothesis.id);
    nonEmptyString(hypothesis.statement, `hypothesis ${hypothesis.id} statement`);
    if (!["input", "state", "permission", "environment", "dependency", "timing", "implementation", "tooling", "unknown"].includes(hypothesis.causalLayer)) throw new InputError(`hypothesis ${hypothesis.id} causalLayer is invalid.`);
    stringArray(hypothesis.supportingEvidence, `hypothesis ${hypothesis.id} supportingEvidence`);
    stringArray(hypothesis.contradictingEvidence, `hypothesis ${hypothesis.id} contradictingEvidence`);
    for (const ref of [...hypothesis.supportingEvidence, ...hypothesis.contradictingEvidence]) {
      if (!evidenceInventory.has(ref)) throw new InputError(`hypothesis ${hypothesis.id} references evidence outside the failure episode inventory: ${ref}.`);
    }
    if (!["open", "supported", "refuted", "confirmed"].includes(hypothesis.state)) throw new InputError(`hypothesis ${hypothesis.id} state is invalid.`);
    if (hypothesis.state === "confirmed" && (hypothesis.supportingEvidence.length === 0 || hypothesis.contradictingEvidence.length > 0)) throw new InputError(`confirmed hypothesis ${hypothesis.id} requires supporting evidence and no unresolved contradiction.`);
  }
  const testIds = new Set();
  for (const candidate of input.candidateTests) {
    nonEmptyString(candidate.checkId, "candidate test checkId");
    if (testIds.has(candidate.checkId)) throw new InputError(`Duplicate candidate test id: ${candidate.checkId}`);
    testIds.add(candidate.checkId);
    validateCandidateTest(candidate, hypothesisIds);
  }
  for (const attempt of input.attemptedChecks) {
    nonEmptyString(attempt.checkId, "attempted checkId");
    nonEmptyString(attempt.inputDigest, `attempted check ${attempt.checkId} inputDigest`);
    nonEmptyString(attempt.resultDigest, `attempted check ${attempt.checkId} resultDigest`);
  }
}

function validateCandidateTest(candidate, hypothesisIds) {
  nonEmptyString(candidate.question, `candidate ${candidate.checkId} question`);
  stringArray(candidate.preconditions, `candidate ${candidate.checkId} preconditions`);
  stringArray(candidate.requiredAuthorization, `candidate ${candidate.checkId} requiredAuthorization`);
  nonEmptyString(candidate.stopCondition, `candidate ${candidate.checkId} stopCondition`);
  nonEmptyString(candidate.inputDigest, `candidate ${candidate.checkId} inputDigest`);
  if (!["read-only", "reversible", "external", "destructive"].includes(candidate.risk)) throw new InputError(`candidate ${candidate.checkId} risk is invalid.`);
  if (!Number.isInteger(candidate.informationGain) || candidate.informationGain < 1 || candidate.informationGain > 5) throw new InputError(`candidate ${candidate.checkId} informationGain must be 1..5.`);
  if (!Number.isInteger(candidate.cost) || candidate.cost < 1 || candidate.cost > 5) throw new InputError(`candidate ${candidate.checkId} cost must be 1..5.`);
  if (!Array.isArray(candidate.outcomes) || candidate.outcomes.length < 2) throw new InputError(`candidate ${candidate.checkId} requires at least two outcomes.`);
  const implications = new Set();
  for (const outcome of candidate.outcomes) {
    nonEmptyString(outcome.observation, `candidate ${candidate.checkId} outcome observation`);
    stringArray(outcome.supportsHypotheses, `candidate ${candidate.checkId} supportsHypotheses`);
    stringArray(outcome.refutesHypotheses, `candidate ${candidate.checkId} refutesHypotheses`);
    for (const id of [...outcome.supportsHypotheses, ...outcome.refutesHypotheses]) if (!hypothesisIds.has(id)) throw new InputError(`candidate ${candidate.checkId} references unknown hypothesis ${id}.`);
    implications.add(canonicalJson({ supports: [...outcome.supportsHypotheses].sort(), refutes: [...outcome.refutesHypotheses].sort() }));
  }
  if (implications.size < 2) throw new InputError(`candidate ${candidate.checkId} outcomes do not discriminate between hypotheses.`);
}

export function clusterFailures(input) {
  validateInput(input);
  const clusters = new Map();
  for (const episode of input.episodes) {
    const stableFailureTuple = normalizeStableValue(episode.stableFailureTuple);
    const signature = { operation: episode.operation, stableFailureTuple, environmentDigest: episode.environmentDigest };
    const fingerprint = sha256(signature);
    const existing = clusters.get(fingerprint);
    if (existing) existing.episodeIds.push(episode.attemptId);
    else clusters.set(fingerprint, { fingerprint, episodeIds: [episode.attemptId], ...signature });
  }
  return [...clusters.values()];
}

const riskRank = { "read-only": 0, reversible: 1, external: 2, destructive: 3 };

function isDuplicate(candidate, attemptedChecks) {
  return attemptedChecks.some((attempt) => attempt.checkId === candidate.checkId && attempt.inputDigest === candidate.inputDigest);
}

function rankTests(left, right) {
  return right.informationGain - left.informationGain || riskRank[left.risk] - riskRank[right.risk] || left.cost - right.cost || left.checkId.localeCompare(right.checkId);
}

function authorizationDisposition(candidate, authorization) {
  const authorities = [candidate.checkId, ...candidate.requiredAuthorization];
  if (authorities.some((item) => authorization.prohibitedChecks.includes(item))) return "prohibited";
  if (authorities.some((item) => authorization.approvalRequired.includes(item))) return "approval-required";
  if (authorities.every((item) => authorization.allowedChecks.includes(item))) return "allowed";
  return "approval-required";
}

export function analyzeDiagnosis(input) {
  validateInput(input);
  const failureClusters = clusterFailures(input);
  const observations = input.episodes.map((episode, index) => ({
    id: `OBS-${String(index + 1).padStart(3, "0")}`,
    statement: `Attempt ${episode.attemptId} failed during ${episode.operation} in environment ${episode.environmentDigest}.`,
    evidenceRefs: [...episode.evidenceRefs]
  }));
  const hypotheses = input.candidateHypotheses.map((item) => structuredClone(item));
  const confirmed = hypotheses.find((item) => item.state === "confirmed" && item.supportingEvidence.length > 0);
  const limitations = [];

  if (input.accessBlockers.length > 0) {
    return {
      schemaVersion: "1.0.0",
      failureClusters,
      observations,
      hypotheses,
      nextDiscriminatingTest: null,
      confirmedCause: null,
      recommendedNextAction: "Provide access to the blocked evidence or tool before continuing diagnosis.",
      limitations: [...input.accessBlockers],
      verdict: "BLOCKED"
    };
  }

  if (confirmed) {
    return {
      schemaVersion: "1.0.0",
      failureClusters,
      observations,
      hypotheses,
      nextDiscriminatingTest: null,
      confirmedCause: { hypothesisId: confirmed.id, statement: confirmed.statement, evidenceRefs: [...confirmed.supportingEvidence] },
      recommendedNextAction: "Use the confirmed cause as input to a separately authorized remediation task.",
      limitations,
      verdict: "CAUSE_CONFIRMED"
    };
  }

  const notRepeated = [];
  const available = [];
  const approvalNeeded = [];
  for (const candidate of input.candidateTests) {
    if (isDuplicate(candidate, input.attemptedChecks)) {
      notRepeated.push(candidate.checkId);
      continue;
    }
    const disposition = authorizationDisposition(candidate, input.authorization);
    if (disposition === "prohibited") {
      limitations.push(`Candidate ${candidate.checkId} is prohibited by the authorization boundary.`);
      continue;
    }
    if (disposition === "approval-required") approvalNeeded.push(candidate);
    else available.push(candidate);
  }
  if (notRepeated.length > 0) limitations.push(`Already attempted without changed input: ${notRepeated.join(", ")}.`);
  available.sort(rankTests);
  approvalNeeded.sort(rankTests);
  const selected = available[0] ?? approvalNeeded[0] ?? null;
  const verdict = available.length > 0 ? "NEXT_TEST" : approvalNeeded.length > 0 ? "NEEDS_APPROVAL" : "NEEDS_INPUT";
  const recommendedNextAction = verdict === "NEXT_TEST"
    ? `Run ${selected.checkId} within the recorded authorization boundary and capture the observed branch.`
    : verdict === "NEEDS_APPROVAL"
      ? `Obtain the listed authorization before running ${selected.checkId}.`
      : "Provide a new discriminating candidate, changed input, or additional evidence; do not repeat an unchanged check.";
  return {
    schemaVersion: "1.0.0",
    failureClusters,
    observations,
    hypotheses,
    nextDiscriminatingTest: selected ? structuredClone(selected) : null,
    confirmedCause: null,
    recommendedNextAction,
    limitations,
    verdict
  };
}

export function validateReport(report, request = null) {
  const errors = [];
  if (!report || typeof report !== "object" || Array.isArray(report)) return ["report must be an object"];
  if (!validateReportSchema(report)) errors.push(`report schema validation failed: ${JSON.stringify(validateReportSchema.errors)}`);
  if (report.schemaVersion !== "1.0.0") errors.push("report.schemaVersion must be 1.0.0");
  if (!Array.isArray(report.failureClusters)) errors.push("failureClusters must be an array");
  if (!Array.isArray(report.observations)) errors.push("observations must be an array");
  if (!Array.isArray(report.hypotheses)) errors.push("hypotheses must be an array");
  if (!Array.isArray(report.limitations)) errors.push("limitations must be an array");
  if (!["CAUSE_CONFIRMED", "NEXT_TEST", "NEEDS_INPUT", "NEEDS_APPROVAL", "BLOCKED"].includes(report.verdict)) errors.push("verdict is invalid");
  if (report.verdict === "CAUSE_CONFIRMED") {
    if (!report.confirmedCause || !Array.isArray(report.confirmedCause.evidenceRefs) || report.confirmedCause.evidenceRefs.length === 0) errors.push("CAUSE_CONFIRMED requires direct evidence");
    const hypothesis = report.hypotheses?.find((item) => item.id === report.confirmedCause?.hypothesisId);
    if (!hypothesis || hypothesis.state !== "confirmed" || hypothesis.contradictingEvidence?.length > 0) errors.push("confirmedCause must reference an uncontradicted confirmed hypothesis");
    if (!request) errors.push("the request is required to bind confirmed evidence to the failure episode inventory");
    else {
      const inventory = new Set(request.episodes.flatMap((episode) => episode.evidenceRefs));
      for (const ref of report.confirmedCause?.evidenceRefs ?? []) if (!inventory.has(ref)) errors.push(`confirmedCause references evidence outside the failure episode inventory: ${ref}`);
    }
  }
  if (["NEXT_TEST", "NEEDS_APPROVAL"].includes(report.verdict)) {
    const candidate = report.nextDiscriminatingTest;
    if (!candidate) errors.push(`${report.verdict} requires nextDiscriminatingTest`);
    else {
      const implications = new Set((candidate.outcomes ?? []).map((outcome) => canonicalJson({ supports: [...(outcome.supportsHypotheses ?? [])].sort(), refutes: [...(outcome.refutesHypotheses ?? [])].sort() })));
      if (!Array.isArray(candidate.outcomes) || candidate.outcomes.length < 2 || implications.size < 2) errors.push("next test must have discriminating outcomes");
      if (!candidate.stopCondition) errors.push("next test requires a stop condition");
      if (request?.attemptedChecks?.some((attempt) => attempt.checkId === candidate.checkId && attempt.inputDigest === candidate.inputDigest)) errors.push("next test repeats an attempted check without changed input");
    }
  }
  if (request && Array.isArray(report.failureClusters)) {
    try {
      const expected = analyzeDiagnosis(request);
      const expectedIds = request.episodes.map((item) => item.attemptId).sort();
      const actualIds = report.failureClusters.flatMap((item) => item.episodeIds).sort();
      if (canonicalJson(expectedIds) !== canonicalJson(actualIds)) errors.push("failure clusters do not cover episodes exactly once");
      if (canonicalJson(expected.failureClusters) !== canonicalJson(report.failureClusters)) errors.push("failure cluster fingerprints do not match the request-derived clusters");
      if (canonicalJson(expected.observations) !== canonicalJson(report.observations)) errors.push("observations do not match the failure episode evidence inventory");
      if (canonicalJson(expected.hypotheses) !== canonicalJson(report.hypotheses)) errors.push("hypotheses do not match the validated request");
      if (canonicalJson(expected.nextDiscriminatingTest) !== canonicalJson(report.nextDiscriminatingTest)) errors.push("selected test does not match request authorization, duplicate checks, and ranking");
      if (canonicalJson(expected.confirmedCause) !== canonicalJson(report.confirmedCause)) errors.push("confirmedCause does not match request evidence");
      if (canonicalJson(expected.limitations) !== canonicalJson(report.limitations)) errors.push("limitations do not match request authorization and evidence");
      if (expected.recommendedNextAction !== report.recommendedNextAction) errors.push("recommendedNextAction does not match the validated selection");
      if (expected.verdict !== report.verdict) errors.push(`verdict must be ${expected.verdict}`);
    } catch (error) {
      errors.push(`request cannot substantiate report: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return errors;
}
