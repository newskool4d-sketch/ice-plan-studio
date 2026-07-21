# Stage 6 레퍼런스 A~G 회귀 corpus

`docs/BASELINE_ANALYSIS.md`에서 확정한 레퍼런스 A~G의 페이지 시퀀스, 기관 유형,
표지 프로필, 항목기호 계열을 재현하는 소유 fixture다. 텍스트 콘텐츠는 전부 합성이며
개인정보·원문 본문을 담지 않는다. 단, 표지의 CI·배너 이미지는 boncheong 템플릿 자산
(`hwpx-toolkit/templates/boncheong/BinData/`, 이미 저장소에 커밋된 파일과 동일 해시)이
생성 과정에서 각 HWPX에 임베드된다 — 신규 자산 노출은 없다.
원 레퍼런스 전체를 복제한 corpus가 아니라, 재기준선에서 확정한 조판 계약을 검증하는
sanitized coverage corpus다.

```powershell
py regenerate.py
py regenerate.py --com
```

각 실행은 7개 Plan IR과 HWPX를 재생성하고 구조·빠른 미리보기 동등성을 검사한다.
`--com`은 한글 COM 열기, 정확한 페이지 수, PDF 변환까지 확인한다(세션 운영은
`scripts/hwp_com_session.py` 공용 모듈). 결과와 fixture 지문은 `verification-log.json`에
기록한다 — `.hwpx`는 ZIP 타임스탬프 때문에 바이트 해시가 재현되지 않으므로
`Contents/section0.xml`의 SHA-256을 조판 결과 지문으로 쓴다.
