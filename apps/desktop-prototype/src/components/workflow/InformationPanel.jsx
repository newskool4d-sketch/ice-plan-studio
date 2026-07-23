import { AgencySelect } from "./AgencySelect.jsx";

export function InformationPanel({ infoDraft, agencyId, onChangeInfo, onAgencyChange, onConfirm }) {
  return <div className="workflow-panel" data-panel="information">
    <span className="eyebrow">3단계 · 기본정보</span><h2>문서 기본정보를 확정하세요</h2>
    <label className="workflow-field"><span>문서 제목</span><input id="info-title" value={infoDraft.title} onChange={(event) => onChangeInfo("title", event.target.value)} /></label>
    <label className="workflow-field"><span>표지 연월</span><input id="info-date" value={infoDraft.date} placeholder="2026. 7." onChange={(event) => onChangeInfo("date", event.target.value)} /></label>
    <label className="workflow-field"><span>기관</span><AgencySelect value={agencyId} onChange={onAgencyChange} /></label>
    <button id="info-confirm" type="button" className="primary-action" disabled={!infoDraft.title.trim()} onClick={onConfirm}>기본정보 확정</button>
  </div>;
}
