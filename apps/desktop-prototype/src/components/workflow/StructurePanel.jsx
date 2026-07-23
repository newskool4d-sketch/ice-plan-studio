import { BULLET_PALETTES } from "../../domain/ruleEngine.js";
import { pageTypeOptions } from "./steps.js";

export function StructurePanel({
  currentPaletteId, onChangeMarkerPalette, pageDrafts, onSelectPage,
  onChangePageType, onConfirmPageType, structureConfirmed, onNext,
}) {
  return <div className="workflow-panel" data-panel="structure">
    <span className="eyebrow">4단계 · 구조편집</span><h2>페이지 유형을 확정하세요</h2>
    <p>자동 추정값을 검토하고 페이지마다 직접 확정해야 다음 단계가 열립니다.</p>
    <label className="workflow-field bullet-palette-field"><span>항목기호 계열</span>
      <select value={currentPaletteId} onChange={(event) => onChangeMarkerPalette(event.target.value)}>
        {currentPaletteId === "custom" && <option value="custom" disabled>사용자 지정 계열</option>}
        {BULLET_PALETTES.map((palette) => <option value={palette.id} key={palette.id}>{palette.label}</option>)}
      </select>
    </label>
    <div className="page-type-list">
      {pageDrafts.map((item, index) => <div className={`page-type-row${item.confirmed ? " is-confirmed" : ""}`} data-confirmed={item.confirmed} key={item.id}>
        <button type="button" className="page-jump" onClick={() => onSelectPage(index + 1)}>{index + 1}쪽</button>
        <select className="page-type-select" aria-label={`${index + 1}쪽 페이지 유형`} value={item.type} onChange={(event) => onChangePageType(index, event.target.value)}>{pageTypeOptions.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select>
        <button type="button" className="page-type-confirm" disabled={item.confirmed} onClick={() => onConfirmPageType(index)}>{item.confirmed ? "확정됨" : "확정"}</button>
      </div>)}
    </div>
    <button id="structure-next" type="button" className="primary-action" disabled={!structureConfirmed} onClick={onNext}>규칙검수로 이동</button>
  </div>;
}
