#!/usr/bin/env python3
"""
서브컬쳐 게임 타임라인 — 배너/이벤트 일정 자동 갱신 스크립트
매일 GitHub Actions cron에서 실행 (UTC 00:00 = KST 09:00)

실행 방법:
  pip install requests beautifulsoup4 lxml
  python scripts/update_data.py
"""
import json, sys, os, re
from datetime import date
from pathlib import Path

ROOT = Path(__file__).parent.parent
DATA_FILE = ROOT / "data" / "games.json"

sys.path.insert(0, str(Path(__file__).parent))
from parsers import (
    genshin, game8 as g8, hoyoverse,
    nikke as nikke_parser, bluearchive as ba_parser,
    umamusume as uma_parser, endfield as ef_parser,
    limbus as limbus_parser, wuwa as wuwa_parser,
)

# GitHub Actions의 데이터센터 IP에서는 아래 소스가 차단되어 항상 0건이 된다.
# (game8은 2KB짜리 차단 페이지, nikke.gg는 429) 자동 갱신 대상에서 빼두고,
# 로컬에서 손으로 돌릴 때는 UPDATE_ALL=1 로 강제 실행한다.
CI_BLOCKED = {
    "wuwa":      "wuwatracker.com이 403, game8.co도 차단 페이지 반환",
    "nte":       "game8.co가 데이터센터 IP에 차단 페이지 반환",
    "mongil":    "game8.co가 데이터센터 IP에 차단 페이지 반환",
    "umamusume": "game8.co가 데이터센터 IP에 차단 페이지 반환",
    "nikke":     "nikke.gg가 429(Too Many Requests) 반환",
}

# SYNC_PROXY(주거/사설망 출구)가 있으면 다시 뚫리는 소스.
# game8은 프록시를 거쳐도 202 Cloudflare 챌린지를 돌려주므로 제외 대상에 남긴다.
PROXY_UNBLOCKS = {"wuwa", "nikke"}

FORCE_ALL = os.environ.get("UPDATE_ALL") == "1"


def blocked_games() -> dict:
    """이번 실행에서 건너뛸 게임 목록."""
    if os.environ.get("SYNC_PROXY", "").strip():
        return {k: v for k, v in CI_BLOCKED.items() if k not in PROXY_UNBLOCKS}
    return CI_BLOCKED


def load_games() -> dict:
    # 한글·일본어 제목이 들어가므로 인코딩을 로케일에 맡기지 않는다
    with open(DATA_FILE, encoding="utf-8") as f:
        return json.load(f)


def save_games(data: dict) -> None:
    """임시 파일에 쓴 뒤 교체 — 도중에 중단되어도 games.json이 깨지지 않는다."""
    tmp = DATA_FILE.with_name(DATA_FILE.name + ".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp, DATA_FILE)


def entry_key(e: dict) -> str:
    """병합용 키. 수동 항목에 필드가 빠져 있어도 KeyError로 죽지 않게 한다."""
    return f"{e.get('title', '')}|{e.get('start', '')}"


def sanitize_text(s: str) -> str:
    if not s:
        return ""
    return re.sub(r'<[^>]+>', '', s).strip()


def merge_entries(existing: list, fresh: list) -> tuple[list, int]:
    """
    기존 entries와 새로 파싱한 entries를 병합.
    - 수동 작성(_auto 없는) 항목 보존
    - 자동 항목은 title+start 키로 dedupe, 새 것으로 교체
    - 90일 이상 지난 자동 항목 제거
    """
    # fresh 항목 위생화
    for e in fresh:
        if "title" in e:
            e["title"] = sanitize_text(e["title"])
        if "subtitle" in e:
            e["subtitle"] = sanitize_text(e["subtitle"])

    # existing 항목 위생화 (기존 _auto 항목 내 잔존 태그 제거)
    for e in existing:
        if e.get("_auto"):
            if "title" in e:
                e["title"] = sanitize_text(e["title"])
            if "subtitle" in e:
                e["subtitle"] = sanitize_text(e["subtitle"])

    auto_fresh = {entry_key(e): e for e in fresh}

    kept = []
    for e in existing:
        if not e.get("_auto"):
            kept.append(e)  # 수동 항목은 항상 유지
            # 수동 항목과 같은 키의 fresh 항목이 있다면 중복 방지를 위해 제거
            auto_fresh.pop(entry_key(e), None)
            continue
        key = entry_key(e)
        if key in auto_fresh:
            kept.append(auto_fresh.pop(key))  # 갱신
        else:
            # 오래된 자동 항목 제거 (90일 초과)
            try:
                end = date.fromisoformat(e.get("end", ""))
                if (date.today() - end).days <= 90:
                    kept.append(e)
            except Exception:
                pass

    # 새로 발견된 항목 추가
    new_count = len(auto_fresh)
    kept.extend(auto_fresh.values())

    # 타입 순서 정렬: version → banner → event
    order = {"version": 0, "banner": 1, "event": 2}
    kept.sort(key=lambda e: (order.get(e.get("type","event"), 2), e.get("start","9999")))

    return kept, new_count


def report(attempted: list, failed: list, updated: list, total_new: int,
           skipped: list | None = None) -> None:
    """실행 결과를 콘솔과 GitHub Actions(output/summary)에 남긴다.

    파서가 조용히 0건을 반환해도 워크플로우가 초록불로 끝나던 문제를 막기 위해,
    실패 목록을 후속 스텝이 읽을 수 있는 형태로 내보낸다.
    """
    skipped = skipped or []
    if skipped:
        print(f"\n자동 갱신 제외 ({len(skipped)}개): {', '.join(skipped)}")
    if failed:
        print(f"⚠ 파싱 실패/무수확 ({len(failed)}/{len(attempted)}): {', '.join(failed)}")
    else:
        print(f"모든 파서 정상 ({len(attempted)}개)")

    out = os.environ.get("GITHUB_OUTPUT")
    if out:
        with open(out, "a", encoding="utf-8") as f:
            f.write(f"failed={','.join(failed)}\n")
            f.write(f"failed_count={len(failed)}\n")
            f.write(f"attempted_count={len(attempted)}\n")

    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as f:
            f.write("## 배너/이벤트 자동 갱신\n\n")
            f.write(f"- 파서 실행: **{len(attempted)}개**\n")
            f.write(f"- 갱신된 게임: **{len(updated)}개** (신규 {total_new}건)\n")
            if skipped:
                f.write(f"- 제외(소스 차단): {', '.join(skipped)}\n")
            if failed:
                f.write(f"- ⚠ 결과 없음: **{', '.join(failed)}**\n")
            else:
                f.write("- ✅ 실패 없음\n")


def run():
    print("=== 배너/이벤트 자동 갱신 시작 ===")
    blocked = blocked_games()
    proxy = os.environ.get("SYNC_PROXY", "").strip()
    if proxy:
        # 자격증명이 로그에 남지 않도록 가린다
        print(f"프록시 경유: {re.sub(r'//[^@]*@', '//***@', proxy)}")
    data = load_games()
    today = str(date.today())
    total_new = 0
    updated_games = []
    failed_games = []
    attempted_games = []
    skipped_games = []

    for game in data["games"]:
        gid = game["id"]

        if gid in blocked and not FORCE_ALL:
            print(f"\n[{gid}] 자동 갱신 제외 — {blocked[gid]}")
            skipped_games.append(gid)
            continue

        print(f"\n[{gid}] 파싱 중...")

        try:
            if gid == "genshin":
                # api.ennead.cc 우선, 실패 시 paimon.moe fallback
                fresh = hoyoverse.parse("genshin")
                if not fresh:
                    fresh = genshin.parse()
            elif gid == "starrail":
                fresh = hoyoverse.parse(gid)
            elif gid == "zzz":
                # api.ennead.cc가 zenless calendar를 한국어로 제공한다 (game8은 fallback)
                fresh = hoyoverse.parse(gid)
                if not fresh and gid in g8.GAME8_URLS:
                    fresh = g8.parse(gid, g8.GAME8_URLS[gid])
            elif gid == "nikke":
                fresh = nikke_parser.parse()
            elif gid == "bluearchive":
                fresh = ba_parser.parse()
            elif gid == "umamusume":
                fresh = uma_parser.parse()
            elif gid == "endfield":
                # game8 대신 위키 Cargo API (아시아 서버 = 한국 일정)
                fresh = ef_parser.parse()
            elif gid == "limbus":
                fresh = limbus_parser.parse()
            elif gid == "wuwa":
                # wuwatracker 타임라인(JSON 페이로드), game8은 fallback
                fresh = wuwa_parser.parse()
                if not fresh and gid in g8.GAME8_URLS:
                    fresh = g8.parse(gid, g8.GAME8_URLS[gid])
            elif gid in g8.GAME8_URLS:
                fresh = g8.parse(gid, g8.GAME8_URLS[gid])
            else:
                print(f"  [{gid}] 파서 없음, 건너뜀")
                continue
            attempted_games.append(gid)
        except Exception as e:
            print(f"  [{gid}] 파서 예외: {e}")
            failed_games.append(gid)
            continue

        if not fresh:
            print(f"  [{gid}] 결과 없음")
            failed_games.append(gid)
            continue

        new_entries, new_count = merge_entries(game.get("entries", []), fresh)
        if new_count > 0 or len(new_entries) != len(game.get("entries", [])):
            game["entries"] = new_entries
            updated_games.append(gid)
            total_new += new_count
            print(f"  [{gid}] 항목 갱신: 총 {len(new_entries)}개 (+{new_count} 신규)")

    report(attempted_games, failed_games, updated_games, total_new, skipped_games)

    if not updated_games:
        print("\n변경 없음. 종료.")
        return False

    data["meta"]["lastUpdated"] = today
    data["meta"]["autoUpdated"] = today

    save_games(data)

    print(f"\n=== 갱신 완료: {len(updated_games)}개 게임, {total_new}개 신규 항목 ===")
    print(f"업데이트된 게임: {', '.join(updated_games)}")
    return True


if __name__ == "__main__":
    run()  # 종료 코드는 항상 0 — 커밋 여부는 Actions가 git diff로 판단한다
    sys.exit(0)
