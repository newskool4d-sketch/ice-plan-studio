import { PlanPreview } from "../PlanPreview.jsx";
import { layoutTokens } from "../../domain/previewProjection.js";

export function ThumbnailRail({ projection, page, onSelectPage }) {
  return <aside className="thumbnail-rail">
    <div className="thumbnail-heading"><strong>페이지</strong><span>{projection?.pages.length || 0}</span></div>
    <div className="thumbnail-list">{projection ? projection.pages.map((item) => <button type="button" className={`page-thumbnail${page === item.number ? " is-selected" : ""}`} aria-current={page === item.number ? "page" : undefined} key={item.id} onClick={() => onSelectPage(item.number)}><span className="thumb-paper"><span className="thumb-title">{item.label}</span>{item.blocks.some((block) => block.type === "table") ? <span className="thumb-table" /> : <span className="thumb-line" />}</span><span className="thumb-caption">{item.number}</span></button>) : <p className="thumbnail-note">문서를 불러오면 Plan IR에서 페이지 유형을 구성합니다.</p>}</div>
  </aside>;
}

export function DocumentStage({
  previewMode, onPreviewMode, realPreview, zoom, onZoom,
  projection, current, agencyName, highlightBlockIndex,
}) {
  return <section className="document-stage">
    <div className="preview-toolbar"><div className="toolbar-group"><button type="button" className={`view-button${previewMode === "react" ? " is-active" : ""}`} onClick={() => onPreviewMode("react")}>빠른 미리보기</button><button type="button" className={`view-button${previewMode === "rendered" ? " is-active" : ""}`} disabled={!realPreview} onClick={() => onPreviewMode("rendered")}>실조판 SVG</button><button type="button" className="tool-button" onClick={() => onZoom((value) => Math.min(125, value + 10))}>확대</button><select aria-label="미리보기 확대율" value={zoom} onChange={(event) => onZoom(Number(event.target.value))}>{[50, 60, 75, 90, 100, 125].map((value) => <option key={value} value={value}>{value}%</option>)}</select><button type="button" className="tool-button" onClick={() => onZoom((value) => Math.max(50, value - 10))}>축소</button></div><span>{current ? `${current.number}쪽 · ${current.label}` : "입력 대기"}</span></div>
    {realPreview?.layoutAdjustment?.applied ? <div className="layout-adjust-banner" role="status">{realPreview.layoutAdjustment.notice}</div> : null}
    <div className="canvas-scroll">{previewMode === "rendered" && realPreview ? <div className="paper-wrap composition-svg-wrap" style={{ transform: `scale(${zoom / 75})` }}><img className="composition-svg" src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(realPreview.svg)}`} alt={`생성 HWPX 실조판 ${realPreview.pageCount}쪽`} /></div> : projection && current ? <div className="paper-wrap" style={{ transform: `scale(${zoom / 75})` }}><PlanPreview projection={projection} page={current} agencyName={agencyName} highlightBlockIndex={highlightBlockIndex} /></div> : <div className="preview-empty-state"><h1>문서를 불러와 조판을 시작하세요</h1><p>6단계 워크플로가 실제 확정 상태에 따라 순서대로 열립니다.</p></div>}</div>
    <div className="viewport-footer"><span>A4 {layoutTokens.page.widthMm} × {layoutTokens.page.heightMm}mm</span><span>본문폭 {projection ? `${projection.bodyWidthMm.toFixed(0)}mm` : "—"}</span><span>확대 {zoom}%</span></div>
  </section>;
}
