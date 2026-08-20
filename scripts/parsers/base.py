"""공통 유틸리티 — HTTP 페치, 날짜 파싱"""
import os, re, time, requests
from datetime import datetime, date, timedelta
from bs4 import BeautifulSoup

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36")

# 일부 사이트(game8 등)는 UA만 보는 요청에 데이터센터 IP 기준으로 다른 응답을 준다.
# 실제 브라우저와 같은 헤더 세트를 보내 정상 페이지를 받도록 한다.
BROWSER_HEADERS = {
    "User-Agent": UA,
    "Accept": ("text/html,application/xhtml+xml,application/xml;q=0.9,"
               "image/avif,image/webp,*/*;q=0.8"),
    "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7,ja;q=0.6",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
    "Upgrade-Insecure-Requests": "1",
}

MONTH_MAP = {
    'jan':1,'feb':2,'mar':3,'apr':4,'may':5,'jun':6,
    'jul':7,'aug':8,'sep':9,'oct':10,'nov':11,'dec':12
}


def proxies() -> dict | None:
    """SYNC_PROXY가 있으면 requests용 프록시 매핑을 돌려준다.

    데이터센터 IP를 막는 사이트(wuwatracker·nikke.gg)를 CI에서 읽기 위한 통로다.
    값 예: socks5h://user:pass@fly-app:8080 (socks5h = DNS도 프록시에서 해석)
    """
    p = os.environ.get("SYNC_PROXY", "").strip()
    return {"http": p, "https": p} if p else None


def fetch(url: str, timeout=20, retries=2, headers: dict | None = None,
          use_proxy: bool = True) -> str:
    """브라우저 유사 헤더로 GET. 일시적 실패는 지수 백오프로 재시도한다."""
    hdr = dict(BROWSER_HEADERS)
    if headers:
        hdr.update(headers)
    prox = proxies() if use_proxy else None
    last_err = None
    for attempt in range(retries + 1):
        try:
            r = requests.get(url, headers=hdr, timeout=timeout, proxies=prox)
            r.raise_for_status()
            return r.text
        except Exception as e:
            last_err = e
            if attempt < retries:
                time.sleep(1.5 * (attempt + 1))
    raise last_err

def soup(html: str) -> BeautifulSoup:
    return BeautifulSoup(html, "lxml")


# ── MediaWiki 위키 소스 공통 유틸 ──
# HTML 스크래핑과 달리 위키 API는 CI 환경에서도 차단되지 않아 안정적이다.

def cargo_query(api: str, tables: str, fields: str, where: str = "",
                order_by: str = "", limit: int = 200) -> list[dict]:
    """Cargo 확장이 설치된 위키에서 구조화된 행을 가져온다."""
    params = {
        "action": "cargoquery",
        "tables": tables,
        "fields": fields,
        "limit":  str(limit),
        "format": "json",
    }
    if where:
        params["where"] = where
    if order_by:
        params["order_by"] = order_by

    r = requests.get(api, headers=BROWSER_HEADERS, timeout=20, params=params)
    r.raise_for_status()
    data = r.json()
    if "error" in data:
        raise RuntimeError(data["error"].get("info", "cargo error"))
    return [row.get("title", {}) for row in data.get("cargoquery", [])]


def wiki_datetime(s: str, is_end: bool = False) -> date | None:
    """'2026-08-09 04:00:00' → date.

    종료 시각이 새벽이면(예: 03:59:59) 실질적인 마지막 날은 전날이므로 하루 뺀다.
    """
    s = (s or "").strip()
    if not s:
        return None
    try:
        dt = datetime.strptime(s, "%Y-%m-%d %H:%M:%S")
    except ValueError:
        try:
            return date.fromisoformat(s[:10])
        except ValueError:
            return None
    d = dt.date()
    if is_end and dt.hour < 6:
        d -= timedelta(days=1)
    return d


def wiki_parse_html(api: str, page: str) -> str:
    """MediaWiki parse API로 문서의 렌더된 HTML을 받는다.

    Cargo가 없는 위키(DPL 등 서버 렌더 확장을 쓰는 곳)에서 표를 읽을 때 사용한다.
    """
    r = requests.get(api, headers=BROWSER_HEADERS, timeout=25, params={
        "action": "parse",
        "page": page,
        "prop": "text",
        "format": "json",
        "formatversion": "2",
    })
    r.raise_for_status()
    data = r.json()
    if "error" in data:
        raise RuntimeError(data["error"].get("info", "parse error"))
    return data["parse"]["text"]


def within_window(start: date | None, end: date | None, past_days: int = 90) -> bool:
    """표시 범위에 들어오는 일정인지(끝난 지 past_days 이내인지) 판단."""
    return bool(start and end and end >= start
                and (date.today() - end).days <= past_days)

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
