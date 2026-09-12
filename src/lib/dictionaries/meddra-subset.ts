/**
 * DEMO SUBSET of a MedDRA-like adverse-event dictionary (D-024, T7.4).
 *
 * Licensed MedDRA is out of hackathon scope (stated in the development
 * plan); this bundled subset is structurally faithful — 8-digit codes,
 * Preferred Term (PT) grouped under System Organ Class (SOC) — and clearly
 * labeled a demo artifact. Codes are REPRESENTATIVE, not real MedDRA codes.
 * In production this module swaps for the licensed dictionary service.
 */

export type MeddraTerm = {
  /** representative 8-digit PT-style code */
  code: string;
  /** Preferred Term */
  pt: string;
  /** System Organ Class */
  soc: string;
};

const GI = "Gastrointestinal disorders";
const SKIN = "Skin and subcutaneous tissue disorders";
const NERV = "Nervous system disorders";
const GEN = "General disorders and administration site conditions";
const HEP = "Hepatobiliary disorders";
const RESP = "Respiratory, thoracic and mediastinal disorders";
const CARD = "Cardiac disorders";
const VASC = "Vascular disorders";
const MSK = "Musculoskeletal and connective tissue disorders";
const META = "Metabolism and nutrition disorders";
const PSY = "Psychiatric disorders";
const RENAL = "Renal and urinary disorders";
const INF = "Infections and infestations";
const INV = "Investigations";
const BLOOD = "Blood and lymphatic system disorders";
const IMM = "Immune system disorders";
const EYE = "Eye disorders";
const EAR = "Ear and labyrinth disorders";

export const MEDDRA_SUBSET: MeddraTerm[] = [
  // Gastrointestinal
  { code: "10000101", pt: "Nausea", soc: GI },
  { code: "10000102", pt: "Vomiting", soc: GI },
  { code: "10000103", pt: "Diarrhoea", soc: GI },
  { code: "10000104", pt: "Constipation", soc: GI },
  { code: "10000105", pt: "Abdominal pain", soc: GI },
  { code: "10000106", pt: "Abdominal pain upper", soc: GI },
  { code: "10000107", pt: "Dyspepsia", soc: GI },
  { code: "10000108", pt: "Gastritis", soc: GI },
  { code: "10000109", pt: "Gastric irritation", soc: GI },
  { code: "10000110", pt: "Flatulence", soc: GI },
  { code: "10000111", pt: "Abdominal distension", soc: GI },
  { code: "10000112", pt: "Dry mouth", soc: GI },
  { code: "10000113", pt: "Mouth ulceration", soc: GI },
  { code: "10000114", pt: "Gastrooesophageal reflux disease", soc: GI },
  { code: "10000115", pt: "Haematemesis", soc: GI },
  { code: "10000116", pt: "Melaena", soc: GI },
  // Skin
  { code: "10000201", pt: "Rash", soc: SKIN },
  { code: "10000202", pt: "Pruritus", soc: SKIN },
  { code: "10000203", pt: "Urticaria", soc: SKIN },
  { code: "10000204", pt: "Rash maculo-papular", soc: SKIN },
  { code: "10000205", pt: "Skin exfoliation", soc: SKIN },
  { code: "10000206", pt: "Dermatitis contact", soc: SKIN },
  { code: "10000207", pt: "Alopecia", soc: SKIN },
  { code: "10000208", pt: "Hyperhidrosis", soc: SKIN },
  { code: "10000209", pt: "Dry skin", soc: SKIN },
  { code: "10000210", pt: "Skin discolouration", soc: SKIN },
  { code: "10000211", pt: "Photosensitivity reaction", soc: SKIN },
  { code: "10000212", pt: "Eczema", soc: SKIN },
  // Nervous system
  { code: "10000301", pt: "Headache", soc: NERV },
  { code: "10000302", pt: "Dizziness", soc: NERV },
  { code: "10000303", pt: "Somnolence", soc: NERV },
  { code: "10000304", pt: "Tremor", soc: NERV },
  { code: "10000305", pt: "Paraesthesia", soc: NERV },
  { code: "10000306", pt: "Hypoaesthesia", soc: NERV },
  { code: "10000307", pt: "Migraine", soc: NERV },
  { code: "10000308", pt: "Syncope", soc: NERV },
  { code: "10000309", pt: "Seizure", soc: NERV },
  { code: "10000310", pt: "Memory impairment", soc: NERV },
  { code: "10000311", pt: "Dysgeusia", soc: NERV },
  { code: "10000312", pt: "Balance disorder", soc: NERV },
  // General
  { code: "10000401", pt: "Fatigue", soc: GEN },
  { code: "10000402", pt: "Pyrexia", soc: GEN },
  { code: "10000403", pt: "Asthenia", soc: GEN },
  { code: "10000404", pt: "Malaise", soc: GEN },
  { code: "10000405", pt: "Chills", soc: GEN },
  { code: "10000406", pt: "Oedema peripheral", soc: GEN },
  { code: "10000407", pt: "Chest discomfort", soc: GEN },
  { code: "10000408", pt: "Pain", soc: GEN },
  { code: "10000409", pt: "Thirst", soc: GEN },
  { code: "10000410", pt: "Feeling hot", soc: GEN },
  // Hepatobiliary
  { code: "10000501", pt: "Hepatotoxicity", soc: HEP },
  { code: "10000502", pt: "Jaundice", soc: HEP },
  { code: "10000503", pt: "Hepatitis acute", soc: HEP },
  { code: "10000504", pt: "Hepatomegaly", soc: HEP },
  { code: "10000505", pt: "Cholestasis", soc: HEP },
  { code: "10000506", pt: "Hepatic pain", soc: HEP },
  // Respiratory
  { code: "10000601", pt: "Cough", soc: RESP },
  { code: "10000602", pt: "Dyspnoea", soc: RESP },
  { code: "10000603", pt: "Oropharyngeal pain", soc: RESP },
  { code: "10000604", pt: "Rhinorrhoea", soc: RESP },
  { code: "10000605", pt: "Nasal congestion", soc: RESP },
  { code: "10000606", pt: "Epistaxis", soc: RESP },
  { code: "10000607", pt: "Wheezing", soc: RESP },
  { code: "10000608", pt: "Bronchospasm", soc: RESP },
  // Cardiac
  { code: "10000701", pt: "Palpitations", soc: CARD },
  { code: "10000702", pt: "Tachycardia", soc: CARD },
  { code: "10000703", pt: "Bradycardia", soc: CARD },
  { code: "10000704", pt: "Arrhythmia", soc: CARD },
  { code: "10000705", pt: "Angina pectoris", soc: CARD },
  { code: "10000706", pt: "Myocardial infarction", soc: CARD },
  // Vascular
  { code: "10000801", pt: "Hypertension", soc: VASC },
  { code: "10000802", pt: "Hypotension", soc: VASC },
  { code: "10000803", pt: "Orthostatic hypotension", soc: VASC },
  { code: "10000804", pt: "Flushing", soc: VASC },
  { code: "10000805", pt: "Hot flush", soc: VASC },
  // Musculoskeletal
  { code: "10000901", pt: "Arthralgia", soc: MSK },
  { code: "10000902", pt: "Myalgia", soc: MSK },
  { code: "10000903", pt: "Back pain", soc: MSK },
  { code: "10000904", pt: "Muscle spasms", soc: MSK },
  { code: "10000905", pt: "Pain in extremity", soc: MSK },
  { code: "10000906", pt: "Joint swelling", soc: MSK },
  { code: "10000907", pt: "Musculoskeletal stiffness", soc: MSK },
  // Metabolism & nutrition
  { code: "10001001", pt: "Decreased appetite", soc: META },
  { code: "10001002", pt: "Increased appetite", soc: META },
  { code: "10001003", pt: "Hyperglycaemia", soc: META },
  { code: "10001004", pt: "Hypoglycaemia", soc: META },
  { code: "10001005", pt: "Weight decreased", soc: META },
  { code: "10001006", pt: "Weight increased", soc: META },
  { code: "10001007", pt: "Dehydration", soc: META },
  // Psychiatric
  { code: "10001101", pt: "Insomnia", soc: PSY },
  { code: "10001102", pt: "Anxiety", soc: PSY },
  { code: "10001103", pt: "Depressed mood", soc: PSY },
  { code: "10001104", pt: "Restlessness", soc: PSY },
  { code: "10001105", pt: "Irritability", soc: PSY },
  { code: "10001106", pt: "Confusional state", soc: PSY },
  // Renal & urinary
  { code: "10001201", pt: "Dysuria", soc: RENAL },
  { code: "10001202", pt: "Pollakiuria", soc: RENAL },
  { code: "10001203", pt: "Urinary retention", soc: RENAL },
  { code: "10001204", pt: "Haematuria", soc: RENAL },
  { code: "10001205", pt: "Renal impairment", soc: RENAL },
  { code: "10001206", pt: "Chromaturia", soc: RENAL },
  // Infections
  { code: "10001301", pt: "Nasopharyngitis", soc: INF },
  { code: "10001302", pt: "Upper respiratory tract infection", soc: INF },
  { code: "10001303", pt: "Urinary tract infection", soc: INF },
  { code: "10001304", pt: "Gastroenteritis", soc: INF },
  { code: "10001305", pt: "Oral candidiasis", soc: INF },
  { code: "10001306", pt: "Influenza", soc: INF },
  // Investigations
  { code: "10001401", pt: "Alanine aminotransferase increased", soc: INV },
  { code: "10001402", pt: "Aspartate aminotransferase increased", soc: INV },
  { code: "10001403", pt: "Blood bilirubin increased", soc: INV },
  { code: "10001404", pt: "Blood creatinine increased", soc: INV },
  { code: "10001405", pt: "Blood pressure increased", soc: INV },
  { code: "10001406", pt: "Blood pressure decreased", soc: INV },
  { code: "10001407", pt: "Blood glucose increased", soc: INV },
  { code: "10001408", pt: "Haemoglobin decreased", soc: INV },
  { code: "10001409", pt: "Platelet count decreased", soc: INV },
  { code: "10001410", pt: "Eosinophil count increased", soc: INV },
  // Blood & lymphatic
  { code: "10001501", pt: "Anaemia", soc: BLOOD },
  { code: "10001502", pt: "Thrombocytopenia", soc: BLOOD },
  { code: "10001503", pt: "Leukopenia", soc: BLOOD },
  { code: "10001504", pt: "Eosinophilia", soc: BLOOD },
  { code: "10001505", pt: "Lymphadenopathy", soc: BLOOD },
  // Immune system
  { code: "10001601", pt: "Hypersensitivity", soc: IMM },
  { code: "10001602", pt: "Anaphylactic reaction", soc: IMM },
  { code: "10001603", pt: "Drug hypersensitivity", soc: IMM },
  { code: "10001604", pt: "Angioedema", soc: IMM },
  // Eye
  { code: "10001701", pt: "Vision blurred", soc: EYE },
  { code: "10001702", pt: "Eye irritation", soc: EYE },
  { code: "10001703", pt: "Dry eye", soc: EYE },
  { code: "10001704", pt: "Conjunctivitis", soc: EYE },
  // Ear
  { code: "10001801", pt: "Tinnitus", soc: EAR },
  { code: "10001802", pt: "Vertigo", soc: EAR },
  { code: "10001803", pt: "Ear pain", soc: EAR },
];

const byCode = new Map(MEDDRA_SUBSET.map((t) => [t.code, t]));
const byPtLower = new Map(MEDDRA_SUBSET.map((t) => [t.pt.toLowerCase(), t]));

/** PT/SOC substring search for the coding picker */
export function searchMeddra(q: string, limit = 12): MeddraTerm[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return [];
  return MEDDRA_SUBSET.filter(
    (t) =>
      t.pt.toLowerCase().includes(needle) ||
      t.soc.toLowerCase().includes(needle),
  ).slice(0, limit);
}

/** code → term, or undefined for anything outside the subset */
export function decodeMeddra(
  code: string | null | undefined,
): MeddraTerm | undefined {
  return code ? byCode.get(code) : undefined;
}

/** case-insensitive exact PT match — resolves a picked term to its code */
export function meddraByPt(pt: string): MeddraTerm | undefined {
  return byPtLower.get(pt.trim().toLowerCase());
}
