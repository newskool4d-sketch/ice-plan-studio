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
  ws.addEventListener('message', async (event) => {
    const raw = typeof event.data === 'string'
      ? event.data
      : event.data instanceof ArrayBuffer
        ? new TextDecoder().decode(event.data)
        : ArrayBuffer.isView(event.data)
          ? new TextDecoder().decode(event.data)
          : await event.data.text();
    const msg = JSON.parse(raw);
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
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const n = ++id;
    // 적응 조판 검증(ipcAdaptive)은 후보 생성 루프(sadeuri)를 여러 rung 도는 IPC
    // 호출을 기다린다 — squeeze가 실패(exhausted)하면 조기 반환 없이 사다리
    // 전체를 다 돌므로 성공 케이스보다 오래 걸린다(후보 1회당 model_to_hwpx.py
    // 재실행 + 목차 쪽 번호 계산 포함). 넉넉히 잡아 느린 정상 완료를 오탐 실패로
    // 처리하지 않는다.
    const timeout = setTimeout(() => {
      pending.delete(n);
      reject(new Error(`CDP ${method} 응답 시간 초과`));
    }, 30_000);
    pending.set(n, (message) => { clearTimeout(timeout); resolve(message); });
    ws.send(JSON.stringify({ id: n, method, params }));
  });

  await send('Runtime.enable');
  await sleep(5000);

  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    return r.result?.result?.value;
  };
  report.rootChildren = await evaluate("document.getElementById('root')?.childElementCount ?? -1");
  report.title = await evaluate('document.title');
  report.hasIcePlanBridge = await evaluate('Boolean(window.icePlan)');
  // 설치본 식별용 버전 배지. 화면에 실제로 그려졌는지까지 본다 — IPC만 확인하면
  // 배지가 사라져도 통과한다.
  report.appVersionIpc = await evaluate('window.icePlan?.appVersion?.()');
  report.brandVersionText = await evaluate("document.querySelector('.brand-version')?.textContent ?? null");
  report.versionShown = typeof report.appVersionIpc === 'string'
    && report.brandVersionText === `v${report.appVersionIpc}`;

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
  const previewOf = async (target) => JSON.parse(await evaluate(`
    (async () => {
      try {
        const r = await window.icePlan.renderCompositionPreview(${JSON.stringify(target)});
        const svg = Array.isArray(r.svg) ? r.svg.join('') : String(r.svg || '');
        return JSON.stringify({ ok: svg.includes('<svg'), pageCount: r.pageCount,
                                adjustment: r.layoutAdjustment || null });
      } catch (e) { return JSON.stringify({ ok: false, error: String(e && e.message || e) }); }
    })()
  `) ?? '{"ok":false,"error":"no value"}');

  report.ipcPreview = await previewOf(model);
  report.ipcPreview.expectedPages = EXPECTED_PAGES;
  report.ipcPreview.pagesMatch = report.ipcPreview.pageCount === EXPECTED_PAGES;
  // 짧은 문서에는 보정이 걸리면 안 된다(과보정 감시).
  report.ipcPreview.adjustmentSkipped = report.ipcPreview.adjustment?.applied === false;

  // 적응 조판이 "실제로" 동작하는지 확인한다. 보정이 필요 없는 입력만 넣으면
  // 하드코딩된 null과 정상 동작을 구분할 수 없다(memory: electron-cdp-verification —
  // 위반 있는/없는 양쪽 입력을 모두 넣어야 정적 mock을 잡는다).
  // 32문단은 기본 간격(160%)에서 한 쪽을 살짝 넘겨 3쪽이 되고, 조이면 2쪽으로
  // 돌아온다(sweep 실측: 155% rung에서 성공). 본문 타이포그래피가 12pt/160%에서
  // 13pt/170%로 바뀌며 예전 36문단 기준은 사다리 끝(140%)까지 조여도 2쪽에 못
  // 들어가 재보정했다(2026-08-05) — test-data/adaptive-layout/gate.py의
  // 'sweep-p36' fixture도 같은 타이포그래피 변경의 영향을 받을 수 있으나, 그쪽은
  // 한글 COM 실물 계측(calibrate:layout-measure --com)이 필요해 이 스크립트
  // 범위 밖이다. 재교정 필요 여부를 별도로 확인할 것.
  const overflowing = {
    ...model,
    metadata: { ...model.metadata, title: '적응 조판 검증', cover: { ...model.metadata.cover, title: '적응 조판 검증' } },
    blocks: [{ id: 'h', type: 'heading', role: 'heading', level: 1, text: 'Ⅰ. 검증' },
             ...Array.from({ length: 32 }, (_value, index) => ({
               id: `p${index}`, type: 'paragraph', role: 'body',
               text: `${index + 1}. 조판 측정기 교정을 위한 본문 문단으로 분량 경계를 확인한다`,
             }))],
  };
  report.ipcAdaptive = await previewOf(overflowing);
  report.ipcAdaptive.adjustmentApplied = report.ipcAdaptive.adjustment?.applied === true;
  report.ipcAdaptive.hasNotice = Boolean(report.ipcAdaptive.adjustment?.notice);
  report.ipcAdaptive.pagesMatch = report.ipcAdaptive.pageCount === EXPECTED_PAGES;

  ws.close();
} catch (error) {
  report.fatal = `${error.name}: ${error.message}`;
} finally {
  try { child.kill(); } catch { /* noop */ }
}

report.passed = !report.fatal && report.exceptions.length === 0
  && report.rootChildren > 0 && report.hasIcePlanBridge === true && report.versionShown === true
  && report.ipcPreview?.ok === true && report.ipcPreview?.pagesMatch === true
  && report.ipcPreview?.adjustmentSkipped === true
  && report.ipcAdaptive?.ok === true && report.ipcAdaptive?.adjustmentApplied === true
  && report.ipcAdaptive?.hasNotice === true && report.ipcAdaptive?.pagesMatch === true;
console.log(JSON.stringify(report, null, 2));
process.exitCode = report.passed ? 0 : 1;
