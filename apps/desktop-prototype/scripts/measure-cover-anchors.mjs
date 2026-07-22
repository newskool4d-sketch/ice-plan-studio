#!/usr/bin/env node
/**
 * 표지 앵커(슬로건·CI·제목틀) 좌표 실측기 — 10단계 표지 정밀 고정용.
 *
 * 표지 개체는 XML에 절대 좌표로 박혀 있지 않다. `treatAsChar="1"` 흐름 배치라
 * 최종 위치는 조판 엔진이 문단 정렬·셀 여백으로 계산한다. 그래서 "XML이 같으니
 * 위치도 같다"는 검사는 무의미하고, **렌더 결과에서 실제 좌표를 읽어야** 한다
 * (실제로 CI가 셀 안에서 좌측으로 30mm 치우친 결함을 XML 검사가 놓쳤다).
 *
 * 사용: node scripts/measure-cover-anchors.mjs <hwpx경로>
 * 출력: JSON — 표지 쪽의 배치 개체 좌표(pt·mm)
 */
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { renderHwpxToSvg } = require('kordoc');
const { chunkBuffers } = require(path.join(HERE, '..', 'electron', 'preview-split.cjs'));

const PT_PER_MM = 72 / 25.4;
const mm = (pt) => Number((pt / PT_PER_MM).toFixed(3));

/** 표지 쪽에서 이미지 개체(use)를 뽑아 좌표를 잰다. 페이지 배경은 제외한다. */
function imageAnchors(svg, pageWidthPt) {
  const anchors = [];
  for (const match of svg.matchAll(/<use\b[^>]*>/g)) {
    const tag = match[0];
    const read = (name) => {
      const found = tag.match(new RegExp(`\\b${name}="(-?[\\d.]+)"`));
      return found ? Number(found[1]) : null;
    };
    const href = tag.match(/(?:xlink:)?href="#?([^"]+)"/);
    const x = read('x');
    const y = read('y');
    const width = read('width');
    const height = read('height');
    if (x === null || width === null) continue;
    anchors.push({
      id: href ? href[1] : null,
      xPt: x, yPt: y, widthPt: width, heightPt: height,
      centerXPt: x + width / 2,
      // 페이지 중앙에서 얼마나 벗어났는가 — 가운데 정렬 회귀를 이 값으로 잡는다.
      centerOffsetMm: mm(x + width / 2 - pageWidthPt / 2),
      xMm: mm(x), yMm: y === null ? null : mm(y),
      widthMm: mm(width), heightMm: height === null ? null : mm(height),
    });
  }
  return anchors;
}

export async function measureCoverAnchors(hwpxBuffer) {
  const cover = chunkBuffers(hwpxBuffer)[0];
  const rendered = await renderHwpxToSvg(cover, { reflow: true, reflowMode: 'keep' });
  return {
    pageWidthPt: rendered.width,
    pageCount: rendered.pageCount,
    images: imageAnchors(rendered.svg, rendered.width),
  };
}

if (process.argv[1]?.endsWith('measure-cover-anchors.mjs')) {
  const target = process.argv[2];
  if (!target) {
    console.error('사용법: node scripts/measure-cover-anchors.mjs <hwpx경로>');
    process.exit(2);
  }
  console.log(JSON.stringify(await measureCoverAnchors(await fs.readFile(target)), null, 2));
}
