# hwpx-toolkit (벤더링 사본)

출처: `~/.agents/skills/hwpx변환` 스킬 (2026-07-19 시점 사본)

타 PC 배포 시 개발자 홈 디렉터리의 스킬 경로에 의존하지 않도록,
HWPX 생성에 필요한 최소 구성만 앱 내부로 복사했다.

## 구성

- `scripts/hwpx_helpers.py` — 문단·표·이미지 XML 생성 헬퍼 (원본 그대로)
- `scripts/build_hwpx.py` — 템플릿 기반 HWPX 조립 (**수정**: lxml → stdlib `xml.etree`,
  메타데이터 갱신을 네임스페이스 안전한 정규식 치환으로 재작성)
- `scripts/fix_namespaces.py` — 한컴 표준 네임스페이스 후처리 (원본 그대로)
- `scripts/finalize_hwpx.py` — linesegarray 제거·레이아웃 검사 (원본 그대로)
- `scripts/validate.py` — 구조 검증 (**수정**: lxml → stdlib `xml.etree`)
- `templates/base/` — HWPX 기본 골격
- `templates/gonmun/` — 공문서 템플릿 (charPr 0~10, paraPr 0~22)

## 동기화 정책

원본 스킬이 업데이트되어도 이 사본은 자동 반영되지 않는다.
스킬 쪽 개선을 가져올 때는 위 수정 사항(lxml 제거)을 다시 적용할 것.

## 런타임 요구사항 (외부 PC)

- Python 3.11+ (`py` 런처 또는 PATH의 `python`)
- 서드파티 패키지 불필요 — 표준 라이브러리만 사용
  (Pillow가 있으면 표지 이미지 원본 비율 계산이 정확해지지만, 없어도
  PNG/JPEG 헤더 직접 파싱으로 동작)
