"""원신 파서 — paimon.moe GitHub (banners.js + timeline.js)"""
import subprocess, json, tempfile, os, re
from datetime import date, datetime, timezone

BANNERS_URL  = "https://raw.githubusercontent.com/MadeBaruna/paimon-moe/main/src/data/banners.js"
TIMELINE_URL = "https://raw.githubusercontent.com/MadeBaruna/paimon-moe/main/src/data/timeline.js"

_JS_RUNNER = """
const https = require('https');
const url = process.argv[2];
https.get(url, res => {
  let raw = '';
  res.on('data', d => raw += d);
  res.on('end', () => {
    // export const X = → module.exports.X =
    raw = raw.replace(/export const (\\w+) =/, 'module.exports.$1 =');
    const tmp = require('os').tmpdir() + '/paimon_tmp.cjs';
    require('fs').writeFileSync(tmp, raw);
    const mod = require(tmp);
    console.log(JSON.stringify(Object.values(mod)[0]));
  });
}).on('error', e => { console.error(e.message); process.exit(1); });
""".strip()

def _fetch_js(url: str) -> list | dict | None:
    try:
        tmp_js = tempfile.NamedTemporaryFile(suffix='.cjs', delete=False, mode='w')
        tmp_js.write(_JS_RUNNER)
        tmp_js.close()
        result = subprocess.run(
            ["node", tmp_js.name, url],
            capture_output=True, text=True, timeout=30
        )
        os.unlink(tmp_js.name)
        if result.returncode != 0:
            return None
        return json.loads(result.stdout)
    except Exception as e:
        print(f"  [genshin] JS fetch 실패: {e}")
        return None

def parse() -> list[dict]:
    now = datetime.now(timezone.utc)
    cutoff = date.fromisoformat(str(now.date())) .replace(year=now.year - 1)  # 1년 전까지
    entries = []

    # ── 이벤트 (timeline.js) ──
    timeline = _fetch_js(TIMELINE_URL)
    if timeline and isinstance(timeline, list):
        for group in timeline:
            if not isinstance(group, list):
                continue
            for item in group:
                if not isinstance(item, dict):
                    continue
                try:
                    s = item["start"][:10]
                    e = item["end"][:10]
                    end_d = date.fromisoformat(e)
                    if (date.today() - end_d).days > 90:
                        continue
                    entries.append({
                        "type": "event",
                        "title": item.get("name", "?"),
                        "start": s,
                        "end": e,
                        "version": "",
                        "tentative": False,
                        "source": "paimon.moe",
                        "_auto": True,
                    })
                except Exception:
                    pass

    # ── 배너 (banners.js) ──
    banners = _fetch_js(BANNERS_URL)
    if banners and isinstance(banners, dict):
        for btype, blist in banners.items():
            if btype not in ("characters", "weapons"):
                continue
            if not isinstance(blist, list):
                continue
            for b in blist:
                try:
                    s = b["start"][:10]
                    e = b["end"][:10]
                    end_d = date.fromisoformat(e)
                    if (date.today() - end_d).days > 90:
                        continue
                    featured = b.get("featured", [])
                    subtitle = ", ".join(featured[:2]).title() if featured else btype
                    entries.append({
                        "type": "banner",
                        "title": b.get("name", b.get("shortName", "?")),
                        "subtitle": subtitle,
                        "rarity": 5,
                        "start": s,
                        "end": e,
                        "version": b.get("version", ""),
                        "tentative": False,
                        "source": "paimon.moe",
                        "_auto": True,
                    })
                except Exception:
                    pass

    print(f"  [genshin] 이벤트 {sum(1 for e in entries if e['type']=='event')}개, "
          f"배너 {sum(1 for e in entries if e['type']=='banner')}개")
    return entries
