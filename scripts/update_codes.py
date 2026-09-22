#!/usr/bin/env python3
"""
서브컬쳐 게임 타임라인 — 게임별 리딤 코드 자동 수집 스크립트
update_data.py와 같은 주기로 GitHub Actions에서 실행된다.

실행 방법:
  pip install -r scripts/requirements.txt
  python scripts/update_codes.py
"""
import json, os, sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).parent.parent
GAMES_FILE = ROOT / "data" / "games.json"
CODES_FILE = ROOT / "data" / "codes.json"

sys.path.insert(0, str(Path(__file__).parent))
from parsers.codes import hoyo, pockettactics as pt

# 웹 교환 페이지가 있는 게임만 링크를 둔다. 나머지는 게임 안에서만 입력할 수 있다.
REDEEM_URLS = {
    "genshin":  "https://genshin.hoyoverse.com/ko/gift",
    "starrail": "https://hsr.hoyoverse.com/gift",
    "zzz":      "https://zenless.hoyoverse.com/redemption",
}

# 게임별 수집기 (소스 이름, 파서). 앞에 둔 소스의 보상 문구가 우선한다.
HOYO = (hoyo.SOURCE, hoyo.parse)
PT   = (pt.SOURCE, pt.parse)

COLLECTORS = {
    "genshin":     [HOYO, PT],
    "starrail":    [HOYO, PT],
    "zzz":         [HOYO, PT],
    "wuwa":        [PT],
    "nikke":       [PT],
    "bluearchive": [PT],
    "umamusume":   [PT],
    "endfield":    [PT],
    "nte":         [PT],
    "aniimo":      [PT],
    "mongil":      [PT],
}

# pockettactics.com이 데이터센터 IP를 막을 경우를 대비해 프록시 유무를 기록해 둔다.
PROXY = os.environ.get("SYNC_PROXY", "").strip()


def load_json(path: Path) -> dict:
    if not path.exists():
        return {}
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def save_codes(data: dict) -> None:
    """임시 파일에 쓴 뒤 교체 — 도중에 끊겨도 codes.json이 깨지지 않는다."""
    tmp = CODES_FILE.with_name(CODES_FILE.name + ".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp, CODES_FILE)


def collect(game_id: str) -> tuple[list[dict], set[str]]:
    """게임 하나의 코드를 모은다. (코드 목록, 이번에 응답한 소스 이름)"""
    merged: dict[str, dict] = {}
    answered: set[str] = set()

    for source, fn in COLLECTORS.get(game_id, []):
        try:
            got = fn(game_id)
        except Exception as e:
            print(f"  [{game_id}] {source} 실패: {e}")
            continue
        answered.add(source)
        for item in got:
            key = item["code"].upper()
            # 먼저 들어온 소스를 신뢰한다. 보상이 비어 있을 때만 뒷 소스로 채운다.
            if key in merged:
                if not merged[key].get("reward") and item.get("reward"):
                    merged[key]["reward"] = item["reward"]
                continue
            merged[key] = dict(item)

    return list(merged.values()), answered


def merge(existing: list, fresh: list, today: str, answered: set[str]) -> list[dict]:
    """
    기존 목록과 새로 수집한 목록을 합친다.
    - 손으로 넣은(_auto 없는) 코드는 소스에서 사라져도 남긴다
    - 이미 알던 코드는 처음 본 날짜(added)를 유지한다
    - 응답한 소스에서 빠진 자동 코드는 만료된 것으로 보고 지운다
    - 이번에 응답하지 않은 소스의 코드는 판단할 근거가 없으므로 그대로 둔다
      (소스 한 곳이 잠깐 죽었다고 그쪽 코드가 통째로 사라지면 안 된다)
    """
    known = {c.get("code", "").upper(): c for c in existing}
    out: list[dict] = []

    for item in fresh:
        key = item["code"].upper()
        prev = known.get(key)
        out.append({
            "code":   item["code"],
            "reward": item.get("reward", ""),
            "source": item.get("source", ""),
            "added":  (prev or {}).get("added", today),
            "_auto":  True,
        })

    seen = {c["code"].upper() for c in out}
    for c in existing:
        if c.get("code", "").upper() in seen:
            continue
        if not c.get("_auto") or c.get("source") not in answered:
            out.append(c)

    # 최근에 추가된 코드가 위로 온다
    out.sort(key=lambda c: (c.get("added", ""), c.get("code", "")), reverse=True)
    return out


def report(failed: list, empty: list, counts: dict) -> None:
    total = sum(counts.values())
    print(f"\n수집 완료: {len(counts)}개 게임, 코드 {total}개")
    if empty:
        print(f"코드 없음: {', '.join(empty)}")
    if failed:
        print(f"⚠ 소스 응답 없음 ({len(failed)}개): {', '.join(failed)}")

    out = os.environ.get("GITHUB_OUTPUT")
    if out:
        with open(out, "a", encoding="utf-8") as f:
            f.write(f"codes_failed={','.join(failed)}\n")
            f.write(f"codes_failed_count={len(failed)}\n")
            f.write(f"codes_total={total}\n")

    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as f:
            f.write("\n## 리딤 코드 수집\n\n")
            f.write(f"- 수집한 코드: **{total}개** ({len(counts)}개 게임)\n")
            if empty:
                f.write(f"- 코드 없음: {', '.join(empty)}\n")
            if failed:
                f.write(f"- ⚠ 소스 응답 없음: **{', '.join(failed)}**\n")


def run() -> bool:
    print("=== 리딤 코드 수집 시작 ===")
    if PROXY:
        print("프록시 설정 감지 — 차단 소스도 시도한다")

    games = load_json(GAMES_FILE)
    prev = load_json(CODES_FILE)
    prev_games = prev.get("games", {})

    # 첫 수집에서는 전부 오늘 처음 본 코드가 되어 화면이 NEW 배지로 뒤덮인다.
    # 기준이 될 이전 목록이 없으면 수집일을 비워 두고, 다음 실행부터 기록한다.
    today = str(date.today()) if prev_games else ""
    result: dict[str, dict] = {}
    failed, empty, counts = [], [], {}

    for game in games.get("games", []):
        gid = game["id"]
        if gid not in COLLECTORS:
            # 수집기가 없는 게임도 손으로 넣은 코드는 그대로 남긴다
            if prev_games.get(gid, {}).get("codes"):
                result[gid] = prev_games[gid]
            continue

        print(f"\n[{gid}] 코드 수집 중...")
        existing = prev_games.get(gid, {}).get("codes", [])
        fresh, answered = collect(gid)

        if not answered:
            # 소스가 전부 죽었을 때 기존 목록을 지우면 화면이 빈다. 그대로 둔다.
            failed.append(gid)
            if existing:
                result[gid] = prev_games[gid]
            continue

        codes = merge(existing, fresh, today, answered)
        if not codes:
            empty.append(gid)
            continue

        entry = {"codes": codes}
        url = REDEEM_URLS.get(gid)
        if url:
            entry["redeemUrl"] = url
        result[gid] = entry
        counts[gid] = len(codes)

    report(failed, empty, counts)

    data = {
        "meta": {
            "lastUpdated": today,
            "note": "리딤 코드는 지역·계정 조건에 따라 사용할 수 없을 수 있습니다.",
        },
        "games": result,
    }

    if prev.get("games") == result:
        print("\n변경 없음. 종료.")
        return False

    save_codes(data)
    print(f"\n=== {CODES_FILE.relative_to(ROOT)} 갱신 완료 ===")
    return True


if __name__ == "__main__":
    run()  # 종료 코드는 항상 0 — 커밋 여부는 Actions가 git diff로 판단한다
    sys.exit(0)
