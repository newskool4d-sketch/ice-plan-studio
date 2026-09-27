#!/usr/bin/env python3
"""한글이 저장한 PDF로 문단 간격·줄간격·빈 쪽을 실측해 HWPX 문단 속성 정의와 대조한다.

kordoc 미리보기는 '다음 문단과 함께'·표 쪽 나눔을 반영하지 않아 빈 쪽·간격 결함이 한글에서만
드러난다(2026-09-27 v0.12.12 실측). 한글 COM이 막힌 동안은 사용자가 한글에서 저장한 PDF로 돌린다.

사용: py scripts/inspect_pdf_spacing.py <생성 HWPX> <한글 저장 PDF>
판정: ① paraPr별 실측 줄간격이 정의와 ±2%p ② 실측 문단 위 간격이 정의와 ±0.6pt
      ③ 표지·마지막 쪽을 뺀 쪽의 줄 수가 중앙값의 40% 이상(빈 쪽 없음)
      ④ 항목·제목의 첫 줄 x = 쪽 여백 + 왼여백, 둘째 줄 x = 첫 줄 + 내어쓰기(±0.8pt)
         — 기호 시작 위치를 칸(반각 공백) 수로도 보고한다
      ⑤ paraPr id = 목록 위치(한글은 위치로 찾는다) — 어긋나면 FAIL, 판정은 위치 기준 정의로 한다
"""
import re
import statistics
import sys
import zipfile
import xml.etree.ElementTree as ET
from collections import defaultdict
from pathlib import Path

import fitz  # PyMuPDF

NS = {'hp': 'http://www.hancom.co.kr/hwpml/2011/paragraph', 'hh': 'http://www.hancom.co.kr/hwpml/2011/head',
      'hc': 'http://www.hancom.co.kr/hwpml/2011/core'}


def para_definitions(header):
    """한글처럼 paraPrIDRef를 목록 위치로 풀어 정의를 돌려준다 — id 값과 위치가 다른 정의도 함께 보고한다.

    한글은 id 속성이 아니라 목록 위치로 문단 속성을 찾는다(2026-09-27 실측). id로 풀면
    번호에 빈칸이 있는 파일에서 '정의대로 조판됐다'고 잘못 판정한다.
    """
    defs, mismatched = {}, []
    for position, para_pr in enumerate(header.iter('{%s}paraPr' % NS['hh'])):
        spacing = para_pr.find('.//hh:lineSpacing', NS)
        margin = para_pr.find('.//hh:margin', NS)

        def value(tag):
            node = margin.find(f'hc:{tag}', NS) if margin is not None else None
            return int(node.get('value')) / 100 if node is not None else 0.0
        if para_pr.get('id') != str(position):
            mismatched.append((position, para_pr.get('id')))
        defs[str(position)] = {
            'ls': int(spacing.get('value')) if spacing is not None and spacing.get('type') == 'PERCENT' else None,
            'prev': value('prev'), 'next': value('next'), 'left': value('left'), 'intent': value('intent'),
        }
    return defs, mismatched


def page_left_margin(section_xml):
    match = re.search(r'<hp:pagePr\b.*?<hp:margin\b[^>]*\bleft="(\d+)"', section_xml, flags=re.S)
    return int(match.group(1)) / 100 if match else None


def body_paragraphs(section):
    result = []
    for p in section.findall('hp:p', NS):
        if p.find('.//hp:tbl', NS) is not None:
            continue
        text = ''.join((t.text or '') for run in p.findall('hp:run', NS) for t in run.findall('hp:t', NS)).strip()
        if text:
            result.append({'pid': p.get('paraPrIDRef'), 'text': text})
    return result


def pdf_lines(pdf):
    lines = []
    for page_index, page in enumerate(fitz.open(pdf), start=1):
        spans = sorted(
            (round(span['origin'][1], 2), span['origin'][0], span['size'], span['text'])
            for block in page.get_text('dict')['blocks'] for line in block.get('lines', [])
            for span in line['spans'] if span['text'].strip()
        )
        merged = []
        for base, x, size, text in spans:
            if merged and abs(merged[-1]['base'] - base) <= 0.6:
                merged[-1]['text'] += text
                merged[-1]['sizes'].append(size)
                merged[-1]['x'] = min(merged[-1]['x'], x)
            else:
                merged.append({'page': page_index, 'base': base, 'x': x, 'sizes': [size], 'text': text})
        lines.extend(merged)
    return lines


def main(hwpx_path, pdf_path):
    sys.stdout.reconfigure(encoding='utf-8')
    archive = zipfile.ZipFile(hwpx_path)
    defs, id_gaps = para_definitions(ET.fromstring(archive.read('Contents/header.xml')))
    section_xml = archive.read('Contents/section0.xml').decode('utf-8')
    paragraphs = body_paragraphs(ET.fromstring(section_xml))
    margin = page_left_margin(section_xml)
    # 쪽 번호(`- 6 -`)는 문단이 아니다 — 남겨 두면 쪽 끝 문단의 '둘째 줄'로 잘못 짝지어진다
    lines = [line for line in pdf_lines(pdf_path) if not re.fullmatch(r'-\s*\d+\s*-', line['text'].strip())]
    squash = lambda value: re.sub(r'\s+', '', value)

    failures = []
    if id_gaps:
        position, para_id = id_gaps[0]
        print(f'⚠ paraPr id≠목록 위치 {len(id_gaps)}건 (첫 위치 {position}: id {para_id}) — 한글은 위치로 찾으므로 '
              '아래 판정은 한글이 실제로 적용한 정의(위치 기준)와 비교한다')
        failures.append('paraPr-id-position')
    out_of_range = sorted({para['pid'] for para in paragraphs if para['pid'] not in defs}, key=int)
    if out_of_range:
        count = sum(para['pid'] not in defs for para in paragraphs)
        print(f'⚠ 정의 목록 밖 paraPrIDRef {out_of_range} (문단 {count}개) — 한글이 어떤 속성으로 조판했는지 '
              '알 수 없어 판정에서 뺀다')
        failures.append('paraPr-ref-out-of-range')

    matched, cursor = [], 0
    for para in paragraphs:
        target = squash(para['text'])
        start = next((j for j in range(cursor, min(cursor + 80, len(lines)))
                      if squash(lines[j]['text']).startswith(target[:8])), None)
        if start is None:
            continue
        group, acc, k = [], '', start
        while k < len(lines) and len(acc) < len(target):
            acc += squash(lines[k]['text'])
            group.append(lines[k])
            k += 1
        cursor = k
        matched.append({**para, 'lines': group, 'size': statistics.median(s for line in group for s in line['sizes'])})

    within, before = defaultdict(list), defaultdict(list)
    for prev_item, item in zip([None] + matched[:-1], matched):
        if item['pid'] not in defs:
            continue
        same = [line for line in item['lines'] if line['page'] == item['lines'][0]['page']]
        within[item['pid']] += [b['base'] - a['base'] for a, b in zip(same, same[1:])]
        # 한글은 줄간격 여백을 앞 줄 아래에 붙인다 — 문단 사이 기준선 거리는
        # (앞 문단 글자 크기 × 앞 문단 줄간격) + 앞 문단 아래 간격 + 이 문단 위 간격이다(실측으로 확인).
        if (prev_item and prev_item['pid'] in defs and prev_item['lines'][-1]['page'] == item['lines'][0]['page']
                and defs[prev_item['pid']]['ls']):
            gap = item['lines'][0]['base'] - prev_item['lines'][-1]['base']
            pitch = prev_item['size'] * defs[prev_item['pid']]['ls'] / 100
            before[item['pid']].append(gap - pitch - defs[prev_item['pid']]['next'])

    print(f'문단 {len(paragraphs)}개 중 PDF 대응 {len(matched)}개')
    print('paraPr | 정의(줄간격, 위pt) | 실측 줄간격 | 실측 위 간격(중앙값, n) | 판정')
    for pid in sorted({m['pid'] for m in matched if m['pid'] in defs}, key=int):
        d = defs[pid]
        size = statistics.median(m['size'] for m in matched if m['pid'] == pid)
        ls = statistics.median(within[pid]) / size * 100 if within[pid] else None
        prev = statistics.median(before[pid]) if before[pid] else None
        ok_ls = ls is None or d['ls'] is None or abs(ls - d['ls']) <= 2
        ok_prev = prev is None or abs(prev - d['prev']) <= 0.6
        # 판정은 변환기가 정의하는 본문 문단 속성(238~, 동적 248~)만 — 템플릿 속성(표지 등)은 참고 표시
        if int(pid) < 238:
            verdict = '참고'
        else:
            verdict = 'OK' if ok_ls and ok_prev else 'FAIL'
        if verdict == 'FAIL':
            failures.append(pid)
        ls_text = f'{ls:.0f}%' if ls is not None else '-'
        prev_text = f'{prev:.2f}pt (n={len(before[pid])})' if prev is not None else '-'
        print(f"{pid:>4} | {d['ls']}%, {d['prev']:g}pt | {ls_text} | {prev_text} | {verdict}")

    # ④ 들여쓰기: 한글은 첫 줄을 왼여백에, 둘째 줄부터 내어쓰기(음수 intent)만큼 더 들여 쓴다
    tokens = __import__('json').loads((Path(__file__).resolve().parent / 'layout-tokens.json').read_text(encoding='utf-8'))
    space_pt = tokens['itemLayout']['glyphWidthHwpUnit']['space'] / 100
    marker_pattern = re.compile(r'^(\d+\.|[가-하]\.|\d+\)|[가-하]\)|\(\d+\)|[①-⑮]|[㉮-㉻]|[□○❍■◦-])\s')
    indent_errors = defaultdict(list)
    marker_cells = defaultdict(set)
    for item in matched:
        d = defs.get(item['pid'])
        if d is None or int(item['pid']) < 238 or margin is None or not (d['left'] or d['intent']):
            continue
        first = item['lines'][0]
        indent_errors[item['pid']].append(first['x'] - (margin + d['left']))
        second = item['lines'][1] if len(item['lines']) > 1 and item['lines'][1]['page'] == first['page'] else None
        if second is not None and d['intent'] < 0:
            indent_errors[item['pid']].append(second['x'] - (margin + d['left'] - d['intent']))
        marker = marker_pattern.match(item['text'])
        if marker:
            kind = re.sub(r'^[가-하]', '가', re.sub(r'\d+', '1', re.sub(r'^[①-⑮]', '①', marker.group(1))))
            marker_cells[kind].add(round((first['x'] - margin) / space_pt, 1))
    print('들여쓰기(첫 줄·둘째 줄 x − 정의 위치, 최대 오차):')
    for pid in sorted(indent_errors, key=int):
        worst = max(indent_errors[pid], key=abs)
        verdict = 'OK' if abs(worst) <= 0.8 else 'FAIL'
        if verdict == 'FAIL':
            failures.append(f'indent-{pid}')
        print(f"  {pid:>4} | 왼여백 {defs[pid]['left']:g}pt·내어쓰기 {-defs[pid]['intent']:g}pt | 최대 오차 {worst:+.2f}pt (n={len(indent_errors[pid])}) | {verdict}")
    print('기호 시작 위치(칸 = 반각 공백 %.2fpt):' % space_pt, {kind: sorted(cells) for kind, cells in marker_cells.items()})

    per_page = defaultdict(int)
    for line in lines:
        per_page[line['page']] += 1
    pages = sorted(per_page)
    middle = pages[1:-1]
    median_lines = statistics.median(per_page[p] for p in middle) if middle else 0
    sparse = [p for p in middle if per_page[p] < median_lines * 0.4]
    print('쪽별 줄 수:', dict(per_page), '/ 빈 쪽 의심:', sparse or '없음')
    if sparse:
        failures.append('sparse-pages')
    print('결과:', 'PASS' if not failures else f'FAIL {failures}')
    return 0 if not failures else 1


if __name__ == '__main__':
    if len(sys.argv) != 3:
        raise SystemExit('사용: py scripts/inspect_pdf_spacing.py <생성 HWPX> <한글 저장 PDF>')
    raise SystemExit(main(Path(sys.argv[1]), Path(sys.argv[2])))
