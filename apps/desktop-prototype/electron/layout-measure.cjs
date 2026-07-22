/**
 * 9단계 적응 조판용 결정적 조판 측정기.
 *
 * 한글 COM은 실행마다 다르게 실패하므로(memory: hwp-com-kordoc-known-limits)
 * 보정 루프의 측정기로는 쓸 수 없다. 대신 kordoc reflow 렌더 결과를 읽는다.
 * COM은 최종 게이트 검증과 이 측정기의 교정에만 쓴다
 * (교정 결과: test-data/adaptive-layout/calibration.json).
 *
 * kordoc reflow는 하드 쪽 나눔(pageBreak="1")을 무시하므로 preview-split의
 * 청크 분할을 그대로 재사용한다 — 미리보기와 측정기가 같은 조판을 보게 하려는
 * 의도이며, 둘이 갈라지면 "미리보기는 1쪽인데 측정은 2쪽"이 된다.
 */
const AdmZip = require('adm-zip');
const { renderHwpxToSvg } = require('kordoc');
const { chunkBuffers } = require('./preview-split.cjs');

// HWPUNIT은 1/7200 inch, pt는 1/72 inch — 정확히 100배 관계다(근사 아님).
const HWPUNIT_PER_PT = 100;

/** section0.xml의 hp:pagePr에서 실제 본문 영역(pt)을 읽는다. 토큰 추정 금지. */
function readPageGeometry(sectionXml) {
  const page = sectionXml.match(/<hp:pagePr\b[^>]*height="(\d+)"[^>]*>/);
  const margin = sectionXml.match(
    /<hp:margin\b[^>]*header="(\d+)"[^>]*footer="(\d+)"[^>]*top="(\d+)"[^>]*bottom="(\d+)"/);
  if (!page || !margin) throw new Error('section0.xml에서 pagePr/margin을 읽지 못했습니다.');
  const toPt = (value) => Number(value) / HWPUNIT_PER_PT;
  const pageHeightPt = toPt(page[1]);
  const bodyTopPt = toPt(margin[3]) + toPt(margin[1]);
  const bodyBottomPt = pageHeightPt - toPt(margin[4]) - toPt(margin[2]);
  return { pageHeightPt, bodyTopPt, bodyBottomPt, bodyHeightPt: bodyBottomPt - bodyTopPt };
}

/**
 * 페이지별 SVG 조각으로 자른다.
 *
 * kordoc은 각 쪽을 `<g data-page="N" transform="translate(0 Y)">`로 감싸고
 * **그 안의 좌표는 쪽 상대(page-relative)** 로 쓴다. 캔버스 절대 y로 계산하면
 * 2쪽 문서의 마지막 쪽 채움률이 음수로 나온다(실측 확인) — 반드시 쪽 그룹으로
 * 자른 뒤 그룹 안에서 측정해야 한다.
 */
function splitPages(svg) {
  const marks = [...svg.matchAll(/<g\s+data-page="(\d+)"\s+transform="translate\(0 ([\d.-]+)\)">/g)];
  return marks.map((mark, index) => ({
    page: Number(mark[1]),
    offsetPt: Number(mark[2]),
    svg: svg.slice(mark.index, index + 1 < marks.length ? marks[index + 1].index : svg.length),
  }));
}

/** 쪽 안에서 실제로 잉크가 찍힌 가장 아래 y(쪽 상대 pt). 없으면 null. */
function contentBottomPt(pageSvg) {
  let bottom = null;
  const bump = (value) => {
    if (Number.isFinite(value) && (bottom === null || value > bottom)) bottom = value;
  };
  for (const m of pageSvg.matchAll(/<text\b[^>]*\by="(-?[\d.]+)"/g)) bump(Number(m[1]));
  for (const m of pageSvg.matchAll(/<use\b[^>]*\by="(-?[\d.]+)"[^>]*>/g)) {
    const height = m[0].match(/\bheight="(-?[\d.]+)"/);
    bump(Number(m[1]) + (height ? Number(height[1]) : 0));
  }
  for (const m of pageSvg.matchAll(/<line\b[^>]*\by1="(-?[\d.]+)"[^>]*\by2="(-?[\d.]+)"/g)) {
    bump(Math.max(Number(m[1]), Number(m[2])));
  }
  // 쪽 전면 배경 rect는 잉크가 아니다 — 포함하면 모든 문서의 채움률이 100%로
  // 나와 측정기가 무의미해진다.
  for (const m of pageSvg.matchAll(/<rect\b[^>]*\by="(-?[\d.]+)"[^>]*\bheight="(-?[\d.]+)"/g)) {
    const height = Number(m[2]);
    if (height > 800) continue;
    bump(Number(m[1]) + height);
  }
  return bottom;
}

/**
 * kordoc 쪽수를 한글 실측에 맞게 보정한다.
 *
 * kordoc reflow는 (1) 한글보다 줄높이를 4~6% 작게 잡고 (2) 표 넘침은 아예 쪽으로
 * 나누지 않는다. 그래서 "마지막 쪽 채움률 1.0 이하 = 들어감"으로 판정하면 한글에서
 * 쪽이 늘어난다. COM 대조 실측 경계는 채움률 0.931(들어감) ↔ 0.962(안 들어감)이므로
 * 안전 임계(기본 0.93)를 넘으면 그 쪽은 넘친 것으로 보고 쪽수를 +1 한다.
 * 근거 표본: test-data/adaptive-layout/calibration.json
 */
function effectivePages(pageCount, lastPageFillRatio, tokens) {
  if (lastPageFillRatio === null) return { effectivePageCount: pageCount, overflowed: false, confident: true };
  const overflowed = lastPageFillRatio > tokens.safeFillThreshold;
  return {
    effectivePageCount: pageCount + (overflowed ? 1 : 0),
    overflowed,
    // 넘침이 크면 +1로 실제 쪽수를 맞춘다고 보장할 수 없다(표는 kordoc이 전혀 안 나눔).
    confident: lastPageFillRatio <= tokens.unboundedOverflowFill,
  };
}

async function measureHwpx(hwpxBuffer, tokens) {
  const sectionXml = new AdmZip(hwpxBuffer).readAsText('Contents/section0.xml');
  const geometry = readPageGeometry(sectionXml);
  const chunks = [];
  const warnings = [];
  let pageCount = 0;
  for (const [index, buffer] of chunkBuffers(hwpxBuffer).entries()) {
    const rendered = await renderHwpxToSvg(buffer, { reflow: true, reflowMode: 'keep' });
    const pages = splitPages(rendered.svg).map((page) => {
      const bottom = contentBottomPt(page.svg);
      return {
        page: page.page,
        contentBottomPt: bottom,
        fillRatio: bottom === null ? null : (bottom - geometry.bodyTopPt) / geometry.bodyHeightPt,
      };
    });
    const last = pages[pages.length - 1] || null;
    const effective = effectivePages(rendered.pageCount, last ? last.fillRatio : null, tokens);
    chunks.push({
      index,
      pageCount: rendered.pageCount,
      ...effective,
      canvasHeightPt: rendered.height,
      renderedPages: pages.length,
      // pageCount와 실제 렌더된 쪽 그룹 수가 다르면 측정 신뢰도가 깨진 것이므로 드러낸다.
      pageCountMatchesRendered: pages.length === rendered.pageCount,
      lastPageContentBottomPt: last ? last.contentBottomPt : null,
      // 채움률: 마지막 쪽 본문 영역을 얼마나 채웠는가. 1.0 = 본문 영역 꽉 참.
      lastPageFillRatio: last ? last.fillRatio : null,
      pages,
      warnings: rendered.warnings || [],
    });
    pageCount += rendered.pageCount;
    warnings.push(...(rendered.warnings || []));
  }
  const effectivePageCount = chunks.reduce((sum, chunk) => sum + chunk.effectivePageCount, 0);
  return {
    // rawPageCount는 kordoc이 그대로 보고한 값 — 보정 전후를 구분해 남긴다.
    rawPageCount: pageCount,
    pageCount: effectivePageCount,
    confident: chunks.every((chunk) => chunk.confident),
    geometry,
    chunks,
    warnings,
  };
}

module.exports = { measureHwpx, readPageGeometry, splitPages, contentBottomPt, effectivePages };
