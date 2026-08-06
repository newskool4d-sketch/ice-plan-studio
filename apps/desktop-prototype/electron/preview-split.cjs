const AdmZip = require('adm-zip');

// kordoc v4.1.0의 reflow 렌더러는 pageBreak="1"(하드 쪽 나눔)을 생성만 하고
// 렌더 시 읽지 않는다(dist 전수 확인 — 읽는 코드 없음). 그대로 렌더하면
// 표지와 본문이 한 캔버스에 겹친다. 우회: 생성된 HWPX의 section0.xml을
// 쪽 나눔 문단 경계로 분할해 조각별 HWPX를 만들고, 각각 렌더한 결과를
// 세로로 이어 붙인다. 조각 안에서의 자동 넘침(분량 초과)은 kordoc이
// 처리하므로, 하드 나눔+자동 넘침이 모두 반영된 근사 조판이 된다.

// model_to_hwpx.py page_break_para()가 생성하는 마커와 정확히 일치해야 한다.
const PAGE_BREAK_PARA = /<hp:p id="\d+" paraPrIDRef="0" styleIDRef="0" pageBreak="1" columnBreak="0" merged="0">(?:<hp:ctrl>[\s\S]*?<\/hp:ctrl>)*<hp:run charPrIDRef="0">(?:<hp:ctrl>[\s\S]*?<\/hp:ctrl>)*<hp:t\/><\/hp:run><\/hp:p>/g;

function splitSection(sectionXml) {
  const open = sectionXml.indexOf('>', sectionXml.indexOf('<hs:sec')) + 1;
  const close = sectionXml.lastIndexOf('</hs:sec>');
  const head = sectionXml.slice(0, open);
  const tail = sectionXml.slice(close);
  const chunks = sectionXml.slice(open, close).split(PAGE_BREAK_PARA).filter((chunk) => chunk.trim());
  return chunks.map((chunk) => head + chunk + tail);
}

function chunkBuffers(hwpxBuffer) {
  const source = new AdmZip(hwpxBuffer);
  const section = source.readAsText('Contents/section0.xml');
  return splitSection(section).map((chunkXml) => {
    const zip = new AdmZip(hwpxBuffer);
    zip.updateFile('Contents/section0.xml', Buffer.from(chunkXml, 'utf8'));
    return zip.toBuffer();
  });
}

function stripToInnerSvg(svg, y) {
  const withoutDecl = svg.replace(/^<\?xml[^?]*\?>\s*/, '');
  return withoutDecl.replace(/<svg /, `<svg y="${y}" `);
}

function minimumPhysicalHeight(rendered) {
  const width = Number(rendered?.width) || 595;
  const pageCount = Math.max(1, Number(rendered?.pageCount) || 1);
  const a4PageHeight = Math.round(width * (297 / 210));
  return Math.max(Number(rendered?.height) || 0, a4PageHeight * pageCount);
}

function svgBody(svg) {
  return String(svg || '')
    .replace(/^<\?xml[^?]*\?>\s*/, '')
    .replace(/^<svg\b[^>]*>/, '')
    .replace(/<\/svg>\s*$/, '');
}

/**
 * kordoc이 각 쪽에 붙이는 `<g data-page="N" transform="translate(0 Y)">`에서 실제 쪽
 * 오프셋을 읽는다. 균등 분할(전체 높이 ÷ 쪽수)로 대신하면 안 된다 — 실측에서 균등값
 * 864.45pt 대 실제 간격 865.86pt로 쪽마다 1.4pt씩 어긋나, 17쪽 문서의 마지막 쪽은
 * 약 23pt가 밀려 아랫쪽 내용이 잘려 들어온다.
 */
function pageOffsets(svg) {
  return [...String(svg || '').matchAll(/<g[^>]*\bdata-page="\d+"[^>]*\btransform="translate\(\s*[\d.-]+[\s,]+([\d.-]+)\s*\)"/g)]
    .map((match) => Number(match[1]))
    .filter((value) => Number.isFinite(value));
}

function sliceRenderedPages(rendered) {
  const width = Number(rendered?.width) || 595;
  const pageCount = Math.max(1, Number(rendered?.pageCount) || 1);
  const totalHeight = minimumPhysicalHeight(rendered);
  const offsets = pageOffsets(rendered?.svg);
  const usable = offsets.length === pageCount ? offsets : null;
  const uniformHeight = totalHeight / pageCount;
  const content = svgBody(rendered?.svg);
  return Array.from({ length: pageCount }, (_value, index) => {
    const offset = usable ? usable[index] : uniformHeight * index;
    // 마지막 쪽은 뒤따르는 마커가 없다. 균등 추정값 대신 직전 쪽 간격을 그대로 써야
    // 마지막 쪽만 높이가 다르게 잘리지 않는다.
    const step = usable
      ? (usable[index + 1] ?? offset + (index > 0 ? offset - usable[index - 1] : uniformHeight))
      : uniformHeight * (index + 1);
    const pageHeight = Math.max(1, step - offset);
    return (
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${pageHeight}" `
      + `viewBox="0 0 ${width} ${pageHeight}"><rect width="${width}" height="${pageHeight}" fill="#fff"/>`
      + `<g transform="translate(0 -${offset})">${content}</g></svg>`
    );
  });
}

async function renderPagedPreview(hwpxBuffer, renderHwpxToSvg) {
  const parts = [];
  const pages = [];
  let pageCount = 0;
  let width = 0;
  let height = 0;
  const warnings = [];
  const stats = { texts: 0, images: 0, tables: 0 };
  for (const buffer of chunkBuffers(hwpxBuffer)) {
    const r = await renderHwpxToSvg(buffer, { reflow: true, reflowMode: 'keep' });
    parts.push(stripToInnerSvg(r.svg, height));
    pages.push(...sliceRenderedPages(r));
    pageCount += r.pageCount;
    width = Math.max(width, r.width);
    height += minimumPhysicalHeight(r);
    warnings.push(...(r.warnings || []));
    for (const key of Object.keys(stats)) stats[key] += r.stats?.[key] || 0;
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="#fff"/>${parts.join('')}</svg>`;
  return { svg, pages, pageCount, warnings, stats };
}

module.exports = {
  renderPagedPreview,
  sliceRenderedPages,
  splitSection,
  chunkBuffers,
  minimumPhysicalHeight,
};
