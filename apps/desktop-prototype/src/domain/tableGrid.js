// 표 텍스트의 단일 원천 규칙 (V4 13단계, I-1·I-2).
//
// 표 블록은 table.cells(원본 셀)와 header·rows(호환 필드)를 함께 가진다. 둘이 어긋나면
// cells가 원천이다 — 규칙 자동수정이 cells는 올바른 칸에 고쳤는데 header·rows만 한 행
// 밀려 훼손된 저장본이 실재한다(v0.12.0~0.12.11). cells가 없는 표(요약·자리표시 파생 표,
// 브라우저 파서 표)는 header·rows를 쓰되, 미리보기 투영이 rows 앞에 머리글을 한 번 더
// 넣은 옛 저장 모양을 걸러낸다. scripts/model_to_hwpx.py table_grid와 같은 규칙이어야
// 미리보기와 HWPX가 같다.

const text = (value) => String(value ?? '');

function sameRow(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function tableGrid(block) {
  const cells = block?.table?.cells;
  if (Array.isArray(cells) && cells.length) return cells.map((row) => row.map((cell) => text(cell?.text)));
  const header = Array.isArray(block?.header) ? block.header.map(text) : [];
  let rows = Array.isArray(block?.rows) ? block.rows.map((row) => row.map(text)) : [];
  if (rows.length && sameRow(rows[0], header)) rows = rows.slice(1);
  return [header, ...rows];
}

// header·rows를 격자에서 새 배열로 다시 만든다 — 배열 공유(header === rows[0])가
// 남으면 한쪽 수정이 다른 쪽을 조용히 바꾼다(I-2).
export function withTableGrid(block, grid) {
  return { ...block, header: [...(grid[0] || [])], rows: grid.slice(1).map((row) => [...row]) };
}
