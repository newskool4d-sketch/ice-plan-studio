import { useEffect, useMemo, useState } from "react";
import { PlanPreview } from "./PlanPreview.jsx";
import { agencyProfiles, defaultAgencyProfile } from "../domain/agencyProfiles.js";
import { parseMarkdown } from "../domain/markdownParser.js";
import { createPreviewProjection, layoutTokens } from "../domain/previewProjection.js";
import { applyAllRuleSuggestions, applyRuleSuggestion, inspectDocumentRules } from "../domain/ruleEngine.js";

const workflowSteps = [
  { key: "start", label: "시작", detail: "문서 불러오기" },
  { key: "analysis", label: "분석", detail: "입력 구조 확인" },
  { key: "information", label: "기본정보", detail: "제목·기관 확정" },
  { key: "structure", label: "구조편집", detail: "페이지 유형 확정" },
  { key: "rules", label: "규칙검수", detail: "검수 결과 확인" },
  { key: "export", label: "내보내기", detail: "HWPX 생성" },
];

const pageTypeOptions = Object.entries(layoutTokens.pageTypes).map(([value, label]) => ({ value, label }));

function modelTitle(model, fallback) {
  return model?.blocks?.find((block) => block.type === "heading" && block.level === 1)?.text
    || model?.metadata?.cover?.title
    || model?.metadata?.title
    || fallback.replace(/\.(md|txt|hwpx?|iceplan)$/i, "");
}

function compositionModel(model, agency) {
  if (!model) return null;
  return {
    ...model,
    metadata: {
      ...model.metadata,
      cover: {
        ...(model.metadata?.cover || {}),
        title: model.metadata?.cover?.title || model.metadata?.title,
        displayName: model.metadata?.cover?.displayName || agency.displayName,
      },
      layout: {
        ...(model.metadata?.layout || {}),
        template: "boncheong",
        coverProfile: agency.coverProfile,
      },
    },
  };
}

function profilePackage(agency) {
  return {
    schemaVersion: "0.2",
    kind: "iceprofile",
    profile: {
      id: agency.id,
      label: agency.label,
      baseAgencyId: agency.id,
      organization: { displayName: agency.displayName, department: null },
      branding: { slogan: agency.slogan, ci: agency.ci, sloganAsset: agency.sloganAsset, customByAgency: {} },
      layout: { coverProfile: agency.coverProfile },
      extensions: {},
    },
  };
}

function pageDraftsFrom(model, agency) {
  return createPreviewProjection(compositionModel(model, agency)).pages.map((page) => ({
    id: page.id,
    type: page.type,
    title: page.title,
    confirmed: false,
  }));
}

function WorkflowRail({ activeStep, available, completed, onSelect }) {
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

function WorkflowApp() {
  const [model, setModel] = useState(null);
  const [file, setFile] = useState("");
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(75);
  const [notice, setNotice] = useState("");
  const [agencyId, setAgencyId] = useState(defaultAgencyProfile.id);
  const [previewMode, setPreviewMode] = useState("react");
  const [realPreview, setRealPreview] = useState(null);
  const [activeStep, setActiveStep] = useState(0);
  const [analysisConfirmed, setAnalysisConfirmed] = useState(false);
  const [infoDraft, setInfoDraft] = useState({ title: "", date: "" });
  const [infoConfirmed, setInfoConfirmed] = useState(false);
  const [pageDrafts, setPageDrafts] = useState([]);
  const [rulesConfirmed, setRulesConfirmed] = useState(false);
  const [ignoredRuleIds, setIgnoredRuleIds] = useState([]);
  const [selectedRuleId, setSelectedRuleId] = useState(null);
  const [ruleHistory, setRuleHistory] = useState([]);

  const agency = agencyProfiles[agencyId] || defaultAgencyProfile;
  const outputModel = useMemo(() => compositionModel(model, agency), [model, agency]);
  const projection = useMemo(() => outputModel ? createPreviewProjection(outputModel) : null, [outputModel]);
  const current = projection?.pages[page - 1];
  const findings = useMemo(() => model ? inspectDocumentRules(model) : [], [model]);
  const visibleFindings = useMemo(() => findings.filter((item) => !ignoredRuleIds.includes(item.id)), [findings, ignoredRuleIds]);
  const selectedFinding = visibleFindings.find((item) => item.id === selectedRuleId) || visibleFindings[0] || null;
  const suggestionCount = visibleFindings.filter((item) => item.kind === "suggestion").length;
  const approvalCount = model?.approval?.edits?.length || 0;
  const structureConfirmed = pageDrafts.length > 0 && pageDrafts.every((item) => item.confirmed);
  const available = [
    true,
    Boolean(model),
    Boolean(model && analysisConfirmed),
    Boolean(model && analysisConfirmed && infoConfirmed),
    Boolean(model && analysisConfirmed && infoConfirmed && structureConfirmed),
    Boolean(model && analysisConfirmed && infoConfirmed && structureConfirmed && rulesConfirmed),
  ];
  const completed = [Boolean(model), analysisConfirmed, infoConfirmed, structureConfirmed, rulesConfirmed, false];

  useEffect(() => {
    if (projection) setPage((value) => Math.min(Math.max(value, 1), projection.pages.length));
  }, [projection]);

  useEffect(() => {
    if (!visibleFindings.some((item) => item.id === selectedRuleId)) setSelectedRuleId(visibleFindings[0]?.id || null);
  }, [selectedRuleId, visibleFindings]);

  useEffect(() => {
    if (!outputModel || !window.icePlan?.renderCompositionPreview) {
      setRealPreview(null);
      return undefined;
    }
    let cancelled = false;
    setRealPreview(null);
    window.icePlan.renderCompositionPreview(outputModel)
      .then((result) => { if (!cancelled) setRealPreview(result); })
      .catch((error) => { if (!cancelled) setNotice(`실조판 미리보기를 만들지 못했습니다: ${error.message}`); });
    return () => { cancelled = true; };
  }, [outputModel]);

  const load = async (event) => {
    const input = event.target.files?.[0];
    if (!input) return;
    try {
      const parsed = window.icePlan?.loadPlanInput && input.path
        ? (await window.icePlan.loadPlanInput(input.path)).model
        : parseMarkdown(await input.text(), { title: input.name });
      const title = modelTitle(parsed, input.name);
      const next = {
        ...parsed,
        metadata: {
          ...parsed.metadata,
          title,
          cover: { ...(parsed.metadata?.cover || {}), title },
        },
      };
      setFile(input.name);
      setModel(next);
      setInfoDraft({ title, date: next.metadata?.cover?.date || "" });
      setPageDrafts(pageDraftsFrom(next, agency));
      setAnalysisConfirmed(false);
      setInfoConfirmed(false);
      setRulesConfirmed(false);
      setIgnoredRuleIds([]);
      setSelectedRuleId(null);
      setRuleHistory([]);
      setPage(1);
      setPreviewMode("react");
      setActiveStep(1);
      setNotice(`${input.name}을 불러왔습니다. 분석 결과를 확인해 주세요.`);
    } catch (error) {
      setNotice(`파일을 읽지 못했습니다: ${error.message}`);
    }
    event.target.value = "";
  };

  const handleAgencyChange = (event) => {
    setAgencyId(event.target.value);
    if (model) {
      setInfoConfirmed(false);
      setRulesConfirmed(false);
      setActiveStep(2);
      setNotice("기관이 변경되어 기본정보를 다시 확정해야 합니다.");
    }
  };

  const confirmAnalysis = () => {
    setAnalysisConfirmed(true);
    setActiveStep(2);
    setNotice("입력 분석을 확정했습니다. 기본정보를 확인해 주세요.");
  };

  const changeInfo = (field, value) => {
    setInfoDraft((currentDraft) => ({ ...currentDraft, [field]: value }));
    setInfoConfirmed(false);
    setRulesConfirmed(false);
  };

  const confirmInformation = () => {
    const title = infoDraft.title.trim();
    if (!title) return;
    setModel((currentModel) => ({
      ...currentModel,
      metadata: {
        ...currentModel.metadata,
        title,
        cover: {
          ...(currentModel.metadata?.cover || {}),
          title,
          date: infoDraft.date,
          displayName: agency.displayName,
        },
        layout: {
          ...(currentModel.metadata?.layout || {}),
          template: "boncheong",
          coverProfile: agency.coverProfile,
        },
      },
    }));
    setInfoConfirmed(true);
    setRulesConfirmed(false);
    setActiveStep(3);
    setNotice("기본정보를 확정했습니다. 각 페이지 유형을 확인해 주세요.");
  };

  const applyPages = (nextPages) => {
    setPageDrafts(nextPages);
    setModel((currentModel) => ({
      ...currentModel,
      metadata: {
        ...currentModel.metadata,
        pages: nextPages.map(({ type, title }) => ({ type, title })),
      },
    }));
    setRulesConfirmed(false);
    setPreviewMode("react");
  };

  const changePageType = (index, type) => {
    const nextPages = pageDrafts.map((item, itemIndex) => itemIndex === index
      ? { ...item, type, title: layoutTokens.pageTypes[type], confirmed: false }
      : item);
    applyPages(nextPages);
    setPage(index + 1);
    setNotice(`${index + 1}쪽 유형을 ${layoutTokens.pageTypes[type]}(으)로 변경했습니다. 다시 확정해 주세요.`);
  };

  const confirmPageType = (index) => {
    setPageDrafts((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, confirmed: true } : item));
    setPage(index + 1);
    setRulesConfirmed(false);
  };

  const selectRule = (ruleFinding) => {
    setSelectedRuleId(ruleFinding.id);
    setPreviewMode("react");
    if (Number.isInteger(ruleFinding.target?.blockIndex)) {
      const bodyIndex = projection?.pages.findIndex((item) => item.type === "body") ?? -1;
      if (bodyIndex >= 0) setPage(bodyIndex + 1);
    }
  };

  const applySelectedRule = () => {
    if (!selectedFinding || selectedFinding.kind !== "suggestion") return;
    try {
      const beforeModel = model;
      const applied = applyRuleSuggestion(model, selectedFinding);
      setRuleHistory((history) => [...history, { model: beforeModel, label: selectedFinding.title }]);
      setModel(applied.model);
      setRulesConfirmed(false);
      setNotice(`${selectedFinding.title} 제안을 승인해 적용했습니다.`);
    } catch (error) {
      setNotice(`규칙 적용 실패: ${error.message}`);
    }
  };

  const applyAllRules = () => {
    try {
      const applied = applyAllRuleSuggestions(model, { excludeIds: ignoredRuleIds });
      if (!applied.edits.length) return;
      setRuleHistory((history) => [...history, { model, label: `전체 적용 ${applied.edits.length}건` }]);
      setModel(applied.model);
      setRulesConfirmed(false);
      setNotice(`수정 제안 ${applied.edits.length}건을 명시 승인으로 적용했습니다.`);
    } catch (error) {
      setNotice(`전체 적용 실패: ${error.message}`);
    }
  };

  const ignoreSelectedRule = () => {
    if (!selectedFinding) return;
    setIgnoredRuleIds((ids) => ids.includes(selectedFinding.id) ? ids : [...ids, selectedFinding.id]);
    setRulesConfirmed(false);
    setNotice(`${selectedFinding.title} 항목을 무시했습니다.`);
  };

  const ignoreAllRules = () => {
    setIgnoredRuleIds((ids) => [...new Set([...ids, ...visibleFindings.map((item) => item.id)])]);
    setRulesConfirmed(false);
    setNotice(`남은 검토 항목 ${visibleFindings.length}건을 모두 무시했습니다.`);
  };

  const undoLastRule = () => {
    const previous = ruleHistory.at(-1);
    if (!previous) return;
    setModel(previous.model);
    setRuleHistory((history) => history.slice(0, -1));
    setRulesConfirmed(false);
    setNotice(`${previous.label} 적용을 되돌렸습니다.`);
  };

  const confirmRules = () => {
    if (visibleFindings.length) {
      setNotice(`남은 검토 항목 ${visibleFindings.length}건을 적용하거나 무시해야 합니다.`);
      return;
    }
    setRulesConfirmed(true);
    setActiveStep(5);
    setNotice(`규칙 검수를 완료했습니다. 적용 ${approvalCount}건, 무시 ${ignoredRuleIds.length}건입니다.`);
  };

  const exportHwpx = async () => {
    if (!available[5] || !outputModel || !window.icePlan?.exportHwpx) {
      setNotice(outputModel ? "HWPX 내보내기는 모든 선행 단계를 확정한 Electron에서 사용할 수 있습니다." : "먼저 문서를 불러와 주세요.");
      return;
    }
    try {
      const result = await window.icePlan.exportHwpx(outputModel);
      if (!result.canceled) setNotice(`HWPX로 내보냈습니다: ${result.filePath}`);
    } catch (error) {
      setNotice(`HWPX 내보내기 실패: ${error.message}`);
    }
  };

  const saveWorkspace = async () => {
    if (!model || !window.icePlan?.saveProject) {
      setNotice(model ? "프로젝트 저장은 Electron에서 사용할 수 있습니다." : "먼저 문서를 불러와 주세요.");
      return;
    }
    try {
      const result = await window.icePlan.saveProject({
        project: {
          schemaVersion: "0.2",
          kind: "iceplan",
          metadata: { loadedFile: file, title: modelTitle(model, file) },
          workflow: { activeStep, analysisConfirmed, infoDraft, infoConfirmed, pageDrafts, rulesConfirmed, ignoredRuleIds },
          view: { page, zoom, previewMode },
          settings: { agencyId },
        },
        document: model,
        profile: profilePackage(agency),
        validation: { approval: model.approval || { status: "unapproved" }, ignoredRuleIds, rulesConfirmed },
        history: { snapshots: [] },
      });
      if (!result.canceled) setNotice(`프로젝트 v${result.schemaVersion}로 저장했습니다: ${result.filePath}`);
    } catch (error) {
      setNotice(`프로젝트 저장 실패: ${error.message}`);
    }
  };

  const loadWorkspace = async () => {
    if (!window.icePlan?.loadProject) {
      setNotice("프로젝트 불러오기는 Electron에서 사용할 수 있습니다.");
      return;
    }
    try {
      const result = await window.icePlan.loadProject();
      if (result.canceled) return;
      const snapshot = result.project;
      const nextModel = snapshot.document;
      if (!nextModel?.blocks) throw new Error("프로젝트에 Plan IR 문서가 없습니다.");
      const workflow = snapshot.project?.workflow || {};
      const view = snapshot.project?.view || {};
      const settings = snapshot.project?.settings || {};
      const requestedAgencyId = settings.agencyId || snapshot.profile?.profile?.baseAgencyId || defaultAgencyProfile.id;
      const nextAgency = agencyProfiles[requestedAgencyId] || defaultAgencyProfile;
      const nextDrafts = Array.isArray(workflow.pageDrafts) && workflow.pageDrafts.length
        ? workflow.pageDrafts.map((item) => ({ ...item, confirmed: Boolean(item.confirmed) }))
        : pageDraftsFrom(nextModel, nextAgency);
      const nextAnalysisConfirmed = Boolean(workflow.analysisConfirmed);
      const nextInfoConfirmed = nextAnalysisConfirmed && Boolean(workflow.infoConfirmed);
      const nextStructureConfirmed = nextInfoConfirmed && nextDrafts.length > 0 && nextDrafts.every((item) => item.confirmed);
      const nextIgnored = Array.isArray(workflow.ignoredRuleIds) ? workflow.ignoredRuleIds : [];
      const pendingRules = inspectDocumentRules(nextModel).filter((item) => !nextIgnored.includes(item.id));
      const nextRulesConfirmed = nextStructureConfirmed && Boolean(workflow.rulesConfirmed) && pendingRules.length === 0;
      const maxStep = nextRulesConfirmed ? 5 : nextStructureConfirmed ? 4 : nextInfoConfirmed ? 3 : nextAnalysisConfirmed ? 2 : 1;
      const restoredStep = Math.min(maxStep, Math.max(1, Number(workflow.activeStep) || 1));
      setModel(nextModel);
      setFile(snapshot.project?.metadata?.loadedFile || result.filePath.split(/[\\/]/).pop());
      setAgencyId(nextAgency.id);
      setAnalysisConfirmed(nextAnalysisConfirmed);
      setInfoDraft(workflow.infoDraft || { title: modelTitle(nextModel, "프로젝트"), date: nextModel.metadata?.cover?.date || "" });
      setInfoConfirmed(nextInfoConfirmed);
      setPageDrafts(nextDrafts);
      setRulesConfirmed(nextRulesConfirmed);
      setIgnoredRuleIds(nextIgnored);
      setSelectedRuleId(null);
      setRuleHistory([]);
      setPage(Math.max(1, Number(view.page) || 1));
      setZoom(Math.min(125, Math.max(50, Number(view.zoom) || 75)));
      setPreviewMode(view.previewMode === "rendered" ? "rendered" : "react");
      setActiveStep(restoredStep);
      setNotice(`${result.migratedFrom ? `v${result.migratedFrom} 프로젝트를 v0.2로 승격해 ` : ""}불러왔습니다: ${result.filePath}`);
    } catch (error) {
      setNotice(`프로젝트를 읽지 못했습니다: ${error.message}`);
    }
  };

  const saveAgencyProfile = async () => {
    if (!window.icePlan?.saveProfile) {
      setNotice("프로필 저장은 Electron에서 사용할 수 있습니다.");
      return;
    }
    try {
      const result = await window.icePlan.saveProfile(profilePackage(agency));
      if (!result.canceled) setNotice(`프로필 v${result.schemaVersion}로 저장했습니다: ${result.filePath}`);
    } catch (error) {
      setNotice(`프로필 저장 실패: ${error.message}`);
    }
  };

  const loadAgencyProfile = async () => {
    if (!window.icePlan?.loadProfile) {
      setNotice("프로필 불러오기는 Electron에서 사용할 수 있습니다.");
      return;
    }
    try {
      const result = await window.icePlan.loadProfile();
      if (result.canceled) return;
      const imported = result.profile?.profile;
      const requested = imported?.baseAgencyId || imported?.id;
      const nextAgency = agencyProfiles[requested]
        || Object.values(agencyProfiles).find((item) => item.coverProfile === imported?.layout?.coverProfile)
        || defaultAgencyProfile;
      setAgencyId(nextAgency.id);
      if (model) {
        setInfoConfirmed(false);
        setRulesConfirmed(false);
        setActiveStep(2);
      }
      setNotice(`${result.migratedFrom ? `v${result.migratedFrom} 프로필을 v0.2로 승격해 ` : ""}${nextAgency.label}로 불러왔습니다.`);
    } catch (error) {
      setNotice(`프로필을 읽지 못했습니다: ${error.message}`);
    }
  };

  const renderStepPanel = () => {
    if (activeStep === 0) return <div className="workflow-panel" data-panel="start">
      <span className="eyebrow">1단계 · 시작</span><h2>계획안 원본을 불러오세요</h2>
      <p>MD·TXT·HWP·HWPX를 Plan IR로 변환한 뒤 분석 단계가 열립니다.</p>
      <label className="primary-action file-load-button">문서 선택<input type="file" accept=".md,.txt,.hwp,.hwpx" onChange={load} /></label>
      <div className="package-resume-card">
        <strong>기존 작업 재개</strong>
        <p>v0.1 평면 JSON 프로젝트·프로필도 불러올 때 v0.2로 자동 승격합니다.</p>
        <div className="package-action-row">
          <button id="start-project-load" type="button" onClick={loadWorkspace}>프로젝트 불러오기</button>
          <button id="start-profile-load" type="button" onClick={loadAgencyProfile}>프로필 불러오기</button>
          <button id="start-profile-save" type="button" onClick={saveAgencyProfile}>현재 프로필 저장</button>
        </div>
      </div>
    </div>;

    if (activeStep === 1) return <div className="workflow-panel" data-panel="analysis">
      <span className="eyebrow">2단계 · 분석</span><h2>입력 구조를 확인하세요</h2>
      <div className="workflow-summary-grid">
        <div><strong>{model?.blocks?.length || 0}</strong><span>Plan IR 블록</span></div>
        <div><strong>{projection?.pages.length || 0}</strong><span>예상 조판 단위</span></div>
        <div><strong>{findings.length}</strong><span>규칙 검토 항목</span></div>
      </div>
      <p className="workflow-source">원본: <strong>{file}</strong></p>
      <div className="page-type-chips">{projection?.pages.map((item) => <span key={item.id}>{item.label}</span>)}</div>
      <button id="analysis-confirm" type="button" className="primary-action" onClick={confirmAnalysis}>분석 결과 확정</button>
    </div>;

    if (activeStep === 2) return <div className="workflow-panel" data-panel="information">
      <span className="eyebrow">3단계 · 기본정보</span><h2>문서 기본정보를 확정하세요</h2>
      <label className="workflow-field"><span>문서 제목</span><input id="info-title" value={infoDraft.title} onChange={(event) => changeInfo("title", event.target.value)} /></label>
      <label className="workflow-field"><span>표지 연월</span><input id="info-date" value={infoDraft.date} placeholder="2026. 7." onChange={(event) => changeInfo("date", event.target.value)} /></label>
      <label className="workflow-field"><span>기관</span><select value={agencyId} onChange={handleAgencyChange}>{Object.values(agencyProfiles).map((profile) => <option key={profile.id} value={profile.id}>{profile.label}</option>)}</select></label>
      <button id="info-confirm" type="button" className="primary-action" disabled={!infoDraft.title.trim()} onClick={confirmInformation}>기본정보 확정</button>
    </div>;

    if (activeStep === 3) return <div className="workflow-panel" data-panel="structure">
      <span className="eyebrow">4단계 · 구조편집</span><h2>페이지 유형을 확정하세요</h2>
      <p>자동 추정값을 검토하고 페이지마다 직접 확정해야 다음 단계가 열립니다.</p>
      <div className="page-type-list">
        {pageDrafts.map((item, index) => <div className={`page-type-row${item.confirmed ? " is-confirmed" : ""}`} data-confirmed={item.confirmed} key={item.id}>
          <button type="button" className="page-jump" onClick={() => setPage(index + 1)}>{index + 1}쪽</button>
          <select className="page-type-select" aria-label={`${index + 1}쪽 페이지 유형`} value={item.type} onChange={(event) => changePageType(index, event.target.value)}>{pageTypeOptions.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select>
          <button type="button" className="page-type-confirm" disabled={item.confirmed} onClick={() => confirmPageType(index)}>{item.confirmed ? "확정됨" : "확정"}</button>
        </div>)}
      </div>
      <button id="structure-next" type="button" className="primary-action" disabled={!structureConfirmed} onClick={() => setActiveStep(4)}>규칙검수로 이동</button>
    </div>;

    if (activeStep === 4) return <div className="workflow-panel rule-review-panel" data-panel="rules" data-pending-rules={visibleFindings.length}>
      <div className="rule-review-heading"><span><span className="eyebrow">5단계 · 규칙검수</span><h2>승인형 수정 검토</h2></span><strong>{visibleFindings.length}건</strong></div>
      {visibleFindings.length ? <>
        <div className="rule-review-list" role="listbox" aria-label="규칙 검토 항목">
          {visibleFindings.map((ruleFinding, index) => <button type="button" role="option" aria-selected={selectedFinding?.id === ruleFinding.id} className={`rule-review-item${selectedFinding?.id === ruleFinding.id ? " is-selected" : ""}`} data-rule-id={ruleFinding.id} data-rule-kind={ruleFinding.kind} onClick={() => selectRule(ruleFinding)} key={ruleFinding.id}>
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
          <button id="rule-apply" type="button" className="primary-action" disabled={selectedFinding?.kind !== "suggestion"} onClick={applySelectedRule}>선택 적용</button>
          <button id="rule-ignore" type="button" className="secondary-action" onClick={ignoreSelectedRule}>선택 무시</button>
        </div>
        <div className="rule-bulk-actions">
          <button id="rule-apply-all" type="button" disabled={!suggestionCount} onClick={applyAllRules}>제안 전체 적용 ({suggestionCount})</button>
          <button id="rule-ignore-all" type="button" onClick={ignoreAllRules}>남은 항목 모두 무시</button>
          <button id="rule-undo" type="button" disabled={!ruleHistory.length} onClick={undoLastRule}>마지막 적용 되돌리기</button>
        </div>
        <p className="approval-safety-note">적용 버튼을 누르기 전에는 Plan IR 원문을 변경하지 않습니다.</p>
      </> : <div className="workflow-empty-result"><strong>검토할 항목이 없습니다.</strong><span>적용 {approvalCount}건 · 무시 {ignoredRuleIds.length}건</span></div>}
      <button id="rules-confirm" type="button" className="primary-action" disabled={visibleFindings.length > 0} onClick={confirmRules}>규칙검수 완료</button>
    </div>;

    return <div className="workflow-panel" data-panel="export">
      <span className="eyebrow">6단계 · 내보내기</span><h2>HWPX 생성 준비 완료</h2>
      <dl className="export-summary"><div><dt>문서</dt><dd>{infoDraft.title}</dd></div><div><dt>기관</dt><dd>{agency.displayName}</dd></div><div><dt>페이지 유형</dt><dd>{pageDrafts.length}개 확정</dd></div><div><dt>규칙 결과</dt><dd>{approvalCount}건 적용 · {ignoredRuleIds.length}건 무시</dd></div></dl>
      <button id="export-hwpx" type="button" className="primary-action" onClick={exportHwpx}>HWPX 내보내기</button>
    </div>;
  };

  return <main className="app-shell" data-active-step={workflowSteps[activeStep].key} data-pending-rules={visibleFindings.length}>
    <header className="app-topbar">
      <div className="brand-lockup"><span className="brand-name">ICE Plan Studio</span><span className="topbar-divider" /><strong>{workflowSteps[activeStep].label}</strong></div>
      <div className="topbar-actions">
        <span className="save-state"><span className="status-dot" />{completed.slice(0, 5).filter(Boolean).length}/5 확정</span>
        <label className="profile-select">기관<select value={agencyId} onChange={handleAgencyChange}>{Object.values(agencyProfiles).map((profile) => <option key={profile.id} value={profile.id}>{profile.label}</option>)}</select></label>
        <button id="workspace-save" type="button" className="topbar-button" disabled={!model} onClick={saveWorkspace}>작업 저장</button>
        <button id="workspace-load" type="button" className="topbar-button" onClick={loadWorkspace}>작업 열기</button>
        <label className="topbar-button file-load-button">파일 불러오기<input type="file" accept=".md,.txt,.hwp,.hwpx" onChange={load} /></label>
        <button type="button" className="topbar-button" disabled={!available[5]} onClick={() => setActiveStep(5)}>내보내기 단계</button>
      </div>
    </header>
    <div className="app-body">
      <WorkflowRail activeStep={activeStep} available={available} completed={completed} onSelect={setActiveStep} />
      <section className="review-workspace">
        <aside className="thumbnail-rail">
          <div className="thumbnail-heading"><strong>페이지</strong><span>{projection?.pages.length || 0}</span></div>
          <div className="thumbnail-list">{projection ? projection.pages.map((item) => <button type="button" className={`page-thumbnail${page === item.number ? " is-selected" : ""}`} aria-current={page === item.number ? "page" : undefined} key={item.id} onClick={() => setPage(item.number)}><span className="thumb-paper"><span className="thumb-title">{item.label}</span>{item.blocks.some((block) => block.type === "table") ? <span className="thumb-table" /> : <span className="thumb-line" />}</span><span className="thumb-caption">{item.number}</span></button>) : <p className="thumbnail-note">문서를 불러오면 Plan IR에서 페이지 유형을 구성합니다.</p>}</div>
        </aside>
        <section className="document-stage">
          <div className="preview-toolbar"><div className="toolbar-group"><button type="button" className={`view-button${previewMode === "react" ? " is-active" : ""}`} onClick={() => setPreviewMode("react")}>빠른 미리보기</button><button type="button" className={`view-button${previewMode === "rendered" ? " is-active" : ""}`} disabled={!realPreview} onClick={() => setPreviewMode("rendered")}>실조판 SVG</button><button type="button" className="tool-button" onClick={() => setZoom((value) => Math.min(125, value + 10))}>확대</button><select aria-label="미리보기 확대율" value={zoom} onChange={(event) => setZoom(Number(event.target.value))}>{[50, 60, 75, 90, 100, 125].map((value) => <option key={value} value={value}>{value}%</option>)}</select><button type="button" className="tool-button" onClick={() => setZoom((value) => Math.max(50, value - 10))}>축소</button></div><span>{current ? `${current.number}쪽 · ${current.label}` : "입력 대기"}</span></div>
          <div className="canvas-scroll">{previewMode === "rendered" && realPreview ? <div className="paper-wrap composition-svg-wrap" style={{ transform: `scale(${zoom / 75})` }}><img className="composition-svg" src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(realPreview.svg)}`} alt={`생성 HWPX 실조판 ${realPreview.pageCount}쪽`} /></div> : projection && current ? <div className="paper-wrap" style={{ transform: `scale(${zoom / 75})` }}><PlanPreview projection={projection} page={current} agencyName={agency.displayName} highlightBlockIndex={activeStep === 4 ? selectedFinding?.target?.blockIndex : null} /></div> : <div className="preview-empty-state"><h1>문서를 불러와 조판을 시작하세요</h1><p>6단계 워크플로가 실제 확정 상태에 따라 순서대로 열립니다.</p></div>}</div>
          <div className="viewport-footer"><span>A4 {layoutTokens.page.widthMm} × {layoutTokens.page.heightMm}mm</span><span>본문폭 {projection ? `${projection.bodyWidthMm.toFixed(0)}mm` : "—"}</span><span>확대 {zoom}%</span></div>
        </section>
        <aside className="rule-inspector">{renderStepPanel()}</aside>
      </section>
    </div>
    <footer className="app-statusbar"><span>문서: {file || "입력 대기"}</span><span>{projection ? `페이지 ${page}/${projection.pages.length}` : "페이지 —"}</span><span>현재 단계: {workflowSteps[activeStep].label}</span><span className="status-summary">다음 게이트: {available[Math.min(activeStep + 1, 5)] ? "사용 가능" : "확정 필요"}</span></footer>
    {notice ? <div className="toast" role="status">{notice}</div> : null}
  </main>;
}

export { WorkflowApp };
