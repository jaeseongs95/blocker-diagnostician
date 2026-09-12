# blocker-diagnostician

한국어 | [English](README.en.md)

반복되는 실패를 안정적인 fingerprint로 묶고, 원인 가설을 구분할 다음 검사를 정하는 Codex 스킬입니다. 진단 결과를 바탕으로 수정하거나 배포하지 않으며, 새 정보 없이 같은 검사를 반복하지 않습니다.

## 요구 사항

- Node.js 22 이상
- 개발과 잠금 파일 재현에는 pnpm 11 사용

## 직접 실행

```bash
node scripts/cluster-failures.mjs --input tests/fixtures/same-failure.json
node scripts/digest-request.mjs --input tests/fixtures/same-failure.json
node scripts/cli.mjs --input tests/fixtures/same-failure.json
node scripts/cli.mjs < tests/fixtures/same-failure.json
```

후보 가설과 검사가 뜻하는 바는 evidence를 읽은 호출자가 작성합니다. CLI는 fingerprint 계산, 같은 입력으로 이미 수행한 검사 제외, 결과 분기의 판별 가능성, 권한과 정보 가치의 순위를 결정적으로 처리합니다. 후보와 과거 검사에는 실행 대상을 설명하는 `checkInput`을 포함해야 합니다. `inputDigest`는 `checkId + checkInput`의 canonical JSON에서 다시 계산되므로 digest, 질문 문구나 평가 점수만 바꿔 같은 검사를 다시 제안할 수 없습니다.

권한은 금지, 승인 필요, 명시적 허용 순으로 적용하며 read-only 검사도 자동으로 허용하지 않습니다. 각 evidence binding의 관계는 해당 가설의 `supportingEvidence` 또는 `contradictingEvidence`에도 정확히 기록해야 합니다. 확정 원인의 evidence는 episode inventory에 존재해야 하며, artifact digest와 가설 ID가 `supports` 관계로 결속돼야 합니다. `refutes` binding이 하나라도 있으면 원인을 확정할 수 없습니다. 한 보고서에서 둘 이상의 가설을 확정할 수 없으며, 스킬은 제안한 검사를 직접 실행하지 않습니다.

생성한 보고서는 다음처럼 다시 검사할 수 있습니다.

```bash
node scripts/validate-report.mjs --request tests/fixtures/same-failure.json --request-digest "sha256:..." --report diagnosis.json
```

먼저 `digest-request.mjs`가 출력한 `requestArtifactDigest`를 workflow나 호출자 상태에 고정하고, 검증할 때 그 값을 그대로 `--request-digest`에 전달합니다. 검증기는 원본 request의 canonical digest와 보고서의 `requestArtifactDigest`를 모두 대조합니다. request를 바꿔 파괴적 검사나 승인되지 않은 검사를 허용한 보고서는 검증을 통과하지 못합니다. stdin을 사용할 때는 `{ "request": ..., "requestArtifactDigest": "sha256:...", "report": ... }`를 전달합니다.

## 검증

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm validate
```

## 통합

이 스킬은 단독으로 사용할 수 있으며 suite나 MCP에 의존하지 않습니다. 필요하면 [Agent Governance Suite](https://github.com/jaeseongs95/agent-governance-suite)에 편입해 다른 거버넌스 스킬과 함께 사용할 수도 있습니다.

`integration/skill-descriptor.json`은 Agent Governance Suite용 선택 어댑터입니다. 통합 환경에서는 실패한 기존 run을 수정하지 않고 별도 recovery workflow에서 이 스킬을 실행합니다.
