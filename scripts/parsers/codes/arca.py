"""리딤 코드 파서 — arca.live 채널 공지의 '리딤코드 모음' 글

채널마다 유저가 손으로 관리하는 글이라 형식이 제각각이다(표, 번호 목록, 줄글).
그래서 표는 행, 나머지는 줄 단위로 끊고, 각 단위의 첫 코드 모양 토큰을 코드로 본다.
같은 단위에서 '~ 11.11', '(~10/22 10:59)', '- 26/12/31' 같은 기한을 찾아 expires 로 둔다.
기한이 없으면(상시·종료 미정) expires 를 비운다.

arca.live는 Cloudflare 뒤에 있어 일반 requests는 403을 받는다.
curl_cffi로 브라우저 TLS 지문을 흉내 내면 통과한다.
"""
import os
import re
from datetime import date

from curl_cffi import requests as cr

from ..base import soup

SOURCE = "arca.live"

# games.json의 게임 id → 채널/글 번호
POSTS = {
    "genshin":  "genshin/95519559",
    "starrail": "hkstarrail/181430987",
    "zzz":      "zenlesszonezero/109976603",
    "trickcal": "trickcal/152421512",
    "nikke":    "nikketgv/175622071",
    "aniimo":   "aniimo/183374082",
    "mongil":   "mongillstardive/167430462",
}

# 대문자·숫자로 된 5~24자, 글자와 숫자가 섞이거나 8자 이상 (LETS·PLAY 같은 짧은 단어 코드는 표에서만 받는다)
_CODE = re.compile(r'^[A-Za-z0-9]{4,24}$')
_LEAD = re.compile(r'^\s*(?:\d+\s*[.)]\s*)?')
# 코드처럼 생겼지만 코드가 아닌 낱말
_STOP = {"HTTPS", "HTTP", "LINK", "CODE", "PC", "MOBILE", "NEW", "GIFT", "TWITCH", "YOUTUBE", "DISCORD"}
# 만료·종료 목록 제목
_DEAD = re.compile(r'만료|종료된|지난\s*코드|사용\s*불가|expired', re.I)
# 기한: 물결 뒤의 월.일 / 월/일 / 년/월/일
_UNTIL = re.compile(r'~\s*(?:(\d{2,4})[./-])?(\d{1,2})[./월]\s*(\d{1,2})')
_DASH_YMD = re.compile(r'[-–]\s*(\d{2})/(\d{1,2})/(\d{1,2})')
_KDATE = re.compile(r'기한\s*:?\s*(\d{1,2})월\s*(\d{1,2})일')
_FOREVER = re.compile(r'상시|종료\s*미정|무기한')
# 보상 문구에 섞여 들어오는 기간·추가일 표기
_NOISE = re.compile(
    r'\(?\s*~[^)]*\)?'                  # (~10/22 10:59), ~ 11.11 (수) 08:30
    r'|\([\d./~ ]+\)'                   # (9.12~)
    r'|\b\d{2}[./]\d{1,2}[./]\d{1,2}일?'  # 23.04.27, 26/12/31일
    r'|\(?종료\s*미정\)?|상시|무기한'
    r'|\b\d{1,2}:\d{2}\b')


def _clean(t: str) -> str:
    return re.sub(r'\s+', ' ', (t or "").replace("\xa0", " ")).strip()


def _year_for(month: int, day: int, today: date) -> date:
    """연도 없는 월/일을 오늘 기준으로 가장 그럴듯한 해에 놓는다 (반년 넘게 지났으면 내년)."""
    d = date(today.year, month, day)
    if (today - d).days > 183:
        d = date(today.year + 1, month, day)
    return d


def _expires(text: str, today: date) -> str:
    if _FOREVER.search(text):
        return ""
    try:
        m = _UNTIL.search(text)
        if m:
            y, mo, d = m.group(1), int(m.group(2)), int(m.group(3))
            if y:
                y = int(y) + (2000 if len(y) == 2 else 0)
                return str(date(y, mo, d))
            return str(_year_for(mo, d, today))
        m = _DASH_YMD.search(text)
        if m:
            return str(date(2000 + int(m.group(1)), int(m.group(2)), int(m.group(3))))
    except ValueError:
        pass
    return ""


def _is_code(tok: str, strict: bool) -> bool:
    if not _CODE.match(tok) or tok.upper() in _STOP:
        return False
    if tok != tok.upper() and not any(c.isdigit() for c in tok):
        return False  # 소문자 섞인 낱말
    if strict:
        # 줄글에서는 숫자가 섞였거나 8자 이상인 것만 코드로 본다
        return any(c.isdigit() for c in tok) or len(tok) >= 8
    return True


def _units(body, today: date):
    """(텍스트, 표 행 여부, 셀 목록, 표 공통 기한) 단위로 끊는다. 만료 제목 아래는 건너뛴다."""
    for table in body.find_all("table"):
        dead, until = False, ""
        for tr in table.find_all("tr"):
            cells = [_clean(c.get_text(" ")) for c in tr.find_all(["td", "th"])]
            joined = " ".join(cells)
            if len(cells) == 1 and _DEAD.search(joined):
                dead = True
            # "입력 기한: 9월 22일 00:59" 같은 제목 행은 아래 코드 전체의 기한이다
            m = _KDATE.search(joined)
            if m:
                until = str(_year_for(int(m.group(1)), int(m.group(2)), today))
            if not dead and joined:
                yield joined, True, cells, until
        table.decompose()

    dead = False
    for line in body.get_text("\n").split("\n"):
        line = _clean(line)
        if not line:
            continue
        if _DEAD.search(line) and len(line) < 30:
            dead = True
        if not dead:
            yield line, False, [line], ""


def parse(game_id: str) -> list[dict]:
    post = POSTS.get(game_id)
    if not post:
        return []

    proxy = os.environ.get("SYNC_PROXY", "").strip() or None
    r = cr.get(f"https://arca.live/b/{post}", impersonate="chrome", timeout=30, proxy=proxy)
    r.raise_for_status()
    sp = soup(r.text)
    body = sp.select_one(".article-body .fr-view") or sp.select_one(".article-body")
    if body is None:
        raise ValueError("본문을 찾지 못함 (Cloudflare 차단 또는 글 삭제)")

    today = date.today()
    out: list[dict] = []
    seen: set[str] = set()
    pending: dict | None = None  # 코드 줄 다음 줄에 보상이 오는 형식

    def add(code: str, reward: str, text: str, until: str) -> dict:
        item = {
            "code":    code,
            "reward":  _clean(_NOISE.sub(" ", reward)).strip(" -|:,")[:200],
            "expires": _expires(text, today) or until,
            "source":  SOURCE,
        }
        seen.add(code.upper())
        out.append(item)
        return item

    for text, in_table, cells, until in _units(body, today):
        prev, pending = pending, None
        first = _LEAD.sub("", cells[0]).split(" ")[0] if cells[0] else ""

        # 한 행에 코드만 여러 칸 늘어선 표 (방송 코드 3종 등)
        if in_table and len(cells) > 1 and all(_is_code(c, strict=False) for c in cells):
            for c in cells:
                if c.upper() not in seen:
                    add(c, "", text, until)
            continue

        if _is_code(first, strict=not in_table) and first.upper() not in seen:
            rest = " ".join([_LEAD.sub("", cells[0])[len(first):]] + cells[1:])
            item = add(first, rest, text, until)
            # 줄글 목록은 코드 아래 "- 보상" 줄이 이어지므로 표가 아니면 계속 받는다
            pending = item if not in_table or not item["reward"] else None
            continue

        # 바로 앞 줄이 코드였다면 이 줄에서 보상을 찾는다
        if prev is not None:
            m = re.search(r'보상\s*:?\s*(.+)$', text)
            if m:
                prev["reward"] = _clean(m.group(1)).strip(" :|")[:200]
            elif not in_table and text.startswith("-"):
                # "- 엘리프 927개" "- 선택권 1개" 처럼 여러 줄이면 이어 붙인다
                line = _clean(text.lstrip("- "))
                prev["reward"] = ", ".join(filter(None, [prev["reward"], line]))[:200]
                pending = prev
            elif not in_table and not prev["reward"] and len(text) < 80 and re.search(r'\d', text):
                # 코드 바로 아래 줄에 보상만 적는 형식 ("휘석 10, 2만 크래딧")
                prev["reward"] = text[:200]

    print(f"  [{game_id}] {SOURCE}: {len(out)}개")
    return out
