"""HoYoverse 파서 — api.ennead.cc 비공식 API (원신·스타레일·ZZZ)"""
import requests
from datetime import date, datetime, timezone, timedelta

BASE = "https://api.ennead.cc/mihoyo"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
HDR = {"User-Agent": UA}

# 게임 ID → API slug 매핑
_SLUG = {
    "genshin":   "genshin",
    "starrail":  "starrail",
    "zzz":       "zenless",
    "honkai":    "honkai",
}


def _ts(unix: int | None) -> str | None:
    if not unix:
        return None
    return datetime.fromtimestamp(unix, tz=timezone.utc).strftime("%Y-%m-%d")


def parse(game_id: str) -> list[dict]:
    slug = _SLUG.get(game_id)
    if not slug:
        print(f"  [hoyoverse] {game_id} 지원 안 함")
        return []

    today = date.today()
    cutoff = today - timedelta(days=90)
    entries: list[dict] = []

    # calendar 엔드포인트 (배너+이벤트)
    try:
        r = requests.get(f"{BASE}/{slug}/calendar", headers=HDR, timeout=15, params={"lang": "ko"})
        r.raise_for_status()
        data = r.json()
    except Exception as e:
        print(f"  [{game_id}] calendar fetch 실패: {e}")
        data = {}

    # ── 배너 ──
    for b in data.get("banners", []):
        start_s = _ts(b.get("start_time"))
        end_s   = _ts(b.get("end_time"))
        if not start_s or not end_s:
            continue
        try:
            if date.fromisoformat(end_s) < cutoff:
                continue
        except ValueError:
            continue

        chars   = [c["name"] for c in b.get("characters", [])[:3]]
        weapons = [w["name"] for w in b.get("weapons", [])[:2]]
        lc      = [l["name"] for l in b.get("light_cones", [])[:2]]
        featured = chars or weapons or lc
        subtitle = ", ".join(featured) if featured else ""

        banner_name = b.get("name") or ""
        if not banner_name:
            if chars:
                banner_name = chars[0]
            elif weapons:
                banner_name = weapons[0]
            elif lc:
                banner_name = lc[0]
            else:
                banner_name = "배너"

        entries.append({
            "type":      "banner",
            "title":     banner_name,
            "subtitle":  subtitle,
            "rarity":    5,
            "start":     start_s,
            "end":       end_s,
            "version":   b.get("version", ""),
            "tentative": False,
            "source":    "api.ennead.cc",
            "_auto":     True,
        })

    # ── 이벤트 ──
    for ev in data.get("events", []):
        start_s = _ts(ev.get("start_time"))
        end_s   = _ts(ev.get("end_time"))
        if not start_s or not end_s:
            continue
        try:
            if date.fromisoformat(end_s) < cutoff:
                continue
        except ValueError:
            continue

        entries.append({
            "type":      "event",
            "title":     ev.get("name", "이벤트"),
            "start":     start_s,
            "end":       end_s,
            "version":   "",
            "tentative": False,
            "source":    "api.ennead.cc",
            "_auto":     True,
        })

    # ── 도전 콘텐츠 (심연/기억의 전장 등) ──
    for ch in data.get("challenges", []):
        start_s = _ts(ch.get("start_time"))
        end_s   = _ts(ch.get("end_time"))
        if not start_s or not end_s:
            continue
        try:
            if date.fromisoformat(end_s) < cutoff:
                continue
        except ValueError:
            continue

        entries.append({
            "type":      "event",
            "title":     ch.get("name", "도전"),
            "start":     start_s,
            "end":       end_s,
            "version":   "",
            "tentative": False,
            "source":    "api.ennead.cc",
            "_auto":     True,
        })

    banners = sum(1 for e in entries if e["type"] == "banner")
    events  = sum(1 for e in entries if e["type"] == "event")
    print(f"  [{game_id}] 배너 {banners}개, 이벤트 {events}개")
    return entries
