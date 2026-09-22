"""리딤 코드 범용 파서 — pockettactics.com

게임마다 /<게임>/codes 페이지를 같은 틀로 관리한다.
본문 첫 목록이 '코드 - 보상' 줄로 된 활성 코드 목록이고,
만료 코드는 보상 없이 코드만 나열되므로 구분자 유무로 걸러진다.
"""
import re

from ..base import fetch, soup

BASE = "https://www.pockettactics.com"
SOURCE = "pockettactics.com"

# games.json의 게임 id → 코드 페이지 경로
URLS = {
    "genshin":     f"{BASE}/genshin-impact/codes",
    "starrail":    f"{BASE}/honkai-star-rail/codes",
    "zzz":         f"{BASE}/zenless-zone-zero/codes",
    "wuwa":        f"{BASE}/wuthering-waves/codes",
    "nikke":       f"{BASE}/nikke/codes",
    "bluearchive": f"{BASE}/blue-archive/codes",
    "umamusume":   f"{BASE}/umamusume-pretty-derby/codes",
    "endfield":    f"{BASE}/arknights-endfield/codes",
    "nte":         f"{BASE}/neverness-to-everness/codes",
    "aniimo":      f"{BASE}/aniimo/codes",
    "mongil":      f"{BASE}/mongil-star-dive/codes",
}

# "CODE - 보상" / "CODE -보상" (구분자 앞 공백)
_WITH_SPACE = re.compile(r'^(\S+)\s+[-–—:]\s*(\S.*)$')
# "CODE- 보상" (구분자 뒤에만 공백)
_NO_SPACE = re.compile(r'^([A-Za-z0-9_.]+)[-–—:]\s+(\S.*)$')

_CODE_OK = re.compile(r'^[A-Za-z0-9][A-Za-z0-9_.\-]{2,31}$')
_NEW_TAIL = re.compile(r'\s*\(\s*new!?\s*\)\s*$', re.I)

# 만료 코드 목록 위에 붙는 제목
_DEAD_HEADING = re.compile(r'(expired|no longer|old|inactive)', re.I)


def _clean(text: str) -> str:
    return re.sub(r'\s+', ' ', (text or "").replace("\xa0", " ")).strip()


def _split(text: str) -> tuple[str, str] | None:
    for pat in (_WITH_SPACE, _NO_SPACE):
        m = pat.match(text)
        if not m:
            continue
        code, reward = m.group(1).strip(), m.group(2).strip()
        if _CODE_OK.match(code):
            return code, reward
    return None


def _heading_of(ul) -> str:
    h = ul.find_previous(["h2", "h3", "h4"])
    return _clean(h.get_text(" ", strip=True)) if h else ""


def parse(game_id: str) -> list[dict]:
    url = URLS.get(game_id)
    if not url:
        return []

    sp = soup(fetch(url, timeout=25))
    article = sp.select_one("article") or sp

    for ul in article.find_all("ul"):
        if _DEAD_HEADING.search(_heading_of(ul)):
            continue

        out: list[dict] = []
        seen: set[str] = set()
        for li in ul.find_all("li", recursive=False):
            parsed = _split(_clean(li.get_text(" ", strip=True)))
            if not parsed:
                continue
            code, reward = parsed
            if code.upper() in seen:
                continue
            seen.add(code.upper())
            out.append({
                "code":   code,
                # 소스가 새 코드에 붙이는 "(new!)" 꼬리표는 시간이 지나면 사실과
                # 어긋나므로 떼어 낸다. 신규 여부는 수집일(added)로 판단한다.
                "reward": _NEW_TAIL.sub("", reward)[:200],
                "source": SOURCE,
            })

        # 코드 목록은 본문 첫 목록 하나뿐이다. 그 뒤의 목록은 교환 방법 안내다.
        if len(out) >= 1:
            print(f"  [{game_id}] {SOURCE}: {len(out)}개")
            return out

    print(f"  [{game_id}] {SOURCE}: 코드 목록을 찾지 못함")
    return []
