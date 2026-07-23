export function AnalysisPanel({ model, projection, findings, file, onConfirm }) {
  return <div className="workflow-panel" data-panel="analysis">
    <span className="eyebrow">2단계 · 분석</span><h2>입력 구조를 확인하세요</h2>
    <div className="workflow-summary-grid">
      <div><strong>{model?.blocks?.length || 0}</strong><span>Plan IR 블록</span></div>
      <div><strong>{projection?.pages.length || 0}</strong><span>예상 조판 단위</span></div>
      <div><strong>{findings.length}</strong><span>규칙 검토 항목</span></div>
    </div>
    <p className="workflow-source">원본: <strong>{file}</strong></p>
    <div className="page-type-chips">{projection?.pages.map((item) => <span key={item.id}>{item.label}</span>)}</div>
    <button id="analysis-confirm" type="button" className="primary-action" onClick={onConfirm}>분석 결과 확정</button>
  </div>;
}
