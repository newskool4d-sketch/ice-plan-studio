#!/usr/bin/env python3
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
TEMPLATE_SECTION = TOOLKIT / "templates" / "gonmun" / "section0.xml"
sys.path.insert(0, str(SCRIPTS))
from hwpx_helpers import add_images_to_hwpx, make_image_para, next_id, reset_id, update_content_hpf, xml_escape  # noqa: E402

HWPUNIT_PER_MM = 7200 / 25.4
COVER_CI_BOX_MM = (30, 30)  # 정사각형 제한 박스
COVER_SLOGAN_BOX_MM = (150, 40)  # 본문 폭 기준 와이드 배너

# gonmun 템플릿에 실제 존재하는 스타일 ID만 사용한다 (dangling 참조 방지).
# charPr: 0=본문 10pt, 7=22pt bold, 8=16pt bold, 9=8pt, 10=10pt bold
# paraPr: 0=양쪽정렬(번호 없음), 11=왼쪽, 14=왼쪽 들여쓰기, 20=가운데, 22=셀 본문
# 주의: paraPr 2~8·16~18은 OUTLINE 자동번호 문단 — 본문에 사용 금지
VALID_CHARPR = {str(i) for i in range(11)}
BOLD_CHARPR = {'0': '10', '1': '10', '9': '10'}  # 본문 계열 → 10pt bold
HEADING_STYLES = {1: ('7', '20'), 2: ('8', '11')}
HEADING_DEFAULT = ('10', '11')  # level 3 이상
BODY_CHARPR, BODY_PARAPR = '0', '0'
LIST_PARAPR = '14'
CELL_PARAPR = '22'
TABLE_ANCHOR_PARAPR = '0'
BOLD_PATTERN = re.compile(r'\*\*(.+?)\*\*')


def runs_xml(text, charpr):
    """`**굵게**` 마커를 bold run으로 변환하고 나머지는 일반 run으로 출력."""
    bold_charpr = BOLD_CHARPR.get(charpr, charpr)
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


def text_para(text, charpr, parapr):
    return (
        f'<hp:p id="{next_id()}" paraPrIDRef="{parapr}" styleIDRef="0" '
        f'pageBreak="0" columnBreak="0" merged="0">{runs_xml(text, charpr)}</hp:p>'
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


def read_image_size(path):
    """PNG/JPEG 픽셀 크기를 표준 라이브러리만으로 읽는다 (Pillow 불필요).

    PNG: 시그니처(8B) 뒤 첫 청크가 IHDR — width/height가 big-endian 4B씩.
    JPEG: SOF0~SOF15(0xC0~0xCF, 단 C4/C8/CC 제외) 마커의 payload에서
          [정밀도 1B][height 2B][width 2B].
    """
    import struct
    with open(path, 'rb') as f:
        head = f.read(24)
        if head[:8] == b'\x89PNG\r\n\x1a\n' and head[12:16] == b'IHDR':
            width, height = struct.unpack('>II', head[16:24])
            return width, height
        if head[:2] == b'\xff\xd8':  # JPEG SOI
            f.seek(2)
            while True:
                marker = f.read(2)
                if len(marker) < 2 or marker[0] != 0xFF:
                    break
                code = marker[1]
                if 0xC0 <= code <= 0xCF and code not in (0xC4, 0xC8, 0xCC):
                    f.read(3)  # length 2B + precision 1B
                    height, width = struct.unpack('>HH', f.read(4))
                    return width, height
                length = struct.unpack('>H', f.read(2))[0]
                f.seek(length - 2, 1)
    return None


def image_dims_hwpunit(path, max_width_mm, max_height_mm):
    ratio = None
    try:
        size = read_image_size(path)
        if size and size[1]:
            ratio = size[0] / size[1]
    except Exception:
        ratio = None
    if not ratio:
        ratio = max_width_mm / max_height_mm
    max_width = max_width_mm * HWPUNIT_PER_MM
    max_height = max_height_mm * HWPUNIT_PER_MM
    width = max_width
    height = width / ratio
    if height > max_height:
        height = max_height
        width = height * ratio
    return round(width), round(height)


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
    source = TEMPLATE_SECTION.read_text(encoding='utf-8')
    match = re.search(r'<hp:p id="1000000001".*?</hp:p>', source, flags=re.S)
    if not match:
        raise RuntimeError('Could not locate secPr paragraph')
    return match.group(0)


def table_xml(block, styles):
    header = block.get('header', [])
    rows = [header] + block.get('rows', [])
    columns = max((len(row) for row in rows), default=1)
    total_width = 42520
    minimum_width = 6500
    content_lengths = [max((len(str(row[col])) for row in rows if col < len(row)), default=1) for col in range(columns)]
    usable = total_width - minimum_width * columns
    length_total = max(sum(content_lengths), 1)
    widths = [minimum_width + int(usable * length / length_total) for length in content_lengths]
    widths[-1] += total_width - sum(widths)
    row_heights = []
    for row in rows:
        line_count = max((max(1, (len(str(row[col])) + max(widths[col] // 900, 1) - 1) // max(widths[col] // 900, 1)) for col in range(min(len(row), columns))), default=1)
        row_heights.append(1400 + min(line_count, 5) * 500)
    table_id = next_id()
    cells = []
    for row_index, row in enumerate(rows):
        cells.append('<hp:tr>')
        for col_index in range(columns):
            value = row[col_index] if col_index < len(row) else ''
            cell_id = next_id()
            cell_border = '4' if row_index == 0 else '3'
            para_id = next_id()
            style_key = 'tableHeader' if row_index == 0 else 'tableBody'
            charpr = styles.get(style_key, {}).get('charPrId')
            if charpr not in VALID_CHARPR:
                charpr = '10' if row_index == 0 else '0'
            header_flag = '1' if row_index == 0 else '0'
            cells.append(
                f'<hp:tc name="" header="{header_flag}" hasMargin="0" protect="0" editable="0" dirty="0" borderFillIDRef="{cell_border}">'
                f'<hp:cellAddr colAddr="{col_index}" rowAddr="{row_index}"/>'
                '<hp:cellSpan colSpan="1" rowSpan="1"/>'
                f'<hp:cellSz width="{widths[col_index]}" height="{row_heights[row_index]}"/>'
                '<hp:cellMargin left="283" right="283" top="141" bottom="141"/>'
                f'<hp:subList id="{cell_id}" textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="CENTER" '
                f'linkListIDRef="0" linkListNextIDRef="0" textWidth="{max(widths[col_index] - 566, 1)}" fieldName="">'
                f'<hp:p id="{para_id}" paraPrIDRef="{CELL_PARAPR}" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">'
                f'{runs_xml(str(value), charpr)}'
                f'</hp:p></hp:subList></hp:tc>'
            )
        cells.append('</hp:tr>')
    return (
        f'<hp:tbl id="{table_id}" zOrder="0" numberingType="TABLE" textWrap="TOP_AND_BOTTOM" '
        f'textFlow="BOTH_SIDES" lock="0" dropcapstyle="None" pageBreak="CELL" repeatHeader="1" '
        f'rowCnt="{len(rows)}" colCnt="{columns}" cellSpacing="0" borderFillIDRef="3" noAdjust="0">'
        f'<hp:sz width="{total_width}" widthRelTo="ABSOLUTE" height="{sum(row_heights)}" heightRelTo="ABSOLUTE" protect="0"/>'
        '<hp:pos treatAsChar="0" affectLSpacing="0" flowWithText="1" allowOverlap="0" holdAnchorAndSO="0" '
        'vertRelTo="PARA" horzRelTo="COLUMN" vertAlign="TOP" horzAlign="LEFT" vertOffset="0" horzOffset="0"/>'
        '<hp:outMargin left="0" right="0" top="0" bottom="0"/><hp:inMargin left="0" right="0" top="0" bottom="0"/>'
        + ''.join(cells) + '</hp:tbl>'
    )


def table_paragraph(block, styles):
    return (
        f'<hp:p id="{next_id()}" paraPrIDRef="{TABLE_ANCHOR_PARAPR}" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">'
        f'<hp:run charPrIDRef="0">{table_xml(block, styles)}</hp:run></hp:p>'
    )


def build(model_path, output):
    model = json.loads(Path(model_path).read_text(encoding='utf-8'))
    styles = model.get('styles', {})
    reset_id(1000)
    paragraphs = [first_paragraph()]
    images = []
    cover = model.get('metadata', {}).get('cover')
    if cover and (cover.get('ciDataUrl') or cover.get('sloganDataUrl')):
        paragraphs.extend(cover_paragraphs(cover, images))
    for block in model.get('blocks', []):
        if block['type'] == 'table':
            paragraphs.append(table_paragraph(block, styles))
            continue
        text = block.get('text', '')
        if block['type'] == 'listItem':
            text = ('1. ' if block.get('ordered') else '- ') + text
        if text:
            if block['type'] == 'heading':
                charpr, parapr = HEADING_STYLES.get(block.get('level', 1), HEADING_DEFAULT)
            elif block['type'] == 'listItem':
                charpr, parapr = BODY_CHARPR, LIST_PARAPR
            else:
                charpr, parapr = BODY_CHARPR, BODY_PARAPR
            paragraphs.append(text_para(text, charpr, parapr))
    section = ('<?xml version="1.0" encoding="UTF-8"?>'
               '<hs:sec xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph" '
               'xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" '
               'xmlns:hc="http://www.hancom.co.kr/hwpml/2011/core">' + ''.join(paragraphs) + '</hs:sec>')
    section_path = Path(output).with_suffix('.section0.xml')
    section_path.write_text(section, encoding='utf-8')
    try:
        doc_title = model.get('metadata', {}).get('title') or 'ICE Plan Studio 문서'
        subprocess.run([sys.executable, str(SCRIPTS / 'build_hwpx.py'), '--template', 'gonmun', '--section', str(section_path), '--title', doc_title, '--output', str(output)], check=True)
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


if __name__ == '__main__':
    if len(sys.argv) != 3:
        raise SystemExit('Usage: python model_to_hwpx.py model.json output.hwpx')
    build(sys.argv[1], sys.argv[2])






