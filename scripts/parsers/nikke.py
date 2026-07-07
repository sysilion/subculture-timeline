"""NIKKE 파서 — nikke.gg 패치노트 스크래핑"""
import re
import requests
from datetime import date, timedelta
from bs4 import BeautifulSoup

from .base import MONTH_MAP

BASE = "https://nikke.gg"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124"
HDR = {"User-Agent": UA}

# "June 11, 2026" 형식
_DATE_RE = re.compile(
    r'(January|February|March|April|May|June|July|August|September|October|November|December)'
    r'\s+(\d{1,2}),\s+(20\d{2})',
    re.IGNORECASE,
)

# 섹션 번호 패턴 (X.Y 형식)
_SECTION_RE = re.compile(r'^\d+\.\d+\s+(.+)')

# 이벤트로 인정할 키워드 (화이트리스트)
_EVENT_KEYWORDS = re.compile(
    r'(story event|login event|mini game|minigame|archives|union raid|solo raid'
    r'|champion arena|coordinated operation|simulation room|story line'
    r'|anniversary|collab|collaboration|limited event|festival)',
    re.IGNORECASE,
)


def _to_date(m: tuple) -> date | None:
    mo = MONTH_MAP.get(m[0][:3].lower())
    return date(int(m[2]), mo, int(m[1])) if mo else None


def _fetch_patch_urls(limit: int = 3) -> list[str]:
    try:
        r = requests.get(f"{BASE}/patch-notes/", headers=HDR, timeout=15)
        r.raise_for_status()
    except Exception as e:
        print(f"  [nikke] 목록 fetch 실패: {e}")
        return []

    soup = BeautifulSoup(r.text, "lxml")
    seen: set[str] = set()
    urls: list[str] = []
    for a in soup.find_all("a", href=True):
        href = a["href"]
        if re.search(r'202\d.*(update|patch)', href, re.I) or re.search(r'(update|patch).*202\d', href, re.I):
            if href not in seen:
                seen.add(href)
                urls.append(href)
        if len(urls) >= limit:
            break
    return urls


def _parse_one(url: str) -> list[dict]:
    try:
        r = requests.get(url, headers=HDR, timeout=15)
        r.raise_for_status()
    except Exception as e:
        print(f"  [nikke] {url} fetch 실패: {e}")
        return []

    lines = [l.strip() for l in BeautifulSoup(r.text, "lxml").get_text(separator="\n").splitlines() if l.strip()]
    entries: list[dict] = []
    today = date.today()
    cutoff = today - timedelta(days=90)

    # ── 배너(Special Recruit) ──
    # "* Special Recruit duration: From the end of the [date] maintenance to [date]"
    for i, line in enumerate(lines):
        if "special recruit" not in line.lower() or "duration" not in line.lower():
            continue

        block = " ".join(lines[i:i+3])
        dates = _DATE_RE.findall(block)
        if len(dates) < 2:
            continue
        start = _to_date(dates[0])
        end   = _to_date(dates[1])
        if not start or not end or end < cutoff:
            continue

        # 배너 캐릭터명: 위 줄에서 "SSR [Name] joins Special Recruit" 패턴 (짧은 이름만)
        char_name = ""
        for prev in lines[max(0, i-12):i]:
            m = re.match(r'SSR\s+(.{3,40}?)\s+(?:joins|is available)\s+Special Recruit', prev, re.I)
            if m:
                char_name = m.group(1).strip()
                break
        # 이름이 너무 길면(문장처럼 보이면) 제외
        if len(char_name) > 40:
            char_name = ""

        title = f"Special Recruit: {char_name}" if char_name else "Special Recruit"
        entries.append({
            "type":      "banner",
            "title":     title,
            "subtitle":  char_name,
            "start":     str(start),
            "end":       str(end),
            "version":   "",
            "tentative": False,
            "source":    "nikke.gg",
            "_auto":     True,
        })

    # ── 이벤트 — 섹션 번호가 있는 항목만 (X.Y 형식) ──
    seen_keys: set[str] = set()
    for i, line in enumerate(lines):
        # 섹션 번호 있는 항목인지 확인
        sec_m = _SECTION_RE.match(line)
        if not sec_m:
            continue
        event_name_raw = sec_m.group(1).strip()

        # 화이트리스트: 알려진 이벤트 키워드 포함 항목만 허용
        if not _EVENT_KEYWORDS.search(event_name_raw):
            continue

        # "New Fully Voiced Story Event: ARK RANGER" → "ARK RANGER"
        event_name = re.sub(
            r'^(?:new\s+(?:fully\s+voiced\s+)?)?(?:story\s+)?event\s*:\s*',
            '', event_name_raw, flags=re.I
        ).strip()
        if not event_name or event_name.lower() in ("new events", "events", "event"):
            continue
        # "Added ..." 형식은 업데이트 노트이지 이벤트가 아님
        if re.match(r'^Added\s', event_name, re.I):
            continue

        # 이 섹션 이후 첫 번째 "duration" 줄 찾기 (최대 10줄 이내)
        for j in range(i+1, min(i+15, len(lines))):
            lower = lines[j].lower()
            if not re.search(r'(?:event\s+)?duration\s*:', lower):
                continue
            if "from" not in lower:
                continue

            block = " ".join(lines[j:j+3])
            dates = _DATE_RE.findall(block)
            if len(dates) < 2:
                continue
            start = _to_date(dates[0])
            end   = _to_date(dates[1])
            if not start or not end or end < cutoff:
                break

            key = f"{event_name}|{start}"
            if key in seen_keys:
                break
            seen_keys.add(key)

            entries.append({
                "type":      "event",
                "title":     event_name,
                "start":     str(start),
                "end":       str(end),
                "version":   "",
                "tentative": False,
                "source":    "nikke.gg",
                "_auto":     True,
            })
            break  # 섹션당 하나만

    return entries


def parse() -> list[dict]:
    urls = _fetch_patch_urls(limit=3)
    if not urls:
        print("  [nikke] 패치노트 URL 없음")
        return []

    all_entries: list[dict] = []
    seen_keys: set[str] = set()
    for url in urls:
        for entry in _parse_one(url):
            key = f"{entry['title']}|{entry['start']}"
            if key not in seen_keys:
                seen_keys.add(key)
                all_entries.append(entry)

    banners = sum(1 for e in all_entries if e["type"] == "banner")
    events  = sum(1 for e in all_entries if e["type"] == "event")
    print(f"  [nikke] 배너 {banners}개, 이벤트 {events}개")
    return all_entries
