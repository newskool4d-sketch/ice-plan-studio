#!/usr/bin/env python3
"""항목 위계·간격 조판 규칙 — src/domain/itemLayout.js와 같은 규칙(쌍둥이).

블록마다 조판 주석(역할·표시 단계·기호·내어쓰기·위 간격·다음 문단과 함께·줄간격)을
붙인다. verify-item-layout 게이트가 JS 결과와 필드 단위로 대조한다.

- 서술형 제목(마침표·'함/음/됨/임'으로 끝남)은 제목이 아니라 항목으로 조판한다.
  길이는 기준이 아니다 — 번호 제목은 길이와 무관하게 같게 조판한다(2026-08-14 판정).
- 기호 시작 위치는 사용자 샘플의 칸 수(1.=0·가.=1·1)=3·가)=4·①=6·㉮=7칸), 둘째 줄은 내용 첫 글자에 맞춘다.

사용(대조용): python item_layout.py <blocks.json> → 주석 JSON 출력
"""
import json
import re
import sys
from pathlib import Path

TOKENS = json.loads((Path(__file__).resolve().parent / 'layout-tokens.json').read_text(encoding='utf-8'))
ITEM = TOKENS['itemLayout']
# `[가-하]`는 음절 1만여 자를 포함하므로 실제 항목기호 14자만 쓴다(itemLayout.js와 같은 집합).
KOREAN = '가나다라마바사아자차카타파하'
LABEL = re.compile(rf'^\s*(\d+\.|[{KOREAN}]\.|\d+\)|[{KOREAN}]\)|\(\d+\)|\([{KOREAN}]\)|[①-⑮]|[㉮-㉻])\s*(.+)$')
# 서술형 제목이 항목이 될 때의 단계 — 사용자 샘플 순서(1. 가. 1) 가) ① ㉮). 샘플은 가) 다음을
# ①로 두므로 ①·㉮는 4·5단계이고, 샘플에 없는 (1)·(가)도 같은 4·5단계 자리에 둔다.
CANONICAL_LEVELS = [
    (re.compile(r'^\d+\.$'), 0),
    (re.compile(rf'^[{KOREAN}]\.$'), 1),
    (re.compile(r'^\d+\)$'), 2),
    (re.compile(rf'^[{KOREAN}]\)$'), 3),
    (re.compile(r'^\(\d+\)$'), 4),
    (re.compile(rf'^\([{KOREAN}]\)$'), 5),
    (re.compile(r'^[①-⑮]$'), 4),
    (re.compile(r'^[㉮-㉻]$'), 5),
]
SENTENCE_END = re.compile(r'(?:\.|[함음됨임])$')
FRAME_KINDS = {'roman-chapter', 'task-section', 'task-subsection'}
# 대조용 기본 판별 — 실제 변환(model_to_hwpx.py)은 structured_heading_parts를 주입한다.
# headingPresentation.js·model_to_hwpx.STRUCTURED_HEADING_PATTERNS와 같은 집합·순서.
_FRAME_PATTERNS = (
    ('task-subsection', re.compile(r'^\s*(\[?과제\s*\d+\s*-\s*\d+\]?[.]?)\s*(.+)$')),
    ('task-section', re.compile(r'^\s*(\[?과제\s*\d+\]?[.]?)\s*(.+)$')),
    ('roman-chapter', re.compile(r'^\s*([ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]+)\.\s*(.+)$')),
)


def _default_frame_kind(text):
    for kind, pattern in _FRAME_PATTERNS:
        match = pattern.match(text)
        if match and 0 < len(re.sub(r'\s+', '', match.group(2))) <= 20:
            return kind
    return None


def split_label(text):
    match = LABEL.match(text or '')
    return {'label': match.group(1), 'title': match.group(2).strip()} if match else None


def is_sentence_title(title):
    return bool(SENTENCE_END.search(re.sub(r'[\s*]+$', '', title or '')))


def _glyph_width(character):
    widths = ITEM['glyphWidthHwpUnit']
    if '0' <= character <= '9':
        return widths['digit']
    if character == '(':
        return widths['paren']
    if character in '.)·,*':
        return widths['punct']
    if character in '-−–—':
        return widths['dash']
    return widths['full']


def indent_position(level):
    """단계별 기호 시작 위치(HWPUNIT) = 샘플 칸 수 × 반각 공백 폭."""
    half_spaces = ITEM['levelIndentHalfSpaces']
    return half_spaces[min(max(level, 0), len(half_spaces) - 1)] * ITEM['glyphWidthHwpUnit']['space']


def marker_hang(marker):
    return sum(_glyph_width(character) for character in str(marker)) + ITEM['glyphWidthHwpUnit']['space']


def _canonical_level(label):
    return next((level for pattern, level in CANONICAL_LEVELS if pattern.match(label)), 0)


def _text(value):
    return '' if value is None else str(value)


def layout_blocks(blocks, frame_kind=None):
    frame_kind = frame_kind or _default_frame_kind
    prev = ITEM['prevHwpUnit']
    line_spacing = ITEM['lineSpacingPercent']
    state = {'base': 0, 'run': None}

    def item(level, marker, text):
        return {'role': 'item', 'level': level, 'marker': marker, 'text': text, 'hang': marker_hang(marker),
                'prev': prev['topItem'] if level == 0 else prev['nestedItem'], 'keep': False,
                'lineSpacing': line_spacing['item']}

    def heading(role, level, marker, text):
        return {'role': role, 'level': level, 'marker': marker, 'text': text,
                'hang': marker_hang(marker) if marker else 0,
                'prev': prev['numberedHeading'] if role == 'heading1' else prev['koreanSubheading'],
                'keep': True, 'lineSpacing': line_spacing['heading']}

    def simple(role, line):
        return {'role': role, 'level': 0, 'prev': 0, 'keep': False, 'lineSpacing': line}

    def annotate(block):
        kind = block.get('type')
        text = _text(block.get('text'))
        if kind == 'table':
            return simple('table', None)
        if kind == 'paragraph':
            return simple('quote', None) if block.get('blockquote') else simple('body', line_spacing['item'])
        if kind == 'listItem':
            parser_level = int(float(block.get('level') or 0))
            if state['run'] is None:
                state['run'] = parser_level
            level = min(ITEM['maxDisplayLevel'], state['base'] + max(0, parser_level - state['run']))
            return item(level, block.get('marker') or ('1.' if block.get('ordered') else '-'), text)
        if kind != 'heading':
            return simple('body', line_spacing['item'])
        frame = frame_kind(text)
        if frame in FRAME_KINDS:
            state['base'] = 0
            state['run'] = None
            roman = frame == 'roman-chapter'
            return {'role': 'frame', 'level': 0, 'prev': prev['chapter'] if roman else 0, 'keep': roman, 'lineSpacing': None}
        state['run'] = None
        labeled = split_label(text)
        if labeled and is_sentence_title(labeled['title']):
            level = _canonical_level(labeled['label'])
            state['base'] = level + 1
            return item(level, labeled['label'], labeled['title'])
        if labeled:
            numbered = bool(re.match(r'^\d+\.$', labeled['label']))
            state['base'] = 1 if numbered else 2
            return heading('heading1' if numbered else 'heading2', 0 if numbered else 1, labeled['label'], text)
        heading_level = int(float(block.get('level') or 1))
        if heading_level <= 1:
            state['base'] = 0
            return simple('heading', None)
        shallow = heading_level <= 3
        state['base'] = 1 if shallow else 2
        return heading('heading1' if shallow else 'heading2', 0 if shallow else 1, None, text)

    annotations = []
    keep_run = 0
    for block in blocks or []:
        annotation = annotate(block or {})
        if annotation['keep']:
            keep_run += 1
            if keep_run > ITEM['maxKeepWithNextChain']:
                annotation['keep'] = False
                keep_run = 0
        else:
            keep_run = 0
        annotations.append(annotation)
    return annotations


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    source = json.loads(Path(sys.argv[1]).read_text(encoding='utf-8'))
    print(json.dumps(layout_blocks(source), ensure_ascii=False))
