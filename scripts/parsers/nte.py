"""이환(Neverness to Everness) 파서 — ntebuild.com 이벤트 캘린더

이 사이트는 일정을 schema.org Event(JSON-LD)로 노출한다. game8 스크래핑과 달리
표준 마크업이라 안정적이고, 배너·이벤트·업데이트가 한 페이지에 모여 있다.
"""
import re
from datetime import date

from .base import fetch, ld_json_events, within_window

URL = "https://www.ntebuild.com/events"

# "Alluring Shadows — Zankou Banner", "The Ichi-Daime — Nanally Rerun" 같은 형태
_BANNER_KW = re.compile(r'(banner|rerun|pickup|gacha)', re.I)


def _to_date(value: str) -> date | None:
    value = (value or "").strip()[:10]
    try:
        return date.fromisoformat(value)
    except ValueError:
        return None


def parse() -> list[dict]:
    try:
        html = fetch(URL)
    except Exception as e:
        print(f"  [nte] fetch 실패: {e}")
        return []

    events = ld_json_events(html)
    if not events:
        print(f"  [nte] Event 데이터 없음 (HTML {len(html)}자)")
        return []

    entries: list[dict] = []
    seen: set[str] = set()
    for ev in events:
        start = _to_date(ev.get("startDate"))
        end   = _to_date(ev.get("endDate"))
        if not within_window(start, end):
            continue

        name = (ev.get("name") or "").strip()
        if not name:
            continue
        key = f"{name}|{start}"
        if key in seen:
            continue
        seen.add(key)

        is_banner = bool(_BANNER_KW.search(name))
        entry = {
            "type":      "banner" if is_banner else "event",
            "title":     name[:120],
            "start":     str(start),
            "end":       str(end),
            "version":   "",
            "tentative": False,
            "source":    "ntebuild.com",
            "_auto":     True,
        }
        if is_banner:
            entry["rarity"] = 5
        entries.append(entry)

    banners = sum(1 for e in entries if e["type"] == "banner")
    print(f"  [nte] 배너 {banners}개, 이벤트 {len(entries) - banners}개")
    return entries
