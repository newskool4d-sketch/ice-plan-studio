#!/usr/bin/env python3
import argparse
import base64
import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path

# 벤더링된 hwpx-toolkit 사용 (타 PC 배포 시 개발자 홈 경로 의존 제거).
# 원본: ~/.agents/skills/hwpx변환 — 동기화 정책은 hwpx-toolkit/VENDORED.md 참조.
TOOLKIT = Path(__file__).resolve().parent.parent / "hwpx-toolkit"
SCRIPTS = TOOLKIT / "scripts"
GONMUN_SECTION = TOOLKIT / "templates" / "gonmun" / "section0.xml"
BONCHEONG_ANCHOR = TOOLKIT / "templates" / "boncheong" / "cover-anchor.xml"
TEMPLATE_CHOICES = ("gonmun", "boncheong")
sys.path.insert(0, str(SCRIPTS))
from hwpx_helpers import add_images_to_hwpx, make_image_para, next_id, reset_id, update_content_hpf, xml_escape  # noqa: E402
from image_dimensions import image_dims_hwpunit  # noqa: E402
from layout_engine import BODY_WIDTH_HWPUNIT, PAGE_LABELS, page_sequence, resolve_profile, table_column_widths, table_row_heights  # noqa: E402
COVER_CI_BOX_MM = (30, 30)  # 정사각형 제한 박스
COVER_SLOGAN_BOX_MM = (150, 40)  # 본문 폭 기준 와이드 배너

# 스타일 ID는 템플릿마다 완전히 다르다. 템플릿의 header.xml에 실제 존재하는 ID만
# 써야 하며, 다른 템플릿의 ID를 쓰면 dangling 참조가 되거나 엉뚱한 서식으로 렌더된다.
#
# gonmun: charPr 0=본문 10pt, 7=22pt bold, 8=16pt bold, 9=8pt, 10=10pt bold
#         paraPr 0=양쪽정렬, 11=왼쪽, 14=들여쓰기, 20=가운데, 22=셀 본문
#         주의: paraPr 2~8·16~18은 OUTLINE 자동번호 문단 — 본문 사용 금지
# boncheong: 레퍼런스 A(세계로배움학교) 실측값 — docs/BASELINE_ANALYSIS.md §4 참조
STYLE_SETS = {
    'gonmun': {
        'valid_charpr': {str(i) for i in range(11)},
        'bold_map': {'0': '10', '1': '10', '9': '10'},
        'heading': {1: ('7', '20'), 2: ('8', '11')},
        'heading_default': ('10', '11'),
        'body': ('0', '0'),
        'list_parapr': '14',
        'cell_parapr': '22',
        'cell_charpr': {'header': '10', 'body': '0'},
        'table_anchor_parapr': '0',
    },
    'boncheong': {
        # 실측 ID 맵: 9=장제목 14pt, 121=본문 12pt(paraPr 73=개조식 내어쓰기),
        # 307=표 머리글 맑은고딕 11pt(자간 -15%), 417=표 본문 맑은고딕 10pt,
        # 64=표 셀 문단(가운데 120%)
        'valid_charpr': {'9', '11', '15', '18', '121', '132', '204', '277', '307', '338', '417', '512'},
        'bold_map': {'121': '132'},
        'heading': {1: ('9', '1'), 2: ('132', '73')},
        'heading_default': ('132', '73'),
        'body': ('121', '73'),
        'list_parapr': '73',
        'cell_parapr': '64',
        'cell_charpr': {'header': '307', 'body': '417'},
        'table_anchor_parapr': '1',
        # bf4·bf13·bf17 모두 4면 실선. 표 셀에는 bf13 사용(레퍼런스 표 셀 계열)
        'cell_borderfill': {'header': '13', 'body': '13'},
        'table_borderfill': '13',
    },
}
BOLD_PATTERN = re.compile(r'\*\*(.+?)\*\*')


def runs_xml(text, charpr, style=None):
    """`**굵게**` 마커를 bold run으로 변환하고 나머지는 일반 run으로 출력."""
    bold_map = (style or STYLE_SETS['gonmun'])['bold_map']
    bold_charpr = bold_map.get(charpr, charpr)
    parts = []
    pos = 0
    for m in BOLD_PATTERN.finditer(text):
        if m.start() > pos:
            parts.append((text[pos:m.start()], charpr))
        parts.append((m.group(1), bold_charpr))
        pos = m.end()
    if pos < len(text):
        parts.append((text[pos:], charpr))
    if not parts:
        parts = [('', charpr)]
    return ''.join(
        f'<hp:run charPrIDRef="{cp}"><hp:t>{xml_escape(seg)}</hp:t></hp:run>'
        for seg, cp in parts
    )


def text_para(text, charpr, parapr, style=None):
    return (
        f'<hp:p id="{next_id()}" paraPrIDRef="{parapr}" styleIDRef="0" '
        f'pageBreak="0" columnBreak="0" merged="0">{runs_xml(text, charpr, style)}</hp:p>'
    )


def blank_para():
    return (
        f'<hp:p id="{next_id()}" paraPrIDRef="0" styleIDRef="0" '
        f'pageBreak="0" columnBreak="0" merged="0"><hp:run charPrIDRef="0"><hp:t/></hp:run></hp:p>'
    )


def page_break_para():
    return (
        f'<hp:p id="{next_id()}" paraPrIDRef="0" styleIDRef="0" '
        f'pageBreak="1" columnBreak="0" merged="0"><hp:run charPrIDRef="0"><hp:t/></hp:run></hp:p>'
    )


def decode_data_url_to_tempfile(data_url):
    if not data_url or not str(data_url).startswith('data:'):
        return None
    header, _, b64data = str(data_url).partition(',')
    if not b64data:
        return None
    ext = '.jpg' if 'jpeg' in header else '.png'
    raw = base64.b64decode(b64data)
    with tempfile.NamedTemporaryFile(delete=False, suffix=ext) as tmp:
        tmp.write(raw)
        return tmp.name


def cover_paragraphs(cover, images):
    """표지 페이지 문단 생성. images 리스트에 add_images_to_hwpx용 항목을 채운다."""
    parts = [blank_para(), blank_para(), blank_para()]

    ci_path = decode_data_url_to_tempfile(cover.get('ciDataUrl'))
    if ci_path:
        width, height = image_dims_hwpunit(ci_path, *COVER_CI_BOX_MM)
        image_id = f'cover-ci-{next_id()}'
        images.append({'file': f'{image_id}{Path(ci_path).suffix}', 'id': image_id, 'src_path': ci_path})
        parts.append(make_image_para(image_id, width=width, height=height, parapr='19'))
        parts.append(blank_para())

    slogan_path = decode_data_url_to_tempfile(cover.get('sloganDataUrl'))
    if slogan_path:
        width, height = image_dims_hwpunit(slogan_path, *COVER_SLOGAN_BOX_MM)
        image_id = f'cover-slogan-{next_id()}'
        images.append({'file': f'{image_id}{Path(slogan_path).suffix}', 'id': image_id, 'src_path': slogan_path})
        parts.append(make_image_para(image_id, width=width, height=height, parapr='19'))
        parts.append(blank_para())

    parts.append(blank_para())
    title = cover.get('title') or ''
    if title:
        parts.append(text_para(title, '7', '20'))
    display_name = cover.get('displayName') or ''
    if display_name:
        parts.append(text_para(display_name, '0', '20'))
    parts.append(blank_para())
    parts.append(blank_para())
    parts.append(page_break_para())
    return parts


def first_paragraph():
    source = GONMUN_SECTION.read_text(encoding='utf-8')
    match = re.search(r'<hp:p id="1000000001".*?</hp:p>', source, flags=re.S)
    if not match:
        raise RuntimeError('Could not locate secPr paragraph')
    return match.group(0)


def boncheong_cover_paragraphs(model, profile):
    """Render the boncheong cover anchor with profile-specific variants."""
    metadata = model.get('metadata', {})
    cover = metadata.get('cover') or {}
    first_heading = next(
        (block.get('text') for block in model.get('blocks', [])
         if block.get('type') == 'heading' and block.get('text')),
        '본청 계획안',
    )
    replacements = {
        '기본 방향 문구를 입력하세요': cover.get('direction') or '기본 방향',
        '2026 ○○○○ 기본 계획': cover.get('title') or metadata.get('title') or first_heading,
        '2026. 7. ': cover.get('date') or '2026. 7.',
        '인천광역시교육청 ○○과 ': cover.get('displayName') or '인천광역시교육청',
    }
    anchor_xml = BONCHEONG_ANCHOR.read_text(encoding='utf-8')
    for placeholder, value in replacements.items():
        anchor_xml = anchor_xml.replace(placeholder, xml_escape(str(value)))
    title = replacements['2026 ○○○○ 기본 계획']
    parts = [anchor_xml]
    if not profile.banner_image:
        # 소유 banner asset(image1)만 제거하여 배너형/무배너형을 명시적으로 구분한다.
        parts[0], removed = re.subn(r'<hp:pic[^>]*>.*?<hc:img binaryItemIDRef="image1".*?</hp:pic>', '', parts[0], count=1, flags=re.S)
        if removed != 1:
            raise RuntimeError('Could not remove the cover banner image anchor')
    if not profile.title_box:
        # 제목틀을 통째로 대체해 직접기관형 제목도 명시적 charPr 9 토큰을 사용한다.
        title_run = f'<hp:run charPrIDRef="9"><hp:t>{xml_escape(str(title))}</hp:t></hp:run>'
        parts[0], replaced = re.subn(
            r'<hp:run charPrIDRef="0"><hp:tbl id="2063551796".*?</hp:tbl><hp:t/></hp:run>',
            title_run, parts[0], count=1, flags=re.S,
        )
        if replaced != 1:
            raise RuntimeError('Could not replace the cover title-box anchor')
    if profile.english_name:
        # 표지는 고정 레이아웃(결정사항 6)이므로 새 문단을 추가해 페이지 높이를
        # 늘리지 않는다 — 앵커에 이미 있는 빈 여분 문단(부서명 줄과 동일한
        # paraPr/charPr, 원본 문서의 미사용 여백 줄)을 재사용해 영문 기관명을 채운다.
        trailing_slot = '<hp:p id="0" paraPrIDRef="25" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0"><hp:run charPrIDRef="15"/>'
        filled_slot = ('<hp:p id="0" paraPrIDRef="25" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">'
                        f'<hp:run charPrIDRef="15"><hp:t>{xml_escape(str(profile.english_name))}</hp:t></hp:run>')
        if trailing_slot not in parts[0]:
            raise RuntimeError('Could not find the cover english-name anchor slot')
        parts[0] = parts[0].replace(trailing_slot, filled_slot, 1)
    parts.append(page_break_para())
    return parts


def page_placeholder_blocks(page_type):
    """Content generation 없이도 각 페이지 유형의 조판 구조를 검증할 최소 블록."""
    if page_type == 'preflight':
        return [{'type': 'table', 'header': ['점검 항목', '검토완료', '해당없음'], 'rows': [['형식 점검', '□', '□'], ['내용 확인', '□', '□']]}]
    if page_type == 'schedule':
        return [{'type': 'table', 'header': ['구분', '내용'], 'rows': [['일정', '입력 대기']]}]
    label = {'toc': '목차 항목 입력', 'summary': '요약 내용 입력', 'task': '세부과제 내용 입력', 'appendix': '부록·붙임 내용 입력'}.get(page_type, '내용 입력 대기')
    return [{'type': 'paragraph', 'text': label}]


def page_type_paragraphs(page, model, profile, styles, style, starts_new_page=True):
    """Render one of the nine layout page types; policy content remains caller-owned."""
    page_type = page['type']
    metadata = model.get('metadata', {})
    if page_type == 'cover':
        return boncheong_cover_paragraphs(model, profile)
    if page_type == 'body':
        parts = [page_break_para()] if starts_new_page else []
        parts.extend(render_blocks(page.get('blocks', model.get('blocks', [])), styles, style))
        return parts
    title = page.get('title') or PAGE_LABELS[page_type]
    parts = [page_break_para()] if starts_new_page else []
    if page_type == 'inner-cover':
        parts.append(text_para(metadata.get('title') or title, '9', '1', style))
        covered = metadata.get('cover') or {}
        parts.append(text_para(covered.get('displayName') or '인천광역시교육청', '121', '73', style))
        parts.append(text_para('운영 계획', '121', '73', style))
    else:
        parts.append(text_para(title, '9', '1', style))
    parts.extend(render_blocks(page.get('blocks') or page_placeholder_blocks(page_type), styles, style))
    return parts


def table_xml(block, styles, style=None):
    style = style or STYLE_SETS['gonmun']
    header = block.get('header', [])
    rows = [header] + block.get('rows', [])
    columns = max((len(row) for row in rows), default=1)
    total_width = style.get('body_width', BODY_WIDTH_HWPUNIT)
    widths = table_column_widths(rows, total_width=total_width)
    row_heights = table_row_heights(rows, widths)
    table_id = next_id()
    cells = []
    for row_index, row in enumerate(rows):
        cells.append('<hp:tr>')
        for col_index in range(columns):
            value = row[col_index] if col_index < len(row) else ''
            cell_id = next_id()
            borders = style.get('cell_borderfill', {'header': '4', 'body': '3'})
            cell_border = borders['header'] if row_index == 0 else borders['body']
            para_id = next_id()
            style_key = 'tableHeader' if row_index == 0 else 'tableBody'
            charpr = styles.get(style_key, {}).get('charPrId')
            if charpr not in style['valid_charpr']:
                charpr = style['cell_charpr']['header' if row_index == 0 else 'body']
            header_flag = '1' if row_index == 0 else '0'
            cells.append(
                f'<hp:tc name="" header="{header_flag}" hasMargin="0" protect="0" editable="0" dirty="0" borderFillIDRef="{cell_border}">'
                f'<hp:cellAddr colAddr="{col_index}" rowAddr="{row_index}"/>'
                '<hp:cellSpan colSpan="1" rowSpan="1"/>'
                f'<hp:cellSz width="{widths[col_index]}" height="{row_heights[row_index]}"/>'
                '<hp:cellMargin left="283" right="283" top="141" bottom="141"/>'
                f'<hp:subList id="{cell_id}" textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="CENTER" '
                f'linkListIDRef="0" linkListNextIDRef="0" textWidth="{max(widths[col_index] - 566, 1)}" fieldName="">'
                f'<hp:p id="{para_id}" paraPrIDRef="{style["cell_parapr"]}" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">'
                f'{runs_xml(str(value), charpr, style)}'
                f'</hp:p></hp:subList></hp:tc>'
            )
        cells.append('</hp:tr>')
    return (
        f'<hp:tbl id="{table_id}" zOrder="0" numberingType="TABLE" textWrap="TOP_AND_BOTTOM" '
        f'textFlow="BOTH_SIDES" lock="0" dropcapstyle="None" pageBreak="CELL" repeatHeader="1" '
        f'rowCnt="{len(rows)}" colCnt="{columns}" cellSpacing="0" borderFillIDRef="{style.get("table_borderfill", "3")}" noAdjust="0">'
        f'<hp:sz width="{total_width}" widthRelTo="ABSOLUTE" height="{sum(row_heights)}" heightRelTo="ABSOLUTE" protect="0"/>'
        # treatAsChar=1: 표를 글자처럼 취급해 본문 흐름에 고정한다. 0(띄우기)이면 한글이
        # 표를 앞 문단 위로 재배치해 원본 블록 순서가 뒤바뀐다(2026-07-20 실물 확인).
        # 레퍼런스 A도 소형 표는 treatAsChar=1을 쓴다 — BASELINE_ANALYSIS §2.5 참조.
        '<hp:pos treatAsChar="1" affectLSpacing="0" flowWithText="1" allowOverlap="0" holdAnchorAndSO="0" '
        'vertRelTo="PARA" horzRelTo="COLUMN" vertAlign="TOP" horzAlign="LEFT" vertOffset="0" horzOffset="0"/>'
        '<hp:outMargin left="0" right="0" top="0" bottom="0"/><hp:inMargin left="0" right="0" top="0" bottom="0"/>'
        + ''.join(cells) + '</hp:tbl>'
    )


def table_paragraph(block, styles, style=None):
    style = style or STYLE_SETS['gonmun']
    anchor_charpr = style['cell_charpr']['body']
    return (
        f'<hp:p id="{next_id()}" paraPrIDRef="{style["table_anchor_parapr"]}" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">'
        f'<hp:run charPrIDRef="{anchor_charpr}">{table_xml(block, styles, style)}</hp:run></hp:p>'
    )


def render_blocks(blocks, styles, style):
    paragraphs = []
    for block in blocks:
        if block['type'] == 'table':
            paragraphs.append(table_paragraph(block, styles, style))
            continue
        text = block.get('text', '')
        if block['type'] == 'listItem':
            text = ('1. ' if block.get('ordered') else '- ') + text
        if not text:
            continue
        if block['type'] == 'heading':
            charpr, parapr = style['heading'].get(block.get('level', 1), style['heading_default'])
        elif block['type'] == 'listItem':
            charpr, parapr = style['body'][0], style['list_parapr']
        else:
            charpr, parapr = style['body']
        paragraphs.append(text_para(text, charpr, parapr, style))
    return paragraphs


def build(model_path, output, template='gonmun'):
    model = json.loads(Path(model_path).read_text(encoding='utf-8'))
    if template not in TEMPLATE_CHOICES:
        raise ValueError(f'Unsupported template: {template}')
    styles = model.get('styles', {})
    style = STYLE_SETS[template]
    reset_id(1000)
    images = []
    if template == 'boncheong':
        profile = resolve_profile(model.get('metadata', {}))
        paragraphs = []
        pages = page_sequence(model.get('metadata', {}), profile)
        for index, page in enumerate(pages):
            starts_new_page = index > 0 and pages[index - 1]['type'] != 'cover'
            paragraphs.extend(page_type_paragraphs(page, model, profile, styles, style, starts_new_page=starts_new_page))
    else:
        paragraphs = [first_paragraph()]
        cover = model.get('metadata', {}).get('cover')
        if cover and (cover.get('ciDataUrl') or cover.get('sloganDataUrl')):
            paragraphs.extend(cover_paragraphs(cover, images))
        paragraphs.extend(render_blocks(model.get('blocks', []), styles, style))
    section = ('<?xml version="1.0" encoding="UTF-8"?>'
               '<hs:sec xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph" '
               'xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" '
               'xmlns:hc="http://www.hancom.co.kr/hwpml/2011/core">' + ''.join(paragraphs) + '</hs:sec>')
    section_path = Path(output).with_suffix('.section0.xml')
    section_path.write_text(section, encoding='utf-8')
    try:
        # metadata.title은 원본 파일명(예: "계획안.md")을 그대로 담고 있을 수 있어
        # 확장자를 제거한다 (내부 문서 속성에 ".md"가 그대로 노출되는 것 방지).
        raw_title = model.get('metadata', {}).get('title') or ''
        doc_title = re.sub(r'\.(md|txt|hwpx?|iceplan)$', '', raw_title, flags=re.I) or 'ICE Plan Studio 문서'
        subprocess.run([sys.executable, str(SCRIPTS / 'build_hwpx.py'), '--template', template, '--section', str(section_path), '--title', doc_title, '--output', str(output)], check=True)
        if images:
            add_images_to_hwpx(output, images)
            update_content_hpf(output, images)
        subprocess.run([sys.executable, str(SCRIPTS / 'fix_namespaces.py'), str(output)], check=True)
        subprocess.run([sys.executable, str(SCRIPTS / 'finalize_hwpx.py'), str(output), '--in-place', '--strip-linesegarray', '--layout'], check=True)
        subprocess.run([sys.executable, str(SCRIPTS / 'validate.py'), str(output)], check=True)
    finally:
        section_path.unlink(missing_ok=True)
        for image in images:
            Path(image['src_path']).unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description='Convert an ICE Plan model to HWPX')
    parser.add_argument('model_path')
    parser.add_argument('output')
    parser.add_argument('--template', choices=TEMPLATE_CHOICES, default='gonmun')
    args = parser.parse_args()
    build(args.model_path, args.output, args.template)


if __name__ == '__main__':
    main()
