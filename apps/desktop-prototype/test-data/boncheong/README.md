# boncheong 템플릿 게이트 증거

재설계 0단계 게이트(`docs/REBASELINE_PLAN.md` §6)의 재현 가능한 증거다.
이전에는 산출물이 세션 임시 폴더에만 있어 사라졌기 때문에(§8 자체 발견 사항),
저장소에 영속화한다.

## 재현

```bash
cd apps/desktop-prototype/test-data/boncheong

py regenerate.py          # HWPX 생성 + 구조 검증 + 해시 기록
py regenerate.py --com    # 위 + 한글 COM 실물 열기·PDF 변환 (한컴오피스 필요)
```

`regenerate.py`는 이 폴더의 산출물을 덮어쓰고 `verification-log.json`을 갱신한다.
COM 검증을 건너뛰면 로그에 `"com": {"skipped": true}`로 남는다 — 실행하지 않은
검증을 통과로 표시하지 않는다.

## 파일

| 파일 | 설명 |
|---|---|
| `regenerate.py` | 재생성·검증 스크립트 |
| `boncheong-minimal.model.json` | 입력 fixture (표지 + 본문 + 목록 + 3열 표) |
| `boncheong-minimal.hwpx` | 생성된 HWPX |
| `boncheong-minimal.pdf` | 한글 COM 변환 PDF (육안 대조용) |
| `verification-log.json` | 실행 결과·한글 버전·페이지 수·SHA-256 |

## 이 fixture가 검증하는 것

- 표지 고정 앵커 렌더링 — 슬로건 → 스트라이프 제목 틀 → 연월 → CI → 기관명
- 브랜드 이미지 임베드 — `BinData/image1·image2`, manifest 양방향 일치
- boncheong 스타일 토큰 적용 — 표 머리글/본문이 각각 맑은 고딕 11pt/10pt로 렌더
- 블록 순서 보존 — 문단 → 목록 → 표 (`treatAsChar="1"`)
- 본문 폭 170mm

## 기록된 결과 (2026-07-20)

| 항목 | 결과 |
|---|---|
| 생성 | OK |
| 구조 검증 | PASS (zip 13개, 표 7행) |
| 한글 COM (11.0.0.9136) | 열기 성공, 2페이지, PDF 변환 성공 |

### 알려진 미해결

쪽번호가 표지부터 카운트되어 본문이 `- 2 -`로 시작한다. 표지·목차를 제외하고
본문을 `- 1 -`로 시작하려면 구역(secPr) 분리가 필요하며 2단계 이관 사항이다.

## 라이선스·개인정보

이 폴더의 이미지는 `apps/desktop-prototype/public/branding/`의 자체 브랜드 자산이며
(SHA-256 동일 확인), 레퍼런스 문서의 본문·이미지·개인정보는 포함하지 않는다.
