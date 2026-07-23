#!/usr/bin/env node
/**
 * 6단계 워크플로 실주행 검증 — 문서를 주입해 단계를 끝까지 걸어본다.
 *
 * verify-app-render.mjs는 문서를 불러오지 않아 **시작 패널만** 렌더된다. 그래서
 * 2~6단계 패널이 깨져도 통과했다(11단계 컴포넌트 분리 때 이 공백을 확인). 이
 * 하네스는 파일 input에 문서를 주입한 뒤 각 단계 확정 버튼을 눌러 data-panel이
 * 순서대로 바뀌는지 본다.
 *
 * 사용: node scripts/verify-workflow-walk.mjs "<exe경로>" [port]
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const EXE = process.argv[2];
if (!EXE) {
  console.error('사용법: node scripts/verify-workflow-walk.mjs "<exe경로>" [port]');
  process.exit(2);
}
const PORT = Number(process.argv[3]) || 9261;

const SAMPLE = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'ice-walk-')), 'walk-sample.md');
await fs.writeFile(SAMPLE, `# 2026 리팩터링 검증 계획

## Ⅰ. 추진 배경
- 단계 패널 렌더 확인용 문서입니다.
- 두 번째 항목입니다.

## Ⅱ. 추진 내용
- 세 번째 항목입니다.
`, 'utf8');

const child = spawn(EXE, [`--remote-debugging-port=${PORT}`], { stdio: 'ignore' });
const report = { steps: [], exceptions: [] };
try {
  let target = null;
  for (let i = 0; i < 30; i += 1) {
    await sleep(1000);
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      const pages = list.filter((t) => t.type === 'page');
      if (pages.length) { target = pages[0]; break; }
    } catch { /* 기동 대기 */ }
  }
  if (!target) throw new Error('CDP page target 없음');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true });
    ws.addEventListener('error', () => rej(new Error('WebSocket 실패')), { once: true });
  });
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(typeof event.data === 'string' ? event.data : String(event.data));
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }
    if (msg.method === 'Runtime.exceptionThrown') {
      report.exceptions.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text);
    }
  });
  const send = (method, params = {}) => new Promise((res) => {
    const n = ++id; pending.set(n, res); ws.send(JSON.stringify({ id: n, method, params }));
  });
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    return r.result?.result?.value;
  };

  await send('Runtime.enable');
  await send('Page.enable');
  await send('DOM.enable');
  await send('Page.reload', { ignoreCache: true });
  await sleep(5000);

  const panelNow = () => evaluate("document.querySelector('[data-panel]')?.dataset.panel ?? null");
  report.steps.push({ step: 'start', panel: await panelNow() });

  // 1단계: 파일 주입
  const doc = await send('DOM.getDocument', { depth: -1 });
  const nodeId = (await send('DOM.querySelector', {
    nodeId: doc.result.root.nodeId, selector: '[data-panel="start"] input[type=file]',
  })).result.nodeId;
  if (!nodeId) throw new Error('시작 패널의 파일 input을 찾지 못했습니다.');
  await send('DOM.setFileInputFiles', { nodeId, files: [SAMPLE] });
  await sleep(4000);
  report.steps.push({ step: 'analysis', panel: await panelNow() });

  const clickAndRead = async (selector, label, wait = 3500) => {
    const clicked = await evaluate(`(() => { const el = document.querySelector('${selector}');
      if (!el || el.disabled) return false; el.click(); return true; })()`);
    await sleep(wait);
    report.steps.push({ step: label, clicked, panel: await panelNow() });
  };

  // 규칙검수 진입 전, 검토 항목 배지가 썸네일에 뜨는지 본다(11단계 미리보기 강화).
  // 이 시점은 규칙 무시 전이라 항목이 남아 있어야 배지 부재=회귀로 판정할 수 있다.
  report.thumbIssueBadge = await evaluate(
    "document.querySelector('.thumb-issue-badge')?.textContent ?? null");

  await clickAndRead('#analysis-confirm', 'information');

  // ── 11단계 4: 카드형 기관 선택기 — 26개 기관 카드가 뜨고, 카드 클릭이
  // 상단바 드롭다운과 같은 상태를 움직이는지(공용 selectAgency) 확인한다.
  report.agencyCards = await evaluate(`(async () => {
    const cards = document.querySelectorAll('.agency-card');
    if (!cards.length) return { count: 0 };
    const district = document.querySelector('[data-agency-id="district-nambu"]');
    if (!district) return { count: cards.length, districtCard: false };
    district.click();
    await new Promise((r) => setTimeout(r, 400));
    const topbarValue = document.querySelector('.profile-select select')?.value;
    const selected = document.querySelector('.agency-card.is-selected')?.dataset.agencyId;
    // 본청으로 되돌려 이후 단계 진행(직속 G 프로필 쪽수 차이 방지)
    document.querySelector('[data-agency-id="metropolitan"]')?.click();
    await new Promise((r) => setTimeout(r, 400));
    return { count: cards.length, districtCard: true, topbarValue, selected,
             synced: topbarValue === 'district-nambu' && selected === 'district-nambu' };
  })()`);

  await clickAndRead('#info-confirm', 'structure');
  // 구조편집: 모든 쪽 확정 버튼 누르기
  await evaluate("document.querySelectorAll('.page-type-confirm').forEach((b) => { if (!b.disabled) b.click(); })");
  await sleep(2500);
  await clickAndRead('#structure-next', 'rules');
  // 규칙검수: 남은 항목 모두 무시 후 완료
  await evaluate("document.querySelector('#rule-ignore-all')?.click()");
  await sleep(2000);
  await clickAndRead('#rules-confirm', 'export');

  report.panelsSeen = [...new Set(report.steps.map((s) => s.panel).filter(Boolean))];
  report.allSixSeen = ['start', 'analysis', 'information', 'structure', 'rules', 'export']
    .every((p) => report.panelsSeen.includes(p));

  // ── 11단계 UI 검증: 진행률 바 / 다크 테마 실적용 / 나란히 비교 모드 ──
  report.progressBar = await evaluate(`(() => {
    const fill = document.querySelector('.workflow-progress-fill');
    return fill ? fill.style.width : null;
  })()`);
  report.themeToggle = await evaluate(`(async () => {
    const button = document.querySelector('#theme-toggle');
    if (!button) return { present: false };
    button.click();
    await new Promise((r) => setTimeout(r, 300));
    const dark = document.documentElement.dataset.theme === 'dark';
    // 토큰이 실제로 화면 색을 바꿨는지 계산값으로 확인 — 속성만 바뀌고 CSS가
    // 안 먹는 회귀(토큰 오타 등)를 잡는다.
    const surface = getComputedStyle(document.querySelector('.app-topbar')).backgroundColor;
    button.click();
    await new Promise((r) => setTimeout(r, 300));
    const restored = document.documentElement.dataset.theme === 'light';
    return { present: true, dark, darkSurface: surface, restored,
             darkApplied: dark && surface !== 'rgb(255, 255, 255)' };
  })()`);
  // ── 11단계 5·6: 폴더 열기 브리지 / 내보내기 진행 UI 마크업 / faint 대비 토큰 ──
  report.microInteractions = await evaluate(`(() => ({
    showInFolderBridge: typeof window.icePlan?.showInFolder === 'function',
    exportButton: Boolean(document.querySelector('#export-hwpx')),
    // AA 대비용으로 올린 --faint(#68788a)가 실제 계산값에 반영됐는지
    eyebrowColor: getComputedStyle(document.querySelector('.eyebrow')).color,
  }))()`);
  report.compareMode = await evaluate(`(async () => {
    const button = document.querySelector('#preview-compare');
    if (!button) return { present: false };
    if (button.disabled) return { present: true, enabled: false };
    button.click();
    await new Promise((r) => setTimeout(r, 500));
    const panes = document.querySelectorAll('.compare-pane').length;
    const svg = Boolean(document.querySelector('.compare-pane .composition-svg'));
    const quick = Boolean(document.querySelector('.compare-pane .a4-page'));
    return { present: true, enabled: true, panes, svg, quick, ok: panes === 2 && svg && quick };
  })()`);
  // 드래그&드롭 — DataTransfer로 실제 drop 이벤트를 만들어 로더가 도는지 본다.
  // 문서를 다시 불러 미리보기 상태가 초기화되므로 **반드시 마지막**에 수행한다.
  report.dropLoad = await evaluate(`(async () => {
    const dt = new DataTransfer();
    dt.items.add(new File(['# 드롭 검증\\n\\n- 드롭 항목'], 'drop-test.md', { type: 'text/markdown' }));
    const shell = document.querySelector('.app-shell');
    shell.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
    await new Promise((r) => setTimeout(r, 2500));
    const panel = document.querySelector('[data-panel]')?.dataset.panel;
    const fileLabel = document.querySelector('.app-statusbar span')?.textContent || '';
    return { panel, fileLabel, ok: panel === 'analysis' && fileLabel.includes('drop-test.md') };
  })()`);
  ws.close();
} catch (error) {
  report.fatal = `${error.name}: ${error.message}`;
} finally {
  try { child.kill(); } catch { /* noop */ }
}
report.passed = !report.fatal && report.exceptions.length === 0 && report.allSixSeen === true
  && report.thumbIssueBadge !== null
  && report.progressBar === '100%'
  && report.themeToggle?.darkApplied === true && report.themeToggle?.restored === true
  && report.compareMode?.ok === true
  && report.agencyCards?.count === 26 && report.agencyCards?.synced === true
  && report.microInteractions?.showInFolderBridge === true
  && report.microInteractions?.eyebrowColor === 'rgb(104, 120, 138)'
  && report.dropLoad?.ok === true;
console.log(JSON.stringify(report, null, 2));
process.exitCode = report.passed ? 0 : 1;
