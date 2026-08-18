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


# games.json의 날짜는 KST 기준(meta.note 참조).
# UTC로 변환하면 KST 새벽에 끝나는 일정이 하루 앞당겨 기록된다.
KST = timezone(timedelta(hours=9))


def _top_names(items, limit: int) -> list[str]:
    """픽업 대상 이름 추출. 최고 등급(5성 / S랭크)이 있으면 그것만 쓴다."""
    if not items:
        return []
    top = [i for i in items if str(i.get("rarity", "")) in ("5", "S")]
    pool = top or items
    return [i.get("name", "").strip() for i in pool[:limit] if i.get("name")]


def _ts(unix: int | None) -> str | None:
    if not unix:
        return None
    return datetime.fromtimestamp(unix, tz=KST).strftime("%Y-%m-%d")


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

        # 게임마다 필드명이 다르다: 원신 characters/weapons,
        # 스타레일 characters/light_cones, ZZZ agents/w_engines
        chars = _top_names(b.get("characters") or b.get("agents"), 3)
        gear  = _top_names(b.get("weapons") or b.get("light_cones") or b.get("w_engines"), 2)
        featured = chars or gear
        subtitle = ", ".join(featured) if featured else ""

        banner_name = (b.get("name") or "").strip()
        if not banner_name:
            banner_name = featured[0] if featured else "배너"
        # 제목과 같은 내용을 부제로 반복하지 않는다
        if subtitle == banner_name:
            subtitle = ""

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
