export function RulesPanel({
  visibleFindings, selectedFinding, suggestionCount, approvalCount, ignoredRuleIds,
  ruleHistory, onSelectRule, onApplySelected, onIgnoreSelected, onApplyAll,
  onIgnoreAll, onUndo, onConfirm,
}) {
  return <div className="workflow-panel rule-review-panel" data-panel="rules" data-pending-rules={visibleFindings.length}>
    <div className="rule-review-heading"><span><span className="eyebrow">5단계 · 규칙검수</span><h2>승인형 수정 검토</h2></span><strong>{visibleFindings.length}건</strong></div>
    {visibleFindings.length ? <>
      <div className="rule-review-list" role="listbox" aria-label="규칙 검토 항목">
        {visibleFindings.map((ruleFinding, index) => <button type="button" role="option" aria-selected={selectedFinding?.id === ruleFinding.id} className={`rule-review-item${selectedFinding?.id === ruleFinding.id ? " is-selected" : ""}`} data-rule-id={ruleFinding.id} data-rule-kind={ruleFinding.kind} onClick={() => onSelectRule(ruleFinding)} key={ruleFinding.id}>
          <span>{index + 1}</span><span><strong>{ruleFinding.title}</strong><small>{ruleFinding.code} · {ruleFinding.kind === "suggestion" ? "수정 제안" : "확인 필요"}</small></span>
        </button>)}
      </div>
      {selectedFinding ? <div className="rule-diff-card" aria-live="polite">
        <div className="rule-diff-title"><span className={`finding-dot is-${selectedFinding.severity}`}>{selectedFinding.kind === "suggestion" ? "제안" : "경고"}</span><strong>{selectedFinding.title}</strong></div>
        <p>{selectedFinding.message}</p>
        {selectedFinding.kind === "suggestion" ? <div className="rule-diff">
          <div><span>원문</span><pre className="rule-before">{String(selectedFinding.before)}</pre></div>
          <div><span>수정안</span><pre className="rule-after">{String(selectedFinding.after)}</pre></div>
        </div> : <div className="rule-warning-copy">{String(selectedFinding.before || "사실관계와 문서 맥락을 직접 확인해야 합니다.")}</div>}
        <details><summary>규칙 근거</summary><p>{selectedFinding.evidence}</p></details>
      </div> : null}
      <div className="rule-action-row">
        <button id="rule-apply" type="button" className="primary-action" disabled={selectedFinding?.kind !== "suggestion"} onClick={onApplySelected}>선택 적용</button>
        <button id="rule-ignore" type="button" className="secondary-action" onClick={onIgnoreSelected}>선택 무시</button>
      </div>
      <div className="rule-bulk-actions">
        <button id="rule-apply-all" type="button" disabled={!suggestionCount} onClick={onApplyAll}>제안 전체 적용 ({suggestionCount})</button>
        <button id="rule-ignore-all" type="button" onClick={onIgnoreAll}>남은 항목 모두 무시</button>
        <button id="rule-undo" type="button" disabled={!ruleHistory.length} onClick={onUndo}>마지막 적용 되돌리기</button>
      </div>
      <p className="approval-safety-note">적용 버튼을 누르기 전에는 Plan IR 원문을 변경하지 않습니다.</p>
    </> : <div className="workflow-empty-result"><strong>검토할 항목이 없습니다.</strong><span>적용 {approvalCount}건 · 무시 {ignoredRuleIds.length}건</span></div>}
    <button id="rules-confirm" type="button" className="primary-action" disabled={visibleFindings.length > 0} onClick={onConfirm}>규칙검수 완료</button>
  </div>;
}
