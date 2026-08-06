// 화면 조립과 상태·핸들러만 담당한다. 단계 패널·레일·상단바·캔버스는
// components/workflow/ 아래로 분리했다(11단계 선행 리팩터링) — 시각 리디자인이
// 워크플로 로직을 건드리지 않게 하려는 분리이며, 이 파일의 동작은 바뀌지 않았다.
import { useEffect, useMemo, useRef, useState } from "react";
import { agencyProfiles, defaultAgencyProfile, resolveAgency } from "../domain/agencyProfiles.js";
import { parseMarkdown } from "../domain/markdownParser.js";
import {
  DOCUMENT_KINDS,
  applyBulletDecision,
  applyFrontMatterDecision,
  ensurePlanDecisions,
  insertPage,
  movePage,
  planDecisionGate,
  removePage,
} from "../domain/planDecisions.js";
import { createPreviewProjection, layoutTokens } from "../domain/previewProjection.js";
import { applyAllRuleSuggestions, applyRuleSuggestion, inspectDocumentRules, BULLET_PALETTES } from "../domain/ruleEngine.js";
import { compositionModel, modelTitle, pageDraftsFrom, profilePackage, withPagePlan } from "../domain/workflowModel.js";
import { AnalysisPanel } from "./workflow/AnalysisPanel.jsx";
import { AppTopbar } from "./workflow/AppTopbar.jsx";
import { DocumentStage, ThumbnailRail } from "./workflow/DocumentStage.jsx";
import { ExportPanel } from "./workflow/ExportPanel.jsx";
import { InformationPanel } from "./workflow/InformationPanel.jsx";
import { RulesPanel } from "./workflow/RulesPanel.jsx";
import { StartPanel } from "./workflow/StartPanel.jsx";
import { StructurePanel } from "./workflow/StructurePanel.jsx";
import { workflowSteps } from "./workflow/steps.js";
import { WorkflowRail } from "./workflow/WorkflowRail.jsx";

const BLOCKING_LABELS = {
  "document-kind": "문서 성격",
  "toc-decision": "목차",
  "summary-decision": "요약",
};

// 본문 계열 쪽 유형. previewProjection·model_to_hwpx와 같은 목록을 쓴다.
const BODY_PAGE_TYPES = ["body", "body-opening", "body-continuation"];

function WorkflowApp() {
  const [model, setModel] = useState(null);
  const [file, setFile] = useState("");
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(75);
  const [notice, setNotice] = useState("");
  const [agencyId, setAgencyId] = useState(defaultAgencyProfile.id);
  const [previewMode, setPreviewMode] = useState("react");
  const [realPreview, setRealPreview] = useState(null);
  const [renderedPage, setRenderedPage] = useState(1);
  // 설치본이 어느 빌드인지 화면에서 바로 확인하기 위한 표시(Electron에서만 채워진다).
  const [appVersion, setAppVersion] = useState(null);
  const [activeStep, setActiveStep] = useState(0);
  const [analysisConfirmed, setAnalysisConfirmed] = useState(false);
  const [infoDraft, setInfoDraft] = useState({ title: "", date: "", department: "" });
  const [infoConfirmed, setInfoConfirmed] = useState(false);
  const [pageDrafts, setPageDrafts] = useState([]);
  const [rulesConfirmed, setRulesConfirmed] = useState(false);
  const [ignoredRuleIds, setIgnoredRuleIds] = useState([]);
  const [selectedRuleId, setSelectedRuleId] = useState(null);
  const [ruleHistory, setRuleHistory] = useState([]);
  const [dragActive, setDragActive] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [lastExport, setLastExport] = useState(null);
  // 검수 패널 폭(작업 영역 대비 %). 비율이라 창 크기가 변해도 3분할 비례가 유지된다.
  const [inspectorPct, setInspectorPct] = useState(() => {
    const stored = Number(localStorage.getItem("ice-inspector-pct"));
    return Number.isFinite(stored) && stored >= 16 && stored <= 46 ? stored : 25;
  });
  const workspaceRef = useRef(null);

  useEffect(() => {
    localStorage.setItem("ice-inspector-pct", String(inspectorPct));
  }, [inspectorPct]);

  const clampInspector = (value) => Math.min(46, Math.max(16, value));

  const startSplitDrag = (event) => {
    event.preventDefault();
    const rect = workspaceRef.current?.getBoundingClientRect();
    if (!rect) return;
    const move = (pointer) => setInspectorPct(clampInspector(((rect.right - pointer.clientX) / rect.width) * 100));
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
  };

  const splitterKeyDown = (event) => {
    if (event.key === "ArrowLeft") setInspectorPct((value) => clampInspector(value + 2));
    else if (event.key === "ArrowRight") setInspectorPct((value) => clampInspector(value - 2));
    else if (event.key === "Home") setInspectorPct(25);
    else return;
    event.preventDefault();
  };

  const agency = resolveAgency(agencyId);
  const outputModel = useMemo(() => compositionModel(model, agency), [model, agency]);
  const projection = useMemo(() => outputModel ? createPreviewProjection(outputModel) : null, [outputModel]);
  const current = projection?.pages[page - 1];
  const findings = useMemo(() => model ? inspectDocumentRules(model) : [], [model]);
  const visibleFindings = useMemo(() => findings.filter((item) => !ignoredRuleIds.includes(item.id)), [findings, ignoredRuleIds]);
  const selectedFinding = visibleFindings.find((item) => item.id === selectedRuleId) || visibleFindings[0] || null;
  const suggestionCount = visibleFindings.filter((item) => item.kind === "suggestion").length;
  const approvalCount = model?.approval?.edits?.length || 0;
  const structureConfirmed = pageDrafts.length > 0 && pageDrafts.every((item) => item.confirmed);
  // 규칙 검토 항목이 있는 쪽에 썸네일 배지를 단다. 블록 대상 규칙은 본문 쪽 소속이다.
  const issueCountByPage = useMemo(() => {
    if (!projection || !visibleFindings.length) return {};
    const bodyPage = projection.pages.find((item) => BODY_PAGE_TYPES.includes(item.type));
    return bodyPage ? { [bodyPage.number]: visibleFindings.length } : {};
  }, [projection, visibleFindings]);
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
    window.icePlan?.appVersion?.().then(setAppVersion).catch(() => setAppVersion(null));
  }, []);

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
      .then((result) => {
        if (cancelled) return;
        setRealPreview(result);
        setRenderedPage((value) => Math.min(Math.max(value, 1), result.pageCount || 1));
      })
      .catch((error) => { if (!cancelled) setNotice(`실조판 미리보기를 만들지 못했습니다: ${error.message}`); });
    return () => { cancelled = true; };
  }, [outputModel]);

  const loadFile = async (input) => {
    if (!input) return;
    try {
      const parsed = window.icePlan?.loadPlanInput && input.path
        ? (await window.icePlan.loadPlanInput(input.path)).model
        : parseMarkdown(await input.text(), { title: input.name });
      const prepared = ensurePlanDecisions(parsed);
      const title = modelTitle(prepared, input.name);
      const next = {
        ...prepared,
        metadata: {
          ...prepared.metadata,
          title,
          cover: { ...(prepared.metadata?.cover || {}), title },
        },
      };
      const drafts = pageDraftsFrom(next, agency);
      setFile(input.name);
      setModel(withPagePlan(next, drafts));
      setInfoDraft({
        title,
        date: next.metadata?.cover?.date || "",
        department: next.metadata?.organization?.department || next.metadata?.cover?.department || "",
      });
      setPageDrafts(drafts);
      setAnalysisConfirmed(false);
      setInfoConfirmed(false);
      setRulesConfirmed(false);
      setIgnoredRuleIds([]);
      setSelectedRuleId(null);
      setRuleHistory([]);
      setPage(1);
      setRenderedPage(1);
      // 가져온 HWPX는 논리 구조 쪽과 자동 넘침이 반영된 실제 쪽이 다르다. 빠른
      // 미리보기로 시작하면 사용자가 원문에 없는 쪽 구성을 보게 되므로 실조판을
      // 기본 화면으로 삼는다(AGENTS.md 본문 조판 계약).
      setPreviewMode(next?.source?.format === "hwpx" ? "rendered" : "react");
      setActiveStep(1);
      setNotice(`${input.name}을 불러왔습니다. 분석 결과를 확인해 주세요.`);
    } catch (error) {
      setNotice(`파일을 읽지 못했습니다: ${error.message}`);
    }
  };

  const load = async (event) => {
    await loadFile(event.target.files?.[0]);
    event.target.value = "";
  };

  // 드래그&드롭 입력 — 파일 선택 버튼과 같은 경로(loadFile)를 탄다.
  const handleDrop = (event) => {
    event.preventDefault();
    setDragActive(false);
    loadFile(event.dataTransfer?.files?.[0]);
  };

  const handleDragOver = (event) => {
    if (!event.dataTransfer?.types?.includes("Files")) return;
    event.preventDefault();
    setDragActive(true);
  };

  // 카드 선택기(기본정보 패널)와 상단바 드롭다운이 같은 로직을 공유한다.
  const selectAgency = (nextId) => {
    setAgencyId(nextId);
    if (model) {
      setInfoConfirmed(false);
      setRulesConfirmed(false);
      setActiveStep(2);
      setNotice("기관이 변경되어 기본정보를 다시 확정해야 합니다.");
    }
  };

  const handleAgencyChange = (event) => selectAgency(event.target.value);

  const changeDocumentKind = (documentKind) => {
    const nextModel = ensurePlanDecisions(model, { documentKind });
    const drafts = pageDraftsFrom(nextModel, agency);
    setModel(withPagePlan(nextModel, drafts));
    setPageDrafts(drafts);
    setAnalysisConfirmed(false);
    setRulesConfirmed(false);
  };

  const changeFrontMatterDecision = (field, mode, warningAcknowledged = false) => {
    try {
      const nextModel = applyFrontMatterDecision(model, field, {
        mode,
        userDecision: mode === "omitted" && field === "toc" ? "confirmed-with-warning" : "confirmed",
        warningAcknowledged,
      });
      const drafts = pageDraftsFrom(nextModel, agency);
      setModel(withPagePlan(nextModel, drafts));
      setPageDrafts(drafts);
      setAnalysisConfirmed(false);
      setRulesConfirmed(false);
      setNotice(`${field === "toc" ? "목차" : "요약"} 결정을 저장했습니다.`);
    } catch (error) {
      setNotice(error.message);
    }
  };

  const changeBulletDecision = (userDecision, overrideReason) => {
    try {
      setModel((currentModel) => applyBulletDecision(currentModel, { userDecision, overrideReason }));
      setRulesConfirmed(false);
      setNotice("불릿 재량 결정을 저장했습니다.");
    } catch (error) {
      setNotice(error.message);
    }
  };

  const confirmAnalysis = () => {
    const gate = planDecisionGate(model);
    if (!gate.passed) {
      const labels = gate.blocking.map((item) => BLOCKING_LABELS[item] || item);
      setNotice(`분석 확정 전에 결정이 필요합니다: ${labels.join(", ")}`);
      return;
    }
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
          department: infoDraft.department.trim(),
        },
        organization: {
          ...(currentModel.metadata?.organization || {}),
          displayName: agency.displayName,
          department: infoDraft.department.trim() || null,
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
    setModel((currentModel) => withPagePlan(currentModel, nextPages));
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

  const addPage = (index) => {
    const nextPages = insertPage(
      pageDrafts,
      { type: "body-continuation", role: "body-continuation", title: layoutTokens.pageTypes["body-continuation"], blocks: [] },
      index + 1,
    );
    applyPages(nextPages);
    setPage(index + 2);
    setNotice("본문 후속 쪽을 추가했습니다. 새 쪽 유형을 확인해 주세요.");
  };

  const deletePage = (index) => {
    try {
      const nextPages = removePage(pageDrafts, index);
      applyPages(nextPages);
      setPage(Math.min(index + 1, nextPages.length));
      setNotice("쪽을 삭제했습니다. 쪽 순서를 다시 확인해 주세요.");
    } catch (error) {
      setNotice(error.message);
    }
  };

  const reorderPage = (index, direction) => {
    const nextPages = movePage(pageDrafts, index, direction);
    applyPages(nextPages);
    const offset = direction === "up" ? -1 : 1;
    setPage(Math.max(1, Math.min(nextPages.length, index + 1 + offset)));
  };

  const confirmPageType = (index) => {
    setPageDrafts((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, confirmed: true } : item));
    // 미리보기 쪽 범위를 벗어나면 빠른 미리보기가 사라지고 나란히 비교가 계속 잠긴다.
    // 125행 클램프는 projection이 바뀔 때만 돌기 때문에 여기서 직접 막아야 한다.
    setPage(Math.min(index + 1, projection?.pages.length || index + 1));
    setRulesConfirmed(false);
  };

  const currentPaletteId = useMemo(() => {
    const markers = model?.metadata?.rules?.itemMarkers;
    if (!Array.isArray(markers)) return "default";
    const match = BULLET_PALETTES.find((palette) => palette.markers.join("|") === markers.join("|"));
    return match ? match.id : "custom";
  }, [model]);

  const changeMarkerPalette = (paletteId) => {
    const palette = BULLET_PALETTES.find((item) => item.id === paletteId);
    if (!palette || !model) return;
    // 문서 마커 계열을 metadata.rules.itemMarkers에 저장한다. 규칙 엔진이 이 값을
    // 소비해 LIST-MARKER 제안 계열을 바꾸므로, 규칙 재검수가 필요하다(확정 해제).
    setModel({
      ...model,
      metadata: {
        ...model.metadata,
        rules: { ...(model.metadata?.rules || {}), itemMarkers: [...palette.markers] },
      },
    });
    setRulesConfirmed(false);
    setNotice(`항목기호 계열을 '${palette.label}'(으)로 바꿨습니다. 규칙검수를 다시 확인해 주세요.`);
  };

  const selectRule = (ruleFinding) => {
    setSelectedRuleId(ruleFinding.id);
    setPreviewMode("react");
    if (Number.isInteger(ruleFinding.target?.blockIndex)) {
      const bodyIndex = projection?.pages.findIndex((item) => BODY_PAGE_TYPES.includes(item.type)) ?? -1;
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
    setExporting(true);
    try {
      const result = await window.icePlan.exportHwpx(outputModel);
      // 간격이 자동 조정됐으면 내보내기 결과에도 알린다 — 묵시 변경 금지.
      const adjusted = result.layoutAdjustment?.applied ? ` (${result.layoutAdjustment.notice})` : "";
      if (!result.canceled) {
        setLastExport({ filePath: result.filePath });
        setNotice(`HWPX로 내보냈습니다: ${result.filePath}${adjusted}`);
      }
    } catch (error) {
      setNotice(`HWPX 내보내기 실패: ${error.message}`);
    } finally {
      setExporting(false);
    }
  };

  const showLastExport = () => {
    if (lastExport?.filePath) window.icePlan?.showInFolder?.(lastExport.filePath).catch((error) => setNotice(`폴더 열기 실패: ${error.message}`));
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
      const nextModel = ensurePlanDecisions(snapshot.document);
      if (!nextModel?.blocks) throw new Error("프로젝트에 Plan IR 문서가 없습니다.");
      const workflow = snapshot.project?.workflow || {};
      const view = snapshot.project?.view || {};
      const settings = snapshot.project?.settings || {};
      const requestedAgencyId = settings.agencyId || snapshot.profile?.profile?.baseAgencyId || defaultAgencyProfile.id;
      const nextAgency = resolveAgency(requestedAgencyId);
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
      setModel(withPagePlan(nextModel, nextDrafts));
      setFile(snapshot.project?.metadata?.loadedFile || result.filePath.split(/[\\/]/).pop());
      setAgencyId(nextAgency.id);
      setAnalysisConfirmed(nextAnalysisConfirmed);
      setInfoDraft(workflow.infoDraft || {
        title: modelTitle(nextModel, "프로젝트"),
        date: nextModel.metadata?.cover?.date || "",
        department: nextModel.metadata?.organization?.department || nextModel.metadata?.cover?.department || "",
      });
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
        || resolveAgency(requested);
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

  const stepPanels = [
    <StartPanel onLoadFile={load} onLoadWorkspace={loadWorkspace} onLoadProfile={loadAgencyProfile} onSaveProfile={saveAgencyProfile} />,
    <AnalysisPanel
      model={model}
      projection={projection}
      findings={findings}
      file={file}
      documentKinds={DOCUMENT_KINDS}
      planDecisions={model?.metadata?.plan}
      onChangeDocumentKind={changeDocumentKind}
      onChangeFrontMatterDecision={changeFrontMatterDecision}
      onConfirm={confirmAnalysis}
    />,
    <InformationPanel infoDraft={infoDraft} agencyId={agencyId} onChangeInfo={changeInfo} onSelectAgency={selectAgency} onConfirm={confirmInformation} />,
    <StructurePanel
      currentPaletteId={currentPaletteId}
      onChangeMarkerPalette={changeMarkerPalette}
      bulletDecision={model?.metadata?.plan?.bullet}
      onChangeBulletDecision={changeBulletDecision}
      pageDrafts={pageDrafts}
      onSelectPage={setPage}
      onChangePageType={changePageType}
      onConfirmPageType={confirmPageType}
      onAddPage={addPage}
      onDeletePage={deletePage}
      onMovePage={reorderPage}
      structureConfirmed={structureConfirmed}
      onNext={() => setActiveStep(4)}
    />,
    <RulesPanel visibleFindings={visibleFindings} selectedFinding={selectedFinding} suggestionCount={suggestionCount} approvalCount={approvalCount} ignoredRuleIds={ignoredRuleIds} ruleHistory={ruleHistory} onSelectRule={selectRule} onApplySelected={applySelectedRule} onIgnoreSelected={ignoreSelectedRule} onApplyAll={applyAllRules} onIgnoreAll={ignoreAllRules} onUndo={undoLastRule} onConfirm={confirmRules} />,
    <ExportPanel infoDraft={infoDraft} agency={agency} pageDrafts={pageDrafts} approvalCount={approvalCount} ignoredRuleIds={ignoredRuleIds} onExport={exportHwpx} exporting={exporting} lastExport={lastExport} onShowInFolder={showLastExport} />,
  ];

  return <main
    className="app-shell"
    data-active-step={workflowSteps[activeStep].key}
    data-pending-rules={visibleFindings.length}
    onDragOver={handleDragOver}
    onDragLeave={() => setDragActive(false)}
    onDrop={handleDrop}
  >
    {dragActive ? <div className="drop-overlay" aria-hidden="true"><strong>놓으면 문서를 불러옵니다</strong><span>MD · TXT · HWP · HWPX</span></div> : null}
    <AppTopbar
      activeStep={activeStep} appVersion={appVersion} completed={completed} agencyId={agencyId}
      model={model} available={available} onAgencyChange={handleAgencyChange}
      onSaveWorkspace={saveWorkspace} onLoadWorkspace={loadWorkspace} onLoadFile={load}
      onGoExport={() => setActiveStep(5)}
    />
    <div className="app-body">
      <WorkflowRail activeStep={activeStep} available={available} completed={completed} onSelect={setActiveStep} />
      <section className="review-workspace" ref={workspaceRef} style={{ "--inspector-size": `${inspectorPct}%` }}>
        <ThumbnailRail
          projection={projection} page={page} onSelectPage={setPage} issueCountByPage={issueCountByPage}
          previewMode={previewMode} realPreview={realPreview}
          renderedPage={renderedPage} onSelectRenderedPage={setRenderedPage}
        />
        <DocumentStage
          previewMode={previewMode} onPreviewMode={setPreviewMode} realPreview={realPreview}
          zoom={zoom} onZoom={setZoom} projection={projection} current={current}
          renderedPage={renderedPage} onRenderedPage={setRenderedPage}
          agencyName={agency.displayName}
          highlightBlockIndex={activeStep === 4 ? selectedFinding?.target?.blockIndex : null}
        />
        <button
          type="button"
          className="pane-splitter"
          role="separator"
          aria-orientation="vertical"
          aria-label="검수 패널 너비 조절 (좌우 화살표, Home=기본값)"
          aria-valuenow={Math.round(inspectorPct)}
          aria-valuemin={16}
          aria-valuemax={46}
          onPointerDown={startSplitDrag}
          onKeyDown={splitterKeyDown}
          onDoubleClick={() => setInspectorPct(25)}
        />
        <aside className="rule-inspector">{stepPanels[activeStep]}</aside>
      </section>
    </div>
    <footer className="app-statusbar"><span>문서: {file || "입력 대기"}</span><span>{projection ? `페이지 ${page}/${projection.pages.length}` : "페이지 —"}</span><span>현재 단계: {workflowSteps[activeStep].label}</span><span className="status-summary">다음 게이트: {available[Math.min(activeStep + 1, 5)] ? "사용 가능" : "확정 필요"}</span></footer>
    {notice ? <div className="toast" role="status">{notice}</div> : null}
  </main>;
}

export { WorkflowApp };
