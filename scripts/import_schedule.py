#!/usr/bin/env python3
"""
일정 이미지 → games.json 수동 반영용 임포터.

공식 일정표 이미지(주로 버전 업데이트 공지)를 읽어 만든 스테이징 JSON을
data/games.json 에 병합한다. 이미지 판독은 사람(또는 Claude)이 하고,
이 스크립트는 검증·중복 제거·정렬·저장만 맡는다.

스테이징 JSON 형식:
  {
    "game": {              # 새 게임일 때만 필수. 기존 게임이면 생략 가능
      "id": "aniimo", "name": "애니모", "fullName": "애니모 (Aniimo)",
      "color": "#5ec8c0", "icon": "🥚", "developer": "Pawprint Studio",
      "iconUrl": "https://www.aniimo.com/favicon.ico"
    },
    "gameId": "aniimo",    # game 을 생략할 때 대상 게임 지정
    "source": "aniimo.com 공식 일정",   # entries 에 source 가 없으면 이 값을 채운다
    "entries": [
      {"type": "event", "title": "여행 수기", "start": "2026-09-16",
       "end": "2026-10-28", "version": "1.0"}
    ]
  }

실행:
  python3 scripts/import_schedule.py staging.json            # 검증 후 병합
  python3 scripts/import_schedule.py staging.json --dry-run  # 저장하지 않고 미리보기
"""
import argparse
import json
import os
import re
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).parent.parent
DATA_FILE = ROOT / "data" / "games.json"

VALID_TYPES = {"version", "banner", "event"}
TYPE_ORDER = {"version": 0, "banner": 1, "event": 2}
REQUIRED_GAME_FIELDS = ("id", "name", "color", "icon")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

# 필드 순서 — 기존 games.json 스타일을 유지한다
ENTRY_FIELD_ORDER = ["type", "title", "subtitle", "rarity", "start", "end",
                     "version", "tentative", "source", "_auto"]
GAME_FIELD_ORDER = ["id", "name", "fullName", "color", "icon", "developer",
                    "enabled", "iconUrl", "bgUrl", "entries", "nameKo", "nameEn"]


def fail(msg: str) -> None:
    print(f"✗ {msg}", file=sys.stderr)
    sys.exit(1)


def parse_date(value: str, where: str) -> date:
    if not isinstance(value, str) or not DATE_RE.match(value):
        fail(f"{where}: 날짜는 YYYY-MM-DD 형식이어야 한다 (받은 값: {value!r})")
    try:
        return date.fromisoformat(value)
    except ValueError:
        fail(f"{where}: 존재하지 않는 날짜 {value!r}")


def validate_entries(entries: list, default_source: str) -> list:
    """필수 필드·날짜·타입 검사. 통과한 항목을 정규화해서 돌려준다."""
    if not isinstance(entries, list) or not entries:
        fail("entries 가 비어 있다")

    seen = {}
    clean = []
    for i, raw in enumerate(entries):
        where = f"entries[{i}]"
        if not isinstance(raw, dict):
            fail(f"{where}: 객체가 아니다")

        etype = raw.get("type")
        if etype not in VALID_TYPES:
            fail(f"{where}: type 은 {sorted(VALID_TYPES)} 중 하나여야 한다 (받은 값: {etype!r})")

        title = (raw.get("title") or "").strip()
        if not title:
            fail(f"{where}: title 이 비어 있다")

        start = parse_date(raw.get("start", ""), f"{where}.start")
        end = parse_date(raw.get("end", ""), f"{where}.end")
        if end < start:
            fail(f"{where}: end({end}) 가 start({start}) 보다 빠르다 — {title}")
        if (end - start).days > 365:
            print(f"  ⚠ {where}: 기간이 {(end - start).days}일이다 — 연도를 잘못 읽지 않았는지 확인 ({title})")

        key = f"{title}|{start}"
        if key in seen:
            fail(f"{where}: 같은 스테이징 안에 중복 항목 — {title} / {start}\n"
                 f"   회차가 다르면 subtitle 로 구분하되 start 가 같으면 안 된다")
        seen[key] = True

        e = dict(raw)
        e["title"] = title
        if e.get("subtitle"):
            e["subtitle"] = e["subtitle"].strip()
        else:
            e.pop("subtitle", None)
        e.setdefault("version", "")
        if not e.get("tentative"):
            e.pop("tentative", None)
        if default_source and not e.get("source"):
            e["source"] = default_source
        # 이미지에서 손으로 읽은 항목이다. _auto 를 붙이면 자동 갱신이 덮어쓴다.
        e.pop("_auto", None)

        ordered = {k: e[k] for k in ENTRY_FIELD_ORDER if k in e}
        ordered.update({k: v for k, v in e.items() if k not in ENTRY_FIELD_ORDER})
        clean.append(ordered)
    return clean


def build_game(meta: dict, entries: list) -> dict:
    missing = [f for f in REQUIRED_GAME_FIELDS if not meta.get(f)]
    if missing:
        fail(f"새 게임을 추가하려면 {missing} 필드가 필요하다")
    g = dict(meta)
    g.setdefault("fullName", g["name"])
    g.setdefault("developer", "")
    g.setdefault("enabled", True)
    g.setdefault("nameKo", g["name"])
    g.setdefault("nameEn", g.get("nameEn") or g["name"])
    g["entries"] = entries
    ordered = {k: g[k] for k in GAME_FIELD_ORDER if k in g}
    ordered.update({k: v for k, v in g.items() if k not in GAME_FIELD_ORDER})
    return ordered


def merge_entries(existing: list, incoming: list) -> tuple[list, int, int]:
    """title+start 키로 병합. 같은 키는 새 값으로 교체, 나머지는 추가."""
    by_key = {f"{e.get('title','')}|{e.get('start','')}": i
              for i, e in enumerate(existing)}
    merged = list(existing)
    added = replaced = 0
    for e in incoming:
        key = f"{e['title']}|{e['start']}"
        if key in by_key:
            merged[by_key[key]] = e
            replaced += 1
        else:
            by_key[key] = len(merged)
            merged.append(e)
            added += 1
    merged.sort(key=lambda e: (TYPE_ORDER.get(e.get("type", "event"), 2), e.get("start", "9999")))
    return merged, added, replaced


def save(data: dict) -> None:
    """임시 파일에 쓴 뒤 교체 — 중단되어도 games.json 이 깨지지 않는다."""
    tmp = DATA_FILE.with_name(DATA_FILE.name + ".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")
    os.replace(tmp, DATA_FILE)


def main() -> None:
    ap = argparse.ArgumentParser(description="일정 이미지에서 만든 스테이징 JSON을 games.json 에 병합")
    ap.add_argument("staging", help="스테이징 JSON 경로")
    ap.add_argument("--dry-run", action="store_true", help="저장하지 않고 결과만 출력")
    args = ap.parse_args()

    with open(args.staging, encoding="utf-8") as f:
        staging = json.load(f)

    meta = staging.get("game") or {}
    gid = meta.get("id") or staging.get("gameId")
    if not gid:
        fail("game.id 또는 gameId 가 필요하다")

    entries = validate_entries(staging.get("entries", []), staging.get("source", ""))

    with open(DATA_FILE, encoding="utf-8") as f:
        data = json.load(f)

    target = next((g for g in data["games"] if g["id"] == gid), None)

    if target is None:
        if not meta:
            fail(f"'{gid}' 게임이 games.json 에 없다. 새로 추가하려면 game 블록을 채울 것")
        data["games"].append(build_game(meta, entries))
        added, replaced = len(entries), 0
        print(f"+ 새 게임 '{gid}' 추가 — 항목 {added}건")
    else:
        target["entries"], added, replaced = merge_entries(target["entries"], entries)
        # 새 게임이 아니어도 메타를 같이 넘겼다면 갱신해준다 (색·아이콘 수정 등)
        for k, v in meta.items():
            if k not in ("id", "entries"):
                target[k] = v
        print(f"= 기존 게임 '{gid}' 갱신 — 신규 {added}건, 교체 {replaced}건, 총 {len(target['entries'])}건")

    data.setdefault("meta", {})["lastUpdated"] = str(date.today())

    # 후보 목록에 남아 있으면 정리한다
    before = len(data.get("candidates", []))
    data["candidates"] = [c for c in data.get("candidates", []) if c.get("id") != gid]
    if len(data["candidates"]) != before:
        print(f"  candidates 에서 '{gid}' 제거")

    if args.dry_run:
        print("\n(--dry-run) 저장하지 않음. 반영될 항목:")
        for e in entries:
            tent = " [미확정]" if e.get("tentative") else ""
            sub = f" / {e['subtitle']}" if e.get("subtitle") else ""
            print(f"  {e['type']:<7} {e['start']} ~ {e['end']}  {e['title']}{sub}{tent}")
        return

    save(data)
    print(f"✓ {DATA_FILE.relative_to(ROOT)} 저장 완료")


if __name__ == "__main__":
    main()
