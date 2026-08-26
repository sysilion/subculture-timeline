"""명조: 워더링 웨이브 파서 — wuwatracker.com 타임라인

Next.js(App Router) 페이지라 일정이 RSC 페이로드(self.__next_f)에 JSON으로
직렬화되어 들어온다. HTML 구조를 긁는 대신 그 JSON을 꺼내 쓰므로
페이지 마크업이 바뀌어도 잘 깨지지 않는다.
"""
import json
import re
from datetime import datetime, timedelta

from .base import fetch, wiki_datetime, within_window

URL = "https://wuwatracker.com/timeline"

_CHUNK = re.compile(r'self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)', re.S)

# 서버 시각은 CST(UTC+8) 기준으로 내려온다. KST는 한 시간 빠르다.
_CST_TO_KST = timedelta(hours=1)


def _payload(html: str) -> str:
    """흩어진 RSC 청크를 하나의 문자열로 복원."""
    parts = []
    for raw in _CHUNK.findall(html):
        try:
            parts.append(json.loads(raw))   # JS 문자열 이스케이프를 안전하게 해제
        except ValueError:
            continue
    return "".join(parts)


def _extract(payload: str, key: str) -> dict | None:
    """{"key":[...]} 객체를 괄호 균형으로 잘라내 파싱."""
    m = re.search(r'\{"' + key + r'":\[', payload)
    if not m:
        return None
    start, depth, in_str, esc = m.start(), 0, False, False
    for i in range(start, len(payload)):
        ch = payload[i]
        if esc:
            esc = False
            continue
        if ch == "\\":
            esc = True
            continue
        if ch == '"':
            in_str = not in_str
            continue
        if in_str:
            continue
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                try:
                    return json.loads(payload[start:i + 1])
                except ValueError:
                    return None
    return None


def _to_kst(value: str, is_cst: bool, is_end: bool):
    """CST 기준 시각이면 KST로 옮긴 뒤 날짜만 취한다."""
    value = (value or "").strip()
    if is_cst and value:
        try:
            dt = datetime.strptime(value, "%Y-%m-%d %H:%M:%S") + _CST_TO_KST
            value = dt.strftime("%Y-%m-%d %H:%M:%S")
        except ValueError:
            pass
    return wiki_datetime(value, is_end=is_end)


def _entries(items: list, etype: str) -> list[dict]:
    out = []
    seen: set[str] = set()
    for it in items or []:
        if not isinstance(it, dict):
            continue
        is_cst = bool(it.get("isCstStart"))
        start = _to_kst(it.get("startDate"), is_cst, is_end=False)
        end   = _to_kst(it.get("endDate"), is_cst, is_end=True)
        if not within_window(start, end):
            continue

        name = (it.get("name") or "").strip()
        if not name:
            continue
        key = f"{name}|{start}"
        if key in seen:
            continue
        seen.add(key)

        entry = {
            "type":      etype,
            "title":     name[:120],
            "start":     str(start),
            "end":       str(end),
            "version":   "",
            "tentative": False,
            "source":    "wuwatracker.com",
            "_auto":     True,
        }
        if etype == "banner":
            entry["rarity"] = 5
        # 표지 이미지(coverImgSrc)는 Referer가 붙으면 403이라 브라우저에서 못 띄운다.
        # 링크와 설명만 가져온다.
        link = it.get("sourceUrl")
        if isinstance(link, str) and link.startswith("https://"):
            entry["link"] = link
        desc = it.get("description")
        if isinstance(desc, str) and desc and desc != "$undefined":
            entry["description"] = desc[:300]
        out.append(entry)
    return out


def parse() -> list[dict]:
    try:
        html = fetch(URL)
    except Exception as e:
        print(f"  [wuwa] fetch 실패: {e}")
        return []

    payload = _payload(html)
    obj = _extract(payload, "banners")
    if not obj:
        print(f"  [wuwa] 타임라인 데이터 없음 (HTML {len(html)}자, 페이로드 {len(payload)}자)")
        return []

    entries = _entries(obj.get("banners"), "banner")
    entries += _entries(obj.get("activities"), "event")

    banners = sum(1 for e in entries if e["type"] == "banner")
    print(f"  [wuwa] 배너 {banners}개, 이벤트 {len(entries) - banners}개")
    return entries
