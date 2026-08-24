"""우마무스메 파서 — uma.moe 리소스 API

uma.moe가 매니페스트로 공개하는 아티팩트 중 banner_timeline.json을 읽는다.
게임 데이터에서 생성된 목록이라 game8 서술형 페이지를 긁는 것보다 정확하고,
확정/추정 여부(is_confirmed)까지 있어 tentative 표시에 그대로 쓸 수 있다.
"""
import json
from datetime import date, datetime, timedelta, timezone

from .base import fetch, within_window

BASE = "https://uma.moe"
MANIFEST_URL = f"{BASE}/resources/manifest.json"

# 글로벌 서버는 JST 기준으로 운영되고 KST와 같은 오프셋을 쓴다
KST = timezone(timedelta(hours=9))

# 상시 콘텐츠(수백~수천 일짜리)는 타임라인에 의미가 없어 제외한다
MAX_DURATION_DAYS = 180

# 이 소스는 JP 일정을 기반으로 수년치 예측을 함께 제공한다.
# 화면의 최대 표시 범위(+120일)에 맞춰 자른다.
FUTURE_DAYS = 120

# 천장 교환용 상시 배너는 제목이 "Fuji Kiseki + 45 more" 식이라 타임라인에서 의미가 없다
SKIP_GACHA_TYPES = {"guaranteed"}


def _to_kst_date(iso: str, is_end: bool = False) -> date | None:
    iso = (iso or "").strip()
    if not iso:
        return None
    try:
        dt = datetime.fromisoformat(iso.replace("Z", "+00:00")).astimezone(KST)
    except ValueError:
        return None
    d = dt.date()
    # 점검 직후 시작해 오전에 끝나는 형태라, 오전 종료 일정의 마지막 날은 전날이다
    if is_end and dt.hour < 12:
        d -= timedelta(days=1)
    return d


def _artifact_path(name: str) -> str | None:
    manifest = json.loads(fetch(MANIFEST_URL))
    for a in manifest.get("artifacts", []):
        if a.get("name") == name:
            return a.get("path")
    return None


def parse() -> list[dict]:
    try:
        path = _artifact_path("banner_timeline.json")
        if not path:
            print("  [umamusume] banner_timeline.json 아티팩트 없음")
            return []
        raw = json.loads(fetch(BASE + path))
    except Exception as e:
        print(f"  [umamusume] fetch 실패: {e}")
        return []

    events = raw.get("events") or []
    entries: list[dict] = []
    seen: set[str] = set()

    for ev in events:
        if not isinstance(ev, dict):
            continue
        if (ev.get("banner_duration_days") or 0) > MAX_DURATION_DAYS:
            continue

        start = _to_kst_date(ev.get("global_release_date"))
        end   = _to_kst_date(ev.get("estimated_end_date"), is_end=True)
        if not within_window(start, end, future_days=FUTURE_DAYS):
            continue

        title = (ev.get("title") or "").strip()
        if not title:
            continue

        # gacha_id가 있으면 뽑기 배너, 없으면 이벤트/캠페인
        is_banner = ev.get("gacha_id") is not None
        kind = (ev.get("gacha_type_name") or ev.get("type") or "").strip()
        if kind in SKIP_GACHA_TYPES:
            continue

        key = f"{title}|{start}|{kind}"
        if key in seen:
            continue
        seen.add(key)

        entry = {
            "type":      "banner" if is_banner else "event",
            "title":     title[:120],
            "start":     str(start),
            "end":       str(end),
            "version":   "",
            # 아직 확정되지 않은 일정은 변동 가능함을 표시한다
            "tentative": not bool(ev.get("is_confirmed")),
            "source":    "uma.moe",
            "_auto":     True,
        }
        if kind:
            entry["subtitle"] = kind.replace("_", " ")[:60]
        if is_banner:
            entry["rarity"] = 3
        entries.append(entry)

    banners = sum(1 for e in entries if e["type"] == "banner")
    tent = sum(1 for e in entries if e["tentative"])
    print(f"  [umamusume] 배너 {banners}개, 이벤트 {len(entries) - banners}개 (미확정 {tent}개)")
    return entries
