"""명일방주: 엔드필드 파서 — endfield.wiki.gg Cargo API

game8 HTML 스크래핑은 CI(데이터센터 IP)에서 차단되므로 위키 API로 받는다.
아시아 서버(AsiaStartTime/AsiaEndTime) 기준 = 한국 서버 일정.
"""
from .base import cargo_query, wiki_datetime, within_window

API = "https://endfield.wiki.gg/api.php"


def _rows(tables: str, fields: str, order_field: str) -> list[dict]:
    return cargo_query(API, tables=tables, fields=fields,
                       order_by=f"{tables}.{order_field} DESC", limit=200)


def _parse_banners() -> list[dict]:
    rows = _rows("Banners", "Banner,RateUpOperator,AsiaStartTime,AsiaEndTime", "AsiaStartTime")
    entries = []
    for r in rows:
        start = wiki_datetime(r.get("AsiaStartTime"))
        end   = wiki_datetime(r.get("AsiaEndTime"), is_end=True)
        if not within_window(start, end):
            continue
        title = (r.get("Banner") or "").strip()
        op    = (r.get("RateUpOperator") or "").strip()
        if not title:
            title = op or "배너"
        entries.append({
            "type":      "banner",
            "title":     title[:120],
            "subtitle":  op[:120],
            "rarity":    6,          # 엔드필드 최고 등급은 ★6
            "start":     str(start),
            "end":       str(end),
            "version":   "",
            "tentative": False,
            "source":    "endfield.wiki.gg",
            "_auto":     True,
        })
    return entries


def _parse_events() -> list[dict]:
    rows = _rows("Events", "Event,Type,AsiaStartTime,AsiaEndTime", "AsiaStartTime")
    entries = []
    seen: set[str] = set()
    for r in rows:
        start = wiki_datetime(r.get("AsiaStartTime"))
        end   = wiki_datetime(r.get("AsiaEndTime"), is_end=True)
        if not within_window(start, end):
            continue
        title = (r.get("Event") or "").strip()
        if not title:
            continue
        key = f"{title}|{start}"
        if key in seen:
            continue
        seen.add(key)
        entries.append({
            "type":      "event",
            "title":     title[:120],
            "subtitle":  (r.get("Type") or "").strip()[:60],
            "start":     str(start),
            "end":       str(end),
            "version":   "",
            "tentative": False,
            "source":    "endfield.wiki.gg",
            "_auto":     True,
        })
    return entries


def parse() -> list[dict]:
    entries: list[dict] = []
    for label, fn in (("배너", _parse_banners), ("이벤트", _parse_events)):
        try:
            got = fn()
            entries.extend(got)
            print(f"  [endfield] {label} {len(got)}개")
        except Exception as e:
            print(f"  [endfield] {label} 파싱 실패: {e}")
    return entries
