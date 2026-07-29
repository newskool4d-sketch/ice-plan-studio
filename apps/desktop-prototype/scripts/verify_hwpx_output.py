#!/usr/bin/env python3
import sys
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

OPF_NS = 'http://www.idpf.org/2007/opf/'
HP_NS = 'http://www.hancom.co.kr/hwpml/2011/paragraph'
# boncheong 템플릿 표지에 원본 그대로 붙는 장식 표. 자료 표가 아니므로 머리글
# 반복 규약(header="1")의 대상이 아니다 — model_to_hwpx.py의 표지 splice 참조.
TEMPLATE_DECORATION_TABLE_IDS = {'2063551796', '2063551804'}


def content_tables(root: ET.Element) -> list[ET.Element]:
    """모델의 table 블록에서 생성된 표만 추린다(표지 장식 표 제외)."""
    return [
        table for table in root.iter(f'{{{HP_NS}}}tbl')
        if table.get('id') not in TEMPLATE_DECORATION_TABLE_IDS
    ]


def verify_content_table(table: ET.Element) -> None:
    table_id = table.get('id')
    assert table.get('repeatHeader') == '1', f'table {table_id}: header repetition is missing'
    assert table.get('rowCnt') and table.get('colCnt'), (
        f'table {table_id}: rowCnt/colCnt attributes are missing (required by Hancom Office)'
    )
    rows = table.findall(f'{{{HP_NS}}}tr')
    assert len(rows) >= 2, f'table {table_id}: table rows are missing'
    header_cells = rows[0].findall(f'{{{HP_NS}}}tc')
    assert header_cells and all(cell.get('header') == '1' for cell in header_cells), (
        f'table {table_id}: header row cells must carry header="1" for repeatHeader to work'
    )


def verify_bindata_references(
    names: list[str],
    content_hpf: bytes,
    section_root: ET.Element,
) -> None:
    manifest_root = ET.fromstring(content_hpf)
    manifest_items = {}
    for item in manifest_root.findall(f'.//{{{OPF_NS}}}item'):
        href = item.get('href', '')
        if href.startswith('BinData/'):
            manifest_items[item.get('id', '')] = href

    archived = {
        name for name in names
        if name.startswith('BinData/') and not name.endswith('/')
    }
    registered = set(manifest_items.values())
    missing = sorted(registered - archived)
    unregistered = sorted(archived - registered)
    assert not missing, f'content.hpf registers missing BinData entries: {missing}'
    assert not unregistered, f'BinData entries are not registered in content.hpf: {unregistered}'

    referenced = {
        element.attrib['binaryItemIDRef']
        for element in section_root.iter()
        if element.attrib.get('binaryItemIDRef')
    }
    dangling = sorted(referenced - set(manifest_items))
    assert not dangling, f'section references unknown binary item IDs: {dangling}'


def verify(path: Path) -> None:
    with zipfile.ZipFile(path) as archive:
        names = archive.namelist()
        assert names and names[0] == 'mimetype', 'mimetype must be first ZIP entry'
        assert archive.getinfo('mimetype').compress_type == zipfile.ZIP_STORED, 'mimetype must be stored'
        for required in ('Contents/header.xml', 'Contents/section0.xml', 'META-INF/container.rdf'):
            assert required in names, f'missing required part: {required}'
        section = archive.read('Contents/section0.xml')
        content_hpf_bytes = archive.read('Contents/content.hpf')
        content_hpf = content_hpf_bytes.decode('utf-8')
        bindata_entries = [n for n in names if n.startswith('BinData/')]
    root = ET.fromstring(section)
    xml = section.decode('utf-8')
    verify_bindata_references(names, content_hpf_bytes, root)
    if '<hp:pic ' in xml:
        assert bindata_entries, 'hp:pic exists but no BinData/ image files were embedded'
        for entry in bindata_entries:
            assert f'href="{entry}"' in content_hpf, f'BinData entry not registered in content.hpf manifest: {entry}'
        assert 'binaryItemIDRef=' in xml, 'hp:pic must reference a binary item'
    assert '<hp:tbl' in xml, 'native table is missing'
    # treatAsChar는 표 크기·역할에 따라 갈린다. 레퍼런스 실측 결과 소형 표·박스는
    # treatAsChar="1"(글자처럼 취급)이 일반적이고, 0으로 띄우면 한글이 표를 앞 문단
    # 위로 재배치해 블록 순서가 뒤바뀐다. 따라서 "0이어야 한다"는 강제 대신
    # 속성이 존재하는지만 검사한다 — docs/BASELINE_ANALYSIS.md §2.5 참조.
    assert 'treatAsChar="' in xml, 'table pos must declare treatAsChar'
    assert xml.count('<hp:tr>') >= 2, 'table rows are missing'
    # 자료 표가 없는 문서(표지·목차·요약·서술형 본문만 있는 계획안)는 머리글 반복
    # 규약을 적용할 대상이 없다. 표가 있는 문서에서만 표별로 검사한다.
    tables = content_tables(root)
    for table in tables:
        verify_content_table(table)
    expected = tuple(sys.argv[2:]) or ('표',)
    for text in expected:
        assert text in xml, f'expected text missing: {text}'
    print(f'PASS: {path}')
    print(f'  zip_entries={len(names)} table_rows={xml.count("<hp:tr>")} content_tables={len(tables)}')


if __name__ == '__main__':
    if len(sys.argv) < 2:
        raise SystemExit('Usage: python verify_hwpx_output.py output.hwpx [expected-text ...]')
    verify(Path(sys.argv[1]))


