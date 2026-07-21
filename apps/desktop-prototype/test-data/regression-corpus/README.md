# Stage 6 레퍼런스 A~G 회귀 corpus

`docs/BASELINE_ANALYSIS.md`에서 확정한 레퍼런스 A~G의 페이지 시퀀스, 기관 유형,
표지 프로필, 항목기호 계열을 개인정보·원문 콘텐츠 없이 재현하는 소유 fixture다.
원 레퍼런스 전체를 복제한 corpus가 아니라, 재기준선에서 확정한 조판 계약을 검증하는
sanitized coverage corpus다.

```powershell
py regenerate.py
py regenerate.py --com
```

각 실행은 7개 Plan IR과 HWPX를 재생성하고 구조·빠른 미리보기 동등성을 검사한다.
`--com`은 한글 COM 열기, 정확한 페이지 수, PDF 변환까지 확인한다. 결과와 SHA-256은
`verification-log.json`에 기록한다.
