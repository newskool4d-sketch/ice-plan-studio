"""Stage 2 layout contract for ICE Plan Studio HWPX output.

This module deliberately contains only deterministic layout decisions.  It does
not generate policy content; callers provide each page's title and blocks.
"""
from __future__ import annotations

from dataclasses import dataclass
import json
from pathlib import Path
from typing import Any


TOKENS_PATH = Path(__file__).with_name('layout-tokens.json')
TOKENS = json.loads(TOKENS_PATH.read_text(encoding='utf-8'))
BODY_WIDTH_HWPUNIT = TOKENS['page']['bodyWidthHwpUnit']
MIN_TABLE_COLUMN_HWPUNIT = TOKENS['table']['minimumColumnWidthHwpUnit']
PAGE_TYPES = tuple(TOKENS['pageTypes'])
PAGE_LABELS = TOKENS['pageTypes']


@dataclass(frozen=True)
class CoverProfile:
    id: str
    title_box: bool
    english_name: str | None = None
    inner_cover: bool = False
    banner_image: bool = True
    name_image: bool = False


COVER_PROFILES = {
    profile_id: CoverProfile(
        profile_id,
        title_box=profile['titleBox'],
        english_name=profile.get('englishName'),
        inner_cover=profile['innerCover'],
        banner_image=profile['bannerImage'],
        name_image=profile.get('nameImage', False),
    )
    for profile_id, profile in TOKENS['coverProfiles'].items()
}


def resolve_profile(metadata: dict[str, Any]) -> CoverProfile:
    requested = ((metadata.get('layout') or {}).get('coverProfile')
                 or metadata.get('coverProfile') or 'metropolitan-a')
    try:
        return COVER_PROFILES[requested]
    except KeyError as exc:
        raise ValueError(f'Unsupported cover profile: {requested}') from exc


def page_sequence(metadata: dict[str, Any], profile: CoverProfile) -> list[dict[str, Any]]:
    pages = metadata.get('pages') or []
    if pages:
        normalized = []
        for page in pages:
            page_type = page.get('type')
            if page_type not in PAGE_TYPES:
                raise ValueError(f'Unsupported page type: {page_type}')
            normalized.append({**page, 'type': page_type})
    else:
        requested = metadata.get('pageTypes') or ['cover', 'body']
        normalized = []
        for page_type in requested:
            if page_type not in PAGE_TYPES:
                raise ValueError(f'Unsupported page type: {page_type}')
            normalized.append({'type': page_type})
    inner_cover = (metadata.get('layout') or {}).get('innerCover', profile.inner_cover)
    if inner_cover and not any(page['type'] == 'inner-cover' for page in normalized):
        cover_index = next((index for index, page in enumerate(normalized) if page['type'] == 'cover'), -1)
        normalized.insert(cover_index + 1, {'type': 'inner-cover'})
    return normalized


def table_column_widths(rows: list[list[Any]], total_width: int = BODY_WIDTH_HWPUNIT,
                        minimum_width: int = MIN_TABLE_COLUMN_HWPUNIT) -> list[int]:
    columns = max((len(row) for row in rows), default=1)
    if columns * minimum_width > total_width:
        minimum_width = max(1, total_width // columns)
    lengths = [max((len(str(row[column])) for row in rows if column < len(row)), default=1) for column in range(columns)]
    usable = total_width - minimum_width * columns
    total = max(sum(lengths), 1)
    widths = [minimum_width + int(usable * length / total) for length in lengths]
    widths[-1] += total_width - sum(widths)
    return widths


def estimate_wrapped_lines(value: Any, width: int, char_width_hwpunit: int | None = None) -> int:
    """Conservative line estimate used to size generated table rows before Hancom reflow."""
    char_width_hwpunit = char_width_hwpunit or TOKENS['table']['estimatedCharWidthHwpUnit']
    capacity = max(width // char_width_hwpunit, 1)
    return max(1, (len(str(value)) + capacity - 1) // capacity)


def table_row_heights(rows: list[list[Any]], widths: list[int]) -> list[int]:
    heights = []
    for row in rows:
        line_count = max((estimate_wrapped_lines(row[column], widths[column]) for column in range(min(len(row), len(widths)))), default=1)
        heights.append(
            TOKENS['table']['baseRowHeightHwpUnit']
            + min(line_count, TOKENS['table']['maxEstimatedLines']) * TOKENS['table']['lineHeightHwpUnit']
        )
    return heights
