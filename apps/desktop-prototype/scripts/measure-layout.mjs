#!/usr/bin/env node
/**
 * 조판 측정기 CLI — 실제 측정 로직은 electron/layout-measure.cjs에 있다.
 * (앱 메인 프로세스와 검증 하네스가 같은 측정기를 쓰게 하려는 분리다.)
 *
 * 사용: node scripts/measure-layout.mjs <hwpx경로>
 */
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { measureHwpx } = require(path.join(HERE, '..', 'electron', 'layout-measure.cjs'));
const TOKENS = JSON.parse(await fs.readFile(path.join(HERE, 'layout-tokens.json'), 'utf8'));

const target = process.argv[2];
if (!target) {
  console.error('사용법: node scripts/measure-layout.mjs <hwpx경로>');
  process.exit(2);
}
console.log(JSON.stringify(await measureHwpx(await fs.readFile(target), TOKENS.adaptiveSpacing), null, 2));
