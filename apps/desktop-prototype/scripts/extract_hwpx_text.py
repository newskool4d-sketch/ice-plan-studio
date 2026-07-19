#!/usr/bin/env python3
import html
import re
import sys
import zipfile
from pathlib import Path


def extract(path: Path) -> str:
    with zipfile.ZipFile(path) as archive:
        xml = archive.read('Contents/section0.xml').decode('utf-8')
    values = re.findall(r'<hp:t(?: [^>]*)?>(.*?)</hp:t>', xml, flags=re.S)
    lines = [re.sub(r'<[^>]+>', '', html.unescape(value)).strip() for value in values]
    return '\n'.join(line for line in lines if line)


if __name__ == '__main__':
    if len(sys.argv) != 2:
        raise SystemExit('Usage: py extract_hwpx_text.py input.hwpx')
    print(extract(Path(sys.argv[1])))
