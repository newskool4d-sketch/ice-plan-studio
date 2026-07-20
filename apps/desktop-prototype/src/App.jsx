import { useEffect, useMemo, useState } from "react";
import { parseMarkdown } from "./domain/markdownParser.js";
import { agencyProfiles, defaultAgencyProfile } from "./domain/agencyProfiles.js";

const steps = [
  ["시작", "새 문서 만들기"],
  ["분석", "문서 분석 및 진단"],
  ["메타데이터", "문서 속성 및 정보"],
  ["구조 편집", "목차와 구조 편집"],
  ["규칙 검토", "형식 규칙 확인 및 수정"],
  ["내보내기", "문서 내보내기 설정"],
];

const pages = [
  { page: 1, label: "교육 목표와 추진 방향", issue: true },
  { page: 2, label: "세부 추진 내용", issue: false },
  { page: 3, label: "추진 일정", issue: false },
  { page: 4, label: "예산 및 역할", issue: false },
  { page: 5, label: "성과 지표", issue: false },
];

const tableRows = [
  ["1", "미래역량 교육 강화", "AI·디지털 기반 교육과정 운영", "교육과정과", "정보화지원과"],
  ["2", "맞춤형 학생 지원", "기초학력 및 진로·진학 지원 확대", "학생지원과", "진로진학지원센터"],
  ["3", "안전하고 건강한 학교", "안전관리 강화 및 건강증진 프로그램 운영", "안전총괄과", "보건실"],
  ["4", "교육공동체 협력 강화", "학부모·지역사회와의 협력 확대", "교육협력과", "전 부서"],
  ["5", "교육행정 혁신", "업무 효율화 및 행정 서비스 개선", "행정지원과", "전 부서"],
];

async function resolveImageDataUrl(src) {
  if (!src) return null;
  if (src.startsWith("data:")) return src;
  const response = await fetch(src);
  const blob = await response.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function renderInline(text) {
  const parts = String(text ?? "").split(/(\*\*[^*]+\*\*)/g).filter((part) => part !== "");
  return parts.map((part, index) => {
    const match = /^\*\*([^*]+)\*\*$/.exec(part);
    return match ? <strong key={index}>{match[1]}</strong> : <span key={index}>{part}</span>;
  });
}

function renderLoadedBlock(block, index) {
  if (block.type === "heading") {
    const Tag = `h${Math.min(Math.max(block.level || 1, 1), 3)}`;
    return <Tag key={index}>{renderInline(block.text)}</Tag>;
  }
  if (block.type === "listItem") {
    return (
      <p key={index} className="loaded-list-item">
        <span className="list-marker">{block.ordered ? "1." : "-"}</span> {renderInline(block.text)}
      </p>
    );
  }
  if (block.type === "table") {
    return (
      <table className="plan-table loaded-table" key={index}>
        <thead><tr>{block.header.map((cell, cellIndex) => <th key={cellIndex}>{renderInline(cell)}</th>)}</tr></thead>
        <tbody>{block.rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex}>{renderInline(cell)}</td>)}</tr>)}</tbody>
      </table>
    );
  }
  return <p key={index} className="loaded-paragraph">{renderInline(block.text)}</p>;
}

function IconButton({ children, label, onClick, pressed = false }) {
  return (
    <button
      type="button"
      className={`tool-button${pressed ? " is-pressed" : ""}`}
      aria-label={label}
      aria-pressed={pressed}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function App() {
  const [activeStep, setActiveStep] = useState(4);
  const [selectedPage, setSelectedPage] = useState(1);
  const [resolution, setResolution] = useState("width-only");
  const [currentWidth, setCurrentWidth] = useState(164);
  const [zoom, setZoom] = useState(75);
  const [isApplying, setIsApplying] = useState(false);
  const [notice, setNotice] = useState("");
  const [isSynced, setIsSynced] = useState(true);
  const [agencyId, setAgencyId] = useState(defaultAgencyProfile.id);
  const [loadedFile, setLoadedFile] = useState("");
  const [loadedModel, setLoadedModel] = useState(null);
  const [customBranding, setCustomBranding] = useState({});
  const [fontReport, setFontReport] = useState(null);
  const agencyProfile = agencyProfiles[agencyId] || defaultAgencyProfile;
  const activeBranding = customBranding[agencyId] || {};

  const issueOpen = selectedPage === 1;
  const applied = currentWidth === 160;
  const selectedOption = resolution === "width-only" ? "권장 최대 너비로 조정" : "내용을 조정하여 너비 유지";
  const pageLabel = pages.find((page) => page.page === selectedPage)?.label ?? "페이지";
  const loadedTitle = loadedModel?.blocks?.find((block) => block.type === "heading")?.text;

  const statusLabel = useMemo(() => {
    if (isApplying) return "조판 중";
    if (!isSynced) return "한글 동기화 대기";
    if (loadedModel) return loadedModel.ruleFindings?.length ? `규칙 검토 필요 ${loadedModel.ruleFindings.length}건` : "규칙 검토 완료";
    return applied ? "빠른 미리보기 완료" : "검토 항목 1개";
  }, [applied, isApplying, isSynced, loadedModel]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) {
          setCurrentWidth(160);
          setNotice("마지막 적용을 다시 실행했습니다.");
        } else {
          setCurrentWidth(164);
          setNotice("마지막 적용을 되돌렸습니다.");
        }
      }
      if (event.key === "Escape") {
        setNotice("");
      }
      if (event.key === "PageDown") {
        event.preventDefault();
        setSelectedPage((page) => (page >= pages.length ? 1 : page + 1));
      }
    };
    window.addEventListener("keydown", onKeyDown);
  return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // 시작 시 필수 글꼴 설치 현황을 검사한다. 누락 글꼴이 있으면 한글이 임의 대체
  // 렌더링해 줄바꿈·페이지 수가 달라지므로, 승인 없는 대체를 막기 위해 표시한다.
  useEffect(() => {
    if (!window.icePlan?.checkFonts) return;
    let cancelled = false;
    window.icePlan.checkFonts()
      .then((report) => {
        if (cancelled) return;
        setFontReport(report);
        if (report?.error) setNotice(`글꼴 검사 실패: ${report.error}`);
        else if (report?.missing?.length) setNotice(`필수 글꼴 ${report.missing.length}종이 설치되지 않았습니다.`);
      })
      .catch((error) => { if (!cancelled) setFontReport({ ok: false, error: error.message, missing: [], results: [] }); });
    return () => { cancelled = true; };
  }, []);

  const applyResolution = () => {
    if (!issueOpen || resolution !== "width-only" || applied || isApplying) return;
    setIsApplying(true);
    setIsSynced(false);
    setNotice("표 너비를 권장값으로 조정하고 있습니다.");
    window.setTimeout(() => {
      setCurrentWidth(160);
      setIsApplying(false);
      setIsSynced(true);
      setNotice("표 너비를 160mm로 조정했습니다. Ctrl+Z로 되돌릴 수 있습니다.");
    }, 500);
  };

  const revertResolution = () => {
    setCurrentWidth(164);
    setIsApplying(false);
    setIsSynced(true);
    setNotice("적용 전 상태로 되돌렸습니다.");
  };
  const handleBrandAsset = async (event, kind) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    setCustomBranding((current) => ({ ...current, [agencyId]: { ...(current[agencyId] || {}), [kind]: dataUrl } }));
    setNotice(`${kind === "ci" ? "CI" : "슬로건"} 파일을 ${agencyProfile.label} 프로필에 등록했습니다.`);
    event.target.value = "";
  };  const handleFileLoad = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const lowerName = file.name.toLowerCase();
      if (lowerName.endsWith('.hwp')) throw new Error('HWP 바이너리는 아직 지원하지 않습니다. 한글에서 HWPX로 저장한 뒤 다시 불러와 주세요.');
      const isHwpx = lowerName.endsWith('.hwpx');
      const text = isHwpx
        ? (window.icePlan?.extractHwpx ? (await window.icePlan.extractHwpx(file.path)).text : '')
        : await file.text();
      if (isHwpx && !text) throw new Error('HWPX 추출은 Electron 실행 파일에서 사용할 수 있습니다.');
      const model = parseMarkdown(text, { title: file.name });
      setLoadedFile(file.name);
      setLoadedModel(model);
      setSelectedPage(1);
      setNotice(`${file.name}을 불러왔습니다. ${model.blocks.length}개 블록을 분석했습니다.`);
    } catch (error) {
      setNotice(`파일을 읽지 못했습니다: ${error.message}`);
    }
    event.target.value = '';
  };

  const handleExport = async () => {
    if (!loadedModel) { setNotice("먼저 MD 또는 TXT 파일을 불러와 주세요."); return; }
    if (!window.icePlan?.exportHwpx) { setNotice("HWPX 내보내기는 Electron 실행 파일에서 사용할 수 있습니다."); return; }
    try {
      const ciDataUrl = await resolveImageDataUrl(activeBranding.ci || agencyProfile.ci);
      const sloganDataUrl = await resolveImageDataUrl(activeBranding.slogan || agencyProfile.sloganAsset);
      const cover = { title: loadedTitle || loadedFile, displayName: agencyProfile.displayName, ciDataUrl, sloganDataUrl };
      const result = await window.icePlan.exportHwpx({ ...loadedModel, metadata: { ...loadedModel.metadata, cover } });
      if (!result.canceled) setNotice(`HWPX로 내보냈습니다: ${result.filePath}`);
    } catch (error) {
      setNotice(`HWPX 내보내기 실패: ${error.message}`);
    }
  };
  const handleSaveProfile = async () => {
    if (!window.icePlan?.saveProfile) { setNotice("프로필 저장은 Electron 실행 파일에서 사용할 수 있습니다."); return; }
    const result = await window.icePlan.saveProfile({ agencyId, customBranding });
    if (!result.canceled) setNotice(`프로필을 저장했습니다: ${result.filePath}`);
  };

  const handleLoadProfile = async () => {
    if (!window.icePlan?.loadProfile) { setNotice("프로필 불러오기는 Electron 실행 파일에서 사용할 수 있습니다."); return; }
    try {
      const result = await window.icePlan.loadProfile();
      if (!result.canceled) {
        setAgencyId(result.profile.agencyId || defaultAgencyProfile.id);
        setCustomBranding(result.profile.customBranding || {});
        setNotice(`프로필을 불러왔습니다: ${result.filePath}`);
      }
    } catch (error) {
      setNotice(`프로필을 읽지 못했습니다: ${error.message}`);
    }
  };
  const handleSaveProject = async () => {
    if (!window.icePlan?.saveProject) { setNotice("프로젝트 저장은 Electron 실행 파일에서 사용할 수 있습니다."); return; }
    const result = await window.icePlan.saveProject({ loadedFile, loadedModel, agencyId, customBranding, resolution, currentWidth });
    if (!result.canceled) setNotice(`프로젝트를 저장했습니다: ${result.filePath}`);
  };

  const handleLoadProject = async () => {
    if (!window.icePlan?.loadProject) { setNotice("프로젝트 불러오기는 Electron 실행 파일에서 사용할 수 있습니다."); return; }
    try {
      const result = await window.icePlan.loadProject();
      if (!result.canceled) {
        const project = result.project;
        setLoadedFile(project.loadedFile || '');
        setLoadedModel(project.loadedModel || null);
        setAgencyId(project.agencyId || defaultAgencyProfile.id);
        setCustomBranding(project.customBranding || {});
        setResolution(project.resolution || 'width-only');
        setCurrentWidth(project.currentWidth || 164);
        setNotice(`프로젝트를 불러왔습니다: ${result.filePath}`);
      }
    } catch (error) {
      setNotice(`프로젝트를 읽지 못했습니다: ${error.message}`);
    }
  };
  return (
    <main className="app-shell">
      <header className="app-topbar">
        <div className="brand-lockup">
          <span className="brand-mark" aria-label={agencyProfile.displayName}><img src={activeBranding.ci || agencyProfile.ci} alt="" /></span>
          <span className="brand-name">Plan Studio</span>
          <span className="topbar-divider" aria-hidden="true" />
          <strong>규칙 검토</strong>
        </div>
        <div className="topbar-actions">
          <span className={`save-state ${isSynced ? "is-saved" : "is-pending"}`}>
            <span className="status-dot" aria-hidden="true" /> {isSynced ? "저장됨" : "저장 중"}
          </span>
          <button type="button" className="topbar-button" onClick={() => setIsSynced(false)}>한글 동기화</button>
          <label className="profile-select">기관<select aria-label="기관 프로필" value={agencyId} onChange={(event) => { setAgencyId(event.target.value); setNotice("기관 프로필을 변경했습니다."); }}>{Object.values(agencyProfiles).map((profile) => <option key={profile.id} value={profile.id}>{profile.label}</option>)}</select></label>
          <label className="topbar-button file-load-button">파일 불러오기<input type="file" accept=".md,.txt,.hwp,.hwpx,text/markdown,text/plain,application/zip" onChange={handleFileLoad} /></label>
          <button type="button" className="topbar-button" onClick={handleExport} disabled={!loadedModel}>HWPX 내보내기</button>
          <label className="topbar-button file-load-button">CI 등록<input type="file" accept="image/png,image/jpeg" onChange={(event) => handleBrandAsset(event, "ci")} /></label>
          <label className="topbar-button file-load-button">슬로건 등록<input type="file" accept="image/png,image/jpeg" onChange={(event) => handleBrandAsset(event, "slogan")} /></label>
          <button type="button" className="topbar-button" onClick={() => setNotice("도움말은 다음 단계에서 연결합니다.")}>도움말</button>
          <button type="button" className="topbar-button" onClick={handleSaveProject}>프로젝트 저장</button>
          <button type="button" className="topbar-button" onClick={handleLoadProject}>프로젝트 불러오기</button>
          <button type="button" className="topbar-button" onClick={handleSaveProfile}>프로필 저장</button>
          <button type="button" className="topbar-button" onClick={handleLoadProfile}>프로필 불러오기</button>
          <button type="button" className="topbar-button" onClick={() => setNotice("설정은 다음 단계에서 연결합니다.")}>설정</button>
        </div>
      </header>

      <div className="app-body">
        <aside className="workflow-rail" aria-label="작업 단계">
          <div className="rail-header">작업 단계</div>
          <nav>
            {steps.map(([label, detail], index) => {
              const done = index < activeStep;
              const current = index === activeStep;
              return (
                  <button
                  className={`workflow-step ${current ? "is-current" : ""} ${done ? "is-done" : ""}`}
                  type="button"
                  key={label}
                  aria-current={current ? "step" : undefined}
                  onClick={() => setActiveStep(index)}
                >
                  <span className="step-number">{done ? "✓" : index + 1}</span>
                  <span className="step-copy"><strong>{label}</strong><small>{detail}</small></span>
                </button>
              );
            })}
          </nav>
          <div className="rail-bottom">
            <button type="button" className="rail-footer-button" onClick={() => setNotice(loadedModel ? `검토 항목 ${loadedModel.ruleFindings?.length || 0}건이 있습니다.` : "검토 항목 1개가 남아 있습니다.")}>검토 항목 <b>{loadedModel ? (loadedModel.ruleFindings?.length || 0) : (issueOpen && !applied ? 1 : 0)}</b></button>
          </div>
        </aside>

        <section className="review-workspace" aria-label="문서 검토 작업영역">
          <aside className="thumbnail-rail" aria-label="페이지 목록">
            <div className="thumbnail-heading"><strong>페이지</strong><button type="button" aria-label="페이지 필터" onClick={() => setNotice("페이지 필터는 다음 단계에서 연결합니다.")}>필터</button></div>
            <div className="thumbnail-list">
              {loadedModel ? (
                <p className="thumbnail-note">실제 페이지 수는 HWPX 내보내기 시 한글 편집기가 계산합니다. 오른쪽 미리보기는 불러온 문서 내용을 이어서 표시합니다.</p>
              ) : (
                pages.map((page) => (
                  <button
                    type="button"
                    className={`page-thumbnail ${selectedPage === page.page ? "is-selected" : ""}`}
                    key={page.page}
                    aria-label={`페이지 ${page.page}, ${page.issue ? "오류 1" : "오류 없음"}`}
                    aria-current={selectedPage === page.page ? "page" : undefined}
                    onClick={() => { setSelectedPage(page.page); setNotice(""); }}
                  >
                    <span className="thumb-paper">
                      <span className="thumb-title" />
                      <span className="thumb-line" />
                      <span className="thumb-line short" />
                      <span className={`thumb-table ${page.issue ? "has-issue" : ""}`} />
                      <span className="thumb-line" />
                    </span>
                    <span className="thumb-caption">{page.page}</span>
                    {page.issue && !applied ? <span className="thumb-alert">오류 1</span> : null}
                  </button>
                ))
              )}
            </div>
          </aside>

          <section className="document-stage" aria-label="A4 문서 미리보기">
            <div className="preview-toolbar">
              <div className="toolbar-group">
                <IconButton label="선택 도구" pressed>선택</IconButton>
                <IconButton label="문서 이동">이동</IconButton>
                <IconButton label="확대" onClick={() => setZoom((value) => Math.min(125, value + 10))}>확대</IconButton>
                <select value={zoom} aria-label="확대 비율" onChange={(event) => setZoom(Number(event.target.value))}>
                  {[50, 60, 75, 90, 100, 125].map((value) => <option key={value} value={value}>{value}%</option>)}
                </select>
                <IconButton label="축소" onClick={() => setZoom((value) => Math.max(50, value - 10))}>축소</IconButton>
              </div>
              <div className="toolbar-group toolbar-view-group">
                <button type="button" className="view-button is-active" onClick={() => setNotice("한 페이지 보기가 선택되었습니다.")}>한 페이지</button>
                <button type="button" className="view-button" onClick={() => setNotice("두 페이지 보기는 다음 단계에서 연결합니다.")}>두 페이지</button>
                <button type="button" className="view-button" onClick={() => setZoom(75)}>페이지 맞춤</button>
              </div>
            </div>

            <div className="canvas-scroll">
              <div className="paper-wrap" style={{ transform: `scale(${zoom / 75})` }}>
                <article className={`a4-page ${loadedModel ? "is-loaded-doc" : ""}`} aria-label={loadedModel ? `불러온 문서 미리보기: ${loadedTitle || loadedFile}` : `페이지 ${selectedPage} ${pageLabel}`}>
                  {loadedModel ? (
                    <>
                      <header className="document-header">
                        <span>{loadedTitle || loadedFile || "제목 없음"}</span>
                        <span className="document-meta">{agencyProfile.displayName}</span><img className="document-slogan" src={activeBranding.slogan || agencyProfile.sloganAsset} alt={agencyProfile.slogan} />
                      </header>
                      <div className="document-rule" />
                      <div className="loaded-document-body">
                        {loadedModel.blocks.map((block, index) => renderLoadedBlock(block, index))}
                      </div>
                    </>
                  ) : issueOpen ? (
                    <>
                      <header className="document-header">
                        <span>{loadedTitle || "2026학년도 주요업무계획"}</span>
                        <span className="document-meta">{agencyProfile.displayName}</span><img className="document-slogan" src={activeBranding.slogan || agencyProfile.sloganAsset} alt={agencyProfile.slogan} />
                      </header>
                      <div className="document-rule" />
                      <h1>교육지표 및 방향</h1>
                      <h2>1. 교육비전</h2>
                      <p className="lead-box">모두가 성장하는 포용교육으로<br />미래를 여는 ○○교육</p>
                      <h2>2. 교육지표</h2>
                      <table className="plan-table compact-table">
                        <thead><tr><th>구분</th><th>교육지표</th><th>추진 내용</th></tr></thead>
                        <tbody>{[["배움", "깊이 있는 배움으로 역량을 키우는 학생", "교육과정"], ["성장", "꿈을 키우며 함께 성장하는 학생", "학생지원"], ["공감", "서로를 존중하며 배려하는 학생", "교육공동체"], ["안전", "안전하고 건강한 학교 환경", "안전총괄"], ["협력", "소통과 협력으로 함께하는 교육공동체", "교육협력"]].map((row) => <tr key={row[0]}>{row.map((cell) => <td key={cell}>{cell}</td>)}</tr>)}</tbody>
                      </table>
                      <h2>3. 추진과제</h2>
                      <div className={`document-object ${applied ? "is-fixed" : "is-issue"}`} tabIndex="0" role="button" aria-label={`추진과제 표, 현재 너비 ${currentWidth}밀리미터`} onClick={() => setNotice("추진과제 표가 선택되었습니다.")}>
                        {!applied && <span className="object-callout">①</span>}
                        <table className="plan-table task-table">
                          <thead><tr><th>추진과제</th><th>세부 내용</th><th>추진시기</th><th>담당부서</th><th>협조부서</th></tr></thead>
                          <tbody>{tableRows.map((row) => <tr key={row[0]}>{row.map((cell) => <td key={cell}>{cell}</td>)}</tr>)}</tbody>
                        </table>
                        {!applied && <span className="object-measure">현재 {currentWidth}mm · 권장 160mm</span>}
                      </div>
                      <div className="page-number">- 1 -</div>
                    </>
                  ) : (
                    <>
                      <header className="document-header"><span>{loadedTitle || "2026학년도 주요업무계획"}</span><span className="document-meta">{agencyProfile.displayName}</span><img className="document-slogan" src={activeBranding.slogan || agencyProfile.sloganAsset} alt={agencyProfile.slogan} /></header>
                      <div className="document-rule" />
                      <h1>{pageLabel}</h1>
                      <h2>주요 내용</h2>
                      <p className="placeholder-copy">이 페이지는 문서 탐색 상태를 확인하기 위한 fixture입니다. 실제 HWPX 렌더링 결과는 문서 엔진 연결 후 표시됩니다.</p>
                      <div className="placeholder-lines"><span /><span /><span /><span /><span /></div>
                      <div className="page-number">- {selectedPage} -</div>
                    </>
                  )}
                </article>
              </div>
            </div>
            <div className="viewport-footer"><span>용지: A4 (210 × 297mm)</span><span>본문 영역: 160 × 257mm</span><span>확대: {zoom}%</span></div>
          </section>

          <aside className="rule-inspector" aria-label="규칙 인스펙터" aria-live="polite">
            {fontReport && (fontReport.error || fontReport.missing?.length) ? (
              <div className="rule-findings-card">
                <span className="section-label">글꼴 검사</span>
                {fontReport.error ? (
                  <div className="rule-finding">
                    <span className="finding-dot is-error">오류</span>
                    <span><strong>글꼴 검사 실패</strong><small>{fontReport.error}</small></span>
                  </div>
                ) : fontReport.results.filter((r) => !r.installed).map((r) => (
                  <div className="rule-finding" key={r.font}>
                    <span className="finding-dot is-warning">주의</span>
                    <span>
                      <strong>{r.font} 미설치</strong>
                      <small>{r.substitutes.length ? `대체 후보: ${r.substitutes.join(", ")} (승인 필요)` : "대체 후보 없음 — 설치 필요"}</small>
                    </span>
                  </div>
                ))}
              </div>
            ) : null}
            {loadedModel ? (
              <>
                <div className="imported-model-card"><span className="section-label">불러온 문서</span><strong>{loadedFile}</strong><span>{loadedTitle || "제목 없음"}</span><small>{loadedModel.blocks.length}개 블록 · 규칙 {loadedModel.ruleFindings?.length || 0}건 · HWPX 내보내기 가능</small></div>
                {loadedModel.ruleFindings?.length ? (
                  <div className="rule-findings-card"><span className="section-label">자동 규칙 점검</span>{loadedModel.ruleFindings.map((finding) => <div className="rule-finding" key={finding.code}><span className={`finding-dot is-${finding.severity}`}>{finding.severity === "error" ? "오류" : "주의"}</span><span><strong>{finding.code} · {finding.title}</strong><small>{finding.message}</small></span></div>)}</div>
                ) : (
                  <div className="empty-inspector"><span className="empty-number">✓</span><h2>규칙 위반 없음</h2><p>불러온 문서가 공문서 서식 규칙을 모두 충족합니다.</p></div>
                )}
              </>
            ) : issueOpen ? (
              <>
                <div className="inspector-header"><div><span className="eyebrow">검토 항목 01</span><h2>표 너비 초과</h2></div><span className={`severity-badge ${applied ? "is-success" : "is-error"}`}>{applied ? "완료" : "오류"}</span></div>
                <p className="inspector-message">표의 전체 너비가 본문 영역을 초과했습니다. 권장 너비 이하로 조정하면 규칙을 준수할 수 있습니다.</p>
                <div className="inspector-section"><span className="section-label">위반 항목</span><div className="target-card"><span className="target-symbol" aria-hidden="true">표</span><span><strong>추진과제 표</strong><small>페이지 1 · 표 ID TBL_01</small></span></div></div>
                <div className="inspector-section"><span className="section-label">측정값</span><dl className="measurement-list"><div><dt>현재 너비</dt><dd className={applied ? "is-fixed" : ""}>{currentWidth} <small>mm</small></dd></div><div><dt>권장 최대 너비</dt><dd>160 <small>mm</small></dd></div><div><dt>초과</dt><dd className={applied ? "is-fixed" : "is-danger"}>{applied ? 0 : 4} <small>mm</small></dd></div></dl></div>
                <div className="inspector-section"><span className="section-label">적용 방법</span><label className="resolution-option"><input type="radio" name="resolution" value="width-only" checked={resolution === "width-only"} onChange={(event) => setResolution(event.target.value)} disabled={applied || isApplying} /><span><strong>권장 최대 너비로 조정</strong><small>열 너비만 조정하고 내용을 유지합니다.</small></span></label><label className="resolution-option"><input type="radio" name="resolution" value="reflow" checked={resolution === "reflow"} onChange={(event) => setResolution(event.target.value)} disabled={applied || isApplying} /><span><strong>내용을 조정하여 너비 유지</strong><small>줄바꿈과 행 높이가 변경될 수 있습니다.</small></span></label></div>
                <div className="inspector-section preview-section"><span className="section-label">적용 후 미리보기</span><div className="before-after"><div><span>현재</span><div className="mini-table is-wide" /></div><b aria-hidden="true">→</b><div><span>{applied ? "적용됨" : "예상"}</span><div className={`mini-table ${applied ? "is-fixed" : ""}`} /></div></div><p>{applied ? "표 너비가 160mm로 조정되었습니다." : `${selectedOption}을 선택하면 표 너비가 ${resolution === "width-only" ? "160mm" : "164mm로 유지"}됩니다.`}</p></div>
                <div className="rule-evidence"><span className="section-label">근거</span><p><strong>TABLE-WIDTH-001</strong><br />본문 영역 안쪽에 표를 배치해야 합니다.</p></div>
                <div className="inspector-actions"><button type="button" className="primary-action" onClick={applyResolution} disabled={applied || resolution !== "width-only" || isApplying}>{isApplying ? "조판 중…" : applied ? "적용 완료" : "적용"}<kbd>Enter</kbd></button><button type="button" className="secondary-action" onClick={revertResolution} disabled={isApplying}>되돌리기 <kbd>Esc</kbd></button><button type="button" className="next-action" onClick={() => setSelectedPage(2)}>다음 항목 <kbd>PageDown</kbd></button></div>
              </>
            ) : (
              <div className="empty-inspector"><span className="empty-number">{selectedPage}</span><h2>검토 항목 없음</h2><p>페이지 {selectedPage}에는 현재 확인할 규칙 위반이 없습니다.</p><button type="button" className="secondary-action" onClick={() => setSelectedPage(1)}>오류 페이지로 이동</button></div>
            )}
          </aside>
        </section>
      </div>

      <footer className="app-statusbar"><span>문서: {loadedFile || "2026_읽걷쓰교육_기본계획.iceplan"}</span><span>{loadedModel ? `블록: ${loadedModel.blocks.length}개` : `페이지: ${selectedPage} / 28`}</span><span>{statusLabel}</span><span className="status-summary">검토 항목: {loadedModel ? (loadedModel.ruleFindings?.length || 0) : (issueOpen && !applied ? 1 : 0)}</span></footer>
      {notice ? <div className="toast" role="status">{notice}</div> : null}
    </main>
  );
}

export { App };



















