"""우마무스메 파서 — game8 월별 릴리즈 스케줄

이 페이지는 표가 아니라 서술형이라 공용 테이블 파서로는 잡히지 않는다.
'이름 줄 다음에 날짜 범위 줄'이 오는 규칙을 이용해 줄 단위로 읽는다.
"""
import re
from datetime import date, timedelta
from bs4 import BeautifulSoup

from .base import fetch, MONTH_MAP

# 어느 달 페이지든 사이드/본문에 다른 달 링크가 있어, 여기서 출발해 최신 달을 따라간다
SEED_URL = "https://game8.co/games/Umamusume-Pretty-Derby/archives/613161"
BASE = "https://game8.co"

_MONTHS = ("January|February|March|April|May|June|July|August|"
           "September|October|November|December")

# "August 5 - 13, 2026" / "August 25 - September 2, 2026"
_RANGE_LINE = re.compile(
    rf'^({_MONTHS})\s+(\d{{1,2}})\s*[-–—~]\s*(?:({_MONTHS})\s+)?(\d{{1,2}}),?\s*(20\d{{2}})\.?$',
    re.I,
)
# "from August 5 to 14, 2026" (문장 속)
_RANGE_INLINE = re.compile(
    rf'from\s+({_MONTHS})\s+(\d{{1,2}})\s+to\s+(?:({_MONTHS})\s+)?(\d{{1,2}}),?\s*(20\d{{2}})',
    re.I,
)

_BANNER_KW = re.compile(r'(SSR|SR\b|rerun|banner|scout|gacha|support card)', re.I)
_EVENT_KW  = re.compile(r'(cup|champions meeting|story event|campaign|legend race'
                        r'|missions|celebration|anniversary|test|training)', re.I)
_SKIP = re.compile(r'^(table of contents|related guides?|comment|all rights|©|game8)', re.I)


def _mk_dates(m) -> tuple[date, date] | None:
    smon, sday, emon, eday, year = m.group(1), m.group(2), m.group(3), m.group(4), m.group(5)
    s_mo = MONTH_MAP.get(smon[:3].lower())
    e_mo = MONTH_MAP.get(emon[:3].lower()) if emon else s_mo
    if not s_mo or not e_mo:
        return None
    try:
        start = date(int(year), s_mo, int(sday))
        end   = date(int(year), e_mo, int(eday))
    except ValueError:
        return None
    # 12월 → 1월처럼 연도를 넘기는 구간 보정
    if end < start:
        try:
            end = end.replace(year=end.year + 1)
        except ValueError:
            return None
    return start, end


def _clean(name: str) -> str:
    name = re.sub(r'\[|\]', '', name)
    name = re.sub(r'\s+', ' ', name).strip(' .·-–—')
    return name[:120]


def _schedule_urls() -> list[str]:
    """시드 페이지에서 '<월> Release Schedule' 링크를 모아 최신 것부터 반환."""
    try:
        html = fetch(SEED_URL)
    except Exception as e:
        print(f"  [umamusume] 시드 fetch 실패: {e}")
        return []

    sp = BeautifulSoup(html, "lxml")
    found: dict[tuple[int, int], str] = {}
    for a in sp.find_all("a", href=True):
        text = a.get_text(" ", strip=True)
        m = re.search(rf'({_MONTHS})\s+(20\d{{2}})\s+Release Schedule', text, re.I)
        if not m:
            continue
        mo = MONTH_MAP.get(m.group(1)[:3].lower())
        if not mo:
            continue
        href = a["href"]
        found[(int(m.group(2)), mo)] = href if href.startswith("http") else BASE + href

    urls = [found[k] for k in sorted(found, reverse=True)][:3]
    if SEED_URL not in urls:
        urls.append(SEED_URL)
    return urls


def _parse_page(url: str) -> list[dict]:
    try:
        html = fetch(url)
    except Exception as e:
        print(f"  [umamusume] fetch 실패 ({url}): {e}")
        return []

    sp = BeautifulSoup(html, "lxml")
    for tag in sp(["script", "style", "nav", "footer"]):
        tag.decompose()
    # 이름이 파편으로 잡힐 때 대체할 수 있도록 섹션 제목을 따로 모아둔다
    headings = {h.get_text(" ", strip=True) for h in sp.find_all(["h2", "h3", "h4"])}
    headings = {h for h in headings if 3 <= len(h) <= 130}
    lines = [l.strip() for l in sp.get_text("\n").splitlines() if l.strip()]

    entries: list[dict] = []
    cutoff = date.today() - timedelta(days=90)

    for i, line in enumerate(lines):
        rng = _RANGE_LINE.match(line) or _RANGE_INLINE.search(line)
        if not rng:
            continue
        dates = _mk_dates(rng)
        if not dates:
            continue
        start, end = dates
        if end < cutoff:
            continue

        # 날짜 줄 위쪽에서 가장 가까운 '이름다운' 줄을 찾는다
        window = lines[max(0, i - 5):i]
        name = ""
        for prev in reversed(window):
            if _RANGE_LINE.match(prev) or _SKIP.match(prev):
                continue
            if len(prev) < 3 or len(prev) > 130:
                continue
            if re.fullmatch(r'[\W\d]+', prev):
                continue
            name = prev
            break

        # 'Reruns'처럼 앞 링크가 잘려 조각만 남은 경우 바로 위 줄을 붙인다
        if re.fullmatch(r'(and\s+)?(Reruns?|Banners?|Events?)', name, re.I):
            for prev in reversed(window[:-1] if window else []):
                if prev != name and 3 <= len(prev) <= 130 and not _RANGE_LINE.match(prev):
                    name = f"{prev} {name}"
                    break

        # 서술형 문장이 잡히면 섹션 제목으로 대체한다
        if re.search(r'\b(is|are|will|has|scheduled|allows|lets|can)\b', name, re.I):
            head = next((h for h in reversed(window) if h in headings), "")
            name = head or ""

        name = _clean(name)
        if not name:
            continue

        etype = "banner" if _BANNER_KW.search(name) else (
            "event" if _EVENT_KW.search(name) else "event")
        entries.append({
            "type":      etype,
            "title":     name,
            "start":     str(start),
            "end":       str(end),
            "version":   "",
            "tentative": False,
            "source":    "game8.co",
            "_auto":     True,
        })
    return entries


def parse() -> list[dict]:
    urls = _schedule_urls()
    if not urls:
        print("  [umamusume] 스케줄 페이지 없음")
        return []

    all_entries: list[dict] = []
    seen: set[str] = set()
    for url in urls:
        for e in _parse_page(url):
            key = f"{e['title']}|{e['start']}"
            if key in seen:
                continue
            seen.add(key)
            all_entries.append(e)

    banners = sum(1 for e in all_entries if e["type"] == "banner")
    events  = len(all_entries) - banners
    print(f"  [umamusume] 배너 {banners}개, 이벤트 {events}개 ({len(urls)}개 페이지)")
    return all_entries
