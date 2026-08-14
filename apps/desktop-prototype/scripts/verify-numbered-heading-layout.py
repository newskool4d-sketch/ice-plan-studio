#!/usr/bin/env python3
"""번호 제목의 조판 규칙 검증.

두 가지 실물 양식 판정(2026-08-14 사용자 검수)을 고정한다.
  1) 제목틀(표)은 로마숫자 장 제목 전용이다. 아라비아 숫자 제목은 제목 길이와
     무관하게 언제나 일반 문단으로 낸다 — 종전에는 20자 이하만 표가 되어
     같은 문서 안에서 표/문단이 뒤섞였다.
  2) 번호 제목 사이에는 문단 간격이 있어야 한다. 종전에는 제목 문단 속성의
     hc:prev·hc:next가 모두 0이라 번호와 번호가 붙어 나왔다.
"""
import json
import re
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

ROMAN_HEADING = "Ⅰ. 목적"
ARABIC_SHORT = "2. 본원 프로그램의 야외 의존도"
ARABIC_LONG = "1. 폭염특보 체계 개편에 따른 야외활동 운영 기준 재정비 방안"


def require(condition, message):
    if not condition:
        raise AssertionError(message)


def local_name(element):
    return element.tag.rsplit("}", 1)[-1]


def paragraph_text(paragraph):
    return "".join(
        node.text or ""
        for node in paragraph.iter()
        if local_name(node) == "t"
    )


def first_cell_text(table):
    for cell in table.iter():
        if local_name(cell) == "tc":
            return "".join(
                node.text or "" for node in cell.iter() if local_name(node) == "t"
            ).strip()
    return ""


def paragraph_para_pr(root, text):
    matches = [
        paragraph
        for paragraph in root.iter()
        if local_name(paragraph) == "p" and paragraph_text(paragraph).strip() == text
    ]
    require(len(matches) == 1, f"문단을 정확히 하나 찾지 못했습니다: {text!r} ({len(matches)}건)")
    return matches[0].get("paraPrIDRef")


def para_pr_prev(header_xml, para_pr_id):
    match = re.search(
        r'<hh:paraPr id="%s".*?</hh:paraPr>' % re.escape(para_pr_id),
        header_xml,
        flags=re.S,
    )
    require(match is not None, f"header.xml에서 paraPr {para_pr_id}을 찾지 못했습니다.")
    prev_values = {int(value) for value in re.findall(r'<hc:prev value="(-?\d+)"', match.group(0))}
    require(len(prev_values) == 1, f"paraPr {para_pr_id}의 hc:prev 값이 갈렸습니다: {prev_values}")
    return prev_values.pop()


def build_model():
    title = "번호 제목 조판 검증 계획"
    return {
        "schemaVersion": "0.2",
        "kind": "plan-ir",
        "metadata": {
            "title": title,
            "cover": {
                "title": title,
                "displayName": "인천광역시교육청학생교육원",
                "englishName": "",
                "date": "2026. 8.",
            },
            "organization": {"displayName": "인천광역시교육청학생교육원", "department": "교학과"},
            "layout": {"template": "boncheong", "coverProfile": "direct-g", "innerCover": False},
            "pages": [
                {"type": "cover", "role": "cover", "blocks": []},
                {
                    "type": "body",
                    "role": "body",
                    "blocks": [
                        {"type": "heading", "level": 2, "text": ROMAN_HEADING},
                        {"type": "heading", "level": 3, "text": ARABIC_LONG},
                        {"type": "paragraph", "text": "첫째 항목의 본문 문장이다."},
                        {"type": "heading", "level": 3, "text": ARABIC_SHORT},
                        {"type": "paragraph", "text": "둘째 항목의 본문 문장이다."},
                    ],
                },
            ],
        },
        "blocks": [],
    }


def main():
    generator = Path(__file__).resolve().parent / "model_to_hwpx.py"
    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        model_path = tmp_path / "model.json"
        output_path = tmp_path / "out.hwpx"
        model_path.write_text(json.dumps(build_model(), ensure_ascii=False), encoding="utf-8")
        subprocess.run(
            [sys.executable, str(generator), str(model_path), str(output_path), "--template", "boncheong"],
            check=True,
            capture_output=True,
        )
        with zipfile.ZipFile(output_path) as archive:
            section = archive.read("Contents/section0.xml").decode("utf-8")
            header = archive.read("Contents/header.xml").decode("utf-8")

    root = ET.fromstring(section)
    tables = [element for element in root.iter() if local_name(element) == "tbl"]
    labels = [first_cell_text(table) for table in tables]

    require("Ⅰ" in labels, "로마숫자 장 제목틀이 사라졌습니다.")
    arabic_frames = [label for label in labels if re.fullmatch(r"\d+\.", label)]
    require(not arabic_frames, f"아라비아 숫자 제목이 표로 조판되었습니다: {arabic_frames}")

    short_para_pr = paragraph_para_pr(root, ARABIC_SHORT)
    long_para_pr = paragraph_para_pr(root, ARABIC_LONG)
    require(
        short_para_pr == long_para_pr,
        f"제목 길이에 따라 아라비아 숫자 제목의 문단 속성이 갈립니다: {short_para_pr} vs {long_para_pr}",
    )
    require(
        para_pr_prev(header, short_para_pr) > 0,
        f"번호 제목 문단(paraPr {short_para_pr})에 문단 위 간격이 없습니다.",
    )
    print("verify-numbered-heading-layout: OK")


if __name__ == "__main__":
    main()
