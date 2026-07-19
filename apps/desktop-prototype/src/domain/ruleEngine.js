const textBlocks = (model) => model.blocks.filter((block) => ['heading', 'paragraph', 'listItem'].includes(block.type));

export function inspectDocumentRules(model) {
  const findings = [];
  const headings = model.blocks.filter((block) => block.type === 'heading');
  const allText = textBlocks(model).map((block) => block.text).join('\n');
  if (!headings.some((heading) => heading.level === 1)) findings.push({ code: 'TITLE-001', title: '문서 제목 누락', severity: 'error', message: '문서 제목(1단계 제목)이 없습니다.' });
  if (!/\d{4}\.\s*\d{1,2}\.\s*\d{1,2}\./.test(allText) && /\d{4}/.test(allText)) findings.push({ code: 'DATE-001', title: '날짜 형식 오류', severity: 'warning', message: '날짜는 YYYY. M. D. 형식으로 표기해야 합니다.' });
  const lastText = textBlocks(model).at(-1)?.text ?? '';
  if (!/끝\.?$/.test(lastText.trim())) findings.push({ code: 'END-001', title: '끝 표시 누락', severity: 'warning', message: '문서 마지막에 끝 표시가 없습니다.' });
  model.blocks.filter((block) => block.type === 'table').forEach((table, index) => {
    if (table.layout?.treatAsChar !== false) findings.push({ code: `TABLE-${index + 1}`, title: '표 글자처럼 취급 설정', severity: 'error', message: '표는 글자처럼 취급하지 않음으로 설정해야 합니다.' });
    if (table.layout?.repeatHeader !== true) findings.push({ code: `TABLE-HEADER-${index + 1}`, title: '표 머리글 반복 미설정', severity: 'warning', message: '표 머리글 반복 설정이 없습니다.' });
  });
  return findings;
}
