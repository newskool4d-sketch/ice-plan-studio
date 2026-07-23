export function ExportPanel({ infoDraft, agency, pageDrafts, approvalCount, ignoredRuleIds, onExport }) {
  return <div className="workflow-panel" data-panel="export">
    <span className="eyebrow">6단계 · 내보내기</span><h2>HWPX 생성 준비 완료</h2>
    <dl className="export-summary"><div><dt>문서</dt><dd>{infoDraft.title}</dd></div><div><dt>기관</dt><dd>{agency.displayName}</dd></div><div><dt>페이지 유형</dt><dd>{pageDrafts.length}개 확정</dd></div><div><dt>규칙 결과</dt><dd>{approvalCount}건 적용 · {ignoredRuleIds.length}건 무시</dd></div></dl>
    <button id="export-hwpx" type="button" className="primary-action" onClick={onExport}>HWPX 내보내기</button>
  </div>;
}
