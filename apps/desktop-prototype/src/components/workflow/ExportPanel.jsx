export function ExportPanel({ infoDraft, agency, pageDrafts, approvalCount, ignoredRuleIds, onExport, exporting, lastExport, onShowInFolder }) {
  return <div className="workflow-panel" data-panel="export">
    <span className="eyebrow">6단계 · 내보내기</span><h2>HWPX 생성 준비 완료</h2>
    <dl className="export-summary"><div><dt>문서</dt><dd>{infoDraft.title}</dd></div><div><dt>기관</dt><dd>{agency.displayName}</dd></div><div><dt>페이지 유형</dt><dd>{pageDrafts.length}개 확정</dd></div><div><dt>규칙 결과</dt><dd>{approvalCount}건 적용 · {ignoredRuleIds.length}건 무시</dd></div></dl>
    <button id="export-hwpx" type="button" className={`primary-action${exporting ? " is-busy" : ""}`} disabled={exporting} aria-busy={exporting} onClick={onExport}>
      {exporting ? <><span className="busy-spinner" aria-hidden="true" />간격 보정·조판 생성 중…</> : "HWPX 내보내기"}
    </button>
    {lastExport ? <div className="export-done-card" role="status">
      <strong>내보내기 완료</strong>
      <span className="export-done-path">{lastExport.filePath}</span>
      <button id="export-show-folder" type="button" className="secondary-action" onClick={onShowInFolder}>폴더에서 보기</button>
    </div> : null}
  </div>;
}
