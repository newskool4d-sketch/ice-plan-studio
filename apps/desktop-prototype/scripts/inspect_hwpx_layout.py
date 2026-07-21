#!/usr/bin/env python3
"""Extract only the HWPX facts used by the preview equivalence gate."""
from __future__ import annotations

import argparse
import json
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET


def local_name(tag: str) -> str:
    return tag.rsplit('}', 1)[-1]


def child(element, name):
    return next((node for node in element if local_name(node.tag) == name), None)


def text_of(element) -> str:
    return ''.join(node.text or '' for node in element.iter() if local_name(node.tag) == 't')


def inspect(path: Path) -> dict:
    with zipfile.ZipFile(path) as archive:
        root = ET.fromstring(archive.read('Contents/section0.xml'))
    tables = []
    for table in root.iter():
        if local_name(table.tag) != 'tbl':
            continue
        size = child(table, 'sz')
        if size is None:
            continue
        rows = []
        for row in (node for node in table if local_name(node.tag) == 'tr'):
            cells = [node for node in row if local_name(node.tag) == 'tc']
            rows.append([text_of(cell) for cell in cells])
        tables.append({'widthHwpUnit': int(size.attrib['width']), 'rowCnt': int(table.attrib['rowCnt']), 'colCnt': int(table.attrib['colCnt']), 'repeatHeader': table.attrib.get('repeatHeader') == '1', 'rows': rows})
    text = ''.join(text_of(node) for node in root.iter() if local_name(node.tag) == 'p')
    return {'tables': tables, 'text': text}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('hwpx', type=Path)
    print(json.dumps(inspect(parser.parse_args().hwpx), ensure_ascii=False))
