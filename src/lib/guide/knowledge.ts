/**
 * Sphera guide — role knowledge base (single source of truth).
 * Ground truth for what each role sees and can do. Authored against
 * src/lib/nav.ts (exact sidebar labels) and src/lib/rbac.ts (permissions);
 * a drift-guard test pins section names to NAV_ITEMS. Update THIS file when
 * features ship — never the persona prompt.
 */
import type { Role } from "@/lib/rbac";

export type GuideWorkflow = { goal: string; steps: string[] };

export type RoleKnowledge = {
  display_name: string;
  dashboard_sections: string[];
  core_workflows: GuideWorkflow[];
  permissions: string[];
  cannot_do: string[];
};

export const GLOBAL_KNOWLEDGE = {
  app: "AyuSphere — AI-assisted Clinical Research Intelligence Platform for Ayurveda (SIH26046). All participant data is synthetic/de-identified; trials are real public CTRI registry records.",
  login:
    "Sign in at /login with your email and password. You are signed out via the profile chip (top-right) → **Sign out**.",
  navigation:
    "The dark green sidebar on the left lists every screen your role can access. The top bar has a global search box, a bell icon showing open alerts (click it to open **Alerts** if your role has it), and your profile chip.",
  messages:
    "**Messages** (sidebar): pick any person in the People list to chat. Type in the box and press Enter or the send button. The paperclip attaches a file or image (max 2 MB). Click any attachment to preview it in a popup; the popup has a download button. Unread counts show as badges next to contacts.",
  previews:
    "Anywhere you see a document — Documents library, a trial's Documents card, chat attachments, Extractions thumbnails — clicking **Preview** (or the thumbnail itself) opens it in a popup. Images, PDFs and CSV/text preview inline; other files offer a download.",
} as const;

const CANNOT_SHARED = {
  auditImmutable:
    "delete or edit audit-trail entries — the audit log is append-only for everyone, including admins",
};

export const ROLE_KNOWLEDGE: Record<Role, RoleKnowledge> = {
  pi: {
    display_name: "Principal Investigator",
    dashboard_sections: [
      "Dashboard", "Messages", "Clinical Trials", "Participants", "Site Management",
      "Visit Schedule", "Data Entry (eCRF)", "Extractions", "Adverse Events",
      "Alerts", "AI Assistant", "Documents", "Reports & Exports",
    ],
    core_workflows: [
      {
        goal: "Create a new trial and take it through the lifecycle",
        steps: [
          "Go to **Clinical Trials**, click **New Trial**",
          "Fill protocol code, title, intervention, target enrolment and at least one visit-plan row, then click **Create trial**",
          "Upload the protocol first: **Documents** → pick the trial → Kind **Protocol** → choose file → **Upload** (ethics submission is gated on this)",
          "On the trial page click **Submit for ethics review** — the Ethics Committee approves it on their side",
          "After approval, enter the CTRI number and click **Record CTRI registration**, attach & activate a site under **Site Management**, then click **Activate trial**",
        ],
      },
      {
        goal: "Enrol a participant",
        steps: [
          "Go to **Participants**, choose the active trial · site, click **Add (code auto-generated)** — the subject code is created for you, no personal data is entered",
          "On the new row click **Pass screening**, then **Record consent**",
          "Pick the arm (intervention/control) and click **Enrol** — the protocol visit schedule is generated automatically",
        ],
      },
      {
        goal: "Capture a visit CRF manually",
        steps: [
          "Go to **Visit Schedule**, click the participant's visit",
          "Fill the e-CRF fields (plausible ranges are shown under each field) and click **Save & submit for approval**",
          "Click **Approve** on the submitted entry (only you or an Admin can), then **Mark visit completed**",
        ],
      },
      {
        goal: "Scan a doctor note into the CRF (AI OCR)",
        steps: [
          "Go to **Data Entry (eCRF)**, choose the participant visit, click **Note photo** and pick the photo (large phone photos are auto-compressed)",
          "Click **Extract to CRF draft** — the AI (Gemini) reads the note and shows every field with a confidence badge next to the original image",
          "Fields marked **confirm** (low confidence or contradicting an earlier approved record) must be clicked/edited before approval unlocks",
          "Click **Approve as record** — an official CRF entry is created with full provenance; see it under the visit's Entries and in **Extractions**",
        ],
      },
      {
        goal: "Watch safety deadlines",
        steps: [
          "**Adverse Events** lists open AE/SAE sorted by reporting deadline with a live countdown clock (amber under 24h, red under 6h)",
          "Open **Alerts** to acknowledge deadline, enrolment-lag, overdue-visit and deviation alerts",
        ],
      },
      {
        goal: "Ask the clinical AI Copilot",
        steps: [
          "Go to **AI Assistant**, ask e.g. \"Which sites are behind target?\" — every answer cites the underlying records; with no supporting records it declines rather than guessing",
        ],
      },
      {
        goal: "Export submission-ready data",
        steps: [
          "Go to **Reports & Exports**, pick a trial, download **FHIR R4 Bundle**, **SDTM DM (CSV)**, **SDTM AE (CSV)** or the **Define-XML stub** — every export is recorded in the audit trail",
        ],
      },
    ],
    permissions: [
      "create/edit trials and run lifecycle steps (except the ethics decision itself)",
      "manage sites, participants, visits and documents",
      "enter CRFs and APPROVE CRF entries and note extractions",
      "capture adverse events and use the AI Copilot and exports",
    ],
    cannot_do: [
      "approve or return an ethics review — only the Ethics Committee (or Admin) decides that",
      "run the pharmacovigilance review walk (mark AEs reported/closed) — that's the Pharmacovigilance role (or Admin)",
      "manage user accounts or the AI model settings — Admin only",
      CANNOT_SHARED.auditImmutable,
    ],
  },
  coordinator: {
    display_name: "Study Coordinator",
    dashboard_sections: [
      "Dashboard", "Messages", "Clinical Trials", "Participants", "Visit Schedule",
      "Data Entry (eCRF)", "Extractions", "Adverse Events", "Alerts",
      "AI Assistant", "Documents",
    ],
    core_workflows: [
      {
        goal: "Add and enrol a participant",
        steps: [
          "Go to **Participants**, choose the active trial · site, click **Add (code auto-generated)**",
          "Click **Pass screening**, then **Record consent**, pick the arm and click **Enrol** — visits are generated automatically",
        ],
      },
      {
        goal: "Enter visit data (e-CRF)",
        steps: [
          "Go to **Visit Schedule**, open the due visit, fill the fields and click **Save & submit for approval**",
          "The PI (or Admin) approves it — you'll see the entry marked approved afterwards",
        ],
      },
      {
        goal: "Scan a doctor note (AI OCR)",
        steps: [
          "**Data Entry (eCRF)** → choose the visit → **Note photo** → **Extract to CRF draft**",
          "Review the extracted fields; the draft is saved for the PI to approve",
        ],
      },
      {
        goal: "Track milestones and upload documents",
        steps: [
          "Trial pages show IEC/CTRI milestone status; upload consent forms and protocol versions under **Documents** (pick trial, kind, file ≤ 2 MB, click **Upload**)",
        ],
      },
    ],
    permissions: [
      "manage participants (screening, consent, enrolment, withdrawal)",
      "enter CRF drafts and submit them, scan doctor notes, capture adverse events",
      "create/edit trials, upload documents, use the AI Copilot",
    ],
    cannot_do: [
      "APPROVE CRF entries or note extractions — only the PI or Admin can",
      "approve ethics reviews (Ethics Committee/Admin) or run the PV review walk (Pharmacovigilance/Admin)",
      "manage sites' registry, users, exports or settings",
      CANNOT_SHARED.auditImmutable,
    ],
  },
  monitor: {
    display_name: "Monitor",
    dashboard_sections: ["Dashboard", "Messages", "Monitoring", "Alerts"],
    core_workflows: [
      {
        goal: "Review site performance and data quality",
        steps: [
          "Go to **Monitoring** — each active trial shows per-site recruitment bars, open data-quality findings (duplicates, impossible values, missing assessments) and deviation alerts",
        ],
      },
      {
        goal: "Work the alert queue",
        steps: [
          "Go to **Alerts**, review overdue-visit / deviation / data-quality items and click **Acknowledge** on the ones you own",
        ],
      },
    ],
    permissions: ["view monitoring analytics and data-quality findings", "acknowledge alerts", "message any user"],
    cannot_do: [
      "enter or approve CRFs, enrol participants, or edit trials — those belong to the PI/Coordinator",
      "use the AI Copilot or exports",
      CANNOT_SHARED.auditImmutable,
    ],
  },
  ethics: {
    display_name: "Ethics Committee",
    dashboard_sections: ["Dashboard", "Messages", "Ethics Review"],
    core_workflows: [
      {
        goal: "Decide on a submitted trial",
        steps: [
          "Go to **Ethics Review** — 'Awaiting decision' lists trials in IEC review with their protocol document named",
          "Click **Approve** to grant IEC approval (unblocks CTRI registration) or **Return** to send it back to draft",
          "The 'Approved registry' below lists everything you've approved and its current status",
        ],
      },
    ],
    permissions: ["approve or return trials submitted for IEC review", "message any user"],
    cannot_do: [
      "create or edit trials, participants or CRFs — you decide on submissions, you don't run studies",
      "see exports, alerts, or the AI Copilot",
      CANNOT_SHARED.auditImmutable,
    ],
  },
  pv: {
    display_name: "Pharmacovigilance",
    dashboard_sections: ["Dashboard", "Messages", "Adverse Events", "Alerts", "AI Assistant", "Reports & Exports"],
    core_workflows: [
      {
        goal: "Track AE/SAE reporting deadlines",
        steps: [
          "**Adverse Events** lists every open AE/SAE sorted by reporting deadline, each with a live countdown clock (amber < 24h, red < 6h, pulsing when breached)",
          "Deadline alerts (approaching/breached) also appear under **Alerts** — click **Acknowledge** to own one",
        ],
      },
      {
        goal: "Export safety data",
        steps: [
          "Go to **Reports & Exports**, pick the trial and download **SDTM AE (CSV)** or the **FHIR R4 Bundle** — exports are audit-logged",
        ],
      },
      {
        goal: "Ask the AI Copilot about safety",
        steps: [
          "**AI Assistant** → ask e.g. \"Any open SAEs near their deadline?\" — answers cite the actual AE records",
        ],
      },
    ],
    permissions: [
      "capture adverse events and run the review walk (under review → reported → closed)",
      "acknowledge alerts, run exports, use the AI Copilot",
    ],
    cannot_do: [
      "enter or approve CRFs, enrol participants, or edit trials",
      "manage users or settings — Admin only",
      CANNOT_SHARED.auditImmutable,
    ],
  },
  admin: {
    display_name: "Administrator",
    dashboard_sections: [
      "Dashboard", "Messages", "Clinical Trials", "Ethics Review", "Participants",
      "Site Management", "Visit Schedule", "Data Entry (eCRF)", "Extractions",
      "Adverse Events", "Monitoring", "Alerts", "AI Assistant", "Documents",
      "Reports & Exports", "Audit Trail", "Settings",
    ],
    core_workflows: [
      {
        goal: "Configure the AI models",
        steps: [
          "Go to **Settings** — the 'AI Model' card sets the clinical AI (Gemini or Claude, model id + API key) used for note OCR and the Copilot; click **Save AI settings**",
          "The 'Guide Assistant (Groq)' card sets the model and API key for Sphera (this floating guide)",
        ],
      },
      {
        goal: "Manage user accounts",
        steps: [
          "**Settings** → 'Create user' (email, name, role, password ≥ 8 chars) → **Create**",
          "Use **Deactivate**/**Reactivate** per account — you cannot deactivate yourself",
        ],
      },
      {
        goal: "Inspect the audit trail",
        steps: [
          "Go to **Audit Trail**, filter by entityType, entityId or action and click **Filter** — every mutation shows actor, before/after and timestamp; the log is append-only",
        ],
      },
      {
        goal: "Everything else",
        steps: [
          "You hold every capability: trial lifecycle incl. ethics decisions, participants, CRF entry AND approval, note extractions, AE review walk, monitoring, documents, exports",
        ],
      },
    ],
    permissions: ["every feature in the platform — full access"],
    cannot_do: [
      "deactivate your own account",
      CANNOT_SHARED.auditImmutable,
    ],
  },
  regulator: {
    display_name: "Regulator",
    dashboard_sections: ["Dashboard", "Messages", "Audit Trail"],
    core_workflows: [
      {
        goal: "Inspect the portfolio read-only",
        steps: [
          "**Dashboard** shows live portfolio KPIs; you can view but never change anything",
        ],
      },
      {
        goal: "Walk the audit trail",
        steps: [
          "Go to **Audit Trail**, filter by entityType/entityId/action and click **Filter** — the complete, immutable history of every action, including who approved each record and when",
        ],
      },
    ],
    permissions: ["read-only dashboard and complete audit trail", "message any user"],
    cannot_do: [
      "change ANYTHING — no trials, participants, CRFs, approvals, exports or settings; every mutating page redirects you away",
      CANNOT_SHARED.auditImmutable,
    ],
  },
};
