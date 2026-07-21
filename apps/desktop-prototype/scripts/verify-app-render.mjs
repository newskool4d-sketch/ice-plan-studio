#!/usr/bin/env node
/**
 * 빌드 산출물(win-unpacked 또는 설치본) 실물 렌더 검증.
 *
 * "프로세스 생존" 스모크 테스트는 빈 화면 크래시를 통과시킨 이력이 있어
 * (2026-07-19, memory: electron-cdp-verification) CDP로 직접 확인한다:
 *   1) Runtime.exceptionThrown 0건  2) #root 실제 렌더  3) icePlan 브리지 노출
 *   4) IPC renderCompositionPreview가 표지+본문 모델을 기대 쪽수로 렌더
 *      (kordoc reflow의 pageBreak 무시 우회 — preview-split.cjs — 회귀 감지)
 *
 * 사용: node scripts/verify-app-render.mjs "<exe경로>" [port]
 */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const EXE = process.argv[2];
const PORT = Number(process.argv[3]) || 9223;
if (!EXE) {
  console.error('사용법: node scripts/verify-app-render.mjs "<exe경로>" [port]');
  process.exit(2);
}

const child = spawn(EXE, [`--remote-debugging-port=${PORT}`], { stdio: 'ignore' });
const report = { exe: EXE, exceptions: [], consoleErrors: [], failedRequests: [] };

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
  if (!target) throw new Error('CDP page target 없음 (앱이 뜨지 않음)');
  report.targetUrl = target.url;

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true });
    ws.addEventListener('error', () => rej(new Error('WebSocket 연결 실패')), { once: true });
  });
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(typeof event.data === 'string' ? event.data : String(event.data));
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      report.exceptions.push(d.exception?.description || d.text);
    }
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      report.consoleErrors.push(msg.params.args.map((a) => a.value ?? a.description).join(' '));
    }
    if (msg.method === 'Network.loadingFailed') report.failedRequests.push(msg.params.errorText);
  });
  const send = (method, params = {}) => new Promise((res) => {
    const n = ++id; pending.set(n, res);
    ws.send(JSON.stringify({ id: n, method, params }));
  });

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Network.enable');
  await send('Page.reload', { ignoreCache: true });
  await sleep(5000);

  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    return r.result?.result?.value;
  };
  report.rootChildren = await evaluate("document.getElementById('root')?.childElementCount ?? -1");
  report.title = await evaluate('document.title');
  report.hasIcePlanBridge = await evaluate('Boolean(window.icePlan)');

  const model = {
    schemaVersion: '0.2', kind: 'plan-ir',
    metadata: {
      title: '실물 렌더 검증',
      cover: { title: '실물 렌더 검증', direction: '검증', date: '2026. 7.', displayName: '인천광역시교육청' },
      layout: { coverProfile: 'metropolitan-a' },
      pages: [{ type: 'cover' }, { type: 'body' }],
    },
    source: { format: 'md', filePath: null },
    approval: { status: 'unapproved' }, pageTypes: ['cover', 'body'], diagnostics: [],
    blocks: [{ id: 'h', type: 'heading', role: 'heading', level: 1, text: 'Ⅰ. 검증' },
             { id: 'p', type: 'paragraph', role: 'body', text: '실조판 미리보기 동작 확인.' }],
  };
  const EXPECTED_PAGES = 2; // 표지 + 본문 (한글 COM 실측 기준)
  report.ipcPreview = JSON.parse(await evaluate(`
    (async () => {
      try {
        const r = await window.icePlan.renderCompositionPreview(${JSON.stringify(model)});
        const svg = Array.isArray(r.svg) ? r.svg.join('') : String(r.svg || '');
        return JSON.stringify({ ok: svg.includes('<svg'), pageCount: r.pageCount });
      } catch (e) { return JSON.stringify({ ok: false, error: String(e && e.message || e) }); }
    })()
  `) ?? '{"ok":false,"error":"no value"}');
  report.ipcPreview.expectedPages = EXPECTED_PAGES;
  report.ipcPreview.pagesMatch = report.ipcPreview.pageCount === EXPECTED_PAGES;

  ws.close();
} catch (error) {
  report.fatal = `${error.name}: ${error.message}`;
} finally {
  try { child.kill(); } catch { /* noop */ }
}

report.passed = !report.fatal && report.exceptions.length === 0
  && report.rootChildren > 0 && report.hasIcePlanBridge === true
  && report.ipcPreview?.ok === true && report.ipcPreview?.pagesMatch === true;
console.log(JSON.stringify(report, null, 2));
process.exitCode = report.passed ? 0 : 1;
