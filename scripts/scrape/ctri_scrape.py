"""
CTRI Ayurveda trial scraper (crawl4ai, pip-only — no Docker, D-019/D-021).

Scrapes PUBLIC TRIAL REGISTRY METADATA ONLY from the Clinical Trials
Registry - India (https://ctri.nic.in): trial title, CTRI registration
number, study type, phase, intervention names, target sample size,
sponsor, health condition, and site names/states.

It deliberately NEVER extracts or stores person-level data — no PI names,
no contact emails/phones, no participant information of any kind (DPDP /
SIH problem-statement mandate). Participant-level data in AyuSphere stays
synthetic (see src/db/seed-real.ts).

Strategy: CTRI's keyword search forms (advancesearchmain.php, pubview.php)
are CAPTCHA-gated, so form automation is off the table. The public
read-only trial view (pmaindet2.php?EncHid=<base64(trialid)>&Enc=&userName=)
needs no CAPTCHA, so we walk trial ids DESCENDING from the newest
registrations and keep pages whose "Type of Study" is Ayurveda.
Requests are sequential with a politeness delay; the run aborts early on a
block signal (consecutive hard failures).

Usage:  python scripts/scrape/ctri_scrape.py
Output: scripts/scrape/ctri_trials.json
"""

from __future__ import annotations

import asyncio
import base64
import json
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

from crawl4ai import AsyncWebCrawler, BrowserConfig, CacheMode, CrawlerRunConfig

BASE = "https://ctri.nic.in/Clinicaltrials/pmaindet2.php?EncHid={enc}&Enc=&userName="

# Newest registrations first (probed 2026-09: ids ~172400 are current;
# many ids in the tail are still under review and return "invalid").
START_ID = 172400
MIN_ID = 140000  # hard floor — never walk earlier than ~late 2025
TARGET_TRIALS = 40
POLITENESS_DELAY_S = 0.35
MAX_CONSECUTIVE_FAILURES = 8  # network/5xx in a row -> treat as a block, stop
MAX_RUNTIME_S = 40 * 60  # wall-clock cap; finalize with >= MIN_ACCEPT trials
MIN_ACCEPT = 20

CTRI_RE = re.compile(r"CTRI/\d{4}/\d{2}/\d{6}")

# Indian states/UTs as CTRI prints them (upper-case) inside site addresses.
INDIAN_STATES = {
    "ANDAMAN & NICOBAR ISLANDS", "ANDHRA PRADESH", "ARUNACHAL PRADESH",
    "ASSAM", "BIHAR", "CHANDIGARH", "CHHATTISGARH", "DADRA & NAGAR HAVELI",
    "DAMAN & DIU", "DELHI", "GOA", "GUJARAT", "HARYANA", "HIMACHAL PRADESH",
    "JAMMU & KASHMIR", "JHARKHAND", "KARNATAKA", "KERALA", "LAKSHADWEEP",
    "MADHYA PRADESH", "MAHARASHTRA", "MANIPUR", "MEGHALAYA", "MIZORAM",
    "NAGALAND", "ORISSA", "ODISHA", "PONDICHERRY", "PUDUCHERRY", "PUNJAB",
    "RAJASTHAN", "SIKKIM", "TAMIL NADU", "TELANGANA", "TRIPURA",
    "UTTAR PRADESH", "UTTARANCHAL", "UTTARAKHAND", "WEST BENGAL",
}

SECTION_LABELS = [
    "CTRI Number", "Last Modified On", "Post Graduate Thesis",
    "Type of Trial", "Type of Study", "Study Design",
    "Public Title of Study", "Scientific Title of Study", "Trial Acronym",
    "Secondary IDs if Any", "Details of Principal Investigator",
    "Details of Contact Person", "Source of Monetary or Material Support",
    "Primary Sponsor", "Details of Secondary Sponsor",
    "Countries of Recruitment", "Sites of Study", "Details of Ethics Committee",
    "Regulatory Clearance Status from DCGI",
    "Health Condition / Problems Studied", "Intervention / Comparator Agent",
    "Inclusion Criteria", "ExclusionCriteria",
    "Method of Generating Random Sequence", "Method of Concealment",
    "Blinding/Masking", "Primary Outcome", "Secondary Outcome",
    "Target Sample Size", "Phase of Trial", "Date of First Enrollment",
]


def strip_tags(fragment: str) -> str:
    fragment = re.sub(r"<br\s*/?>", "\n", fragment, flags=re.I)
    fragment = re.sub(r"<[^>]+>", " ", fragment)
    fragment = fragment.replace("&nbsp;", " ").replace("&amp;", "&")
    fragment = fragment.replace("&quot;", '"').replace("&#39;", "'")
    return re.sub(r"[ \t]+", " ", fragment).strip()


def section(html: str, label: str) -> str:
    """Substring from a bold section label to the next known section label."""
    start = html.find(f"<b>{label}")
    if start == -1:
        return ""
    end = len(html)
    for other in SECTION_LABELS:
        if other == label:
            continue
        pos = html.find(f"<b>{other}", start + len(label) + 3)
        if pos != -1:
            end = min(end, pos)
    return html[start:end]


def first_value_cell(sect: str) -> str:
    """Text of the first <td> after the label's own cell (simple rows)."""
    m = re.search(r"</td>\s*<td>(.*?)</td>", sect, re.S)
    return strip_tags(m.group(1)) if m else ""


def parse_trial(html: str) -> dict | None:
    m = CTRI_RE.search(html)
    if not m:
        return None
    ctri_number = m.group(0)

    study_kind = first_value_cell(section(html, "Type of Study"))  # e.g. Ayurveda
    if "ayurveda" not in study_kind.lower():
        return None

    type_of_trial = first_value_cell(section(html, "Type of Trial")).lower()
    study_type = "observational" if "observational" in type_of_trial else "interventional"

    title = first_value_cell(section(html, "Public Title of Study"))
    sci_title = first_value_cell(section(html, "Scientific Title of Study"))
    if len(title) < 15 and len(sci_title) > len(title):
        title = sci_title
    if not title:
        return None

    phase_raw = first_value_cell(section(html, "Phase of Trial"))
    phase = None if not phase_raw or phase_raw.upper() in {"N/A", "NA", ""} else phase_raw

    size_sect = section(html, "Target Sample Size")
    size = None
    m = re.search(r'Sample Size from India=</b>\s*"?(\d+)', size_sect)
    if not m:
        m = re.search(r'Total Sample Size=</b>\s*"?(\d+)', size_sect)
    if m:
        size = int(m.group(1))

    sponsor = ""
    sp_sect = section(html, "Primary Sponsor")
    # tolerate both CTRI's raw broken markup (<b>Name&nbsp;</td>) and the
    # browser-normalized DOM crawl4ai returns (<b>Name&nbsp;</b></td>)
    m = re.search(r"<b>Name(?:&nbsp;|\s|</b>)*</td>\s*<td>(.*?)</td>", sp_sect, re.S)
    if m:
        sponsor = strip_tags(m.group(1))

    condition = ""
    hc_sect = section(html, "Health Condition / Problems Studied")
    cells = re.findall(r"<td>(.*?)</td>", hc_sect, re.S)
    hc_texts = [strip_tags(c) for c in cells]
    hc_texts = [
        t for t in hc_texts
        if t and t.lower() not in {"health type", "condition"}
        and "patients" != t.lower() and "healthy human volunteers" != t.lower()
    ]
    if hc_texts:
        condition = max(hc_texts, key=len)[:300]

    interventions: list[str] = []
    iv_sect = section(html, "Intervention / Comparator Agent")
    for row in re.findall(r"<tr[^>]*>(.*?)</tr>", iv_sect, re.S):
        cells_raw = re.findall(r"<td[^>]*>(.*?)</td>", row, re.S)
        cells = [strip_tags(c) for c in cells_raw]
        if (
            len(cells) >= 6
            and cells[1].lower().startswith("intervention")
            and not cells[1].lower().startswith("intervention/comparator")  # header row
        ):
            # AYUSH layout: sno | Intervention/Comparator | Type | Drug-Type |
            # Procedure Name | Details ("Medicine Name:" markers inside Details)
            for n in re.findall(r"Medicine Name:</b>\s*([^,<]+)", cells_raw[5]):
                n = strip_tags(n).strip()
                if n and n.upper() not in {"NIL", "NA", "N/A"}:
                    interventions.append(n[:160])
            proc = cells[4].strip()
            if proc and proc.upper() not in {"NIL", "NA", "N/A"}:
                interventions.append(proc[:160])
        elif len(cells) >= 2 and cells[0].lower().startswith("intervention"):
            # classic layout: Type | Name | Details
            name = cells[1].strip()
            if name and name.upper() not in {"NIL", "NA", "N/A"}:
                interventions.append(name[:160])
    deduped: list[str] = []
    seen_iv: set[str] = set()
    for iv in interventions:
        if iv.lower() not in seen_iv:
            seen_iv.add(iv.lower())
            deduped.append(iv)
    intervention = "; ".join(deduped)[:300]

    # Sites: keep ONLY site name + state. PI names / phones / emails in the
    # same table are intentionally ignored (metadata-only rule).
    sites: list[dict] = []
    st_sect = section(html, "Sites of Study")
    for row in re.findall(r"<tr[^>]*>(.*?)</tr>", st_sect, re.S):
        tds = [strip_tags(c) for c in re.findall(r"<td[^>]*>(.*?)</td>", row, re.S)]
        if len(tds) < 4 or "name of site" in row.lower() or "no of sites" in row.lower():
            continue
        site_name = tds[1][:160]
        state = ""
        for line in reversed(tds[2].split("\n")):
            token = line.strip().rstrip(".").upper()
            if token in INDIAN_STATES:
                state = token.title().replace(" & ", " & ")
                break
        if site_name:
            sites.append({"name": site_name, "state": state or None})

    return {
        "ctri_number": ctri_number,
        "title": title[:400],
        "study_type": study_type,
        "phase": phase,
        "intervention": intervention or "Ayurveda intervention (unspecified)",
        "target_sample_size": size,
        "sponsor": sponsor[:200] or None,
        "health_condition": condition or None,
        "sites": sites[:12],
    }


def write_payload(out_path: Path, trials: list[dict]) -> None:
    payload = {
        "source": "ctri.nic.in public registry",
        "scraped_at": datetime.now(timezone.utc).isoformat(),
        "method": (
            "crawl4ai AsyncWebCrawler over public read-only trial views "
            "(pmaindet2.php, base64 EncHid ids, descending), filtered to Type of Study = Ayurveda; "
            "search forms are CAPTCHA-gated so no form automation was used"
        ),
        "note": "Public trial registry metadata only. No person-level data was extracted or stored.",
        "trial_count": len(trials),
        "trials": trials,
    }
    out_path.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")


async def main() -> int:
    out_path = Path(__file__).parent / "ctri_trials.json"
    trials: list[dict] = []
    seen: set[str] = set()
    t0 = time.monotonic()

    browser_cfg = BrowserConfig(
        headless=True,
        java_script_enabled=False,  # static pages; also avoids the js redirect on invalid ids
        text_mode=True,
        verbose=False,
    )
    run_cfg = CrawlerRunConfig(
        cache_mode=CacheMode.BYPASS,
        page_timeout=30000,
        wait_until="domcontentloaded",
        verbose=False,
    )

    consecutive_failures = 0
    scanned = 0
    valid_pages = 0

    async with AsyncWebCrawler(config=browser_cfg) as crawler:
        for trial_id in range(START_ID, MIN_ID, -1):
            if len(trials) >= TARGET_TRIALS:
                break
            if time.monotonic() - t0 > MAX_RUNTIME_S and len(trials) >= MIN_ACCEPT:
                print(f"[cap] runtime cap reached with {len(trials)} trials — finalizing.", flush=True)
                break
            enc = base64.b64encode(str(trial_id).encode()).decode()
            url = BASE.format(enc=enc)
            scanned += 1
            try:
                result = await crawler.arun(url=url, config=run_cfg)
                html = result.html or ""
                # crawl4ai's anti-bot heuristic false-positives on CTRI's tiny
                # "invalid trial id" stub pages (~1.3KB, almost no text). Those
                # still carry html — only a genuinely empty response is a failure.
                if not html:
                    raise RuntimeError(result.error_message or "empty response")
                consecutive_failures = 0
            except Exception as e:  # noqa: BLE001
                consecutive_failures += 1
                print(f"[warn] id={trial_id} failed ({e}); strike {consecutive_failures}", flush=True)
                if consecutive_failures >= MAX_CONSECUTIVE_FAILURES:
                    print("[stop] repeated failures — assuming the site is blocking; stopping politely.", flush=True)
                    break
                await asyncio.sleep(2.0)
                continue

            if "message.php?id=invalid" in html or not CTRI_RE.search(html):
                await asyncio.sleep(POLITENESS_DELAY_S)
                continue

            valid_pages += 1
            trial = parse_trial(html)
            if trial and trial["ctri_number"] not in seen:
                seen.add(trial["ctri_number"])
                trials.append(trial)
                write_payload(out_path, trials)  # incremental — a cap/stop never loses hits
                print(f"[hit {len(trials):>2}] {trial['ctri_number']}  {trial['title'][:70]}", flush=True)

            if scanned % 100 == 0:
                print(f"[progress] scanned={scanned} valid={valid_pages} ayurveda={len(trials)} (at id {trial_id})", flush=True)
            await asyncio.sleep(POLITENESS_DELAY_S)

    if not trials:
        print("[fail] no Ayurveda trials could be scraped — NOT writing fabricated data.", flush=True)
        return 1

    write_payload(out_path, trials)
    print(f"[done] scanned={scanned} valid_pages={valid_pages} ayurveda_trials={len(trials)} -> {out_path}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
