import { useEffect, useState } from "react";
import { AgencySelect } from "./AgencySelect.jsx";
import { workflowSteps } from "./steps.js";

// 다크 테마는 앱 크롬에만 적용된다(A4 종이는 테마 불변 — styles.css 참조).
function useTheme() {
  const [theme, setTheme] = useState(() => localStorage.getItem("ice-theme") === "dark" ? "dark" : "light");
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("ice-theme", theme);
  }, [theme]);
  return [theme, () => setTheme((value) => value === "dark" ? "light" : "dark")];
}

export function AppTopbar({
  activeStep, appVersion, completed, agencyId, model, available,
  onAgencyChange, onSaveWorkspace, onLoadWorkspace, onLoadFile, onGoExport,
}) {
  const [theme, toggleTheme] = useTheme();
  return <header className="app-topbar">
    <div className="brand-lockup"><span className="brand-name">ICE Plan Studio</span>{appVersion ? <span className="brand-version">v{appVersion}</span> : null}<span className="topbar-divider" /><strong>{workflowSteps[activeStep].label}</strong></div>
    <div className="topbar-actions">
      <span className="save-state"><span className="status-dot" />{completed.slice(0, 5).filter(Boolean).length}/5 확정</span>
      <label className="profile-select">기관<AgencySelect value={agencyId} onChange={onAgencyChange} /></label>
      <button id="workspace-save" type="button" className="topbar-button" disabled={!model} onClick={onSaveWorkspace}>작업 저장</button>
      <button id="workspace-load" type="button" className="topbar-button" onClick={onLoadWorkspace}>작업 열기</button>
      <label className="topbar-button file-load-button">파일 불러오기<input type="file" accept=".md,.txt,.hwp,.hwpx" onChange={onLoadFile} /></label>
      <button type="button" className="topbar-button" disabled={!available[5]} onClick={onGoExport}>내보내기 단계</button>
      <button id="theme-toggle" type="button" className="theme-toggle" aria-pressed={theme === "dark"} onClick={toggleTheme}>{theme === "dark" ? "라이트" : "다크"}</button>
    </div>
  </header>;
}
