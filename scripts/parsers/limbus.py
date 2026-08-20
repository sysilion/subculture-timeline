"""림버스 컴퍼니 파서 — limbuscompany.wiki.gg

이 위키에는 Cargo가 없고 DPL로 표가 서버 렌더되므로, parse API로 받은
HTML의 표에서 [이름, 시작일, 종료일] 조합을 읽는다.
"""
import re
from datetime import date

from .base import wiki_parse_html, within_window, MONTH_MAP

API = "https://limbuscompany.wiki.gg/api.php"
PAGES = ["Events"]

# "April 20th, 2023" / "May 4, 2023"
_DATE = re.compile(
    r'([A-Z][a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s*(20\d{2})'
)
_TAG = re.compile(r'<[^>]+>')


def _to_date(m: re.Match) -> date | None:
    mo = MONTH_MAP.get(m.group(1)[:3].lower())
    if not mo:
        return None
    try:
        return date(int(m.group(3)), mo, int(m.group(2)))
    except ValueError:
        return None


def _cells(row_html: str) -> list[str]:
    out = []
    for c in re.findall(r'<t[dh][^>]*>(.*?)</t[dh]>', row_html, re.S):
        text = _TAG.sub(' ', c)
        text = re.sub(r'\s+', ' ', text).strip()
        if text:
            out.append(text)
    return out


def _parse_page(page: str) -> list[dict]:
    html = wiki_parse_html(API, page)
    entries: list[dict] = []
    seen: set[str] = set()

    for row in re.findall(r'<tr>(.*?)</tr>', html, re.S):
        cells = _cells(row)
        if len(cells) < 3:
            continue

        dates = [m for m in (_DATE.search(c) for c in cells) if m]
        if len(dates) < 2:
            continue
        start = _to_date(dates[0])
        end   = _to_date(dates[1])
        if not within_window(start, end):
            continue

        # 날짜가 없는 첫 셀이 이름
        name = next((c for c in cells if not _DATE.search(c) and len(c) > 2), "")
        name = name[:120].strip()
        if not name:
            continue

        key = f"{name}|{start}"
        if key in seen:
            continue
        seen.add(key)

        entries.append({
            "type":      "event",
            "title":     name,
            "start":     str(start),
            "end":       str(end),
            "version":   "",
            "tentative": False,
            "source":    "limbuscompany.wiki.gg",
            "_auto":     True,
        })
    return entries


def parse() -> list[dict]:
    entries: list[dict] = []
    for page in PAGES:
        try:
            got = _parse_page(page)
            entries.extend(got)
            print(f"  [limbus] {page}: {len(got)}개")
        except Exception as e:
            print(f"  [limbus] {page} 파싱 실패: {e}")
    return entries
