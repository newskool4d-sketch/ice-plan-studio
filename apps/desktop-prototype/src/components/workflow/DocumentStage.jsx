import { PlanPreview } from "../PlanPreview.jsx";
import { layoutTokens } from "../../domain/previewProjection.js";

export function ThumbnailRail({
  projection, page, onSelectPage, issueCountByPage = {},
  previewMode, realPreview, renderedPage, onSelectRenderedPage,
}) {
  if (previewMode === "rendered" && realPreview?.pages?.length) {
    return <aside className="thumbnail-rail">
      <div className="thumbnail-heading"><strong>실제 쪽</strong><span>{realPreview.pages.length}</span></div>
      <div className="thumbnail-list">{realPreview.pages.map((_svg, index) => {
        const number = index + 1;
        return <button type="button" className={`page-thumbnail${renderedPage === number ? " is-selected" : ""}`} aria-current={renderedPage === number ? "page" : undefined} key={`rendered-${number}`} onClick={() => onSelectRenderedPage(number)}>
          <span className="thumb-paper"><span className="thumb-title">실조판</span><span className="thumb-line" /></span><span className="thumb-caption">{number}</span>
        </button>;
      })}</div>
    </aside>;
  }
  return <aside className="thumbnail-rail">
    <div className="thumbnail-heading"><strong>페이지</strong><span>{projection?.pages.length || 0}</span></div>
    <div className="thumbnail-list">{projection ? projection.pages.map((item) => <button type="button" className={`page-thumbnail${page === item.number ? " is-selected" : ""}`} aria-current={page === item.number ? "page" : undefined} key={item.id} onClick={() => onSelectPage(item.number)}>
      {issueCountByPage[item.number] ? <span className="thumb-issue-badge" aria-label={`규칙 검토 ${issueCountByPage[item.number]}건`}>{issueCountByPage[item.number]}</span> : null}
      <span className="thumb-paper"><span className="thumb-title">{item.label}</span>{item.blocks.some((block) => block.type === "table") ? <span className="thumb-table" /> : <span className="thumb-line" />}</span><span className="thumb-caption">{item.number}</span>
    </button>) : <p className="thumbnail-note">문서를 불러오면 Plan IR에서 페이지 유형을 구성합니다.</p>}</div>
  </aside>;
}

function QuickPreview({ projection, current, agencyName, highlightBlockIndex, zoom }) {
  return <div className="paper-wrap" style={{ transform: `scale(${zoom / 75})` }}>
    <PlanPreview projection={projection} page={current} agencyName={agencyName} highlightBlockIndex={highlightBlockIndex} />
  </div>;
}

function RenderedPreview({ realPreview, zoom, pageNumber }) {
  const pageSvg = realPreview.pages?.[Math.max(0, Number(pageNumber || 1) - 1)] || realPreview.svg;
  return <div className="paper-wrap composition-svg-wrap" style={{ transform: `scale(${zoom / 75})` }}>
    <img className="composition-svg" src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(pageSvg)}`} alt={`생성 HWPX 실조판 ${pageNumber || 1}쪽`} />
  </div>;
}

export function DocumentStage({
  previewMode, onPreviewMode, realPreview, zoom, onZoom,
  projection, current, agencyName, highlightBlockIndex, renderedPage, onRenderedPage,
}) {
  const hasQuick = Boolean(projection && current);
  const visiblePage = previewMode === "rendered" ? renderedPage : current?.number;
  // 비교 모드는 축소해 보는 화면이라 확대율을 절반으로 눌러 두 쪽이 나란히 들어오게 한다.
  const compareZoom = Math.max(38, Math.round(zoom * 0.55));
  return <section className="document-stage">
    <div className="preview-toolbar"><div className="toolbar-group">
      <button type="button" className={`view-button${previewMode === "react" ? " is-active" : ""}`} onClick={() => onPreviewMode("react")}>빠른 미리보기</button>
      <button type="button" className={`view-button${previewMode === "rendered" ? " is-active" : ""}`} disabled={!realPreview} onClick={() => onPreviewMode("rendered")}>실조판 SVG</button>
      <button id="preview-compare" type="button" className={`view-button${previewMode === "compare" ? " is-active" : ""}`} disabled={!realPreview || !hasQuick} onClick={() => onPreviewMode("compare")}>나란히 비교</button>
      {previewMode === "rendered" && realPreview ? <>
        <button type="button" className="tool-button" disabled={renderedPage <= 1} onClick={() => onRenderedPage((value) => Math.max(1, value - 1))}>이전 쪽</button>
        <button type="button" className="tool-button" disabled={renderedPage >= realPreview.pageCount} onClick={() => onRenderedPage((value) => Math.min(realPreview.pageCount, value + 1))}>다음 쪽</button>
      </> : null}
      <button type="button" className="tool-button" onClick={() => onZoom((value) => Math.min(125, value + 10))}>확대</button>
      <select aria-label="미리보기 확대율" value={zoom} onChange={(event) => onZoom(Number(event.target.value))}>{[50, 60, 75, 90, 100, 125].map((value) => <option key={value} value={value}>{value}%</option>)}</select>
      <button type="button" className="tool-button" onClick={() => onZoom((value) => Math.max(50, value - 10))}>축소</button>
    </div><span>{previewMode === "rendered" && realPreview ? `${visiblePage}/${realPreview.pageCount}쪽 · 실조판` : current ? `${current.number}쪽 · ${current.label}` : "입력 대기"}</span></div>
    {realPreview?.layoutAdjustment?.applied ? <div className="layout-adjust-banner" role="status">{realPreview.layoutAdjustment.notice}</div> : null}
    <div className="canvas-scroll">
      {previewMode === "compare" && realPreview && hasQuick ? <div className="compare-grid">
        <figure className="compare-pane"><figcaption>빠른 미리보기 · {current.number}쪽</figcaption><QuickPreview projection={projection} current={current} agencyName={agencyName} highlightBlockIndex={highlightBlockIndex} zoom={compareZoom} /></figure>
        <figure className="compare-pane"><figcaption>실조판 SVG · {current.number}/{realPreview.pageCount}쪽</figcaption><RenderedPreview realPreview={realPreview} pageNumber={current.number} zoom={compareZoom} /></figure>
      </div>
        : previewMode === "rendered" && realPreview ? <RenderedPreview realPreview={realPreview} pageNumber={renderedPage} zoom={zoom} />
          : hasQuick ? <QuickPreview projection={projection} current={current} agencyName={agencyName} highlightBlockIndex={highlightBlockIndex} zoom={zoom} />
            : <div className="preview-empty-state"><h1>문서를 불러와 조판을 시작하세요</h1><p>6단계 워크플로가 실제 확정 상태에 따라 순서대로 열립니다.</p></div>}
    </div>
    <div className="viewport-footer"><span>A4 {layoutTokens.page.widthMm} × {layoutTokens.page.heightMm}mm</span><span>본문폭 {projection ? `${projection.bodyWidthMm.toFixed(0)}mm` : "—"}</span><span>확대 {zoom}%</span></div>
  </section>;
}
