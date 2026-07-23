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

  await clickAndRead('#analysis-confirm', 'information');
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
  ws.close();
} catch (error) {
  report.fatal = `${error.name}: ${error.message}`;
} finally {
  try { child.kill(); } catch { /* noop */ }
}
report.passed = !report.fatal && report.exceptions.length === 0 && report.allSixSeen === true;
console.log(JSON.stringify(report, null, 2));
process.exitCode = report.passed ? 0 : 1;
