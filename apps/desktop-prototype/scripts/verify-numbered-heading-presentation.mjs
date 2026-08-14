#!/usr/bin/env node
// 제목틀(표) 판정의 JS 쪽 정본 검증. model_to_hwpx.py의
// STRUCTURED_HEADING_PATTERNS와 짝이 맞아야 빠른 미리보기와 HWPX 출력이
// 어긋나지 않는다(쌍둥이 규칙).
import assert from 'node:assert/strict';
import { classifyStructuredHeading } from '../src/domain/headingPresentation.js';

const roman = classifyStructuredHeading('Ⅰ. 목적');
assert.equal(roman?.kind, 'roman-chapter', '로마숫자 장 제목은 제목틀 대상이어야 합니다.');

// 아라비아 숫자 제목은 제목 길이와 무관하게 제목틀을 쓰지 않는다.
// 종전에는 20자 이하만 roman-chapter로 잡혀 같은 문서에서 표/평문이 갈렸다.
for (const text of [
  '2. 본원 프로그램의 야외 의존도',
  '1. 폭염특보 체계 개편에 따른 야외활동 운영 기준 재정비 방안',
  '3. 문제점',
]) {
  assert.equal(
    classifyStructuredHeading(text),
    null,
    `아라비아 숫자 제목이 제목틀 대상으로 분류되었습니다: ${text}`,
  );
}

// 과제 계열과 가나다 소제목 분류는 종전과 같아야 한다(회귀 방지).
assert.equal(classifyStructuredHeading('과제 1. 체험 운영')?.kind, 'task-section');
assert.equal(classifyStructuredHeading('과제 1-2. 안전 관리')?.kind, 'task-subsection');
assert.equal(classifyStructuredHeading('가. 개편 내용')?.kind, 'korean-subheading');

console.log('verify-numbered-heading-presentation: OK');
