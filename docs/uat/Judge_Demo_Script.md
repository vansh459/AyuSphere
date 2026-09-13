# AyuSphere — Judge Demo Script (≈8 minutes)

**SIH26046** · Ministry of Ayush · All India Institute of Ayurveda
Live demo: `https://ayusphere-three.vercel.app` · every role signs in with password `Demo@1234`
(pi@ / coordinator@ / monitor@ / ethics@ / pv@ / admin@ / regulator@ — all `aiia.demo`)

Scored axes: **1** data accuracy & integrity · **2** timeliness of safety & regulatory reporting · **3** interoperability conformance · **4** access-control & audit completeness.
PDF version with live screenshots: `Judge_Demo_Script.pdf` (regenerate any time: `pnpm tsx scripts/build-uat-guides.ts`).

---

## 0:00 · PI — role-tailored entry `axis 4`
1. Sign in as **pi@aiia.demo** — the dashboard is role-tailored: signing queue, open data queries, due visits.
2. Click the leaf orb — **Sphera** greets by name and role (it remembers past conversations).

> **Say:** Seven enforced roles, each with its own dashboard. Even the in-app guide only knows THIS role's screens.

## 1:00 · PI — signed CRF approval `axis 1`
1. **Visit Schedule** → open a due visit → fill the e-CRF (ranges enforced) → **Save & submit for approval**.
2. Enter your password and click **Sign & approve** — a GCP electronic signature: password re-verified, SHA-256 hash of the record stored.

> **Say:** Approval is not a click — it is a signature. The hash lands in the immutable audit trail.

## 2:30 · PI — coded SAE capture `axis 2`
1. **Adverse Events** → **Capture** tab → pick the participant, type "Nausea" (MedDRA picker auto-codes), suspected formulation "Ashwagandha churna" (WHODrug picker), seriousness **SAE** → **Capture**.
2. The **Open AEs** tab shows the new SAE with its escalation clock already counting down.

> **Say:** Coded to MedDRA and WHODrug demo dictionaries; the NDCT-style deadline clock starts at capture — and the rules are admin-configurable, not hard-coded.

## 3:30 · PV — signed reporting, CIOMS, DSMB, NPvCC `axis 2`
1. Switch to **pv@aiia.demo** — the safety dashboard sorts by deadline proximity.
2. **Start PV review** → **Sign & mark reported** (another e-signature) → **Generate regulatory report** — the printable CIOMS-style summary with the escalation timeline and deadline compliance.
3. **Safety Signals** tab → disproportionality flags → **Full DSMB summary** (printable board pack); the **NPvCC ADRs** tab takes spontaneous reports (receive → assess → forward).

> **Say:** AIIA hosts the National Pharmacovigilance Coordination Centre — this is that role, end to end, with artifacts a regulator can hold.

## 5:00 · PI — interoperability, live `axis 3`
1. **Reports & Exports** → download **FHIR R4 Bundle**, **SDTM DM/AE**, **ADaM ADSL**, **Define-XML** (real variable-level metadata).
2. Show the live API: `GET /api/fhir/Bundle/[trialId]` returns `application/fhir+json`; inbound Observation bundles land as **draft** CRFs — nothing imported auto-commits.

> **Say:** CDISC and FHIR are not slideware here — every artifact opens, and the API is live and audited.

## 6:00 · Ethics — the amendment gate `axis 4`
1. Switch to **ethics@aiia.demo** — the amendment queue lists protocol changes awaiting IEC decision.
2. **Return** one (a comment is REQUIRED) or **Approve** — running-trial protocol changes stay blocked until approval.

> **Say:** IEC oversight covers amendments, not just first approval — the protocol version bumps only through this gate.

## 7:00 · Regulator — the audit walk `axis 4`
1. Switch to **regulator@aiia.demo** — read-only everywhere, three screens only.
2. **Audit Trail** → filter to the CRF entry approved in minute 1 — the row shows the approver, before/after, timestamp AND the e-signature hash.

> **Say:** ALCOA+ made literal: append-only at the database, every approval attributable and hash-sealed.

## 7:45 · Closers `all axes`
1. Quick-search "CTRI" jumps to a real registry trial; the app works on a phone (drawer navigation); ask Sphera *"what did I ask you earlier?"* — it remembers.

> **Say:** Real CTRI trials, synthetic participants only — DPDP by schema. Everything you saw is test-gated: 297 automated tests.
