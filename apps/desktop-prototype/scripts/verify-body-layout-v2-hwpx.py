#!/usr/bin/env python3
import json
import re
import subprocess
import sys
import tempfile
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path


TITLE = "학생교육원 공약사업 이행을 위한 체험교육 프로그램 고도화 추진 계획(안)"
ORGANIZATION = "인천광역시교육청학생교육원"
DEPARTMENT = "교학과"
FORBIDDEN = (
    "기본 방향",
    "내용 입력 대기",
    "운영 계획",
    "인천을 품고 세계로 나아가는 글로벌 인재 양성",
)


def require(condition, message):
    if not condition:
        raise AssertionError(message)


def main():
    script_dir = Path(__file__).resolve().parent
    generator = script_dir / "model_to_hwpx.py"
    model = {
        "schemaVersion": "0.2",
        "kind": "plan-ir",
        "metadata": {
            "title": TITLE,
            "documentKind": "school-guidance-basic-plan",
            "cover": {
                "title": TITLE,
                "displayName": ORGANIZATION,
                "englishName": "",
                "direction": "",
                "date": "2026. 7.",
            },
            "organization": {
                "displayName": ORGANIZATION,
                "department": DEPARTMENT,
            },
            "layout": {
                "template": "boncheong",
                "coverProfile": "direct-g",
            },
            "pages": [
                {"type": "cover", "role": "cover", "blocks": []},
                {"type": "toc", "role": "toc", "blocks": []},
                {"type": "summary", "role": "summary", "blocks": []},
                {
                    "type": "body-opening",
                    "role": "body-opening",
                    "blocks": [
                        {"type": "heading", "level": 1, "text": "1. 추진 배경"},
                        {"type": "paragraph", "text": "체험교육 프로그램을 고도화한다."},
                        {"type": "paragraph", "text": "일반 **강조** 일반"},
                    ],
                },
                {
                    "type": "body-continuation",
                    "role": "body-continuation",
                    "blocks": [{"type": "paragraph", "text": "계속 본문"}],
                },
            ],
        },
        "styles": {},
        "blocks": [{"type": "paragraph", "text": "전체 본문 폴백은 사용하지 않는다."}],
    }

    with tempfile.TemporaryDirectory(prefix="ice-plan-body-v2-") as tmp:
        tmp_path = Path(tmp)
        model_path = tmp_path / "fixture.model.json"
        output_path = tmp_path / "fixture.hwpx"
        model_path.write_text(json.dumps(model, ensure_ascii=False), encoding="utf-8")
        completed = subprocess.run(
            [sys.executable, str(generator), str(model_path), str(output_path), "--template", "boncheong"],
            check=True,
            capture_output=True,
        )
        require(output_path.exists(), "HWPX fixture was not generated")
        with zipfile.ZipFile(output_path) as archive:
            section = archive.read("Contents/section0.xml").decode("utf-8")
            header = archive.read("Contents/header.xml").decode("utf-8")

    section_root = ET.fromstring(section)
    header_root = ET.fromstring(header)

    def local_name(element):
        return element.tag.rsplit("}", 1)[-1]

    number_control_names = {"pageHiding", "newNum", "pageNum"}
    direct_number_controls = []
    nested_number_controls = []
    for paragraph in (element for element in section_root.iter() if local_name(element) == "p"):
        for child in list(paragraph):
            if local_name(child) == "ctrl":
                direct_number_controls.extend(
                    descendant for descendant in child.iter()
                    if local_name(descendant) in number_control_names
                )
            if local_name(child) != "run":
                continue
            for control in (item for item in list(child) if local_name(item) == "ctrl"):
                nested_number_controls.extend(
                    descendant for descendant in control.iter()
                    if local_name(descendant) in number_control_names
                )

    for phrase in FORBIDDEN:
        require(phrase not in section, f"forbidden phrase remains: {phrase}")
    require(f"{ORGANIZATION} {DEPARTMENT}" in section, "right-aligned organization/department line is missing")
    require("전체 본문 폴백은 사용하지 않는다." not in section, "body continuation duplicated model.blocks")
    require("구성 항목" in section and "기대 효과" in section, "blank TOC/summary frames are missing")
    require(
        '<hp:run charPrIDRef="9"><hp:t>체험교육 프로그램을 고도화한다.</hp:t></hp:run>' in section,
        "school-guidance body text is not 14pt",
    )
    require(section.count("<hp:pageNum ") == 1, "page-number placement control count changed")
    require(section.count("<hp:pageHiding ") == 4, "cover/front-matter page hiding count is not four")
    require(section.count('<hp:newNum num="1" numType="PAGE"/>') == 1, "body page-number restart is missing or duplicated")
    require(not direct_number_controls, "page-number controls must be nested inside hp:run, not directly under hp:p")
    nested_counts = {
        name: sum(1 for control in nested_number_controls if local_name(control) == name)
        for name in number_control_names
    }
    require(
        nested_counts == {"pageHiding": 4, "newNum": 1, "pageNum": 1},
        f"run-nested page-number control counts changed: {nested_counts}",
    )
    require(section.count('pageBreak="1"') == 5, "six-page fixture does not have five hard page boundaries")
    require(
        re.search(
            rf'<hp:tbl[^>]*borderFillIDRef="52"[^>]*>.*?{re.escape(TITLE)}.*?</hp:tbl>',
            section,
            flags=re.S,
        ),
        "body-opening title is not inside the education-office line frame",
    )
    require(
        section.index('<hp:newNum num="1" numType="PAGE"/>') < section.rindex(TITLE),
        "page-number restart is not attached before the body-opening title",
    )
    bold_paragraph = next(
        (
            paragraph for paragraph in section_root.iter()
            if local_name(paragraph) == "p"
            and "".join((node.text or "") for node in paragraph.iter() if local_name(node) == "t") == "일반 강조 일반"
        ),
        None,
    )
    require(bold_paragraph is not None, "14pt bold fixture paragraph is missing")
    bold_runs = [
        (
            run.attrib.get("charPrIDRef"),
            "".join((node.text or "") for node in run.iter() if local_name(node) == "t"),
        )
        for run in bold_paragraph
        if local_name(run) == "run"
    ]
    require(
        bold_runs == [("9", "일반 "), ("19", "강조"), ("9", " 일반")],
        f"14pt bold run mapping changed: {bold_runs}",
    )
    bold_charpr = next(
        (
            element for element in header_root.iter()
            if local_name(element) == "charPr" and element.attrib.get("id") == "19"
        ),
        None,
    )
    require(bold_charpr is not None, "14pt bold charPr 19 is missing")
    font_ref = next((element for element in bold_charpr if local_name(element) == "fontRef"), None)
    require(bold_charpr.attrib.get("height") == "1400", "charPr 19 is not 14pt")
    require(font_ref is not None and font_ref.attrib.get("hangul") == "5", "charPr 19 is not 함초롬바탕")
    require(any(local_name(element) == "bold" for element in bold_charpr), "charPr 19 is not bold")

    print(json.dumps({
        "gate": "body-layout-v2-hwpx",
        "passed": True,
        "checks": [
            "forbidden defaults removed",
            "education-office title frame",
            "organization and department line",
            "blank TOC and summary frames",
            "school-guidance 14pt body text",
            "school-guidance 14pt bold mapping",
            "front-matter page-number hiding",
            "body page-number restart at one",
            "run-nested page-number control structure",
            "six-page hard-boundary preservation",
            "empty continuation does not duplicate model blocks",
            "toolkit finalize and validate",
        ],
        "generatorExitCode": completed.returncode,
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
