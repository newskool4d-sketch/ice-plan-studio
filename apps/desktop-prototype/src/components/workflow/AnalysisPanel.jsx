function decisionLabel(decision) {
  if (!decision) return "미확인";
  if (decision.mode === "source") return "원문 확인";
  if (decision.mode === "template") return "빈 틀 선택";
  if (decision.mode === "omitted") return "제외 확인";
  return "결정 필요";
}

function FrontMatterDecision({ field, label, decision, detected, onChange }) {
  const isSource = decision?.mode === "source";
  return <div className="workflow-field">
    <span>{label}: <strong>{decisionLabel(decision)}</strong></span>
    {detected ? <button type="button" className="secondary-action" onClick={() => onChange(field, "source")}>원문 사용</button> : null}
    <button type="button" className="secondary-action" onClick={() => onChange(field, "template")}>빈 틀 추가</button>
    <button type="button" className="secondary-action" onClick={() => onChange(field, "omitted", field === "toc")}>{field === "toc" ? "목차 없이 진행" : "요약 생략"}</button>
    {isSource ? <small>원문 항목을 보존합니다.</small> : null}
  </div>;
}

export function AnalysisPanel({
  model, projection, findings, file, documentKinds, planDecisions,
  onChangeDocumentKind, onChangeFrontMatterDecision, onConfirm,
}) {
  const detected = planDecisions?.detected || {};
  const frontMatter = planDecisions?.frontMatter || {};
  return <div className="workflow-panel" data-panel="analysis">
    <span className="eyebrow">2단계 · 분석</span><h2>입력 구조를 확인하세요</h2>
    <div className="workflow-summary-grid">
      <div><strong>{model?.blocks?.length || 0}</strong><span>Plan IR 블록</span></div>
      <div><strong>{projection?.pages.length || 0}</strong><span>예상 조판 단위</span></div>
      <div><strong>{findings.length}</strong><span>규칙 검토 항목</span></div>
    </div>
    <p className="workflow-source">원본: <strong>{file}</strong></p>
    <div className="page-type-chips">{projection?.pages.map((item) => <span key={item.id}>{item.label}</span>)}</div>
    <label className="workflow-field"><span>문서 성격</span>
      <select id="document-kind" value={planDecisions?.documentKind || "unknown"} onChange={(event) => onChangeDocumentKind(event.target.value)}>
        <option value="unknown">선택하세요</option>
        {documentKinds.map((item) => <option value={item.value} key={item.value}>{item.label}</option>)}
      </select>
    </label>
    <div className="plan-decision-list">
      <FrontMatterDecision field="toc" label="목차" decision={frontMatter.toc} detected={detected.toc?.detected} onChange={onChangeFrontMatterDecision} />
      <FrontMatterDecision field="summary" label="요약" decision={frontMatter.summary} detected={detected.summary?.detected} onChange={onChangeFrontMatterDecision} />
    </div>
    <button id="analysis-confirm" type="button" className="primary-action" onClick={onConfirm}>분석 결과 확정</button>
  </div>;
}
