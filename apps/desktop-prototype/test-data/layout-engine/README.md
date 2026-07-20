# Stage 2 조판 엔진 회귀 corpus

본청 A와 직속기관 B·F·G 표지 프로필, 본문, 170mm 표 너비 및 9개 페이지 유형을 검증하는 소유 fixture다.

```powershell
py regenerate.py --com
```

생성 스크립트는 구조 검증과 한글 COM 열기·PDF 변환 결과를 `verification-log.json`에 남긴다. 원 레퍼런스 문서·이미지·개인정보는 포함하지 않는다.
