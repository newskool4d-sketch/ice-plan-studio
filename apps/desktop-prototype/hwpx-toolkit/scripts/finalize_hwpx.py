#!/usr/bin/env python3
# /// script
# requires-python = ">=3.11"
# ///
# --- How to run ---
# python3 finalize_hwpx.py input.hwpx --in-place --strip-linesegarray --layout
from __future__ import annotations

import argparse
import re
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Final
from zipfile import BadZipFile, ZipFile

SECTION_PREFIX: Final = "Contents/"
LINESEG_RE: Final = re.compile(
    r"<hp:linesegarray\b[^>]*(?:/>|>.*?</hp:linesegarray>)",
    re.DOTALL,
)


class FinalizeError(RuntimeError):
    pass


@dataclass(frozen=True, slots=True)
class FinalizeReport:
    status: str
    stripped_linesegarrays: int
    warnings: list[str]


def _read_section(path: Path) -> str:
    try:
        with ZipFile(path, "r") as archive:
            return archive.read("Contents/section0.xml").decode("utf-8")
    except FileNotFoundError as exc:
        raise FinalizeError(f"File not found: {path}") from exc
    except BadZipFile as exc:
        raise FinalizeError(f"Not a valid HWPX ZIP: {path}") from exc
    except KeyError as exc:
        raise FinalizeError("Missing Contents/section0.xml") from exc
    except UnicodeDecodeError as exc:
        raise FinalizeError("Contents/section0.xml is not UTF-8") from exc


def _plain_text(xml: str) -> str:
    pieces = re.findall(r"<hp:t\b[^>]*>(.*?)</hp:t>", xml, re.DOTALL)
    return re.sub(r"<[^>]+>", "", "".join(pieces))


def layout_warnings(path: Path) -> list[str]:
    section = _read_section(path)
    warnings: list[str] = []
    if "<hp:secPr" not in section:
        warnings.append("section0.xml has no hp:secPr")
    if "<hp:colPr" not in section:
        warnings.append("section0.xml has no hp:colPr")
    for index, cell in enumerate(re.finditer(r"(<hp:tc\b.*?</hp:tc>)", section, re.DOTALL), 1):
        cell_xml = cell.group(1)
        text_length = len(_plain_text(cell_xml).strip())
        paragraph_count = len(re.findall(r"<hp:p\b", cell_xml))
        if text_length > 120 and paragraph_count <= 1:
            warnings.append(f"table cell {index} has long single-paragraph text ({text_length} chars)")
    if re.search(r"<hh:charPr\b[^>]*\bborderFillIDRef=", section):
        warnings.append("charPr borderFillIDRef detected; character border bug risk")
    return warnings


def strip_linesegarrays(source: Path, target: Path) -> int:
    stripped = 0
    try:
        with ZipFile(source, "r") as zin, ZipFile(target, "w") as zout:
            for item in zin.infolist():
                data = zin.read(item.filename)
                if item.filename.startswith(SECTION_PREFIX) and item.filename.endswith(".xml"):
                    text = data.decode("utf-8")
                    text, count = LINESEG_RE.subn("", text)
                    stripped += count
                    data = text.encode("utf-8")
                zout.writestr(item, data, compress_type=item.compress_type)
    except FileNotFoundError as exc:
        raise FinalizeError(f"File not found: {source}") from exc
    except BadZipFile as exc:
        raise FinalizeError(f"Not a valid HWPX ZIP: {source}") from exc
    except UnicodeDecodeError as exc:
        raise FinalizeError("A Contents/*.xml entry is not UTF-8") from exc
    return stripped


def finalize(source: Path, target: Path, should_strip: bool, should_check_layout: bool) -> FinalizeReport:
    stripped = 0
    if should_strip:
        if source.resolve() == target.resolve():
            with tempfile.NamedTemporaryFile(delete=False, suffix=".hwpx") as temp:
                temp_path = Path(temp.name)
            try:
                stripped = strip_linesegarrays(source, temp_path)
                temp_path.replace(target)
            finally:
                if temp_path.exists():
                    temp_path.unlink()
        else:
            stripped = strip_linesegarrays(source, target)
    elif source.resolve() != target.resolve():
        target.write_bytes(source.read_bytes())
    warnings = layout_warnings(target if should_strip or source.resolve() != target.resolve() else source)
    if not should_check_layout:
        warnings = []
    return FinalizeReport(
        status="WARN" if warnings else "PASS",
        stripped_linesegarrays=stripped,
        warnings=warnings,
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="Finalize an HWPX delivery candidate")
    parser.add_argument("input", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--in-place", action="store_true")
    parser.add_argument("--strip-linesegarray", action="store_true")
    parser.add_argument("--layout", action="store_true")
    parser.add_argument("--strict", action="store_true", help="Return non-zero when warnings exist")
    args = parser.parse_args()
    if args.output and args.in_place:
        print("FAIL: choose either --output or --in-place", file=sys.stderr)
        return 2
    if args.strip_linesegarray and not args.output and not args.in_place:
        print("FAIL: --strip-linesegarray requires --output or --in-place", file=sys.stderr)
        return 2
    target = args.input if args.in_place else (args.output or args.input)
    try:
        report = finalize(args.input, target, args.strip_linesegarray, args.layout)
    except FinalizeError as exc:
        print(f"FAIL: {exc}", file=sys.stderr)
        return 2
    print(f"{report.status}: finalize_hwpx")
    print(f"  stripped_linesegarrays: {report.stripped_linesegarrays}")
    for warning in report.warnings:
        print(f"  WARN: {warning}")
    return 1 if args.strict and report.warnings else 0


if __name__ == "__main__":
    raise SystemExit(main())
