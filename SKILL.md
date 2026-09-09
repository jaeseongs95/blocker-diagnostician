---
name: blocker-diagnostician
description: 반복되는 실패를 관측 episode와 원인 가설로 분리하고, 새 정보를 얻을 수 있는 다음 판별 검사를 정한다. 수정 구현, 일반 설계 비교, 같은 검사의 반복 실행이나 최종 독립 감사에는 사용하지 않는다.
license: MIT
metadata:
  version: "0.1.0"
---

# Blocker Diagnostician

반복 실패를 같은 원인으로 단정하지 않고 증거로 구분한다. 확인된 원인이 있으면 그 근거를 반환하고, 아직 구분할 수 없으면 정보가치가 높고 권한 범위 안에 있는 다음 검사를 하나 정한다.

## 적용 범위

- 같은 작업이 반복해서 실패했거나 수정 뒤에도 실패가 이어질 때 사용한다.
- 사용자가 원인 후보 분리나 다음 판별 검사를 요청했을 때 사용한다.
- 명확한 단일 오타, 일반 코드 리뷰, 설계안의 정책·비용 비교에는 자동 적용하지 않는다.
- 해결안 사이의 안전·비용·정책 판단이 핵심이 되면 별도의 숙의가 필요하다고 보고한다.

## 입력

`FailureEpisodeSet.v1`을 받는다. 각 episode에는 작업, caller가 선별한 안정적인 failure tuple, 환경 digest와 evidence locator를 둔다. 후보 가설과 후보 검사의 의미는 에이전트가 증거를 읽고 작성하며, 스크립트는 fingerprint, 중복 검사, 권한과 결과 분기만 결정적으로 검증한다.

진단 전에 [references/diagnosis-protocol.md](references/diagnosis-protocol.md)를 읽는다.

```bash
node scripts/cluster-failures.mjs --input failures.json
node scripts/cli.mjs --input failures.json
node scripts/validate-report.mjs --request failures.json --report diagnosis.json
```

모든 명령은 stdin도 지원하고 JSON만 stdout으로 반환한다. 제안한 검사를 직접 실행하거나 파일·외부 상태를 바꾸지 않는다.

## 절차

1. episode별 operation, stable tuple과 환경 digest를 보존해 cluster를 만든다.
2. 관측 사실과 가설을 분리하고 각 가설의 지지·반박 evidence를 기록한다.
3. episode의 evidence inventory에 실제로 존재하는 직접 evidence가 있는 가설만 `confirmed`로 인정한다.
4. 이미 같은 입력으로 실행한 검사는 후보에서 제외한다.
5. 서로 다른 두 개 이상의 관측 결과가 가설을 다르게 지지·기각하는 검사만 판별 검사로 인정한다.
6. 정보가치가 높은 검사를 우선하고, 같은 정보가치에서는 위험과 비용이 낮은 검사를 선택한다.
7. `prohibitedChecks`, `approvalRequired`, `allowedChecks` 순으로 권한을 판정한다. read-only 검사도 명시적 허용 없이는 실행 가능하다고 보지 않으며, 승인이 필요한 검사는 실행하지 않고 `NEEDS_APPROVAL`로 반환한다.
8. 새 관측이나 입력 변화가 없으면 같은 검사를 반복하지 않고 필요한 입력을 보고한다.

## 경계

- 진단 결과를 근거로 수정, 설정 변경, 배포를 수행하지 않는다.
- 비슷한 메시지만으로 다른 환경이나 오류 코드를 같은 cluster로 합치지 않는다.
- 최종 diff, rollback과 릴리스 가능성을 판정하지 않는다.
- 실패한 기존 workflow를 수정하거나 되살리지 않는다. 통합 시 별도 recovery workflow를 사용한다.

## 출력

`DiagnosisReport.v1`과 짧은 사용자 요약을 반환한다. cluster, 관측, 가설, 확정 원인 또는 다음 검사, 중단 조건과 `CAUSE_CONFIRMED | NEXT_TEST | NEEDS_INPUT | NEEDS_APPROVAL | BLOCKED`를 구분한다.
