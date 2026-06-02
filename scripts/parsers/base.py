"""공통 유틸리티 — 날짜 파싱, Game8 HTML 스크래핑"""
import re, requests
from datetime import datetime, date, timedelta
from bs4 import BeautifulSoup

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124"
MONTH_MAP = {
    'jan':1,'feb':2,'mar':3,'apr':4,'may':5,'jun':6,
    'jul':7,'aug':8,'sep':9,'oct':10,'nov':11,'dec':12
}

def fetch(url: str, timeout=20) -> str:
    r = requests.get(url, headers={"User-Agent": UA}, timeout=timeout)
    r.raise_for_status()
    return r.text

def soup(html: str) -> BeautifulSoup:
    return BeautifulSoup(html, "lxml")

def parse_date(s: str, ref_year: int | None = None) -> date | None:
    """다양한 날짜 형식을 date 객체로 변환."""
    s = s.strip()
    # 2026-06-01 or 2026/06/01
    m = re.match(r'(20\d{2})[/-](\d{1,2})[/-](\d{1,2})', s)
    if m:
        return date(int(m[1]), int(m[2]), int(m[3]))
    # Jun. 01, 2026 or June 1, 2026
    m = re.match(r'([A-Za-z]+)\.?\s+(\d{1,2}),?\s+(20\d{2})', s)
    if m:
        mo = MONTH_MAP.get(m[1][:3].lower())
        if mo:
            return date(int(m[3]), mo, int(m[2]))
    # 06/01/2026
    m = re.match(r'(\d{1,2})/(\d{1,2})/(20\d{2})', s)
    if m:
        return date(int(m[3]), int(m[1]), int(m[2]))
    # 06/01 (연도 추론)
    if ref_year:
        m = re.match(r'^(\d{1,2})/(\d{1,2})$', s)
        if m:
            return date(ref_year, int(m[1]), int(m[2]))
    return None

def infer_year(html: str) -> int:
    """HTML에서 4자리 연도를 추론."""
    years = re.findall(r'\b(20\d{2})\b', html)
    if years:
        from collections import Counter
        return int(Counter(years).most_common(1)[0][0])
    return datetime.now().year

def parse_game8_table(url: str, game_id: str, version_hint: str = "") -> list[dict]:
    """
    Game8 배너/이벤트 페이지를 파싱해 entries 목록 반환.
    테이블 형식: [날짜범위, 이벤트명] 패턴
    """
    try:
        html = fetch(url)
    except Exception as e:
        print(f"  [{game_id}] fetch 실패: {e}")
        return []

    ref_year = infer_year(html)
    sp = soup(html)
    entries = []
    seen = set()

    for row in sp.select("tr"):
        cells = [td.get_text(separator=" ", strip=True) for td in row.find_all(["td", "th"])]
        if len(cells) < 2:
            continue

        # 날짜 범위 셀 찾기
        date_cell = cells[0]
        name_cell = cells[1] if len(cells) > 1 else ""

        # "MM/DD - MM/DD" 또는 "Jun. 01 - Jul. 15" 형식
        date_range = re.split(r'\s*[~–—-]\s*', date_cell)
        if len(date_range) < 2:
            continue

        start = parse_date(date_range[0].strip(), ref_year)
        end_s = date_range[1].strip()
        # "End of X.X" 처리
        if re.match(r'^End of', end_s, re.I):
            end = start + timedelta(days=42) if start else None
        else:
            end = parse_date(end_s, ref_year)

        if not start or not end:
            continue

        # 90일 이전 종료된 항목 제외
        if (date.today() - end).days > 90:
            continue

        # 이름 정제
        name = re.sub(r'^[◆●・\-\s]+', '', name_cell).strip()
        name = re.sub(r'\s+', ' ', name)[:120]
        if not name or name in seen:
            continue
        seen.add(name)

        # banner/event 판별
        entry_type = "event"
        if any(kw in name.lower() for kw in ["banner","warp","wish","pickup","resonator","standard","limited"]):
            entry_type = "banner"

        entries.append({
            "type": entry_type,
            "title": name,
            "start": str(start),
            "end": str(end),
            "version": version_hint,
            "tentative": False,
            "source": "game8.co",
            "_auto": True,
        })

    print(f"  [{game_id}] Game8 파싱 완료: {len(entries)}개")
    return entries
