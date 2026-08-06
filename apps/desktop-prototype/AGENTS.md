# Prototype Instructions

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

본문 구조 제목은 `Ⅰ. 제목`, `[과제1] 제목` 또는 `[과제 1] 제목`, `[과제 1-1] 제목`으로 시작할 때 같은 1행 2열 표형 제목 구조를 사용한다. 로마숫자 장 제목을 가장 크게 표시하고, 과제 및 세부과제 제목은 각각 더 작은 크기와 구분 색상을 적용한다. 빠른 미리보기와 HWPX 출력은 동일한 계층과 표현을 유지한다.

가져온 HWPX에서는 `1. 제목`, `과제 1. 제목`, `과제 1-1. 제목`도 위 구조 제목 규칙에 포함한다. `가. 제목` 계열은 표가 아닌 간격이 있는 소제목 문단으로 유지한다.

가져온 HWPX의 본문 시작에는 표지 색띠 구조를 축소한 3행 4열 제목표를 추가하고, 원문에 있던 중복 문서 제목 표·문단은 제거한다. 본문은 함초롬바탕 또는 휴먼명조 13pt·양쪽정렬·170% 줄간격으로 정규화하고, 표는 열폭·행높이를 보존하되 제목부와 내용부 모두 맑은 고딕 11pt로 통일한다. `가.·나.·다.` 소제목 앞에는 한 줄 간격을 둔다.

본문 시작 제목표 아래의 기관명·부서명은 유지하되, 문서 제목을 별도 문단이나 표로 반복하지 않는다. 기관명·부서명 다음에는 바로 첫 구조 제목(`1. 추진 배경` 등)이 이어져야 한다.

검토 메모가 포함된 HWPX는 정책 본문을 삭제하지 않는다. paraPr 12 검토 메모와 구분선 `---`만 제거하며, 제거 건수와 본문 보존을 실제 파일 회귀검증으로 확인한다.

가져온 HWPX는 논리 구조 쪽 수와 자동 넘침이 반영된 실제 쪽 수가 다를 수 있으므로 실조판 SVG를 기본 작업 화면으로 삼고 실제 쪽 전체를 탐색하게 한다. 이 경우 논리 구조 미리보기와 실제 쪽을 같은 번호라고 가정하는 나란히 비교는 제공하지 않는다.
