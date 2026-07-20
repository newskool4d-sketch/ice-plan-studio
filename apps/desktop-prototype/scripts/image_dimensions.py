#!/usr/bin/env python3
"""Read image dimensions and fit them into HWPUNIT bounding boxes."""

import struct
from pathlib import Path

HWPUNIT_PER_MM = 7200 / 25.4


def read_image_size(path: str | Path) -> tuple[int, int] | None:
    """Read PNG/JPEG pixel dimensions using only the standard library."""
    with Path(path).open('rb') as image_file:
        head = image_file.read(24)
        if head[:8] == b'\x89PNG\r\n\x1a\n' and head[12:16] == b'IHDR':
            return struct.unpack('>II', head[16:24])
        if head[:2] == b'\xff\xd8':
            image_file.seek(2)
            while True:
                marker = image_file.read(2)
                if len(marker) < 2 or marker[0] != 0xFF:
                    break
                code = marker[1]
                if 0xC0 <= code <= 0xCF and code not in (0xC4, 0xC8, 0xCC):
                    image_file.read(3)
                    height, width = struct.unpack('>HH', image_file.read(4))
                    return width, height
                length = struct.unpack('>H', image_file.read(2))[0]
                image_file.seek(length - 2, 1)
    return None


def image_dims_hwpunit(
    path: str | Path,
    max_width_mm: float,
    max_height_mm: float,
) -> tuple[int, int]:
    """Fit an image inside a millimetre box and return HWPUNIT dimensions."""
    ratio = None
    try:
        size = read_image_size(path)
        if size and size[1]:
            ratio = size[0] / size[1]
    except (OSError, struct.error):
        pass
    if not ratio:
        ratio = max_width_mm / max_height_mm
    max_width = max_width_mm * HWPUNIT_PER_MM
    max_height = max_height_mm * HWPUNIT_PER_MM
    width = max_width
    height = width / ratio
    if height > max_height:
        height = max_height
        width = height * ratio
    return round(width), round(height)
