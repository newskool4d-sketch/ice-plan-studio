#!/usr/bin/env python3
"""설치 글꼴 검사 (모듈 겸 JSON CLI).

계획안 서식은 표지·장제목·본문·표에 서로 다른 글꼴을 쓰는데, 필수 글꼴이 없으면
한글이 임의 대체 렌더링해 줄바꿈·페이지 수까지 달라진다. 따라서 생성 전에 설치
현황을 확인하고, 누락 글꼴은 사용자 승인 없이 대체하지 않는다.

사용:
    from font_inspector import check_required_fonts
    report = check_required_fonts(['HY헤드라인M'], {'HY헤드라인M': ['HY울릉도M']})

    python font_inspector.py                    # 기본 프로필 검사 → JSON
    python font_inspector.py --list             # 설치 글꼴 전체 → JSON
    python font_inspector.py --required 굴림 돋움
"""
from __future__ import annotations

import argparse
import json
import sys

# 계획안 서식이 참조하는 글꼴과 승인 가능한 대체 후보.
# docs/BASELINE_ANALYSIS.md §4 실측 기준.
DEFAULT_REQUIRED = [
    'HY헤드라인M',   # 표지 제목·연월
    '함초롬바탕',     # 본문
    '맑은 고딕',      # 표
]
DEFAULT_SUBSTITUTES = {
    'HY헤드라인M': ['HY울릉도M', '휴먼엑스포', '맑은 고딕'],
    '함초롬바탕': ['휴먼명조', '바탕'],
    '맑은 고딕': ['함초롬돋움', '한컴산뜻돋움', '돋움'],
}

# 레지스트리 등록명은 "HCR Batang"처럼 영문일 수 있어 별칭으로 함께 조회한다.
FONT_ALIASES = {
    '맑은 고딕': ['malgun'],
    '함초롬바탕': ['hcr batang'],
    '함초롬돋움': ['hcr dotum'],
    '휴먼명조': ['humanmyeongjo'],
    'HY울릉도M': ['ulleungdo'],
    '한컴산뜻돋움': ['sandoll'],
}


class FontInspectionError(RuntimeError):
    """글꼴 목록 자체를 읽지 못한 경우. 설치됨으로 간주하면 안 된다."""


def list_installed_fonts() -> list[str]:
    """Windows 시스템·사용자 글꼴 등록명을 모두 반환한다.

    두 하이브를 모두 읽으며, 어느 쪽도 읽지 못하면 예외를 던진다
    (빈 목록을 반환해 '전부 미설치'로 오판하거나, 반대로 검사 실패를
    '설치됨'으로 넘기지 않기 위해서다).
    """
    if sys.platform != 'win32':
        raise FontInspectionError(f'지원하지 않는 플랫폼: {sys.platform}')

    import winreg

    subkey = r'SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts'
    names: set[str] = set()
    errors: list[str] = []

    for hive, label in ((winreg.HKEY_LOCAL_MACHINE, 'system'),
                        (winreg.HKEY_CURRENT_USER, 'user')):
        try:
            with winreg.OpenKey(hive, subkey) as key:
                index = 0
                while True:
                    try:
                        name, _value, _type = winreg.EnumValue(key, index)
                    except OSError:
                        break
                    names.add(name)
                    index += 1
        except OSError as exc:
            errors.append(f'{label}: {exc}')

    if errors and not names:
        raise FontInspectionError('글꼴 레지스트리를 읽지 못했습니다: ' + '; '.join(errors))
    return sorted(names)


def _normalize(text: str) -> str:
    return text.replace(' ', '').lower()


def _find(font: str, installed_norm: dict[str, str]) -> str | None:
    """설치 목록에서 글꼴을 찾아 실제 등록명을 반환. 없으면 None."""
    for needle in [font, *FONT_ALIASES.get(font, [])]:
        key = _normalize(needle)
        for norm, original in installed_norm.items():
            if key in norm:
                return original
    return None


def check_required_fonts(required=None, substitutes=None) -> dict:
    """필수 글꼴 설치 여부와 대체 후보를 판정한다.

    반환: {ok, installedCount, results[], missing[], error}
      - ok:      필수 글꼴이 모두 설치됨
      - results: 글꼴별 {font, installed, registeredName, substitutes[]}
      - error:   검사 자체가 실패한 경우 사유 (이때 ok는 False)
    """
    required = list(required if required is not None else DEFAULT_REQUIRED)
    substitutes = dict(substitutes if substitutes is not None else DEFAULT_SUBSTITUTES)

    try:
        installed = list_installed_fonts()
    except FontInspectionError as exc:
        # 검사 실패를 설치됨으로 간주하지 않는다.
        return {
            'ok': False,
            'error': str(exc),
            'installedCount': 0,
            'results': [{'font': f, 'installed': False, 'registeredName': None,
                         'substitutes': []} for f in required],
            'missing': required,
        }

    installed_norm = {_normalize(n): n for n in installed}
    results = []
    for font in required:
        found = _find(font, installed_norm)
        available_subs = []
        if found is None:
            available_subs = [s for s in substitutes.get(font, [])
                              if _find(s, installed_norm) is not None]
        results.append({
            'font': font,
            'installed': found is not None,
            'registeredName': found,
            'substitutes': available_subs,
        })

    missing = [r['font'] for r in results if not r['installed']]
    return {
        'ok': not missing,
        'error': None,
        'installedCount': len(installed),
        'results': results,
        'missing': missing,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description='설치 글꼴 검사')
    parser.add_argument('--list', action='store_true', help='설치 글꼴 전체를 출력')
    parser.add_argument('--required', nargs='*', help='검사할 글꼴 (기본: 계획안 프로필)')
    args = parser.parse_args()

    sys.stdout.reconfigure(encoding='utf-8')

    if args.list:
        try:
            fonts = list_installed_fonts()
        except FontInspectionError as exc:
            print(json.dumps({'error': str(exc), 'fonts': []}, ensure_ascii=False))
            return 1
        print(json.dumps({'error': None, 'count': len(fonts), 'fonts': fonts},
                         ensure_ascii=False, indent=2))
        return 0

    report = check_required_fonts(args.required if args.required else None)
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if report['ok'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
