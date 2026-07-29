import { BULLET_PALETTES } from "../../domain/ruleEngine.js";
import { pageTypeOptions } from "./steps.js";

export function StructurePanel({
  currentPaletteId, onChangeMarkerPalette, pageDrafts, onSelectPage,
  onChangePageType, onConfirmPageType, onAddPage, onDeletePage, onMovePage,
  bulletDecision, onChangeBulletDecision, structureConfirmed, onNext,
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
    <label className="workflow-field"><span>불릿 재량 결정</span>
      <select
        id="bullet-decision"
        value={bulletDecision?.userDecision || ""}
        onChange={(event) => onChangeBulletDecision(event.target.value, bulletDecision?.overrideReason || "")}
      >
        <option value="">결정 필요</option>
        <option value="keep-source-marker">원문 기호 유지</option>
        <option value="apply-recommendation">권고 기호 적용</option>
        <option value="custom">직접 선택</option>
      </select>
    </label>
    {bulletDecision?.userDecision ? <input
      id="bullet-override-reason"
      className="workflow-input"
      value={bulletDecision.overrideReason || ""}
      placeholder="재량 사유(선택)"
      onChange={(event) => onChangeBulletDecision(bulletDecision.userDecision, event.target.value)}
    /> : null}
    <div className="page-type-list">
      {pageDrafts.map((item, index) => <div className={`page-type-row${item.confirmed ? " is-confirmed" : ""}`} data-confirmed={item.confirmed} key={item.id}>
        <button type="button" className="page-jump" onClick={() => onSelectPage(index + 1)}>{index + 1}쪽</button>
        <select className="page-type-select" aria-label={`${index + 1}쪽 페이지 유형`} value={item.type} onChange={(event) => onChangePageType(index, event.target.value)}>{pageTypeOptions.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select>
        <button type="button" className="page-type-confirm" disabled={item.confirmed} onClick={() => onConfirmPageType(index)}>{item.confirmed ? "확정됨" : "확정"}</button>
        <button type="button" className="secondary-action" onClick={() => onMovePage(index, "up")} disabled={index === 0} aria-label="위로 이동">↑</button>
        <button type="button" className="secondary-action" onClick={() => onMovePage(index, "down")} disabled={index === pageDrafts.length - 1} aria-label="아래로 이동">↓</button>
        <button type="button" className="secondary-action" onClick={() => onAddPage(index)}>뒤에 쪽 추가</button>
        <button type="button" className="secondary-action" onClick={() => onDeletePage(index)}>삭제</button>
      </div>)}
    </div>
    <button id="structure-next" type="button" className="primary-action" disabled={!structureConfirmed} onClick={onNext}>규칙검수로 이동</button>
  </div>;
}
