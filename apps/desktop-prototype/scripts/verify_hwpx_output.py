#!/usr/bin/env python3
import sys
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET


def verify(path: Path) -> None:
    with zipfile.ZipFile(path) as archive:
        names = archive.namelist()
        assert names and names[0] == 'mimetype', 'mimetype must be first ZIP entry'
        assert archive.getinfo('mimetype').compress_type == zipfile.ZIP_STORED, 'mimetype must be stored'
        for required in ('Contents/header.xml', 'Contents/section0.xml', 'META-INF/container.rdf'):
            assert required in names, f'missing required part: {required}'
        section = archive.read('Contents/section0.xml')
        content_hpf = archive.read('Contents/content.hpf').decode('utf-8')
        bindata_entries = [n for n in names if n.startswith('BinData/')]
    root = ET.fromstring(section)
    xml = section.decode('utf-8')
    if '<hp:pic ' in xml:
        assert bindata_entries, 'hp:pic exists but no BinData/ image files were embedded'
        for entry in bindata_entries:
            assert f'href="{entry}"' in content_hpf, f'BinData entry not registered in content.hpf manifest: {entry}'
        assert 'binaryItemIDRef=' in xml, 'hp:pic must reference a binary item'
    assert '<hp:tbl' in xml, 'native table is missing'
    assert 'treatAsChar="0"' in xml, 'table must not be treated as character'
    assert 'repeatHeader="1"' in xml, 'table header repetition is missing'
    assert 'rowCnt="' in xml and 'colCnt="' in xml, 'table rowCnt/colCnt attributes are missing (required by Hancom Office)'
    assert 'header="1"' in xml, 'header row cells must carry header="1" for repeatHeader to work'
    assert xml.count('<hp:tr>') >= 2, 'table rows are missing'
    expected = tuple(sys.argv[2:]) or ('표',)
    for text in expected:
        assert text in xml, f'expected text missing: {text}'
    print(f'PASS: {path}')
    print(f'  zip_entries={len(names)} table_rows={xml.count("<hp:tr>")}')


if __name__ == '__main__':
    if len(sys.argv) < 2:
        raise SystemExit('Usage: python verify_hwpx_output.py output.hwpx [expected-text ...]')
    verify(Path(sys.argv[1]))


