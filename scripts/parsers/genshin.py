"""원신 파서 — paimon.moe GitHub (banners.js + timeline.js)"""
import subprocess, json, tempfile, os, re
from datetime import date

BANNERS_URL  = "https://raw.githubusercontent.com/MadeBaruna/paimon-moe/main/src/data/banners.js"
TIMELINE_URL = "https://raw.githubusercontent.com/MadeBaruna/paimon-moe/main/src/data/timeline.js"

_JS_RUNNER = """
const https = require('https');
const vm = require('vm');
const url = process.argv[2];
const MAX_BYTES = 8 * 1024 * 1024;

https.get(url, res => {
  if (res.statusCode !== 200) {
    console.error('HTTP ' + res.statusCode);
    res.resume();
    process.exit(1);
  }
  let raw = '';
  res.setEncoding('utf8');
  res.on('data', d => {
    raw += d;
    if (raw.length > MAX_BYTES) {
      console.error('response too large');
      res.destroy();
      process.exit(1);
    }
  });
  res.on('end', () => {
    // 원격 파일을 require()로 실행하지 않는다.
    // require/process/fs/globalThis가 없는 빈 컨텍스트에서 데이터 리터럴만 평가하므로
    // 상류 저장소가 침해되어도 파일·네트워크 접근 수단이 없다.
    const code = raw.replace(/export\\s+const\\s+(\\w+)\\s*=/g, 'exports.$1 =');
    const sandbox = { exports: Object.create(null) };
    vm.createContext(sandbox);
    try {
      vm.runInContext(code, sandbox, { timeout: 5000, displayErrors: false });
    } catch (err) {
      console.error('eval failed: ' + err.message);
      process.exit(1);
    }
    const vals = Object.values(sandbox.exports);
    if (!vals.length) {
      console.error('no export found');
      process.exit(1);
    }
    console.log(JSON.stringify(vals[0]));
  });
}).on('error', e => { console.error(e.message); process.exit(1); });
""".strip()

def _fetch_js(url: str) -> list | dict | None:
    """원격 데이터 파일을 Node vm 샌드박스에서 평가해 JSON으로 받는다."""
    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(
            suffix=".cjs", delete=False, mode="w", encoding="utf-8"
        ) as tmp_js:
            tmp_js.write(_JS_RUNNER)
            tmp_path = tmp_js.name
        result = subprocess.run(
            ["node", tmp_path, url],
            capture_output=True, text=True, timeout=60
        )
        if result.returncode != 0:
            print(f"  [genshin] JS 평가 실패: {result.stderr.strip()[:200]}")
            return None
        return json.loads(result.stdout)
    except Exception as e:
        print(f"  [genshin] JS fetch 실패: {e}")
        return None
    finally:
        # timeout 등 예외 경로에서도 임시 파일을 반드시 정리
        if tmp_path:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass


def parse() -> list[dict]:
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
