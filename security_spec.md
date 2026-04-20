# Security Specification - 스포츠클럽 출석부

## Data Invariants
1. 모든 부원은 반드시 유효한 `clubId` (badminton, dodgeball 등)를 가져야 합니다.
2. 부원의 학년(1-3), 반(1-20), 번호(1-50)는 지정된 범위 내에 있어야 합니다.
3. 출석 기록은 반드시 존재하는 `memberId`와 유효한 날짜 형식을 가져야 합니다.
4. 출석 상태는 'present' 또는 'absent' 중 하나여야 합니다.

## The "Dirty Dozen" Payloads
1. **Ghost Field Attack**: `members`에 `isAdmin: true` 필드 추가 시도.
2. **Invalid Grade**: `grade: 4` (범위 초과) 저장 시도.
3. **Invalid Status**: `status: 'late'` (허용되지 않은 enum) 저장 시도.
4. **Member ID Poisoning**: 1.5KB 크기의 쓰레기 문자열을 `memberId`로 사용.
5. **Unauthorized Update**: `attendance` 기록의 `date`를 다른 날짜로 변경 시도 (Immutability 위반).
6. **Self-Promotion**: `members` 데이터에 권한 관련 필드 주입.
7. **Invalid Gender**: `gender: 'secret'` 저장 시도.
8. **Date Format Poisoning**: `date: 'today'`와 같이 유효하지 않은 날짜 형식 저장.
9. **Massive String**: `name` 필드에 1MB 크기의 문자열 저장 시도.
10. **Club ID Spoofing**: 존재하지 않는 클럽 ID로 부원 생성.
11. **Orphaned Attendance**: 존재하지 않는 부원 ID에 대한 출석 기록 생성.
12. **Double Record**: 동일한 `memberId`와 `date` 조합에 대해 여러 개의 문서 생성 (문서 ID를 `{memberId}_{date}`로 강제하지 않을 경우).

## Test Runner
`firestore.rules.test.ts` 파일이 위 페이로드들에 대해 `PERMISSION_DENIED`를 반환하는지 검증합니다.
