"""
One-off repair pass for ctri_trials.json (same metadata-only rules as
ctri_scrape.py): re-fetches the raw public trial views over the id range the
crawl4ai run scanned and re-parses records already in the JSON — used once to
backfill the sponsor field after a regex missed the browser-normalized DOM.
No new trials are added; person-level data is never extracted.

Usage: python scripts/scrape/ctri_repair.py [start_id] [end_id]
"""
from __future__ import annotations

import base64
import json
import ssl
import sys
import time
import urllib.request
from pathlib import Path

from ctri_scrape import BASE, CTRI_RE, parse_trial

START = int(sys.argv[1]) if len(sys.argv) > 1 else 172400
END = int(sys.argv[2]) if len(sys.argv) > 2 else 171450

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE  # ctri.nic.in's chain is incomplete on some hosts


def fetch(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (research; polite sequential fetch)"})
    with urllib.request.urlopen(req, timeout=30, context=ctx) as r:
        return r.read().decode("utf-8", errors="replace")


def main() -> int:
    path = Path(__file__).parent / "ctri_trials.json"
    payload = json.loads(path.read_text(encoding="utf-8"))
    wanted = {t["ctri_number"]: i for i, t in enumerate(payload["trials"])}
    repaired = 0
    misses = 0

    for trial_id in range(START, END, -1):
        if repaired >= len(wanted):
            break
        enc = base64.b64encode(str(trial_id).encode()).decode()
        try:
            html = fetch(BASE.format(enc=enc))
        except Exception as e:  # noqa: BLE001
            misses += 1
            print(f"[warn] id={trial_id}: {e}", flush=True)
            if misses > 10:
                break
            time.sleep(2)
            continue
        m = CTRI_RE.search(html)
        if not m or m.group(0) not in wanted:
            time.sleep(0.25)
            continue
        trial = parse_trial(html)
        if trial:
            payload["trials"][wanted[trial["ctri_number"]]] = trial
            repaired += 1
            print(f"[fix {repaired:>2}] {trial['ctri_number']} sponsor={trial['sponsor']!r}", flush=True)
        time.sleep(0.25)

    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"[done] repaired {repaired}/{len(wanted)}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
