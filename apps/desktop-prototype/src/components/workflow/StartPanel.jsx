export function StartPanel({ onLoadFile, onLoadWorkspace, onLoadProfile, onSaveProfile }) {
  return <div className="workflow-panel" data-panel="start">
    <span className="eyebrow">1단계 · 시작</span><h2>계획안 원본을 불러오세요</h2>
    <p>MD·TXT·HWP·HWPX를 Plan IR로 변환한 뒤 분석 단계가 열립니다.</p>
    <label className="primary-action file-load-button">문서 선택<input type="file" accept=".md,.txt,.hwp,.hwpx" onChange={onLoadFile} /></label>
    <div className="package-resume-card">
      <strong>기존 작업 재개</strong>
      <p>v0.1 평면 JSON 프로젝트·프로필도 불러올 때 v0.2로 자동 승격합니다.</p>
      <div className="package-action-row">
        <button id="start-project-load" type="button" onClick={onLoadWorkspace}>프로젝트 불러오기</button>
        <button id="start-profile-load" type="button" onClick={onLoadProfile}>프로필 불러오기</button>
        <button id="start-profile-save" type="button" onClick={onSaveProfile}>현재 프로필 저장</button>
      </div>
    </div>
  </div>;
}
