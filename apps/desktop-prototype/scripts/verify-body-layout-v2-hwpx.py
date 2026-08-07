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
BODY_TITLE_MARKER = 'id="2063551812"'
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
                "innerCover": False,
            },
            "pages": [
                {"type": "cover", "role": "cover", "blocks": []},
                {
                    "type": "toc",
                    "role": "toc",
                    # 원문 목차가 있어도 최종 산출물은 실제 본문 제목·쪽번호로
                    # 재생성되는지 확인한다.
                    "blocks": [
                        {"type": "paragraph", "text": "Ⅰ. 오래된 목차 쪽 ................................ 99"},
                    ],
                },
                {"type": "summary", "role": "summary", "blocks": []},
                {
                    "type": "body",
                    "role": "body",
                    "blocks": [
                        {"type": "paragraph", "text": TITLE},
                        {"type": "heading", "level": 1, "text": "Ⅰ. 추진 배경"},
                        {"type": "heading", "level": 1, "text": "1. 추진 체계"},
                        {"type": "heading", "level": 2, "text": "[과제1] 체험교육 강화"},
                        {"type": "heading", "level": 3, "text": "[과제 1-1] 운영 기반 조성"},
                        {"type": "heading", "level": 2, "text": "과제 2. 운영 내실화"},
                        {"type": "heading", "level": 3, "text": "과제 2-1. 안전 기반 조성"},
                        {"type": "heading", "level": 2, "headingKind": "korean-subheading", "text": "가. 운영 방향"},
                        {"type": "paragraph", "text": "체험교육 프로그램을 고도화한다."},
                        {"type": "paragraph", "text": "일반 **강조** 일반"},
                        {"type": "paragraph", "text": "---"},
                        {
                            "type": "table",
                            "header": ["제목부"],
                            "rows": [["내용부"]],
                            "layout": {
                                "table": {
                                    "widthHwpUnit": 30000,
                                    "columnWidthsHwpUnit": [30000],
                                    "rowHeightsHwpUnit": [1800, 2200],
                                    "headerStyle": {"sourceCharPrId": "9", "fontFamily": "함초롬바탕", "sizePt": 14},
                                    "bodyStyle": {"sourceCharPrId": "417", "fontFamily": "맑은 고딕", "sizePt": 10},
                                }
                            },
                        },
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
        imported_model = json.loads(json.dumps(model, ensure_ascii=False))
        imported_model["source"] = {"format": "hwpx", "filePath": "fixture.hwpx"}
        imported_model_path = tmp_path / "imported.model.json"
        imported_output_path = tmp_path / "imported.hwpx"
        imported_model_path.write_text(json.dumps(imported_model, ensure_ascii=False), encoding="utf-8")
        subprocess.run(
            [sys.executable, str(generator), str(imported_model_path), str(imported_output_path), "--template", "boncheong"],
            check=True,
            capture_output=True,
        )
        with zipfile.ZipFile(imported_output_path) as archive:
            imported_section = archive.read("Contents/section0.xml").decode("utf-8")

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
    require(
        f"{ORGANIZATION} {DEPARTMENT}" in section,
        "body-opening organization/department line was not preserved",
    )
    require(section.count(TITLE) == 2, "document title must appear only in the cover and body-opening title tables")
    require("전체 본문 폴백은 사용하지 않는다." not in section, "body continuation duplicated model.blocks")
    require("기대 효과" in section, "summary frame is missing")
    # 목차는 표([구성 항목|쪽])가 아니라 문단형 `제목 ····· 쪽번호`가 정격이다
    # (실물 양식 판정 2026-08-07). 표 머리글이 남아 있으면 회귀다.
    require("구성 항목" not in section, "TOC was emitted as the legacy table form")
    require(
        "····" in section and 'paraPrIDRef="241"' in section,
        "paragraph-form TOC with dot leaders is missing",
    )
    require("오래된 목차 쪽" not in section, "source TOC text was emitted instead of the generated TOC")
    require("\ue000" not in section, "TOC page-number placeholder was not resolved")
    require(
        '<hp:run charPrIDRef="132"><hp:t>체험교육 프로그램을 고도화한다.</hp:t></hp:run>' in section,
        "school-guidance body text is not 13pt",
    )
    require("<hp:t>---</hp:t>" not in section, "horizontal-rule delimiter was not removed")
    require(section.count("<hp:pageNum ") == 1, "page-number placement control count changed")
    require(section.count("<hp:pageHiding ") == 3, "cover/front-matter page hiding count is not three")
    require(section.count('<hp:newNum num="1" numType="PAGE"/>') == 1, "body page-number restart is missing or duplicated")
    require(not direct_number_controls, "page-number controls must be nested inside hp:run, not directly under hp:p")
    nested_counts = {
        name: sum(1 for control in nested_number_controls if local_name(control) == name)
        for name in number_control_names
    }
    require(
        nested_counts == {"pageHiding": 3, "newNum": 1, "pageNum": 1},
        f"run-nested page-number control counts changed: {nested_counts}",
    )
    require(section.count('pageBreak="1"') == 4, "five-page fixture does not have four hard page boundaries")
    require(
        re.search(
            rf'<hp:tbl[^>]*id="{BODY_TITLE_MARKER.split(chr(34))[1]}"[^>]*rowCnt="3"[^>]*colCnt="4"[^>]*>.*?{re.escape(TITLE)}.*?</hp:tbl>',
            section,
            flags=re.S,
        ),
        "body-opening title is not inside the education-office 3x4 frame",
    )
    require(BODY_TITLE_MARKER in imported_section, "imported HWPX is missing the normalized body-opening title frame")
    require(
        section.index('<hp:newNum num="1" numType="PAGE"/>') < section.rindex(TITLE),
        "page-number restart is not attached before the body-opening title",
    )
    structured_specs = (
        ("Ⅰ", "추진 배경", "12", "31", "27"),
        ("1.", "추진 체계", "12", "31", "27"),
        ("[과제1]", "체험교육 강화", "10", "114", "19"),
        ("[과제 1-1]", "운영 기반 조성", "14", "414", "315"),
        ("과제 2.", "운영 내실화", "10", "114", "19"),
        ("과제 2-1.", "안전 기반 조성", "14", "414", "315"),
    )
    section_tables = [element for element in section_root.iter() if local_name(element) == "tbl"]
    for label, title, label_fill, label_charpr, title_charpr in structured_specs:
        table = next(
            (
                candidate for candidate in section_tables
                if "".join((node.text or "") for node in candidate.iter() if local_name(node) == "t") == label + title
            ),
            None,
        )
        require(table is not None, f"structured heading table is missing: {label}")
        require(table.attrib.get("rowCnt") == "1" and table.attrib.get("colCnt") == "2", f"structured heading is not a 1x2 table: {label}")
        cells = [element for element in table.iter() if local_name(element) == "tc"]
        require(len(cells) == 2, f"structured heading cell count changed: {label}")
        require(cells[0].attrib.get("borderFillIDRef") == label_fill, f"structured heading accent changed: {label}")
        label_runs = [element for element in cells[0].iter() if local_name(element) == "run"]
        title_runs = [element for element in cells[1].iter() if local_name(element) == "run"]
        require(any(run.attrib.get("charPrIDRef") == label_charpr for run in label_runs), f"structured heading label size changed: {label}")
        require(any(run.attrib.get("charPrIDRef") == title_charpr for run in title_runs), f"structured heading title size changed: {label}")
        out_margin = next((element for element in table if local_name(element) == "outMargin"), None)
        require(out_margin is not None and int(out_margin.attrib.get("bottom", "0")) > 0, f"structured heading bottom gap is missing: {label}")
    korean_heading = next(
        (
            paragraph for paragraph in section_root.iter()
            if local_name(paragraph) == "p"
            and "".join((node.text or "") for node in paragraph.iter() if local_name(node) == "t") == "가. 운영 방향"
        ),
        None,
    )
    require(korean_heading is not None and korean_heading.attrib.get("paraPrIDRef") == "240", "Korean subheading spacing style is missing")
    korean_para_pr = next(
        element for element in header_root.iter()
        if local_name(element) == "paraPr" and element.attrib.get("id") == "240"
    )
    korean_margins = [element for element in korean_para_pr.iter() if local_name(element) == "margin"]
    korean_case_margin = korean_margins[0]
    korean_margin_values = {
        local_name(element): element.attrib.get("value")
        for element in korean_case_margin
    }
    require(
        korean_margin_values == {
            "intent": "-800", "left": "800", "right": "0", "prev": "1000", "next": "200",
        },
        f"Korean subheading indent/spacing values changed: {korean_margin_values}",
    )
    source_table = next(
        (
            candidate for candidate in section_tables
            if "".join((node.text or "") for node in candidate.iter() if local_name(node) == "t") == "제목부내용부"
        ),
        None,
    )
    require(source_table is not None, "source-style table is missing")
    source_cells = [element for element in source_table.iter() if local_name(element) == "tc"]
    source_runs = [[run.attrib.get("charPrIDRef") for run in cell.iter() if local_name(run) == "run"] for cell in source_cells]
    require(source_runs == [["82"], ["83"]], f"table header/body fonts are not normalized to 11pt: {source_runs}")
    source_paragraphs = [
        next(element for element in cell.iter() if local_name(element) == "p")
        for cell in source_cells
    ]
    require(
        [paragraph.attrib.get("paraPrIDRef") for paragraph in source_paragraphs] == ["64", "238"],
        "table header/body alignment styles changed",
    )
    source_sizes = [next(element for element in cell if local_name(element) == "cellSz") for cell in source_cells]
    require([item.attrib.get("height") for item in source_sizes] == ["1800", "2200"], "source table row heights changed")
    bold_paragraph = next(
        (
            paragraph for paragraph in section_root.iter()
            if local_name(paragraph) == "p"
            and "".join((node.text or "") for node in paragraph.iter() if local_name(node) == "t") == "일반 강조 일반"
        ),
        None,
    )
    require(bold_paragraph is not None, "13pt bold fixture paragraph is missing")
    bold_runs = [
        (
            run.attrib.get("charPrIDRef"),
            "".join((node.text or "") for node in run.iter() if local_name(node) == "t"),
        )
        for run in bold_paragraph
        if local_name(run) == "run"
    ]
    require(
        bold_runs == [("132", "일반 "), ("364", "강조"), ("132", " 일반")],
        f"13pt bold run mapping changed: {bold_runs}",
    )
    bold_charpr = next(
        (
            element for element in header_root.iter()
            if local_name(element) == "charPr" and element.attrib.get("id") == "364"
        ),
        None,
    )
    require(bold_charpr is not None, "13pt bold charPr 364 is missing")
    font_ref = next((element for element in bold_charpr if local_name(element) == "fontRef"), None)
    require(bold_charpr.attrib.get("height") == "1300", "charPr 364 is not 13pt")
    require(font_ref is not None and font_ref.attrib.get("hangul") == "5", "charPr 364 is not 함초롬바탕")
    require(any(local_name(element) == "bold" for element in bold_charpr), "charPr 364 is not bold")
    cover_title_charpr = next(
        (
            element for element in header_root.iter()
            if local_name(element) == "charPr" and element.attrib.get("id") == "512"
        ),
        None,
    )
    cover_font_ref = next((element for element in cover_title_charpr if local_name(element) == "fontRef"), None)
    require(cover_font_ref is not None and cover_font_ref.attrib.get("hangul") == "10", "cover title font is not HY헤드라인M")

    print(json.dumps({
        "gate": "body-layout-v2-hwpx",
        "passed": True,
        "checks": [
            "forbidden defaults removed",
            "education-office title frame",
            "roman chapter 1x2 heading frame",
            "numeric chapter uses roman heading frame",
            "task 1x2 heading frame with reduced green styling",
            "task subsection 1x2 heading frame with reduced blue-gray styling",
            "unbracketed task heading variants",
            "Korean subheading paragraph gap",
            "imported HWPX receives normalized body-opening title",
            "table 11pt font and dimensions",
            "body-opening organization preserved and duplicate title removed",
            "paragraph-form dot-leader TOC and summary frame",
            "school-guidance 13pt body text",
            "school-guidance 13pt bold mapping",
            "front-matter page-number hiding",
            "body page-number restart at one",
            "run-nested page-number control structure",
            "five-page hard-boundary preservation",
            "horizontal-rule delimiter removal",
            "empty continuation does not duplicate model blocks",
            "toolkit finalize and validate",
        ],
        "generatorExitCode": completed.returncode,
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
