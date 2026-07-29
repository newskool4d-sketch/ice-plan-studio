#!/usr/bin/env node
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { migratePlanIR } = require('../electron/workspace-packages.cjs');

const appRoot = path.resolve(__dirname, '..');
const sourceDir = path.join(appRoot, 'test-data');
const outputDir = path.join(sourceDir, 'migrated-fixtures');
const python = process.platform === 'win32' ? ['py', '-3'] : ['python3'];
const sources = fs.readdirSync(sourceDir).filter((name) => name.endsWith('.model.json')).sort();
fs.mkdirSync(outputDir, { recursive: true });

function hash(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

const fixtures = {};
let failed = false;
for (const sourceName of sources) {
  const sourcePath = path.join(sourceDir, sourceName);
  const legacy = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
  const model = migratePlanIR(legacy);
  const stem = sourceName.replace(/\.model\.json$/, '');
  const title = model.metadata?.title || model.blocks.find((block) => block.type === 'heading')?.text || stem;
  model.metadata = {
    ...model.metadata,
    title,
    cover: { ...(model.metadata?.cover || {}), title, date: model.metadata?.cover?.date || '2026. 7.', displayName: model.metadata?.cover?.displayName || '인천광역시교육청' },
    layout: { ...(model.metadata?.layout || {}), coverProfile: model.metadata?.layout?.coverProfile || 'metropolitan-a' },
    pages: model.metadata?.pages?.length ? model.metadata.pages : [{ type: 'cover' }, { type: 'body' }],
  };
  model.pageTypes = model.metadata.pages.map((page) => page.type);
  const modelPath = path.join(outputDir, `${stem}.v0.2.model.json`);
  const hwpxPath = path.join(outputDir, `${stem}.v0.2.hwpx`);
  fs.writeFileSync(modelPath, `${JSON.stringify(model, null, 2)}\n`, 'utf8');
  const generated = spawnSync(python[0], [...python.slice(1), path.join(appRoot, 'scripts/model_to_hwpx.py'), modelPath, hwpxPath, '--template', 'boncheong'], { encoding: 'utf8' });
  const verified = generated.status === 0
    ? spawnSync(python[0], [...python.slice(1), path.join(appRoot, 'scripts/verify_hwpx_output.py'), hwpxPath], { encoding: 'utf8' })
    : { status: null, stdout: '', stderr: '' };
  const item = {
    source: sourceName,
    sourceSchema: legacy.schemaVersion || 'missing',
    targetSchema: model.schemaVersion,
    generate: { ok: generated.status === 0, exitCode: generated.status },
    structure: { ok: verified.status === 0, exitCode: verified.status },
  };
  if (generated.status !== 0) item.generate.error = `${generated.stdout || ''}${generated.stderr || ''}`.slice(-2000);
  if (verified.status !== 0) item.structure.error = `${verified.stdout || ''}${verified.stderr || ''}`.slice(-2000);
  if (fs.existsSync(modelPath) && fs.existsSync(hwpxPath)) item.sha256 = { [path.basename(modelPath)]: hash(modelPath), [path.basename(hwpxPath)]: hash(hwpxPath) };
  if (!item.generate.ok || !item.structure.ok) failed = true;
  fixtures[stem] = item;
}
const report = { schemaVersion: '0.2', gate: 'migrated-fixtures', fixtures, passed: !failed };
fs.writeFileSync(path.join(outputDir, 'verification-log.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ gate: report.gate, fixtures: Object.keys(fixtures), passed: report.passed }, null, 2));
if (failed) process.exitCode = 1;
