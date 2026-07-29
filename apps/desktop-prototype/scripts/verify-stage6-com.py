#!/usr/bin/env python3
"""Stage 6 real Hancom COM gate for the body-layout-v2 fixture."""
from __future__ import annotations

import argparse
import json
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("hwpx", type=Path)
    parser.add_argument("pdf", type=Path)
    parser.add_argument("--expected-pages", type=int, default=5)
    args = parser.parse_args()
    # COM Open은 한글 프로세스 자신의 cwd 기준으로 상대 경로를 풀기 때문에 절대화 필수.
    args.hwpx = args.hwpx.resolve()
    args.pdf = args.pdf.resolve()
    result: dict = {"hwpx": str(args.hwpx), "pdf": str(args.pdf), "expectedPages": args.expected_pages}
    try:
        import pythoncom
        import win32com.client
    except ImportError as exc:
        result.update(ok=False, status="blocked", error=f"pywin32 unavailable: {exc}")
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 2
    pythoncom.CoInitialize()
    hwp = None
    try:
        hwp = win32com.client.Dispatch("HWPFrame.HwpObject")
        hwp.RegisterModule("FilePathCheckDLL", "SecurityModule")
        result["hwpVersion"] = str(hwp.Version)
        result["open"] = bool(hwp.Open(str(args.hwpx), "HWPX", "lock:false;forceopen:true"))
        if result["open"]:
            result["pages"] = int(hwp.PageCount)
            result["pagesMatchExpected"] = result["pages"] == args.expected_pages
            result["pdfSaved"] = bool(hwp.SaveAs(str(args.pdf), "PDF", "") and args.pdf.exists())
        result["ok"] = bool(result.get("open") and result.get("pagesMatchExpected") and result.get("pdfSaved"))
        result["status"] = "passed" if result["ok"] else "failed"
    except Exception as exc:
        result.update(ok=False, status="failed", error=f"{type(exc).__name__}: {exc}")
    finally:
        if hwp is not None:
            try:
                hwp.Clear(1)
            except Exception:
                pass
            try:
                hwp.Quit()
            except Exception:
                pass
        pythoncom.CoUninitialize()
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
