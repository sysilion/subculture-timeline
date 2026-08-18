"""블루 아카이브 파서 — bluearchive.wiki Cargo API

위키가 Cargo 확장을 쓰므로 HTML 스크래핑 대신 구조화된 JSON을 받는다.
페이지 레이아웃이 바뀌어도 깨지지 않는다.
"""
import requests
from datetime import date, datetime, timedelta

API = "https://bluearchive.wiki/w/api.php"
HDR = {"User-Agent": "subculture-timeline/1.0 (+https://github.com/)"}

# 글로벌 서버만 대상 (JP 선행 일정은 제외)
SERVER = "GL"


def _cargo(tables: str, fields: str, where: str, order_by: str, limit: int = 200) -> list[dict]:
    r = requests.get(API, headers=HDR, timeout=20, params={
        "action":   "cargoquery",
        "tables":   tables,
        "fields":   fields,
        "where":    where,
        "order_by": order_by,
        "limit":    str(limit),
        "format":   "json",
    })
    r.raise_for_status()
    data = r.json()
    if "error" in data:
        raise RuntimeError(data["error"].get("info", "cargo error"))
    return [row.get("title", {}) for row in data.get("cargoquery", [])]


def _to_date(s: str, is_end: bool = False) -> date | None:
    """'2026-09-01 02:00:00' → date. 종료가 새벽이면 실질 마지막 날은 전날."""
    s = (s or "").strip()
    if not s:
        return None
    try:
        dt = datetime.strptime(s, "%Y-%m-%d %H:%M:%S")
    except ValueError:
        try:
            return date.fromisoformat(s[:10])
        except ValueError:
            return None
    d = dt.date()
    if is_end and dt.hour < 6:
        d -= timedelta(days=1)
    return d


def _fresh(start: date | None, end: date | None) -> bool:
    return bool(start and end and end >= start and (date.today() - end).days <= 90)


def _parse_banners() -> list[dict]:
    rows = _cargo(
        tables="banners",
        fields="NameEN,Rateup_character,Start_date,End_date,Type",
        where=f'Server="{SERVER}"',
        order_by="banners.Start_date DESC",
    )

    # 같은 기간의 픽업은 한 배너로 묶는다 (행마다 캐릭터가 하나씩 온다)
    grouped: dict[tuple, dict] = {}
    for row in rows:
        start = _to_date(row.get("Start date"))
        end   = _to_date(row.get("End date"), is_end=True)
        if not _fresh(start, end):
            continue
        g = grouped.setdefault((start, end), {"chars": [], "names": []})
        char = (row.get("Rateup character") or "").strip()
        name = (row.get("NameEN") or "").strip()
        if char and char not in g["chars"]:
            g["chars"].append(char)
        if name and name not in g["names"]:
            g["names"].append(name)

    entries = []
    for (start, end), g in grouped.items():
        chars = g["chars"]
        if chars:
            title = ", ".join(chars[:3])
            if len(chars) > 3:
                title += f" +{len(chars) - 3}"
        elif g["names"]:
            title = g["names"][0][:120]
        else:
            title = "Pickup Gacha"
        entries.append({
            "type":      "banner",
            "title":     title[:120],
            "subtitle":  "Pickup",
            "rarity":    3,          # 블루 아카이브 최고 등급은 ★3
            "start":     str(start),
            "end":       str(end),
            "version":   "",
            "tentative": False,
            "source":    "bluearchive.wiki",
            "_auto":     True,
        })
    return entries


def _parse_events() -> list[dict]:
    rows = _cargo(
        tables="events",
        fields="events._pageName=Page,NameEN,Start_date,End_date",
        where=f'Server="{SERVER}"',
        order_by="events.Start_date DESC",
    )

    entries = []
    seen: set[str] = set()
    for row in rows:
        start = _to_date(row.get("Start date"))
        end   = _to_date(row.get("End date"), is_end=True)
        if not _fresh(start, end):
            continue

        name_en = (row.get("NameEN") or "").strip()
        # 'Events/Mini Event/이름' → 마지막 세그먼트
        page_name = (row.get("Page") or "").split("/")[-1].strip()
        # NameEN이 서술형 문장인 경우가 있어, 길면 페이지명을 쓴다
        title = name_en if name_en and len(name_en) <= 60 else (page_name or name_en)
        title = title.split("\n")[0][:120]
        if not title:
            continue

        key = f"{title}|{start}"
        if key in seen:
            continue
        seen.add(key)

        entries.append({
            "type":      "event",
            "title":     title,
            "start":     str(start),
            "end":       str(end),
            "version":   "",
            "tentative": False,
            "source":    "bluearchive.wiki",
            "_auto":     True,
        })
    return entries


def parse() -> list[dict]:
    entries: list[dict] = []
    for label, fn in (("배너", _parse_banners), ("이벤트", _parse_events)):
        try:
            got = fn()
            entries.extend(got)
            print(f"  [bluearchive] {label} {len(got)}개")
        except Exception as e:
            print(f"  [bluearchive] {label} 파싱 실패: {e}")
    return entries
