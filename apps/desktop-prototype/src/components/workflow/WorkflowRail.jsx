import { workflowSteps } from "./steps.js";

export function WorkflowRail({ activeStep, available, completed, onSelect }) {
  return <aside className="workflow-rail" aria-label="문서 작업 단계">
    <div className="rail-header">문서 워크플로</div>
    <nav>
      {workflowSteps.map((step, index) => <button
        type="button"
        className={`workflow-step${activeStep === index ? " is-current" : ""}${completed[index] ? " is-done" : ""}`}
        data-step-key={step.key}
        disabled={!available[index]}
        aria-current={activeStep === index ? "step" : undefined}
        onClick={() => onSelect(index)}
        key={step.key}
      >
        <span className="step-number">{completed[index] ? "✓" : index + 1}</span>
        <span className="step-copy"><strong>{step.label}</strong><small>{step.detail}</small></span>
      </button>)}
    </nav>
    <div className="rail-bottom"><span className="workflow-progress">필수 확정 {completed.slice(0, 5).filter(Boolean).length}/5</span></div>
  </aside>;
}
