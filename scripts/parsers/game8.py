"""Game8 범용 파서 — 6개 게임에서 공유"""
import re, requests
from datetime import date, timedelta
from bs4 import BeautifulSoup

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124"

MONTH_MAP = {
    'jan':1,'january':1,'feb':2,'february':2,'mar':3,'march':3,
    'apr':4,'april':4,'may':5,'jun':6,'june':6,
    'jul':7,'july':7,'aug':8,'august':8,'sep':9,'september':9,
    'oct':10,'october':10,'nov':11,'november':11,'dec':12,'december':12
}

def _parse_date(s: str, ref_year: int) -> date | None:
    s = s.strip().rstrip('.')
    # 2026-06-01
    m = re.match(r'(20\d{2})[/-](\d{1,2})[/-](\d{1,2})', s)
    if m: return date(int(m[1]), int(m[2]), int(m[3]))
    # Jun. 01, 2026 / June 1 2026
    m = re.match(r'([A-Za-z]+)\.?\s+(\d{1,2}),?\s+(20\d{2})', s)
    if m:
        mo = MONTH_MAP.get(m[1].lower().rstrip('.'))
        if mo: return date(int(m[3]), mo, int(m[2]))
    # 06/01/2026
    m = re.match(r'(\d{1,2})/(\d{1,2})/(20\d{2})', s)
    if m: return date(int(m[3]), int(m[1]), int(m[2]))
    # 06/01  (연도 추론)
    m = re.match(r'^(\d{1,2})/(\d{1,2})$', s)
    if m:
        mo, day = int(m[1]), int(m[2])
        if 1 <= mo <= 12 and 1 <= day <= 31:
            return date(ref_year, mo, day)
    return None

def _infer_year(html: str) -> int:
    import datetime as dt
    from collections import Counter
    today = dt.date.today()
    years = [int(y) for y in re.findall(r'\b(20\d{2})\b', html)]
    if not years:
        return today.year
    # 현재 연도 ±2 범위에서 가장 빈도 높은 연도 선택
    nearby = [y for y in years if abs(y - today.year) <= 2]
    if nearby:
        return Counter(nearby).most_common(1)[0][0]
    return today.year

def _clean_name(s: str) -> str:
    s = re.sub(r'^[◆●・▶\-–—\s◇\*]+', '', s)
    s = re.sub(r'\s+', ' ', s).strip()
    # 레이블/헤더 문자열 제거
    label = s.lower().rstrip(':').strip()
    if label in ("duration", "event duration", "start", "end", "event", "availability"):
        return ""
    return s[:120]

def _is_banner(name: str) -> bool:
    kw = ["banner","warp","wish","resonator","standard limited","signal","pickup",
          "invitation","debut","rerun","headhunt","tribute","board"]
    return any(k in name.lower() for k in kw)

def _add_entry(entries, seen, game_id, name, start, end, version_hint):
    if not start or not end:
        return
    if (date.today() - end).days > 90:
        return
    name = _clean_name(name)
    if not name:
        return
    key = f"{name}|{start}"
    if key in seen:
        return
    seen.add(key)
    entries.append({
        "type": "banner" if _is_banner(name) else "event",
        "title": name,
        "start": str(start),
        "end": str(end),
        "version": version_hint,
        "tentative": False,
        "source": "game8.co",
        "_auto": True,
    })


def parse(game_id: str, urls: list[str], version_hint: str = "") -> list[dict]:
    all_entries = []
    seen = set()

    for url in urls:
        try:
            r = requests.get(url, headers={"User-Agent": UA}, timeout=20)
            r.raise_for_status()
            html = r.text
        except Exception as e:
            print(f"  [{game_id}] fetch 실패 ({url}): {e}")
            continue

        ref_year = _infer_year(html)
        sp = BeautifulSoup(html, "lxml")
        rows = sp.select("tr")

        # ── 패턴 A: [날짜범위, 이름] ──
        for row in rows:
            cells = [c.get_text(separator=" ", strip=True) for c in row.find_all(["td","th"])]
            if len(cells) < 2:
                continue
            date_cell, name_raw = cells[0], " ".join(cells[1:])
            parts = re.split(r'\s*(?:~|–|—|to|-(?=\s))\s*', date_cell, maxsplit=1)
            if len(parts) < 2:
                continue
            start = _parse_date(parts[0], ref_year)
            end_s = parts[1].strip()
            if re.search(r'^end\b|ver\.\s*\d', end_s, re.I):
                end = (start + timedelta(days=42)) if start else None
            elif re.search(r'permanent|ongoing|tbd', end_s, re.I):
                end = (start + timedelta(days=180)) if start else None
            else:
                end = _parse_date(end_s, ref_year)
            _add_entry(all_entries, seen, game_id, name_raw, start, end, version_hint)

        # ── 패턴 B: [이름, Start, 날짜] ... [End, 날짜] ──
        i = 0
        while i < len(rows):
            cells = [c.get_text(separator=" ", strip=True) for c in rows[i].find_all(["td","th"])]
            # 이름 + "Start" + 날짜 형식
            if len(cells) >= 3 and cells[1].lower() in ("start","시작"):
                name_raw = cells[0]
                start = _parse_date(cells[2], ref_year)
                end = None
                if i + 1 < len(rows):
                    next_cells = [c.get_text(separator=" ", strip=True) for c in rows[i+1].find_all(["td","th"])]
                    if next_cells and next_cells[0].lower() in ("end","종료"):
                        end = _parse_date(next_cells[1] if len(next_cells) > 1 else next_cells[0], ref_year)
                        i += 1
                _add_entry(all_entries, seen, game_id, name_raw, start, end, version_hint)
            # [이름, Duration, 날짜범위] 또는 [Duration, 날짜범위]
            elif len(cells) >= 2 and cells[0].lower() in ("duration","기간"):
                date_range = cells[1] if len(cells) > 1 else ""
                parts = re.split(r'\s*(?:~|–|—|-)\s*', date_range, maxsplit=1)
                if len(parts) == 2:
                    # 이름은 이전 행에서 가져옴
                    pass  # 복잡한 케이스 - 현재 skip
            i += 1

        # ── 패턴 D: [이름, '날짜범위 설명텍스트'] — wuwa/mongil 스타일 ──
        for row in rows:
            cells = [c.get_text(separator=" ", strip=True) for c in row.find_all(["td","th"])]
            if len(cells) < 2:
                continue
            name_raw = cells[0]
            desc = " ".join(cells[1:])

            # "Availability: May 26, 2026 - June 23, 2026" 또는
            # "April 22, 2026 - June 7, 2026 설명텍스트"
            m = re.search(
                r'(?:availability\s*[:：])?\s*'
                r'([A-Za-z]+\.?\s+\d{1,2},?\s+20\d{2}|\d{1,2}/\d{1,2}/20\d{2})'
                r'\s*[-–~]\s*'
                r'([A-Za-z]+\.?\s+\d{1,2},?\s+20\d{2}|\d{1,2}/\d{1,2}/20\d{2}|permanent|tbd)',
                desc, re.I
            )
            if m:
                start = _parse_date(m[1], ref_year)
                end_s = m[2].strip()
                if re.search(r'permanent|tbd', end_s, re.I):
                    end = (start + timedelta(days=180)) if start else None
                else:
                    end = _parse_date(end_s, ref_year)
                _add_entry(all_entries, seen, game_id, name_raw, start, end, version_hint)

        # ── 패턴 F: [이름, 날짜범위, 설명] — NTE/wuwa banner 스타일 ──
        for row in rows:
            cells = [c.get_text(separator=" ", strip=True) for c in row.find_all(["td","th"])]
            if len(cells) < 2:
                continue
            name_raw = cells[0]
            date_raw = cells[1]
            # "May 27 - June 3, 2026" 또는 "May 27, 2026 - June 3, 2026"
            m = re.search(
                r'([A-Za-z]+\.?\s+\d{1,2}(?:,?\s*20\d{2})?)'
                r'\s*[-–~]\s*'
                r'([A-Za-z]+\.?\s+\d{1,2},?\s*20\d{2})',
                date_raw
            )
            if m:
                s_str, e_str = m[1], m[2]
                # 연도 없는 시작일에 종료일의 연도 적용
                if not re.search(r'20\d{2}', s_str):
                    yr = re.search(r'(20\d{2})', e_str)
                    if yr: s_str += ', ' + yr[1]
                start = _parse_date(s_str, ref_year)
                end = _parse_date(e_str, ref_year)
                _add_entry(all_entries, seen, game_id, name_raw, start, end, version_hint)

        # ── 패턴 E: 셀 텍스트에 '이름 MM/DD/YY -' 포함 — endfield 스타일 ──
        for row in rows:
            for cell in row.find_all(["td","th"]):
                text = cell.get_text(separator=" ", strip=True)
                # "Event Name (Version X.X) MM/DD/YY - MM/DD/YYYY" 형식
                m = re.match(
                    r'(.+?)\s+'
                    r'(\d{1,2}/\d{1,2}/\d{2,4})\s*[-–]\s*'
                    r'(\d{1,2}/\d{1,2}/\d{2,4})',
                    text
                )
                if m:
                    name_raw = m[1].strip()
                    s_str, e_str = m[2], m[3]
                    # 2자리 연도 보정
                    def fix_yr(s):
                        parts = s.split('/')
                        if len(parts[2]) == 2:
                            parts[2] = '20' + parts[2]
                        return '/'.join(parts)
                    start = _parse_date(fix_yr(s_str), ref_year)
                    end = _parse_date(fix_yr(e_str), ref_year)
                    # 이름에 날짜 문자열이 포함되어 있으면 제거
                    name_raw = re.sub(r'\s*\d{1,2}/\d{1,2}/\d{2,4}\s*[-–]\s*\d{1,2}/\d{1,2}/\d{2,4}.*$', '', name_raw)
                    name_raw = re.sub(r'\s*-\s*TBD.*$', '', name_raw)
                    _add_entry(all_entries, seen, game_id, name_raw, start, end, version_hint)

    print(f"  [{game_id}] 파싱 완료: {len(all_entries)}개")
    return all_entries


# ── 게임별 URL 정의 ──

GAME8_URLS = {
    "starrail": [
        "https://game8.co/games/Honkai-Star-Rail/archives/408381",  # 배너
        "https://game8.co/games/Honkai-Star-Rail/archives/408749",  # 이벤트
    ],
    "wuwa": [
        "https://game8.co/games/Wuthering-Waves/archives/453303",   # 배너
        "https://game8.co/games/Wuthering-Waves/archives/453473",   # 이벤트
    ],
    "zzz": [
        "https://game8.co/games/Zenless-Zone-Zero/archives/435687", # 배너
        "https://game8.co/games/Zenless-Zone-Zero/archives/457176", # 이벤트
    ],
    "endfield": [
        "https://game8.co/games/Arknights-Endfield/archives/524215",# 배너
        "https://game8.co/games/Arknights-Endfield/archives/535443",# 이벤트
    ],
    "nte": [
        "https://game8.co/games/Neverness-to-Everness/archives/592071", # 배너
        "https://game8.co/games/Neverness-to-Everness/archives/592073", # 이벤트
    ],
    "mongil": [
        "https://game8.co/games/Mongil-Star-Dive/archives/592077",  # 배너
        "https://game8.co/games/Mongil-Star-Dive/archives/595311",  # 이벤트
    ],
}
