# Diagnosis Protocol

## 관측과 가설

로그, 테스트 결과, 환경 digest와 직접 검사 결과만 관측으로 기록한다. 가설의 지지·반박 evidence ref는 적어도 한 episode의 evidence inventory에 존재해야 한다. “이 원인일 가능성이 높다”는 가설이며, inventory의 직접 evidence가 연결되기 전에는 원인으로 확정하지 않는다.

가설은 필요에 따라 입력, 상태, 권한, 환경, dependency, timing, 구현, 도구 계층으로 나눈다. 분류표를 채우기 위해 근거 없는 가설을 만들지 않는다.

## Failure fingerprint

caller가 제공한 stable tuple과 operation, environment digest를 canonical JSON으로 직렬화해 SHA-256을 계산한다. timestamp, 임시 경로, request·trace ID 같은 변동 필드는 제외할 수 있지만 오류 코드, 핵심 stack frame, dependency 또는 환경 차이는 보존한다. 동일 fingerprint만 기본적으로 같은 cluster다.

## 다음 판별 검사

유효한 검사는 다음 조건을 모두 만족한다.

- 서로 구별되는 예상 결과가 둘 이상이다.
- 각 결과가 어떤 가설을 지지하거나 기각하는지 다르다.
- 이미 같은 입력으로 실행한 검사가 아니다.
- 실행 전 조건, 위험, 필요한 권한과 중단 조건이 있다.

후보는 정보가치가 큰 순서로 보고, 값이 같으면 read-only, reversible, external, destructive 순으로 위험이 낮은 검사를 우선한다. 이후 비용과 ID로 결정적인 순서를 만든다. 승인이 필요한 검사는 제안만 하고 실행하지 않는다.

권한은 `prohibitedChecks`가 최우선이고, 다음이 `approvalRequired`, 마지막이 `allowedChecks`다. check ID나 `requiredAuthorization` 중 하나라도 금지 목록에 있으면 선택하지 않는다. 승인 목록에 있거나 허용 목록에 명시되지 않은 검사는 `NEEDS_APPROVAL`로만 제안한다. read-only 위험 등급은 명시적 허용을 대신하지 않는다.

## 종료

- 직접 evidence로 한 가설이 확인되면 `CAUSE_CONFIRMED`
- 안전하고 승인된 다음 검사가 있으면 `NEXT_TEST`
- 다음 검사에 승인이 필요하면 `NEEDS_APPROVAL`
- episode, evidence 또는 후보가 부족하면 `NEEDS_INPUT`
- 필수 자료나 도구에 접근할 수 없으면 `BLOCKED`

새 정보 없이 같은 검사를 다시 제안하지 않는다. 진단 뒤 실제 수정은 별도 작업으로 다룬다.
