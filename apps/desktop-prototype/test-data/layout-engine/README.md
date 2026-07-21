# Stage 2 조판 엔진 회귀 corpus

본청 A와 직속기관 B·F·G 표지 프로필, 본문, 170mm 표 너비 및 9개 페이지 유형을 검증하는 소유 fixture다.

```powershell
py regenerate.py --com
```

생성 스크립트는 구조 검증과 한글 COM 열기·PDF 변환 결과를 `verification-log.json`에 남긴다(COM 세션·지문 기록은 `scripts/hwp_com_session.py` 공용 모듈). 텍스트 콘텐츠는 전부 합성이며 원 레퍼런스 본문·개인정보를 담지 않는다. 단, 표지의 CI·배너 이미지는 boncheong 템플릿 자산(`hwpx-toolkit/templates/boncheong/BinData/`, 이미 저장소에 커밋된 파일과 동일)이 각 HWPX에 임베드된다.
