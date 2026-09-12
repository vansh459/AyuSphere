/**
 * DEMO SUBSET of a WHODrug-like dictionary for ASU (Ayurveda/Siddha/Unani)
 * formulations (D-024, T7.4). Licensed WHODrug Global is out of hackathon
 * scope; this bundled list is structurally faithful (code + preferred drug
 * name + class) with REPRESENTATIVE codes, sized for the demo portfolio.
 * In production this module swaps for the licensed dictionary service.
 */

export type WhodrugTerm = {
  /** representative code, ASU-prefixed to make its demo nature obvious */
  code: string;
  /** preferred formulation name */
  drugName: string;
  /** coarse therapeutic class (ATC-like grouping for ASU products) */
  drugClass: string;
};

export const WHODRUG_SUBSET: WhodrugTerm[] = [
  { code: "ASU-00001", drugName: "Ashwagandha churna", drugClass: "Rasayana / adaptogen" },
  { code: "ASU-00002", drugName: "Ashwagandharishta", drugClass: "Rasayana / adaptogen" },
  { code: "ASU-00003", drugName: "Triphala churna", drugClass: "Digestive / laxative" },
  { code: "ASU-00004", drugName: "Triphala guggulu", drugClass: "Digestive / anti-inflammatory" },
  { code: "ASU-00005", drugName: "Guduchi ghana vati", drugClass: "Immunomodulator" },
  { code: "ASU-00006", drugName: "Guduchi satva", drugClass: "Immunomodulator" },
  { code: "ASU-00007", drugName: "Arjunarishta", drugClass: "Cardiotonic" },
  { code: "ASU-00008", drugName: "Arjuna ksheerapaka", drugClass: "Cardiotonic" },
  { code: "ASU-00009", drugName: "Brahmi ghrita", drugClass: "Medhya rasayana / nootropic" },
  { code: "ASU-00010", drugName: "Brahmi vati", drugClass: "Medhya rasayana / nootropic" },
  { code: "ASU-00011", drugName: "Shankhapushpi syrup", drugClass: "Medhya rasayana / nootropic" },
  { code: "ASU-00012", drugName: "Chyawanprash avaleha", drugClass: "Rasayana / immunomodulator" },
  { code: "ASU-00013", drugName: "Sitopaladi churna", drugClass: "Respiratory" },
  { code: "ASU-00014", drugName: "Talisadi churna", drugClass: "Respiratory" },
  { code: "ASU-00015", drugName: "Vasavaleha", drugClass: "Respiratory" },
  { code: "ASU-00016", drugName: "Kanakasava", drugClass: "Respiratory" },
  { code: "ASU-00017", drugName: "Hingvastak churna", drugClass: "Digestive / carminative" },
  { code: "ASU-00018", drugName: "Avipattikar churna", drugClass: "Digestive / antacid" },
  { code: "ASU-00019", drugName: "Kutajarishta", drugClass: "Digestive / anti-diarrhoeal" },
  { code: "ASU-00020", drugName: "Bilwadi churna", drugClass: "Digestive / anti-diarrhoeal" },
  { code: "ASU-00021", drugName: "Arogyavardhini vati", drugClass: "Hepatoprotective" },
  { code: "ASU-00022", drugName: "Bhumyamalaki churna", drugClass: "Hepatoprotective" },
  { code: "ASU-00023", drugName: "Punarnavadi mandura", drugClass: "Haematinic / diuretic" },
  { code: "ASU-00024", drugName: "Punarnavasava", drugClass: "Diuretic" },
  { code: "ASU-00025", drugName: "Gokshuradi guggulu", drugClass: "Genitourinary" },
  { code: "ASU-00026", drugName: "Chandraprabha vati", drugClass: "Genitourinary" },
  { code: "ASU-00027", drugName: "Yograj guggulu", drugClass: "Musculoskeletal / anti-rheumatic" },
  { code: "ASU-00028", drugName: "Mahayograj guggulu", drugClass: "Musculoskeletal / anti-rheumatic" },
  { code: "ASU-00029", drugName: "Shallaki capsule", drugClass: "Musculoskeletal / anti-inflammatory" },
  { code: "ASU-00030", drugName: "Rasnadi guggulu", drugClass: "Musculoskeletal / anti-rheumatic" },
  { code: "ASU-00031", drugName: "Dashmoolarishta", drugClass: "Anti-inflammatory / tonic" },
  { code: "ASU-00032", drugName: "Ashokarishta", drugClass: "Gynaecological" },
  { code: "ASU-00033", drugName: "Shatavari churna", drugClass: "Gynaecological / galactagogue" },
  { code: "ASU-00034", drugName: "Kumaryasava", drugClass: "Gynaecological / hepatic" },
  { code: "ASU-00035", drugName: "Nishamalaki churna", drugClass: "Antidiabetic" },
  { code: "ASU-00036", drugName: "Vijaysar churna", drugClass: "Antidiabetic" },
  { code: "ASU-00037", drugName: "Madhumehari granules", drugClass: "Antidiabetic" },
  { code: "ASU-00038", drugName: "Sarpagandha vati", drugClass: "Antihypertensive" },
  { code: "ASU-00039", drugName: "Mukta vati", drugClass: "Antihypertensive" },
  { code: "ASU-00040", drugName: "Haridra khanda", drugClass: "Anti-allergic / dermatological" },
  { code: "ASU-00041", drugName: "Khadirarishta", drugClass: "Dermatological" },
  { code: "ASU-00042", drugName: "Mahamanjisthadi kwatha", drugClass: "Dermatological / blood purifier" },
  { code: "ASU-00043", drugName: "Saraswatarishta", drugClass: "Medhya rasayana / anxiolytic" },
  { code: "ASU-00044", drugName: "Jatamansi churna", drugClass: "Anxiolytic / sedative" },
  { code: "ASU-00045", drugName: "Tagara vati", drugClass: "Sedative" },
];

const byCode = new Map(WHODRUG_SUBSET.map((t) => [t.code, t]));
const byNameLower = new Map(
  WHODRUG_SUBSET.map((t) => [t.drugName.toLowerCase(), t]),
);

/** name/class substring search for the coding picker */
export function searchWhodrug(q: string, limit = 12): WhodrugTerm[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return [];
  return WHODRUG_SUBSET.filter(
    (t) =>
      t.drugName.toLowerCase().includes(needle) ||
      t.drugClass.toLowerCase().includes(needle),
  ).slice(0, limit);
}

/** code → term, or undefined for anything outside the subset */
export function decodeWhodrug(
  code: string | null | undefined,
): WhodrugTerm | undefined {
  return code ? byCode.get(code) : undefined;
}

/** case-insensitive exact name match — resolves a picked drug to its code */
export function whodrugByName(name: string): WhodrugTerm | undefined {
  return byNameLower.get(name.trim().toLowerCase());
}
