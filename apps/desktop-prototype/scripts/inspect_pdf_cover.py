#!/usr/bin/env python3
"""한글이 실제로 만든 PDF에서 표지 이미지 배치 좌표를 읽는다.

kordoc 렌더로 "가운데 정렬됐다"를 확인해도 그것은 우리 측 추정 렌더다.
한글이 정말 그렇게 조판했는지는 한글이 저장한 PDF를 봐야 안다(memory:
electron-cdp-verification — "구조 검증 통과 != 실물 동작"이 반복된 이력).

사용: py scripts/inspect_pdf_cover.py <pdf경로> [쪽번호=1]
출력: 이미지별 배치 사각형(mm)과 페이지 중앙 기준 편차
"""
from __future__ import annotations

import sys
from pathlib import Path

import fitz  # PyMuPDF

PT_PER_MM = 72 / 25.4


def main() -> int:
    if len(sys.argv) < 2:
        print('사용법: py scripts/inspect_pdf_cover.py <pdf경로> [쪽번호]')
        return 2
    path = Path(sys.argv[1])
    page_number = int(sys.argv[2]) - 1 if len(sys.argv) > 2 else 0
    with fitz.open(path) as document:
        page = document[page_number]
        page_width = page.rect.width
        print(f'{path.name} · {page_number + 1}쪽 · 폭 {page_width:.2f}pt '
              f'({page_width / PT_PER_MM:.2f}mm) · 총 {document.page_count}쪽')
        images = page.get_images(full=True)
        if not images:
            print('  배치 이미지 없음')
        for image in images:
            xref = image[0]
            for rect in page.get_image_rects(xref):
                center_offset = (rect.x0 + rect.x1) / 2 - page_width / 2
                print(f'  xref {xref}: x={rect.x0 / PT_PER_MM:.3f}mm y={rect.y0 / PT_PER_MM:.3f}mm '
                      f'w={rect.width / PT_PER_MM:.3f}mm h={rect.height / PT_PER_MM:.3f}mm '
                      f'중앙편차={center_offset / PT_PER_MM:+.3f}mm')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
