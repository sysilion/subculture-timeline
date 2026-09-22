"""HoYoverse 리딤 코드 — hoyo-codes.seria.moe

원신·스타레일·젠레스의 활성 코드를 보상 문구까지 담아 JSON으로 준다.
공식 교환 페이지가 따로 있는 게임들이라 수집 가치가 가장 높다.
"""
import requests

API = "https://hoyo-codes.seria.moe/codes"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"

# games.json의 게임 id → API slug
SLUG = {
    "genshin":  "genshin",
    "starrail": "hkrpg",
    "zzz":      "nap",
}

SOURCE = "hoyo-codes.seria.moe"


def _reward(raw: str) -> str:
    """'Primogem*30;Mora*10000' → '원석 30 · Mora 10000' 수준의 보기 좋은 한 줄.

    소스는 'Item*수량;Item*수량' 형태와 영어 산문 두 가지를 섞어 준다.
    전자만 구분자를 다듬고, 산문은 그대로 둔다.
    """
    raw = (raw or "").strip()
    if not raw:
        return ""
    if ";" not in raw and "*" not in raw:
        return raw[:200]
    parts = []
    for chunk in raw.split(";"):
        chunk = chunk.strip()
        if not chunk:
            continue
        name, sep, qty = chunk.partition("*")
        parts.append(f"{name.strip()} ×{qty.strip()}" if sep else name.strip())
    return " · ".join(parts)[:200]


def parse(game_id: str) -> list[dict]:
    slug = SLUG.get(game_id)
    if not slug:
        return []

    r = requests.get(API, headers={"User-Agent": UA}, timeout=15, params={"game": slug})
    r.raise_for_status()

    out: list[dict] = []
    seen: set[str] = set()
    for item in r.json().get("codes", []):
        code = (item.get("code") or "").strip()
        # status가 OK가 아닌 항목은 만료·지역 제한 코드다
        if not code or item.get("status") != "OK":
            continue
        key = code.upper()
        if key in seen:
            continue
        seen.add(key)
        out.append({
            "code":   code,
            "reward": _reward(item.get("rewards")),
            "source": SOURCE,
        })

    print(f"  [{game_id}] {SOURCE}: {len(out)}개")
    return out
