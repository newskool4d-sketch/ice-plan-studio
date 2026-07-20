#!/usr/bin/env python3
"""Build an HWPX document from templates and XML overrides.

Assembles a valid HWPX file by:
1. Copying the base template
2. Optionally overlaying a document-type template (gonmun, report, minutes, boncheong)
3. Optionally overriding header.xml and/or section0.xml with custom files
4. Optionally setting metadata (title, creator)
5. Validating XML well-formedness
6. Packaging as HWPX (ZIP with mimetype first, ZIP_STORED)

Usage:
    # Empty document from base template
    python build_hwpx.py --output result.hwpx

    # Using a document-type template
    python build_hwpx.py --template gonmun --output result.hwpx

    # Custom section XML override
    python build_hwpx.py --template gonmun --section my_section0.xml --output result.hwpx

    # Custom header and section
    python build_hwpx.py --header my_header.xml --section my_section0.xml --output result.hwpx

    # With metadata
    python build_hwpx.py --template gonmun --section my.xml --title "제목" --creator "작성자" --output result.hwpx
"""

import argparse
import shutil
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZIP_STORED, ZipFile

# 벤더링 노트: 원본은 lxml을 사용했으나 배포성(외부 PC에 lxml 미설치)을 위해
# stdlib xml.etree로 치환했다. 검증은 읽기 전용 파싱만 수행하므로 동작 동일.
# 메타데이터 갱신은 stdlib ET 재직렬화 시 네임스페이스 접두사가 ns0:으로 바뀌는
# 문제를 피하기 위해 정규식 텍스트 치환으로 재작성했다.
import re

from xml.etree import ElementTree as etree

# Resolve paths relative to this script
SCRIPT_DIR = Path(__file__).resolve().parent
SKILL_DIR = SCRIPT_DIR.parent
TEMPLATES_DIR = SKILL_DIR / "templates"
BASE_DIR = TEMPLATES_DIR / "base"

AVAILABLE_TEMPLATES = ["gonmun", "report", "minutes", "boncheong"]


def apply_template_overlay(overlay_dir: Path, work: Path) -> None:
    """Overlay either a legacy flat template or a complete package tree."""
    if (overlay_dir / "Contents").is_dir():
        for overlay_path in overlay_dir.iterdir():
            if overlay_path.name == "cover-anchor.xml":
                continue
            destination = work / overlay_path.name
            if overlay_path.is_dir():
                shutil.copytree(overlay_path, destination, dirs_exist_ok=True)
            elif overlay_path.is_file():
                shutil.copy2(overlay_path, destination)
        return

    for overlay_file in overlay_dir.iterdir():
        if overlay_file.is_file() and overlay_file.suffix == ".xml":
            shutil.copy2(overlay_file, work / "Contents" / overlay_file.name)


def validate_xml(filepath: Path) -> None:
    """Check that an XML file is well-formed. Raises on error."""
    try:
        etree.parse(str(filepath))
    except etree.ParseError as e:
        raise SystemExit(f"Malformed XML in {filepath.name}: {e}")


def _xml_escape(text: str) -> str:
    return (
        text.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )


def update_metadata(content_hpf: Path, title: str | None, creator: str | None) -> None:
    """Update title and/or creator in content.hpf (텍스트 치환 방식)."""
    if not title and not creator:
        return

    text = content_hpf.read_text(encoding="utf-8")

    now = datetime.now(timezone.utc)
    iso_now = now.strftime("%Y-%m-%dT%H:%M:%SZ")

    def set_element(tag_pattern: str, tag_name: str, value: str, source: str) -> str:
        """빈 self-closing 태그(<tag .../>)와 쌍 태그(<tag ...>..</tag>) 모두 갱신."""
        escaped = _xml_escape(value)
        # self-closing: <opf:title/> 또는 <opf:meta name="X" .../>
        pattern_self = rf"(<{tag_pattern})(\s*/>)"
        replaced, count = re.subn(
            pattern_self,
            lambda m: f"{m.group(1)}>{escaped}</{tag_name}>",
            source, count=1)
        if count:
            return replaced
        # 쌍 태그
        pattern_pair = rf"(<{tag_pattern}>)(.*?)(</{tag_name}>)"
        return re.sub(
            pattern_pair,
            lambda m: f"{m.group(1)}{escaped}{m.group(3)}",
            source, count=1, flags=re.S)

    if title:
        text = set_element(r"opf:title[^>/]*", "opf:title", title, text)

    meta_values = {"CreatedDate": iso_now, "ModifiedDate": iso_now,
                   "date": now.strftime("%Y년 %m월 %d일")}
    if creator:
        meta_values["creator"] = creator
        meta_values["lastsaveby"] = creator
    for name, value in meta_values.items():
        text = set_element(
            rf'opf:meta\s+name="{name}"[^>/]*', "opf:meta", value, text)

    content_hpf.write_text(text, encoding="utf-8")


def pack_hwpx(input_dir: Path, output_path: Path) -> None:
    """Create HWPX archive with mimetype as first entry (ZIP_STORED)."""
    mimetype_file = input_dir / "mimetype"
    if not mimetype_file.is_file():
        raise SystemExit(f"Missing 'mimetype' in {input_dir}")

    all_files = sorted(
        p.relative_to(input_dir).as_posix()
        for p in input_dir.rglob("*")
        if p.is_file()
    )

    with ZipFile(output_path, "w", ZIP_DEFLATED) as zf:
        zf.write(mimetype_file, "mimetype", compress_type=ZIP_STORED)
        for rel_path in all_files:
            if rel_path == "mimetype":
                continue
            zf.write(input_dir / rel_path, rel_path, compress_type=ZIP_DEFLATED)


def validate_hwpx(hwpx_path: Path) -> list[str]:
    """Quick structural validation of the output HWPX."""
    errors: list[str] = []
    required = [
        "mimetype",
        "Contents/content.hpf",
        "Contents/header.xml",
        "Contents/section0.xml",
    ]

    try:
        from zipfile import BadZipFile
        zf = ZipFile(hwpx_path, "r")
    except BadZipFile:
        return [f"Not a valid ZIP: {hwpx_path}"]

    with zf:
        names = zf.namelist()
        for r in required:
            if r not in names:
                errors.append(f"Missing: {r}")

        if "mimetype" in names:
            content = zf.read("mimetype").decode("utf-8").strip()
            if content != "application/hwp+zip":
                errors.append(f"Bad mimetype content: {content}")
            if names[0] != "mimetype":
                errors.append("mimetype is not the first ZIP entry")
            info = zf.getinfo("mimetype")
            if info.compress_type != ZIP_STORED:
                errors.append("mimetype is not ZIP_STORED")

        for name in names:
            if name.endswith(".xml") or name.endswith(".hpf"):
                try:
                    etree.fromstring(zf.read(name))
                except etree.ParseError as e:
                    errors.append(f"Malformed XML: {name}: {e}")

    return errors


def build(
    template: str | None,
    header_override: Path | None,
    section_override: Path | None,
    title: str | None,
    creator: str | None,
    output: Path,
) -> None:
    """Main build logic."""

    if not BASE_DIR.is_dir():
        raise SystemExit(f"Base template not found: {BASE_DIR}")

    with tempfile.TemporaryDirectory() as tmpdir:
        work = Path(tmpdir) / "build"

        # 1. Copy base template
        shutil.copytree(BASE_DIR, work)

        # 2. Apply template overlay
        if template:
            overlay_dir = TEMPLATES_DIR / template
            if not overlay_dir.is_dir():
                raise SystemExit(
                    f"Template '{template}' not found. "
                    f"Available: {', '.join(AVAILABLE_TEMPLATES)}"
                )
            apply_template_overlay(overlay_dir, work)

        # 3. Apply custom overrides
        if header_override:
            if not header_override.is_file():
                raise SystemExit(f"Header file not found: {header_override}")
            shutil.copy2(header_override, work / "Contents" / "header.xml")

        if section_override:
            if not section_override.is_file():
                raise SystemExit(f"Section file not found: {section_override}")
            shutil.copy2(section_override, work / "Contents" / "section0.xml")

        # 4. Update metadata
        update_metadata(work / "Contents" / "content.hpf", title, creator)

        # 5. Validate all XML files
        for xml_file in work.rglob("*.xml"):
            validate_xml(xml_file)
        for hpf_file in work.rglob("*.hpf"):
            validate_xml(hpf_file)

        # 6. Pack
        pack_hwpx(work, output)

    # 7. Final validation
    errors = validate_hwpx(output)
    if errors:
        print(f"WARNING: {output} has issues:", file=sys.stderr)
        for e in errors:
            print(f"  - {e}", file=sys.stderr)
    else:
        print(f"VALID: {output}")
        print(f"  Template: {template or 'base'}")
        if header_override:
            print(f"  Header: {header_override}")
        if section_override:
            print(f"  Section: {section_override}")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Build HWPX document from templates and XML overrides"
    )
    parser.add_argument(
        "--template", "-t",
        choices=AVAILABLE_TEMPLATES,
        help="Document type template to use as overlay",
    )
    parser.add_argument(
        "--header",
        type=Path,
        help="Custom header.xml to override",
    )
    parser.add_argument(
        "--section",
        type=Path,
        help="Custom section0.xml to override",
    )
    parser.add_argument(
        "--title",
        help="Document title (updates content.hpf metadata)",
    )
    parser.add_argument(
        "--creator",
        help="Document creator (updates content.hpf metadata)",
    )
    parser.add_argument(
        "--output", "-o",
        type=Path,
        required=True,
        help="Output .hwpx file path",
    )
    args = parser.parse_args()

    build(
        template=args.template,
        header_override=args.header,
        section_override=args.section,
        title=args.title,
        creator=args.creator,
        output=args.output,
    )


if __name__ == "__main__":
    main()
