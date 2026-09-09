# blocker-diagnostician

반복 실패를 안정적인 fingerprint로 나누고, 원인 가설을 구별할 다음 검사를 정하는 Codex 스킬입니다. 진단 결과를 바탕으로 수정하거나 배포하지 않으며, 새 정보 없이 같은 검사를 반복하지 않습니다.

## 요구 사항

- Node.js 22 이상
- 개발과 잠금 파일 재현에는 pnpm 11 사용

## 직접 실행

```bash
node scripts/cluster-failures.mjs --input tests/fixtures/same-failure.json
node scripts/cli.mjs --input tests/fixtures/same-failure.json
node scripts/cli.mjs < tests/fixtures/same-failure.json
```

후보 가설과 검사의 의미는 evidence를 읽은 호출자가 작성합니다. CLI는 fingerprint 계산, 동일 입력으로 수행한 검사 제외, 결과 분기의 판별 가능성, 권한과 정보가치 순위를 결정적으로 처리합니다. 금지, 승인 필요, 명시적 허용 순으로 권한을 적용하며 read-only 검사도 자동 허용하지 않습니다. 확정 원인의 evidence는 episode inventory에 실제로 존재해야 합니다. 제안한 검사를 직접 실행하지 않습니다.

생성한 보고서는 다음처럼 다시 검사할 수 있습니다.

```bash
node scripts/validate-report.mjs --request tests/fixtures/same-failure.json --report diagnosis.json
```

## 검증

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm validate
```

## 통합

`integration/skill-descriptor.json`은 Agent Governance Suite용 선택 어댑터입니다. 직접 호출은 suite나 MCP에 의존하지 않습니다. 통합 환경에서는 실패한 기존 run을 수정하지 않고 별도 recovery workflow에서 이 스킬을 실행합니다.
