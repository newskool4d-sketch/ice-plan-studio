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
TEMPLATE_HEADERS = {name: TOOLKIT / "templates" / name / "Contents" / "header.xml"
                    for name in TEMPLATE_CHOICES}
sys.path.insert(0, str(SCRIPTS))
from hwpx_helpers import add_images_to_hwpx, make_image_para, next_id, reset_id, update_content_hpf, xml_escape  # noqa: E402
from image_dimensions import image_dims_hwpunit  # noqa: E402
from layout_engine import BODY_WIDTH_HWPUNIT, PAGE_LABELS, TOKENS, page_sequence, resolve_profile, table_column_widths, table_row_heights  # noqa: E402
COVER_CI_BOX_MM = (30, 30)  # 정사각형 제한 박스
COVER_SLOGAN_BOX_MM = (150, 40)  # 본문 폭 기준 와이드 배너
BODY_TITLE_FRAME_TABLE_ID = '2063551812'
STRUCTURED_HEADING_PATTERNS = (
    ('task-subsection', re.compile(r'^\s*(\[과제\s*\d+\s*-\s*\d+\])\s*(.+)$')),
    ('task-section', re.compile(r'^\s*(\[과제\s*\d+\])\s*(.+)$')),
    ('roman-chapter', re.compile(r'^\s*([ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]+)\.\s*(.+)$')),
)

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
        # 실측 ID 맵: 9=14pt 본문, 27=18pt 굵은 장제목,
        # 121=기본 12pt 본문(paraPr 73=개조식 내어쓰기).
        # 학교 배포용 기본계획(worldschool-2026)은 style_for_model에서 9를 본문으로 쓴다.
        # 307=표 머리글 맑은고딕 11pt(자간 -15%), 417=표 본문 맑은고딕 10pt,
        # 64=표 셀 문단(가운데 120%)
        'valid_charpr': {
            '9', '11', '15', '18', '19', '27', '31', '114', '121', '132',
            '204', '277', '307', '315', '338', '414', '417', '512',
        },
        'bold_map': {'9': '19', '121': '132'},
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


def style_for_model(template, model):
    base = STYLE_SETS[template]
    style = {
        **base,
        'valid_charpr': set(base['valid_charpr']),
        'bold_map': dict(base['bold_map']),
        'heading': dict(base['heading']),
    }
    metadata = model.get('metadata', {})
    profile_id = (
        (metadata.get('layout') or {}).get('profile')
        or ('worldschool-2026' if metadata.get('documentKind') == 'school-guidance-basic-plan' else None)
    )
    profile = (TOKENS.get('layoutProfiles') or {}).get(profile_id or '') or {}
    if template == 'boncheong' and profile.get('bodySizePt') == 14:
        style['body'] = ('9', '73')
        style['heading'][1] = ('27', '1')
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
    replacements = {
        '기본 방향 문구를 입력하세요': cover.get('direction') or '',
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
    # 영문 기관명은 기관 레지스트리 값(metadata.cover.englishName)을 우선한다.
    # 직속기관 다수가 같은 coverProfile(direct-g)을 공유하므로 프로필에 박힌
    # 영문명을 그대로 쓰면 전부 학생교육원 영문명으로 나온다. cover에 englishName
    # 키가 있으면(빈 값 포함) 그 값을 쓰고, 키 자체가 없을 때만 프로필 기본값으로
    # 폴백한다(단독 model_to_hwpx 호출 하위 호환).
    english_name = cover['englishName'] if 'englishName' in cover else profile.english_name
    if english_name:
        # 표지는 고정 레이아웃(결정사항 6)이므로 새 문단을 추가해 페이지 높이를
        # 늘리지 않는다 — 앵커에 이미 있는 빈 여분 문단(부서명 줄과 동일한
        # paraPr/charPr, 원본 문서의 미사용 여백 줄)을 재사용해 영문 기관명을 채운다.
        trailing_slot = '<hp:p id="0" paraPrIDRef="25" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0"><hp:run charPrIDRef="15"/>'
        filled_slot = ('<hp:p id="0" paraPrIDRef="25" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">'
                        f'<hp:run charPrIDRef="15"><hp:t>{xml_escape(str(english_name))}</hp:t></hp:run>')
        if trailing_slot not in parts[0]:
            raise RuntimeError('Could not find the cover english-name anchor slot')
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


def front_matter_frame_block(page_type):
    """내용을 대신 작성하지 않는 목차·요약용 빈 입력 틀."""
    if page_type == 'toc':
        return {
            'type': 'table',
            'header': ['구성 항목', '쪽'],
            'rows': [['', ''] for _ in range(8)],
        }
    return {
        'type': 'table',
        'header': ['구분', '내용'],
        'rows': [
            ['추진 배경', ''],
            ['주요 내용', ''],
            ['기대 효과', ''],
        ],
    }


def body_title_frame(title, style):
    """교육청 계획서 본문 첫 쪽의 상·하단 선 제목 틀."""
    width = style.get('body_width', BODY_WIDTH_HWPUNIT)
    cell_id = next_id()
    para_id = next_id()
    return (
        f'<hp:p id="{next_id()}" paraPrIDRef="{style["table_anchor_parapr"]}" styleIDRef="0" '
        'pageBreak="0" columnBreak="0" merged="0">'
        f'<hp:run charPrIDRef="27"><hp:tbl id="{BODY_TITLE_FRAME_TABLE_ID}" zOrder="0" numberingType="TABLE" '
        'textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" lock="0" dropcapstyle="None" '
        'pageBreak="CELL" repeatHeader="0" rowCnt="1" colCnt="1" cellSpacing="0" '
        'borderFillIDRef="52" noAdjust="0">'
        f'<hp:sz width="{width}" widthRelTo="ABSOLUTE" height="2000" heightRelTo="ABSOLUTE" protect="0"/>'
        '<hp:pos treatAsChar="1" affectLSpacing="0" flowWithText="1" allowOverlap="0" '
        'holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="COLUMN" vertAlign="TOP" '
        'horzAlign="LEFT" vertOffset="0" horzOffset="0"/>'
        '<hp:outMargin left="0" right="0" top="0" bottom="0"/>'
        '<hp:inMargin left="0" right="0" top="0" bottom="0"/>'
        '<hp:tr><hp:tc name="" header="0" hasMargin="0" protect="0" editable="0" dirty="0" '
        'borderFillIDRef="52"><hp:cellAddr colAddr="0" rowAddr="0"/>'
        '<hp:cellSpan colSpan="1" rowSpan="1"/>'
        f'<hp:cellSz width="{width}" height="2000"/>'
        '<hp:cellMargin left="283" right="283" top="340" bottom="340"/>'
        f'<hp:subList id="{cell_id}" textDirection="HORIZONTAL" lineWrap="BREAK" '
        f'vertAlign="CENTER" linkListIDRef="0" linkListNextIDRef="0" textWidth="{max(width - 566, 1)}" fieldName="">'
        f'<hp:p id="{para_id}" paraPrIDRef="23" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">'
        f'{runs_xml(title, "27", style)}</hp:p></hp:subList></hp:tc></hp:tr></hp:tbl></hp:run></hp:p>'
    )


def structured_heading_parts(text):
    for kind, pattern in STRUCTURED_HEADING_PATTERNS:
        match = pattern.match(str(text or ''))
        if match:
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
        '<hp:outMargin left="0" right="0" top="0" bottom="0"/>'
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
        parts = [
            page_boundary_para(
                page_break=True,
                hide_page_number=hide_page_number,
                restart_page_number=restart_page_number,
            )
        ] if starts_new_page else []
        if page_type == 'body-opening':
            title = metadata.get('title') or metadata.get('cover', {}).get('title') or '추진 계획'
            parts.append(body_title_frame(title, style))
            covered = metadata.get('cover') or {}
            organization = metadata.get('organization') or {}
            display_name = organization.get('displayName') or covered.get('displayName') or ''
            department = organization.get('department') or covered.get('department') or ''
            department_line = ' '.join(str(value).strip() for value in (display_name, department) if str(value).strip())
            if department_line:
                parts.append(text_para(department_line, '121', '22', style))
        if page_type == 'body-continuation':
            page_blocks = page.get('blocks') or []
        else:
            page_blocks = page['blocks'] if 'blocks' in page else model.get('blocks', [])
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
    if page_type in ('toc', 'summary') and not page_blocks:
        parts.append(table_paragraph(front_matter_frame_block(page_type), styles, style))
    else:
        parts.extend(render_blocks(page_blocks, styles, style))
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
            charpr, parapr = style['heading'].get(block.get('level', 1), style['heading_default'])
        elif block['type'] == 'listItem' and block.get('ordered') and int(block.get('level') or 0) == 0:
            charpr, parapr = style['heading'].get(1, style['heading_default'])
        elif block['type'] == 'listItem':
            charpr, parapr = style['body'][0], style['list_parapr']
        else:
            charpr, parapr = style['body']
        paragraphs.append(text_para(text, charpr, parapr, style))
    return paragraphs


def spacing_header(template, line_spacing_percent, para_next_hwpunit):
    """9단계 적응 조판 — 본문 paraPr의 줄간격·문단 아래 간격만 바꾼 header.xml을 만든다.

    이미 만든 HWPX를 후처리로 변조하지 않고 **매 pass 재생성**하는 경로다(멱등).
    간격 조정은 본문 계열 paraPr 하나에만 적용한다. boncheong의 paraPr 73은
    본문·목록·중제목이 공유하지만 표지 앵커(cover-anchor.xml)는 쓰지 않는 것을
    확인했으므로(paraPr 1·22·23·25·26만 사용) 표지 조판에 영향이 없다.

    gonmun은 대상이 아니다 — 본문 paraPr 0·14를 표지·표 문단도 함께 쓰기 때문에
    같은 방식으로 조이면 표까지 눌린다.
    """
    tokens = TOKENS['adaptiveSpacing']
    if template != tokens['template']:
        raise ValueError(f'적응 조판은 {tokens["template"]} 템플릿에서만 지원합니다 (요청: {template}).')
    source = TEMPLATE_HEADERS[template].read_text(encoding='utf-8')
    target_id = tokens['targetParaPrId']
    match = re.search(r'<hh:paraPr id="%s".*?</hh:paraPr>' % re.escape(target_id), source, flags=re.S)
    if not match:
        raise RuntimeError(f'header.xml에서 paraPr {target_id}을 찾지 못했습니다.')
    original = match.group(0)
    # paraPr 안의 hp:case·hp:default 두 분기를 모두 고쳐야 한다. 한쪽만 고치면
    # 한글 버전에 따라 조정이 무시된다.
    # 치환 결과가 원본과 같을 수 있다(사다리 0단 = 기본값 160%). 그것은 정상이므로
    # 동일성이 아니라 **치환 횟수**로 검증한다 — 동일성으로 막으면 무보정 경로가 깨진다.
    patched, spacing_hits = re.subn(r'(<hh:lineSpacing type="PERCENT" value=")\d+(")',
                                    lambda m: f'{m.group(1)}{line_spacing_percent}{m.group(2)}', original)
    patched, next_hits = re.subn(r'(<hc:next value=")-?\d+(")',
                                 lambda m: f'{m.group(1)}{para_next_hwpunit}{m.group(2)}', patched)
    # hp:case·hp:default 두 분기를 모두 고쳐야 한다. 한쪽만 잡히면 한글 버전에 따라
    # 조정이 무시되므로 2건 미만이면 실패로 본다.
    if spacing_hits < 2 or next_hits < 2:
        raise RuntimeError(
            f'paraPr {target_id} 간격 치환 실패 (lineSpacing {spacing_hits}건, next {next_hits}건 — 각 2건 필요).')
    handle = tempfile.NamedTemporaryFile('w', suffix='.header.xml', delete=False, encoding='utf-8')
    with handle:
        handle.write(source.replace(original, patched, 1))
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
            paragraphs.extend(page_type_paragraphs(
                page,
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
    header_path = (spacing_header(template, line_spacing_percent, para_next_hwpunit)
                   if line_spacing_percent else None)
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
