#!/usr/bin/env python3
import argparse
import base64
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

# 벤더링된 hwpx-toolkit 사용 (타 PC 배포 시 개발자 홈 경로 의존 제거).
# 원본: ~/.agents/skills/hwpx변환 — 동기화 정책은 hwpx-toolkit/VENDORED.md 참조.
TOOLKIT = Path(__file__).resolve().parent.parent / "hwpx-toolkit"
SCRIPTS = TOOLKIT / "scripts"
GONMUN_SECTION = TOOLKIT / "templates" / "gonmun" / "section0.xml"
BONCHEONG_ANCHOR = TOOLKIT / "templates" / "boncheong" / "cover-anchor.xml"
TEMPLATE_CHOICES = ("gonmun", "boncheong")
TEMPLATE_HEADERS = {name: TOOLKIT / "templates" / name / "Contents" / "header.xml"
                    for name in TEMPLATE_CHOICES}
sys.path.insert(0, str(SCRIPTS))
from hwpx_helpers import add_images_to_hwpx, make_image_para, next_id, reset_id, update_content_hpf, xml_escape  # noqa: E402
from image_dimensions import image_dims_hwpunit  # noqa: E402

# 본청 표지 하단: 기관명 텍스트를 대체하는 명칭 이미지 문단 (22991×3840 HU, 실물 실측)
NAME_IMAGE_PARAGRAPH = (
    '<hp:p id="2147483648" paraPrIDRef="25" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">'
    '<hp:run charPrIDRef="0"><hp:pic id="2063551811" zOrder="4" numberingType="PICTURE" '
    'textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" lock="0" dropcapstyle="None" href="" '
    'groupLevel="0" instid="989809988" reverse="0">'
    '<hp:offset x="0" y="0"/>'
    '<hp:orgSz width="22991" height="3840"/><hp:curSz width="22991" height="3840"/>'
    '<hp:flip horizontal="0" vertical="0"/>'
    '<hp:rotationInfo angle="0" centerX="11495" centerY="1920" rotateimage="0"/>'
    '<hp:renderingInfo>'
    '<hc:transMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/>'
    '<hc:scaMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/>'
    '<hc:rotMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/>'
    '</hp:renderingInfo>'
    '<hc:img binaryItemIDRef="image3" bright="0" contrast="0" effect="REAL_PIC" alpha="0"/>'
    '<hp:imgRect><hc:pt0 x="0" y="0"/><hc:pt1 x="22991" y="0"/>'
    '<hc:pt2 x="22991" y="3840"/><hc:pt3 x="0" y="3840"/></hp:imgRect>'
    '<hp:imgClip left="0" right="22991" top="0" bottom="3840"/>'
    '<hp:inMargin left="0" right="0" top="0" bottom="0"/>'
    '<hp:imgDim dimwidth="22991" dimheight="3840"/><hp:effects/>'
    '<hp:sz width="22991" widthRelTo="ABSOLUTE" height="3840" heightRelTo="ABSOLUTE" protect="0"/>'
    '<hp:pos treatAsChar="1" affectLSpacing="0" flowWithText="1" allowOverlap="0" '
    'holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="COLUMN" vertAlign="TOP" horzAlign="LEFT" '
    'vertOffset="0" horzOffset="0"/>'
    '<hp:outMargin left="0" right="0" top="0" bottom="0"/>'
    '</hp:pic><hp:t/></hp:run>'
    '<hp:linesegarray><hp:lineseg textpos="0" vertpos="0" vertsize="3840" textheight="3840" '
    'baseline="3264" spacing="1320" horzpos="0" horzsize="48188" flags="393216"/>'
    '</hp:linesegarray></hp:p>'
)
from layout_engine import BODY_WIDTH_HWPUNIT, PAGE_LABELS, TOKENS, page_sequence, resolve_profile, table_column_widths, table_row_heights  # noqa: E402
COVER_CI_BOX_MM = (30, 30)  # 정사각형 제한 박스
COVER_SLOGAN_BOX_MM = (150, 40)  # 본문 폭 기준 와이드 배너
BODY_TITLE_FRAME_TABLE_ID = '2063551812'
STRUCTURED_HEADING_PATTERNS = (
    ('task-subsection', re.compile(r'^\s*(\[?과제\s*\d+\s*-\s*\d+\]?[.]?)\s*(.+)$')),
    ('task-section', re.compile(r'^\s*(\[?과제\s*\d+\]?[.]?)\s*(.+)$')),
    ('roman-chapter', re.compile(r'^\s*([ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]+)\.\s*(.+)$')),
    ('roman-chapter', re.compile(r'^\s*(\d+\.)\s*(?!\d)(.+)$')),
)
# 번호로 시작하는 일반 본문 문장이 장 제목으로 오인되는 것을 막는 상한(공백 제외).
# 없으면 "1. 조판 측정기 교정을 위한 본문 문단으로…"가 목차 항목이 되고,
# populate-toc-pages.cjs가 그 문장의 쪽을 찾지 못해 **빌드 전체가 실패**한다
# (fixture sweep-w08에서 실제로 재현됨).
# 20자 근거: 실측 최장 제목이 "학교급별·운영형태별 프로그램군"(15자)이라 여유 5자.
# 이보다 긴 제목은 구조 제목 표와 목차 양쪽에서 조용히 빠지므로, 실제 문서에서
# 20자 초과 장 제목이 나오면 상한을 올릴 것.
NUMERIC_HEADING_MAX_TITLE_CHARS = 20


def plausible_heading_title(title):
    """번호/문자 접두어 뒤 본문이 실제 제목처럼 짧은지 판정한다(공백 제외 길이 기준)."""
    stripped = re.sub(r'\s+', '', str(title or ''))
    return 0 < len(stripped) <= NUMERIC_HEADING_MAX_TITLE_CHARS

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
        # 실측 ID 맵: 132=함초롬바탕 13pt 본문, 364=동일 계열 굵게,
        # 82/83=표 머리글/본문 맑은고딕 11pt, 34=양쪽정렬 170%,
        # 64=표 머리글 가운데정렬 120%.
        'valid_charpr': {
            '9', '11', '15', '18', '19', '27', '31', '82', '83', '114', '121',
            '132', '204', '277', '307', '315', '338', '364', '414', '417', '512',
        },
        'bold_map': {'9': '19', '121': '364', '132': '364'},
        'heading': {1: ('9', '1'), 2: ('132', '73')},
        'heading_default': ('132', '73'),
        'korean_subheading': ('132', '240'),
        # 목차 항목: 실물 양식 판정(2026-08-07)에 따라 표가 아닌 문단형으로 낸다.
        # 27=18pt 굵은 제목 계열, 241=목차 전용 문단(왼쪽·여백·200% — presentation_header가 주입).
        'toc_entry': ('27', '241'),
        'body': ('132', '238'),
        'list_parapr': '239',
        'group_leader_parapr': '242',
        'cell_parapr': {'header': '64', 'body': '238'},
        'cell_charpr': {'header': '82', 'body': '83'},
        'table_anchor_parapr': '1',
        # bf4·bf13·bf17 모두 4면 실선. 표 셀에는 bf13 사용(레퍼런스 표 셀 계열)
        'cell_borderfill': {'header': '13', 'body': '13'},
        'table_borderfill': '13',
        'structured_heading': {
            'roman-chapter': {
                'label_charpr': '31',
                'title_charpr': '27',
                'label_borderfill': '12',
                'title_borderfill': '52',
                'label_width': 4200,
                'height': 1900,
            },
            'task-section': {
                'label_charpr': '114',
                'title_charpr': '19',
                'label_borderfill': '10',
                'title_borderfill': '52',
                'label_width': 7200,
                'height': 1600,
            },
            'task-subsection': {
                'label_charpr': '414',
                'title_charpr': '315',
                'label_borderfill': '14',
                'title_borderfill': '52',
                'label_width': 9000,
                'height': 1450,
            },
        },
    },
}
BOLD_PATTERN = re.compile(r'\*\*(.+?)\*\*')


def resolve_layout_profile(metadata):
    """미리보기(previewProjection)와 같은 규칙으로 layoutProfile을 고른다."""
    profile_id = (
        (metadata.get('layout') or {}).get('profile')
        or ('worldschool-2026' if metadata.get('documentKind') == 'school-guidance-basic-plan' else None)
    )
    return (TOKENS.get('layoutProfiles') or {}).get(profile_id or '') or {}


def style_for_model(template, model):
    base = STYLE_SETS[template]
    style = {
        **base,
        'valid_charpr': set(base['valid_charpr']),
        'bold_map': dict(base['bold_map']),
        'heading': dict(base['heading']),
    }
    profile = resolve_layout_profile(model.get('metadata', {}))
    if template == 'boncheong' and profile.get('bodySizePt') == 13:
        style['body'] = ('132', '238')
        style['list_parapr'] = '239'
    return style


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


def repack_mimetype_first(hwpx_path):
    """ZIP 수정 후 mimetype을 첫 번째 무압축 엔트리로 복구한다."""
    source_path = Path(hwpx_path)
    with zipfile.ZipFile(source_path, 'r') as source_archive:
        entries = [
            (info, source_archive.read(info.filename))
            for info in source_archive.infolist()
            if info.filename != 'mimetype'
        ]
        mimetype = source_archive.read('mimetype')
    with tempfile.NamedTemporaryFile(
        delete=False,
        suffix='.hwpx',
        dir=source_path.parent,
    ) as temp_handle:
        temp_path = Path(temp_handle.name)
    try:
        with zipfile.ZipFile(temp_path, 'w') as target_archive:
            target_archive.writestr('mimetype', mimetype, compress_type=zipfile.ZIP_STORED)
            for info, data in entries:
                target_archive.writestr(info, data, compress_type=info.compress_type)
        temp_path.replace(source_path)
    finally:
        temp_path.unlink(missing_ok=True)


def blank_para():
    return (
        f'<hp:p id="{next_id()}" paraPrIDRef="0" styleIDRef="0" '
        f'pageBreak="0" columnBreak="0" merged="0"><hp:run charPrIDRef="0"><hp:t/></hp:run></hp:p>'
    )


def page_boundary_para(*, page_break=False, hide_page_number=False, restart_page_number=None):
    controls = []
    if hide_page_number:
        controls.append(
            '<hp:ctrl><hp:pageHiding hideHeader="0" hideFooter="0" '
            'hideMasterPage="0" hideBorder="0" hideFill="0" hidePageNum="1"/></hp:ctrl>'
        )
    if restart_page_number is not None:
        controls.append(
            f'<hp:ctrl><hp:newNum num="{int(restart_page_number)}" numType="PAGE"/></hp:ctrl>'
        )
    return (
        f'<hp:p id="{next_id()}" paraPrIDRef="0" styleIDRef="0" '
        f'pageBreak="{"1" if page_break else "0"}" columnBreak="0" merged="0">'
        + '<hp:run charPrIDRef="0">'
        + ''.join(controls)
        + '<hp:t/></hp:run></hp:p>'
    )


def page_break_para():
    return page_boundary_para(page_break=True)


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
    cover_title = cover.get('title') or metadata.get('title') or first_heading
    cover_title = re.sub(r'\.(md|txt|hwpx?|iceplan)$', '', str(cover_title), flags=re.I).strip()
    replacements = {
        '기본 방향 문구를 입력하세요': cover.get('direction') or '',
        '2026 ○○○○ 기본 계획': cover_title,
        '2026. 7. ': cover.get('date') or '2026. 7.',
        '인천광역시교육청 ○○과 ': cover.get('displayName') or '인천광역시교육청',
    }
    anchor_xml = BONCHEONG_ANCHOR.read_text(encoding='utf-8')
    for placeholder, value in replacements.items():
        anchor_xml = anchor_xml.replace(placeholder, xml_escape(str(value)))
    title = replacements['2026 ○○○○ 기본 계획']
    parts = [anchor_xml]
    direction = (cover.get('direction') or '').strip()
    if not direction:
        parts[0], removed = re.subn(
            r'<hp:p [^>]*paraPrIDRef="23"[^>]*><hp:run charPrIDRef="18"><hp:t></hp:t></hp:run>'
            r'<hp:linesegarray>.*?</hp:linesegarray></hp:p>',
            '', parts[0], count=1, flags=re.S,
        )
        if removed != 1:
            raise RuntimeError('Could not remove the empty direction paragraph from cover title cell')
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
    trailing_slot = '<hp:p id="0" paraPrIDRef="25" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0"><hp:run charPrIDRef="15"/>'
    if profile.name_image:
        # 본청: 기관명 텍스트 문단 → 명칭 이미지 (영문명은 이미지에 포함)
        display_name = xml_escape(str(cover.get('displayName') or '인천광역시교육청'))
        name_para_prefix = (
            '<hp:p id="2147483648" paraPrIDRef="25" styleIDRef="0" pageBreak="0" '
            'columnBreak="0" merged="0"><hp:run charPrIDRef="15"><hp:t>'
            + display_name + '</hp:t></hp:run>')
        start = parts[0].find(name_para_prefix)
        if start < 0:
            raise RuntimeError('Could not find the cover agency-name text paragraph for image replacement')
        end = parts[0].find('</hp:p>', start + len(name_para_prefix))
        if end < 0:
            raise RuntimeError('Could not find closing tag of cover agency-name paragraph')
        parts[0] = parts[0][:start] + NAME_IMAGE_PARAGRAPH + parts[0][end + 7:]
    else:
        # 직속기관: 영문 기관명을 trailing slot에 채움
        english_name = cover['englishName'] if 'englishName' in cover else profile.english_name
        if english_name:
            if trailing_slot not in parts[0]:
                raise RuntimeError('Could not find the cover english-name anchor slot')
            filled_slot = ('<hp:p id="0" paraPrIDRef="25" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">'
                           f'<hp:run charPrIDRef="15"><hp:t>{xml_escape(str(english_name))}</hp:t></hp:run>')
            parts[0] = parts[0].replace(trailing_slot, filled_slot, 1)
    return parts


def page_placeholder_blocks(page_type):
    """Content generation 없이도 각 페이지 유형의 조판 구조를 검증할 최소 블록."""
    if page_type == 'preflight':
        return [{'type': 'table', 'header': ['점검 항목', '검토완료', '해당없음'], 'rows': [['형식 점검', '□', '□'], ['내용 확인', '□', '□']]}]
    if page_type == 'schedule':
        return [{'type': 'table', 'header': ['구분', '내용'], 'rows': [['일정', '입력 대기']]}]
    if page_type in ('inner-cover', 'toc', 'summary'):
        return []
    label = {'task': '세부과제 내용 입력', 'appendix': '부록·붙임 내용 입력'}.get(page_type)
    return [{'type': 'paragraph', 'text': label}] if label else []


def block_plain_text(block):
    if block.get('type') != 'table':
        return str(block.get('text') or '').strip()
    cells = list(block.get('header') or [])
    cells.extend(cell for row in (block.get('rows') or []) for cell in row)
    return ' '.join(str(cell or '').strip() for cell in cells if str(cell or '').strip())


def body_source_blocks(model):
    """목차·요약 파생이 공유하는 본문 페이지 블록 수집(페이지 blocks 없으면 model.blocks 폴백)."""
    candidates = []
    for page in page_sequence(model.get('metadata', {}), resolve_profile(model.get('metadata', {}))):
        if page.get('type') not in {'body', 'body-opening', 'body-continuation'}:
            continue
        blocks = page.get('blocks') if 'blocks' in page else model.get('blocks', [])
        candidates.extend(blocks or [])
    return candidates


def toc_entries(model):
    """본문의 장 제목에서 실제 목차 행과 쪽 번호 치환표를 만든다."""
    candidates = body_source_blocks(model)
    entries = []
    seen = set()
    for block in candidates:
        text = block_plain_text(block)
        match = re.match(r'^\s*((?:[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]+|\d+)\.)\s*(.+?)\s*$', text)
        if not match or not plausible_heading_title(match.group(2)):
            continue
        normalized = f'{match.group(1)} {match.group(2).strip()}'
        if normalized in seen:
            continue
        seen.add(normalized)
        index = len(entries)
        entries.append({
            'text': normalized,
            'lookup': match.group(2).strip(),
            'placeholder': chr(0xE000 + index),
        })
    return entries


# 요약 발췌 상한(문자). LLM식 재작성 없이 원문 발췌만 쓰되, 요약 페이지 한 칸이
# 본문 문단 전체를 삼켜 쪽을 넘기지 않도록 자른다. 수준 변경(전문 발췌 등)은
# summary_rows만 고치면 되고, previewProjection.js와 값·알고리즘이 같아야
# 빠른 미리보기와 HWPX 출력이 어긋나지 않는다.
SUMMARY_EXCERPT_MAX_CHARS = 120
SUMMARY_ELEMENT_KEYWORDS = (
    ('추진 근거', re.compile(r'근거|배경')),
    ('추진 목적', re.compile(r'목적|목표')),
    ('기대 효과', re.compile(r'기대\s*효과')),
)


def summary_join(items):
    joined = ''
    for item in items:
        candidate = item if not joined else f'{joined} / {item}'
        if len(candidate) <= SUMMARY_EXCERPT_MAX_CHARS:
            joined = candidate
            continue
        if not joined:
            joined = item[:SUMMARY_EXCERPT_MAX_CHARS - 1] + '…'
        break
    return joined


def summary_excerpt_text(block):
    if block.get('type') not in {'paragraph', 'listItem'}:
        return ''
    text = re.sub(r'\*\*(.+?)\*\*', r'\1', str(block.get('text') or '')).strip()
    if re.fullmatch(r'-{3,}', text):
        return ''
    return text


def summary_rows(model):
    """요약 페이지 4요소(근거·목적·과제·기대효과) 파생 — 실물 양식 판정(2026-08-07).

    과제는 과제 제목 목록(그 자체가 요약), 나머지는 키워드가 일치하는 첫 장의
    본문 발췌. 요소를 찾지 못하면 빈 칸으로 남겨 수기 입력 여지를 유지한다.
    """
    blocks = body_source_blocks(model)
    chapters = []
    tasks = []
    seen_tasks = set()
    for index, block in enumerate(blocks):
        parts = structured_heading_parts(block_plain_text(block))
        if not parts:
            continue
        if parts['kind'] == 'roman-chapter':
            chapters.append({'title': parts['title'], 'index': index})
        elif parts['kind'] == 'task-section':
            entry = f"{parts['label']} {parts['title']}"
            if entry not in seen_tasks:
                seen_tasks.add(entry)
                tasks.append(entry)

    def excerpt_for(pattern):
        for position, chapter in enumerate(chapters):
            if not pattern.search(chapter['title']):
                continue
            end = chapters[position + 1]['index'] if position + 1 < len(chapters) else len(blocks)
            items = [text for text in (summary_excerpt_text(block) for block in blocks[chapter['index'] + 1:end]) if text]
            return summary_join(items)
        return ''

    contents = {label: excerpt_for(pattern) for label, pattern in SUMMARY_ELEMENT_KEYWORDS}
    return [
        ['추진 근거', contents['추진 근거']],
        ['추진 목적', contents['추진 목적']],
        ['추진 과제', summary_join(tasks)],
        ['기대 효과', contents['기대 효과']],
    ]


def front_matter_frame_block(page_type, model=None):
    """목차는 본문 장 제목으로, 요약은 본문 4요소 파생 표로 채운다."""
    if page_type == 'toc':
        entries = toc_entries(model or {})
        return {
            'type': 'table',
            'header': ['구성 항목', '쪽'],
            'rows': [[entry['text'], entry['placeholder']] for entry in entries],
        }
    return {
        'type': 'table',
        'header': ['구분', '내용'],
        'rows': summary_rows(model or {}),
    }


def toc_leader_dots(entry_text):
    """항목과 쪽 번호 사이 가운뎃점(문자표 ·) 개수를 제목 폭에 맞춰 계산한다.

    실물 양식 확인(2026-08-07): 목차의 정격은 표가 아니라 문단형이고, 점선은
    오른쪽 탭 리더가 아닌 문자 점으로 넣는다 — 탭 리더는 kordoc 실조판
    미리보기가 그리지 못해 미리보기와 실물이 어긋난다(스파이크 실증).
    폭 계산은 전각(한글·로마숫자)=2, 반각=1 근사이며, 점을 전각으로 보수
    계산해 줄바꿈 넘침을 막는다 — 쪽 번호 세로 정렬은 근사 수준이 한계.
    """
    half_units = sum(2 if ord(ch) > 0x2E80 or ord(ch) in range(0x2160, 0x2180) else 1
                     for ch in str(entry_text))
    # 18pt 기준 본문폭 약 26전각(52반각) — 좌측 여백·쪽번호 몫을 빼고 40을 목표로 잡는다.
    return max(4, (40 - half_units - 4) // 2)


def toc_paragraphs(model, style):
    """본문 장 제목 기반 문단형 목차 — `제목 ····· {placeholder}` 줄들."""
    charpr, parapr = style['toc_entry']
    lines = []
    for entry in toc_entries(model):
        dots = '·' * toc_leader_dots(entry['text'])
        lines.append(text_para(f"{entry['text']} {dots} {entry['placeholder']}", charpr, parapr, style))
    return lines


def toc_blocks_effectively_empty(blocks):
    if not blocks:
        return True
    meaningful = []
    for block in blocks:
        if block.get('type') != 'table':
            text = str(block.get('text') or '').strip()
            if text and not re.fullmatch(r'목\s*차', text):
                meaningful.append(text)
            continue
        cells = list(block.get('header') or [])
        cells.extend(cell for row in (block.get('rows') or []) for cell in row)
        values = [str(cell or '').strip() for cell in cells if str(cell or '').strip()]
        meaningful.extend(value for value in values if value not in {'구성 항목', '쪽'})
    return not meaningful


def body_title_frame(title, style):
    """표지와 같은 색띠 구조를 축소한 본문 첫 쪽 3행×4열 제목 틀."""
    anchor = BONCHEONG_ANCHOR.read_text(encoding='utf-8')
    match = re.search(
        r'<hp:tbl id="2063551796".*?</hp:tbl>',
        anchor,
        flags=re.S,
    )
    if not match:
        raise RuntimeError('본청 표지 앵커에서 본문 제목 표를 찾지 못했습니다.')
    table = match.group(0)
    table = table.replace('id="2063551796"', f'id="{BODY_TITLE_FRAME_TABLE_ID}"', 1)
    table = re.sub(
        r'<hp:p\b[^>]*>\s*<hp:run charPrIDRef="18"><hp:t>기본 방향 문구를 입력하세요'
        r'</hp:t></hp:run>.*?</hp:p>',
        '',
        table,
        count=1,
        flags=re.S,
    )
    table = table.replace('2026 ○○○○ 기본 계획', xml_escape(title), 1)
    table = table.replace('charPrIDRef="512"', 'charPrIDRef="11"', 1)
    table = re.sub(r'<hp:linesegarray>.*?</hp:linesegarray>', '', table, flags=re.S)
    table = re.sub(r'(<hp:p id=")[^"]+(")', lambda m: f'{m.group(1)}{next_id()}{m.group(2)}', table)
    table = re.sub(r'<hp:outMargin\b[^>]*/>', '<hp:outMargin left="0" right="0" top="0" bottom="300"/>',
                   table, count=1)
    return (
        f'<hp:p id="{next_id()}" paraPrIDRef="{style["table_anchor_parapr"]}" styleIDRef="0" '
        'pageBreak="0" columnBreak="0" merged="0">'
        f'<hp:run charPrIDRef="11">{table}</hp:run></hp:p>'
    )


def structured_heading_parts(text):
    for kind, pattern in STRUCTURED_HEADING_PATTERNS:
        match = pattern.match(str(text or ''))
        if match and plausible_heading_title(match.group(2)):
            return {'kind': kind, 'label': match.group(1), 'title': match.group(2).strip()}
    return None


def structured_heading_table(text, style):
    parts = structured_heading_parts(text)
    config = (style.get('structured_heading') or {}).get(parts['kind'] if parts else '')
    if not parts or not config:
        return None
    width = style.get('body_width', BODY_WIDTH_HWPUNIT)
    label_width = min(config['label_width'], width - 1)
    title_width = width - label_width
    height = config['height']
    table_id = next_id()
    label_cell_id = next_id()
    label_para_id = next_id()
    title_cell_id = next_id()
    title_para_id = next_id()
    return (
        f'<hp:p id="{next_id()}" paraPrIDRef="{style["table_anchor_parapr"]}" styleIDRef="0" '
        'pageBreak="0" columnBreak="0" merged="0">'
        f'<hp:run charPrIDRef="{config["title_charpr"]}"><hp:tbl id="{table_id}" zOrder="0" '
        'numberingType="TABLE" textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" lock="0" '
        'dropcapstyle="None" pageBreak="CELL" repeatHeader="0" rowCnt="1" colCnt="2" '
        'cellSpacing="0" borderFillIDRef="52" noAdjust="0">'
        f'<hp:sz width="{width}" widthRelTo="ABSOLUTE" height="{height}" heightRelTo="ABSOLUTE" protect="0"/>'
        '<hp:pos treatAsChar="1" affectLSpacing="0" flowWithText="1" allowOverlap="0" '
        'holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="COLUMN" vertAlign="TOP" '
        'horzAlign="LEFT" vertOffset="0" horzOffset="0"/>'
        '<hp:outMargin left="0" right="0" top="0" bottom="300"/>'
        '<hp:inMargin left="0" right="0" top="0" bottom="0"/>'
        '<hp:tr>'
        f'<hp:tc name="" header="0" hasMargin="0" protect="0" editable="0" dirty="0" '
        f'borderFillIDRef="{config["label_borderfill"]}">'
        '<hp:cellAddr colAddr="0" rowAddr="0"/><hp:cellSpan colSpan="1" rowSpan="1"/>'
        f'<hp:cellSz width="{label_width}" height="{height}"/>'
        '<hp:cellMargin left="141" right="141" top="141" bottom="141"/>'
        f'<hp:subList id="{label_cell_id}" textDirection="HORIZONTAL" lineWrap="BREAK" '
        f'vertAlign="CENTER" linkListIDRef="0" linkListNextIDRef="0" textWidth="{max(label_width - 282, 1)}" fieldName="">'
        f'<hp:p id="{label_para_id}" paraPrIDRef="23" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">'
        f'{runs_xml(parts["label"], config["label_charpr"], style)}</hp:p></hp:subList></hp:tc>'
        f'<hp:tc name="" header="0" hasMargin="0" protect="0" editable="0" dirty="0" '
        f'borderFillIDRef="{config["title_borderfill"]}">'
        '<hp:cellAddr colAddr="1" rowAddr="0"/><hp:cellSpan colSpan="1" rowSpan="1"/>'
        f'<hp:cellSz width="{title_width}" height="{height}"/>'
        '<hp:cellMargin left="566" right="283" top="141" bottom="141"/>'
        f'<hp:subList id="{title_cell_id}" textDirection="HORIZONTAL" lineWrap="BREAK" '
        f'vertAlign="CENTER" linkListIDRef="0" linkListNextIDRef="0" textWidth="{max(title_width - 849, 1)}" fieldName="">'
        f'<hp:p id="{title_para_id}" paraPrIDRef="1" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">'
        f'{runs_xml(parts["title"], config["title_charpr"], style)}</hp:p></hp:subList></hp:tc>'
        '</hp:tr></hp:tbl></hp:run></hp:p>'
    )


def page_type_paragraphs(
    page,
    model,
    profile,
    styles,
    style,
    starts_new_page=True,
    hide_page_number=False,
    restart_page_number=None,
):
    """Render one of the nine layout page types; policy content remains caller-owned."""
    page_type = page['type']
    metadata = model.get('metadata', {})
    if page_type == 'cover':
        return boncheong_cover_paragraphs(model, profile)
    if page_type in ('body', 'body-opening', 'body-continuation'):
        document_title = metadata.get('cover', {}).get('title') or metadata.get('title') or '추진 계획'
        document_title = re.sub(r'\.(md|txt|hwpx?|iceplan)$', '', str(document_title), flags=re.I).strip()
        parts = [
            page_boundary_para(
                page_break=True,
                hide_page_number=hide_page_number,
                restart_page_number=restart_page_number,
            )
        ] if starts_new_page else []
        if page_type == 'body-opening':
            parts.append(body_title_frame(document_title, style))
            covered = metadata.get('cover') or {}
            organization = metadata.get('organization') or {}
            display_name = organization.get('displayName') or covered.get('displayName') or ''
            department = organization.get('department') or covered.get('department') or ''
            department_line = ' '.join(
                str(value).strip()
                for value in (display_name, department)
                if str(value).strip()
            )
            if department_line:
                # 기관명·부서명 크기는 미리보기(--opening-department-size)와 같은
                # layoutProfile 값을 따라야 한다. 121=12pt, 132=13pt.
                department_charpr = '132' if resolve_layout_profile(metadata).get(
                    'openingDepartmentSizePt') == 13 else '121'
                parts.append(text_para(department_line, department_charpr, '22', style))
        if page_type == 'body-continuation':
            page_blocks = page.get('blocks') or []
        else:
            page_blocks = page['blocks'] if 'blocks' in page else model.get('blocks', [])
        if page_type == 'body-opening':
            def is_duplicate_title(block):
                text = re.sub(
                    r'\.(md|txt|hwpx?|iceplan)$',
                    '',
                    str(block.get('text') or ''),
                    flags=re.I,
                ).strip()
                if text == document_title:
                    return True
                if block.get('type') != 'table':
                    return False
                cells = list(block.get('header') or [])
                cells.extend(cell for row in (block.get('rows') or []) for cell in row)
                return ''.join(str(cell or '').strip() for cell in cells if str(cell or '').strip()) == document_title
            page_blocks = [block for block in page_blocks if not is_duplicate_title(block)]
        parts.extend(render_blocks(page_blocks, styles, style))
        return parts
    title = page.get('title') or PAGE_LABELS[page_type]
    parts = [
        page_boundary_para(
            page_break=True,
            hide_page_number=hide_page_number,
            restart_page_number=restart_page_number,
        )
    ] if starts_new_page else []
    if page_type == 'inner-cover':
        parts.append(text_para(metadata.get('title') or title, '9', '1', style))
        covered = metadata.get('cover') or {}
        parts.append(text_para(covered.get('displayName') or '인천광역시교육청', '121', '73', style))
    elif page_type in ('toc', 'summary'):
        parts.append(text_para('목 차' if page_type == 'toc' else title, '27', '23', style))
    else:
        parts.append(text_para(title, '9', '1', style))
    page_blocks = page.get('blocks') or page_placeholder_blocks(page_type)
    if page_type == 'toc':
        # 원문 목차 블록이 있어도 최종 HWPX에서는 본문 제목과 실제 조판 쪽을
        # 기준으로 만든 목차 표를 사용한다. 원문 목차를 평문으로 다시 쓰면
        # 예전 쪽 번호가 남고, populate-toc-pages.cjs가 치환할 placeholder도
        # 생성되지 않는다. 본문 제목을 찾지 못한 경우에만 원문을 보존한다.
        generated_entries = toc_entries(model)
        if generated_entries and style.get('toc_entry'):
            # 실물 양식 판정(2026-08-07): 목차는 표가 아닌 문단형이 정격.
            parts.extend(toc_paragraphs(model, style))
        elif generated_entries or toc_blocks_effectively_empty(page_blocks):
            # 문단형 스타일이 없는 템플릿(gonmun)은 종전 표 형태를 유지한다.
            parts.append(table_paragraph(front_matter_frame_block(page_type, model), styles, style))
        else:
            parts.extend(render_blocks(page_blocks, styles, style))
    elif page_type == 'summary' and not page_blocks:
        parts.append(table_paragraph(front_matter_frame_block(page_type, model), styles, style))
    else:
        parts.extend(render_blocks(page_blocks, styles, style))
    return parts


def table_xml(block, styles, style=None):
    style = style or STYLE_SETS['gonmun']
    header = block.get('header', [])
    rows = [header] + block.get('rows', [])
    columns = max((len(row) for row in rows), default=1)
    source_table = (block.get('layout') or {}).get('table') or {}
    source_widths = source_table.get('columnWidthsHwpUnit') or []
    if len(source_widths) == columns and all(int(width or 0) > 0 for width in source_widths):
        widths = [int(width) for width in source_widths]
        total_width = int(source_table.get('widthHwpUnit') or sum(widths))
        if total_width > style.get('body_width', BODY_WIDTH_HWPUNIT):
            target_width = style.get('body_width', BODY_WIDTH_HWPUNIT)
            factor = target_width / max(sum(widths), 1)
            widths = [max(1, round(width * factor)) for width in widths]
            widths[-1] += target_width - sum(widths)
            total_width = target_width
    else:
        total_width = style.get('body_width', BODY_WIDTH_HWPUNIT)
        widths = table_column_widths(rows, total_width=total_width)
    source_heights = source_table.get('rowHeightsHwpUnit') or []
    row_heights = ([int(height) for height in source_heights]
                   if len(source_heights) == len(rows) and all(int(height or 0) > 0 for height in source_heights)
                   else table_row_heights(rows, widths))
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
            cell_parapr = style['cell_parapr']
            if isinstance(cell_parapr, dict):
                cell_parapr = cell_parapr['header' if row_index == 0 else 'body']
            header_flag = '1' if row_index == 0 else '0'
            cells.append(
                f'<hp:tc name="" header="{header_flag}" hasMargin="0" protect="0" editable="0" dirty="0" borderFillIDRef="{cell_border}">'
                f'<hp:cellAddr colAddr="{col_index}" rowAddr="{row_index}"/>'
                '<hp:cellSpan colSpan="1" rowSpan="1"/>'
                f'<hp:cellSz width="{widths[col_index]}" height="{row_heights[row_index]}"/>'
                '<hp:cellMargin left="283" right="283" top="141" bottom="141"/>'
                f'<hp:subList id="{cell_id}" textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="CENTER" '
                f'linkListIDRef="0" linkListNextIDRef="0" textWidth="{max(widths[col_index] - 566, 1)}" fieldName="">'
                f'<hp:p id="{para_id}" paraPrIDRef="{cell_parapr}" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">'
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
        '<hp:outMargin left="0" right="0" top="0" bottom="300"/><hp:inMargin left="0" right="0" top="0" bottom="0"/>'
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
        if re.fullmatch(r'\s*-{3,}\s*', str(text or '')):
            continue
        if block['type'] == 'heading':
            framed_heading = structured_heading_table(text, style)
            if framed_heading:
                paragraphs.append(framed_heading)
                continue
        if block['type'] == 'listItem':
            # Plan IR이 담은 실제 기호(□·○·가.·1. 등)를 우선 사용한다.
            # 과거엔 marker를 버리고 '- '/'1. '를 하드코딩해, React 빠른 미리보기(marker
            # 사용)와 실조판·한글 출력이 어긋났다. React(PlanPreview.jsx)와 동일 규칙:
            # marker가 있으면 그대로, 없으면 ordered 여부로 기본값.
            marker = block.get('marker') or ('1.' if block.get('ordered') else '-')
            text = f'{marker} {text}'
        if not text:
            continue
        if block['type'] == 'heading':
            if block.get('headingKind') == 'korean-subheading':
                charpr, parapr = style.get('korean_subheading', style['heading_default'])
            else:
                charpr, parapr = style['heading'].get(block.get('level', 1), style['heading_default'])
        elif block['type'] == 'listItem' and block.get('ordered') and int(block.get('level') or 0) == 0:
            charpr, parapr = style['heading'].get(1, style['heading_default'])
        elif block['type'] == 'listItem' and not block.get('ordered') and int(block.get('level') or 0) == 0 and 'group_leader_parapr' in style:
            charpr, parapr = style['body'][0], style['group_leader_parapr']
        elif block['type'] == 'listItem':
            charpr, parapr = style['body'][0], style['list_parapr']
        else:
            charpr, parapr = style['body']
        paragraphs.append(text_para(text, charpr, parapr, style))
    return paragraphs


def presentation_header(template, line_spacing_percent=None, para_next_hwpunit=0):
    """9단계 적응 조판 — 본문 paraPr의 줄간격·문단 아래 간격만 바꾼 header.xml을 만든다.

    이미 만든 HWPX를 후처리로 변조하지 않고 **매 pass 재생성**하는 경로다(멱등).
    간격 조정은 본문 계열 paraPr 하나에만 적용한다. boncheong의 paraPr 73은
    본문·목록·중제목이 공유하지만 표지 앵커(cover-anchor.xml)는 쓰지 않는 것을
    확인했으므로(paraPr 1·22·23·25·26만 사용) 표지 조판에 영향이 없다.

    gonmun은 대상이 아니다 — 본문 paraPr 0·14를 표지·표 문단도 함께 쓰기 때문에
    같은 방식으로 조이면 표까지 눌린다.
    """
    source = TEMPLATE_HEADERS[template].read_text(encoding='utf-8')
    if template == 'boncheong':
        cover_charpr = re.search(r'<hh:charPr id="512".*?</hh:charPr>', source, flags=re.S)
        if not cover_charpr:
            raise RuntimeError('header.xml에서 표지 제목 charPr 512를 찾지 못했습니다.')
        patched_cover = cover_charpr.group(0).replace(
            '<hh:fontRef hangul="9" latin="9" hanja="9" japanese="9" other="9" symbol="9" user="9"/>',
            '<hh:fontRef hangul="10" latin="10" hanja="10" japanese="10" other="10" symbol="10" user="10"/>',
            1,
        )
        source = source.replace(cover_charpr.group(0), patched_cover, 1)
        para_properties = re.search(
            r'(<hh:paraProperties itemCnt=")(\d+)(".*?>)(.*?)(</hh:paraProperties>)',
            source,
            flags=re.S,
        )
        if not para_properties:
            raise RuntimeError('header.xml에서 paraProperties를 찾지 못했습니다.')
        custom_ids = {'238', '239', '240', '241', '242'}
        if any(re.search(rf'<hh:paraPr id="{para_id}"\b', para_properties.group(4)) for para_id in custom_ids):
            raise RuntimeError('사용자 정의 문단 속성 ID 238~242가 이미 사용 중입니다.')

        def custom_para_pr(para_id, *, align, left, intent, prev, next_value, line_spacing, keep_with_next):
            margin = (
                f'<hh:margin><hc:intent value="{intent}" unit="HWPUNIT"/>'
                f'<hc:left value="{left}" unit="HWPUNIT"/><hc:right value="0" unit="HWPUNIT"/>'
                f'<hc:prev value="{prev}" unit="HWPUNIT"/><hc:next value="{next_value}" unit="HWPUNIT"/>'
                '</hh:margin>'
            )
            return (
                f'<hh:paraPr id="{para_id}" tabPrIDRef="0" condense="0" fontLineHeight="0" '
                'snapToGrid="0" suppressLineNumbers="0" checked="0">'
                f'<hh:align horizontal="{align}" vertical="BASELINE"/>'
                '<hh:heading type="NONE" idRef="0" level="0"/>'
                f'<hh:breakSetting breakLatinWord="KEEP_WORD" breakNonLatinWord="KEEP_WORD" '
                f'widowOrphan="0" keepWithNext="{keep_with_next}" keepLines="0" '
                'pageBreakBefore="0" lineWrap="BREAK"/>'
                '<hh:autoSpacing eAsianEng="0" eAsianNum="0"/>'
                '<hp:switch><hp:case hp:required-namespace="http://www.hancom.co.kr/hwpml/2016/HwpUnitChar">'
                f'{margin}<hh:lineSpacing type="PERCENT" value="{line_spacing}" unit="HWPUNIT"/>'
                f'</hp:case><hp:default>{margin}<hh:lineSpacing type="PERCENT" '
                f'value="{line_spacing}" unit="HWPUNIT"/></hp:default></hp:switch>'
                '<hh:border borderFillIDRef="2" offsetLeft="0" offsetRight="0" '
                'offsetTop="0" offsetBottom="0" connect="0" ignoreMargin="0"/>'
                '</hh:paraPr>'
            )

        additions = ''.join([
            custom_para_pr(
                '238', align='JUSTIFY', left=0, intent=0, prev=0,
                next_value=0, line_spacing=170, keep_with_next=0,
            ),
            custom_para_pr(
                '239', align='JUSTIFY', left=1600, intent=-1200, prev=0,
                next_value=0, line_spacing=170, keep_with_next=0,
            ),
            custom_para_pr(
                '240', align='LEFT', left=800, intent=-800, prev=1000,
                next_value=200, line_spacing=160, keep_with_next=1,
            ),
            # 241: 문단형 목차 항목 — 왼쪽 정렬 + 좌측 여백으로 점·쪽번호 세로열을
            # 맞추고, 샘플 실측(210%)에 준하는 넉넉한 줄간격을 준다.
            custom_para_pr(
                '241', align='LEFT', left=2400, intent=0, prev=400,
                next_value=0, line_spacing=200, keep_with_next=0,
            ),
            custom_para_pr(
                '242', align='JUSTIFY', left=1600, intent=-1200,
                prev=TOKENS['typography']['topicGroupLeader']['prevHwpUnit'],
                next_value=0, line_spacing=170, keep_with_next=0,
            ),
        ])
        patched_para_properties = (
            f'{para_properties.group(1)}{int(para_properties.group(2)) + 5}'
            f'{para_properties.group(3)}{para_properties.group(4)}{additions}{para_properties.group(5)}'
        )
        source = source.replace(para_properties.group(0), patched_para_properties, 1)
    if line_spacing_percent is not None:
        tokens = TOKENS['adaptiveSpacing']
        if template != tokens['template']:
            raise ValueError(f'적응 조판은 {tokens["template"]} 템플릿에서만 지원합니다 (요청: {template}).')
        # boncheong 실제 본문 문단은 STYLE_SETS['boncheong']['body']가 가리키는
        # paraPr 238을 쓴다(paraPr 34가 아니다 — 34는 미사용 유물). 238은 표 셀
        # 본문(cell_parapr.body)도 함께 참조하므로 조이기가 표 셀 줄간격에도
        # 적용된다(의도된 동작으로 확인됨).
        target_id = '238' if template == 'boncheong' else tokens['targetParaPrId']
        match = re.search(r'<hh:paraPr id="%s".*?</hh:paraPr>' % re.escape(target_id), source, flags=re.S)
        if not match:
            raise RuntimeError(f'header.xml에서 paraPr {target_id}을 찾지 못했습니다.')
        original = match.group(0)
        patched, spacing_hits = re.subn(r'(<hh:lineSpacing type="PERCENT" value=")\d+(")',
                                        lambda m: f'{m.group(1)}{line_spacing_percent}{m.group(2)}', original)
        patched, next_hits = re.subn(r'(<hc:next value=")-?\d+(")',
                                     lambda m: f'{m.group(1)}{para_next_hwpunit}{m.group(2)}', patched)
        if spacing_hits < 2 or next_hits < 2:
            raise RuntimeError(
                f'paraPr {target_id} 간격 치환 실패 (lineSpacing {spacing_hits}건, next {next_hits}건 — 각 2건 필요).')
        source = source.replace(original, patched, 1)
    handle = tempfile.NamedTemporaryFile('w', suffix='.header.xml', delete=False, encoding='utf-8')
    with handle:
        handle.write(source)
    return Path(handle.name)


def build(model_path, output, template='gonmun', line_spacing_percent=None, para_next_hwpunit=0):
    model = json.loads(Path(model_path).read_text(encoding='utf-8'))
    if template not in TEMPLATE_CHOICES:
        raise ValueError(f'Unsupported template: {template}')
    styles = model.get('styles', {})
    style = style_for_model(template, model)
    reset_id(1000)
    images = []
    if template == 'boncheong':
        profile = resolve_profile(model.get('metadata', {}))
        paragraphs = []
        pages = page_sequence(model.get('metadata', {}), profile)
        body_types = {'body', 'body-opening', 'body-continuation'}
        first_body_index = next(
            (index for index, page in enumerate(pages) if page['type'] in body_types),
            None,
        )
        for index, page in enumerate(pages):
            render_page = page
            # 일부 실제 모델은 첫 본문을 generic `body`로 표현한다. 이 경우에도
            # 출력의 첫 본문 쪽에는 본문 제목표·기관명/부서명 헤더가 필요하다.
            if index == first_body_index and page.get('type') == 'body':
                render_page = {**page, 'type': 'body-opening'}
            paragraphs.extend(page_type_paragraphs(
                render_page,
                model,
                profile,
                styles,
                style,
                starts_new_page=index > 0,
                hide_page_number=(
                    first_body_index is not None
                    and 0 < index < first_body_index
                ),
                restart_page_number=(
                    1 if first_body_index is not None and index == first_body_index else None
                ),
            ))
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
    header_path = (
        presentation_header(template, line_spacing_percent, para_next_hwpunit)
        if template == 'boncheong' or line_spacing_percent is not None
        else None
    )
    try:
        # metadata.title은 원본 파일명(예: "계획안.md")을 그대로 담고 있을 수 있어
        # 확장자를 제거한다 (내부 문서 속성에 ".md"가 그대로 노출되는 것 방지).
        raw_title = model.get('metadata', {}).get('title') or ''
        doc_title = re.sub(r'\.(md|txt|hwpx?|iceplan)$', '', raw_title, flags=re.I) or 'ICE Plan Studio 문서'
        build_args = [sys.executable, str(SCRIPTS / 'build_hwpx.py'), '--template', template,
                      '--section', str(section_path), '--title', doc_title, '--output', str(output)]
        if header_path is not None:
            build_args += ['--header', str(header_path)]
        subprocess.run(build_args, check=True)
        if images:
            add_images_to_hwpx(output, images)
            update_content_hpf(output, images)
        subprocess.run([sys.executable, str(SCRIPTS / 'fix_namespaces.py'), str(output)], check=True)
        subprocess.run([sys.executable, str(SCRIPTS / 'finalize_hwpx.py'), str(output), '--in-place', '--strip-linesegarray', '--layout'], check=True)
        entries = toc_entries(model) if template == 'boncheong' else []
        if entries:
            body_start_page = (first_body_index + 1) if first_body_index is not None else 1
            with tempfile.NamedTemporaryFile(
                'w', suffix='.toc.json', delete=False, encoding='utf-8'
            ) as toc_handle:
                json.dump(entries, toc_handle, ensure_ascii=False)
                toc_entries_path = Path(toc_handle.name)
            try:
                electron_exec = os.environ.get('ICE_PLAN_ELECTRON_EXEC')
                node_exec = shutil.which('node')
                if electron_exec:
                    command = [
                        electron_exec,
                        str(Path(__file__).resolve().parent / 'populate-toc-pages.cjs'),
                        str(output),
                        str(toc_entries_path),
                        str(body_start_page),
                    ]
                    node_env = dict(os.environ)
                    node_env['ELECTRON_RUN_AS_NODE'] = '1'
                elif node_exec:
                    command = [
                        node_exec,
                        str(Path(__file__).resolve().parent / 'populate-toc-pages.cjs'),
                        str(output),
                        str(toc_entries_path),
                        str(body_start_page),
                    ]
                    node_env = None
                else:
                    raise RuntimeError('목차 쪽 번호 계산에 필요한 Electron/Node 실행기를 찾지 못했습니다.')
                toc_result = subprocess.run(command, env=node_env, capture_output=True, text=True, encoding='utf-8')
                if toc_result.returncode != 0:
                    detail = '\n'.join(filter(None, [toc_result.stderr.strip(), toc_result.stdout.strip()]))
                    raise RuntimeError(
                        f'목차 쪽 번호 계산 스크립트 실패 (exit {toc_result.returncode}): {detail}'
                    )
                repack_mimetype_first(output)
            finally:
                toc_entries_path.unlink(missing_ok=True)
        subprocess.run([sys.executable, str(SCRIPTS / 'validate.py'), str(output)], check=True)
    finally:
        section_path.unlink(missing_ok=True)
        if header_path is not None:
            header_path.unlink(missing_ok=True)
        for image in images:
            Path(image['src_path']).unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description='Convert an ICE Plan model to HWPX')
    parser.add_argument('model_path')
    parser.add_argument('output')
    parser.add_argument('--template', choices=TEMPLATE_CHOICES, default='gonmun')
    parser.add_argument('--line-spacing', type=int, default=None,
                        help='본문 줄간격(%%). 지정 시 적응 조판 간격으로 재생성한다(boncheong 전용).')
    parser.add_argument('--para-next', type=int, default=0,
                        help='본문 문단 아래 간격(HWPUNIT). --line-spacing과 함께 쓴다.')
    args = parser.parse_args()
    build(args.model_path, args.output, args.template,
          line_spacing_percent=args.line_spacing, para_next_hwpunit=args.para_next)


if __name__ == '__main__':
    main()
