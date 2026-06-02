#!/usr/bin/env python3
"""
서브컬쳐 게임 타임라인 — 배너/이벤트 일정 자동 갱신 스크립트
매일 GitHub Actions cron에서 실행 (UTC 00:00 = KST 09:00)

실행 방법:
  pip install requests beautifulsoup4 lxml
  python scripts/update_data.py
"""
import json, sys, os
from datetime import date
from pathlib import Path

ROOT = Path(__file__).parent.parent
DATA_FILE = ROOT / "data" / "games.json"

sys.path.insert(0, str(Path(__file__).parent))
from parsers import genshin, game8 as g8


def load_games() -> dict:
    with open(DATA_FILE) as f:
        return json.load(f)


def merge_entries(existing: list, fresh: list) -> tuple[list, int]:
    """
    기존 entries와 새로 파싱한 entries를 병합.
    - 수동 작성(_auto 없는) 항목 보존
    - 자동 항목은 title+start 키로 dedupe, 새 것으로 교체
    - 90일 이상 지난 자동 항목 제거
    """
    manual = [e for e in existing if not e.get("_auto")]
    auto_fresh = {f"{e['title']}|{e['start']}": e for e in fresh}

    kept = []
    for e in existing:
        if not e.get("_auto"):
            kept.append(e)  # 수동 항목은 항상 유지
            continue
        key = f"{e['title']}|{e['start']}"
        if key in auto_fresh:
            kept.append(auto_fresh.pop(key))  # 갱신
        else:
            # 오래된 자동 항목 제거 (90일 초과)
            try:
                end = date.fromisoformat(e["end"])
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


def run():
    print("=== 배너/이벤트 자동 갱신 시작 ===")
    data = load_games()
    today = str(date.today())
    total_new = 0
    updated_games = []

    for game in data["games"]:
        gid = game["id"]
        print(f"\n[{gid}] 파싱 중...")

        try:
            if gid == "genshin":
                fresh = genshin.parse()
            elif gid in g8.GAME8_URLS:
                fresh = g8.parse(gid, g8.GAME8_URLS[gid])
            else:
                print(f"  [{gid}] 파서 없음, 건너뜀")
                continue
        except Exception as e:
            print(f"  [{gid}] 파서 예외: {e}")
            continue

        if not fresh:
            print(f"  [{gid}] 결과 없음")
            continue

        new_entries, new_count = merge_entries(game.get("entries", []), fresh)
        if new_count > 0 or len(new_entries) != len(game.get("entries", [])):
            game["entries"] = new_entries
            updated_games.append(gid)
            total_new += new_count
            print(f"  [{gid}] 항목 갱신: 총 {len(new_entries)}개 (+{new_count} 신규)")

    if not updated_games:
        print("\n변경 없음. 종료.")
        return False

    data["meta"]["lastUpdated"] = today
    data["meta"]["autoUpdated"] = today

    with open(DATA_FILE, "w") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    print(f"\n=== 갱신 완료: {len(updated_games)}개 게임, {total_new}개 신규 항목 ===")
    print(f"업데이트된 게임: {', '.join(updated_games)}")
    return True


if __name__ == "__main__":
    changed = run()
    sys.exit(0 if changed else 0)  # 항상 0 (Actions가 commit 여부 판단)
