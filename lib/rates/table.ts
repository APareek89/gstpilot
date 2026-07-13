// THE RATE TABLE — GST rates as structured FACTS, not passages buried in a schedule.
// Why this exists: a rate line ("edible oil = 5%") lives inside a giant multi-page rate
// notification, and page-chunking often separates the item from its % — so retrieval finds
// the item but not the number ("dilution"). A table turns each rate into a clean, looked-up
// fact that carries its own citation, exactly like the calculators ("model proposes, code
// disposes"). lookup is language-agnostic (Hindi item words resolve via synonyms), which also
// fixes the English-works/Hinglish-abstains inconsistency for rates.
//
// ⚠️ HUMAN TASK (Anand): this table is MODEL-COMPILED and UNVERIFIED (learning build). Rates,
// thresholds and the exact notification page for each item must be checked against the source
// PDFs before this is trusted for real advice. `verified: false` marks that. Every entry cites
// a REAL notification chunk id so the SOURCES card resolves; the prose always names the exact
// notification number. Post-Sept-2025 (GST 2.0) rates are used where they changed.

export type RateTier = { upto?: number; above?: number; rate: number };

// A price-conditional rate (footwear, apparel): the % depends on a per-unit sale value. `ask`
// is the exact question the rate lane puts to the user when it doesn't yet know which side of
// the threshold they're on — this is the ASK move, for rates.
export type RateCondition = {
  ask: string;        // e.g. "Per pair sale value ₹2500 se kam ya zyada?"
  unit: string;       // "per pair" | "per piece"
  threshold: number;  // ₹ boundary
  tiers: RateTier[];  // one with upto, one with above
};

export type RateEntry = {
  item: string;            // canonical English name
  synonyms: string[];      // English + Hindi/Hinglish words a seller might use
  hsn: string;             // HSN chapter/heading (indicative)
  rate?: number;           // flat % when there is no condition
  condition?: RateCondition;
  source_notif: string;    // human-readable notification number (always shown in prose)
  citation: string;        // a REAL chunk id so the SOURCES card resolves
  effective_date: string;  // when this rate took effect (for change-over-time + honesty)
  verified: boolean;       // false = model-compiled, not yet checked vs source PDF
  note?: string;
};

// Citations point at the governing notification's page chunks that we confirmed exist:
//   NOTIF-CTR/ntr-2017-001/p1  — 1/2017-Central Tax (Rate), the original rate schedules
//   NOTIF-CTR/ntr-2025-009/p9  — 09/2025-Central Tax (Rate), the Sept-2025 (GST 2.0) revision
const N2017 = { source_notif: "1/2017-Central Tax (Rate)", citation: "NOTIF-CTR/ntr-2017-001/p1", effective_date: "2017-06-28" };
const N2025 = { source_notif: "09/2025-Central Tax (Rate)", citation: "NOTIF-CTR/ntr-2025-009/p9", effective_date: "2025-09-17" };

export const RATE_TABLE: RateEntry[] = [
  // ---- price-conditional (these drive the rate-condition ASK) ----
  {
    item: "footwear", synonyms: ["footwear", "shoes", "joota", "jute", "chappal", "sandal", "slippers", "sneakers"],
    hsn: "6401-6405",
    condition: { ask: "Aapke footwear ki per-pair sale value ₹2,500 se kam hai ya zyada?", unit: "per pair", threshold: 2500,
      tiers: [{ upto: 2500, rate: 5 }, { above: 2500, rate: 18 }] },
    ...N2025, verified: false, note: "Sept-2025 revision raised the concessional threshold to ₹2,500/pair.",
  },
  {
    item: "apparel / garments", synonyms: ["apparel", "garment", "garments", "clothing", "clothes", "kapda", "kapde", "shirt", "t-shirt", "tshirt", "saree", "kurta", "readymade"],
    hsn: "61-63",
    condition: { ask: "Aapke garment ki per-piece sale value ₹2,500 se kam hai ya zyada?", unit: "per piece", threshold: 2500,
      tiers: [{ upto: 2500, rate: 5 }, { above: 2500, rate: 18 }] },
    ...N2025, verified: false, note: "Sept-2025 raised the ₹1,000 threshold (Notif 1/2017 as amended by 18/2018) to ₹2,500.",
  },

  // ---- flat-rate everyday goods (Schedule I, 5%) ----
  { item: "edible oil", synonyms: ["edible oil", "cooking oil", "tel", "mustard oil", "sarson oil", "groundnut oil", "refined oil", "sunflower oil"], hsn: "1507-1518", rate: 5, ...N2017, verified: false },
  { item: "sugar", synonyms: ["sugar", "cheeni", "chini", "shakkar"], hsn: "1701", rate: 5, ...N2017, verified: false },
  { item: "tea", synonyms: ["tea", "chai patti", "chai"], hsn: "0902", rate: 5, ...N2017, verified: false },
  { item: "coffee", synonyms: ["coffee"], hsn: "0901", rate: 5, ...N2017, verified: false },
  { item: "spices / masala", synonyms: ["spices", "masala", "haldi", "turmeric", "chilli powder", "garam masala"], hsn: "0904-0910", rate: 5, ...N2017, verified: false },
  { item: "packaged paneer", synonyms: ["paneer", "chena", "cottage cheese"], hsn: "0406", rate: 5, ...N2025, verified: false, note: "Pre-packaged & labelled." },
  { item: "namkeen / savoury snacks", synonyms: ["namkeen", "snacks", "bhujia", "mixture", "sev", "chips"], hsn: "2106", rate: 5, ...N2025, verified: false, note: "Sept-2025 cut many snacks 12%→5%." },
  { item: "footwear-unbranded", synonyms: [], hsn: "", rate: 5, ...N2025, verified: false, note: "placeholder — see footwear entry" },

  // ---- 18% standard-rate goods ----
  { item: "mobile phone", synonyms: ["mobile", "smartphone", "phone", "mobile phone", "cellphone"], hsn: "8517", rate: 18, ...N2017, verified: false },
  { item: "laptop / computer", synonyms: ["laptop", "computer", "desktop", "notebook computer"], hsn: "8471", rate: 18, ...N2017, verified: false },
  { item: "television", synonyms: ["tv", "television", "led tv"], hsn: "8528", rate: 18, ...N2025, verified: false, note: "Sept-2025 moved TVs (all sizes) & ACs 28%→18%." },
  { item: "air conditioner", synonyms: ["ac", "air conditioner", "air-conditioner"], hsn: "8415", rate: 18, ...N2025, verified: false, note: "Sept-2025 cut 28%→18%." },
  { item: "furniture", synonyms: ["furniture", "wooden furniture", "sofa", "table", "chair"], hsn: "9403", rate: 18, ...N2017, verified: false },
  { item: "soap", synonyms: ["soap", "sabun", "bathing soap"], hsn: "3401", rate: 5, ...N2025, verified: false, note: "Sept-2025 cut toiletries 18%→5%." },
  { item: "shampoo", synonyms: ["shampoo"], hsn: "3305", rate: 5, ...N2025, verified: false, note: "Sept-2025 revision." },
  { item: "toothpaste", synonyms: ["toothpaste", "tooth paste", "manjan"], hsn: "3306", rate: 5, ...N2025, verified: false, note: "Sept-2025 revision." },
  { item: "hair oil", synonyms: ["hair oil", "coconut oil hair"], hsn: "3305", rate: 5, ...N2025, verified: false, note: "Sept-2025 revision." },
  { item: "cosmetics / makeup", synonyms: ["cosmetics", "makeup", "lipstick", "kajal", "cream", "beauty"], hsn: "3304", rate: 18, ...N2017, verified: false },
  { item: "handbag / leather goods", synonyms: ["handbag", "bag", "purse", "wallet", "belt", "leather"], hsn: "4202", rate: 18, ...N2017, verified: false },
  { item: "cement", synonyms: ["cement"], hsn: "2523", rate: 18, ...N2025, verified: false, note: "Sept-2025 cut 28%→18%." },

  // ---- other common slabs ----
  { item: "gold / jewellery", synonyms: ["gold", "jewellery", "jewelry", "sona", "silver", "chandi"], hsn: "7108-7113", rate: 3, ...N2017, verified: false },
  { item: "medicines", synonyms: ["medicine", "medicines", "dawa", "tablet", "drug", "pharma"], hsn: "3004", rate: 5, ...N2017, verified: false, note: "Most formulations 5%; some lifesaving nil." },
  { item: "books", synonyms: ["book", "books", "printed book", "kitab"], hsn: "4901", rate: 0, ...N2017, verified: false, note: "Printed books are exempt (0%)." },
  { item: "bicycle", synonyms: ["bicycle", "cycle", "cykle"], hsn: "8712", rate: 5, ...N2025, verified: false, note: "Sept-2025 cut 12%→5%." },
  { item: "toys", synonyms: ["toy", "toys", "khilona"], hsn: "9503", rate: 5, ...N2017, verified: false, note: "Non-electronic toys 5%; electronic 18%." },
  { item: "textile fabric", synonyms: ["fabric", "cloth", "textile", "cotton fabric"], hsn: "5208-6006", rate: 5, ...N2017, verified: false },
];

// Drop the stray placeholder that has no synonyms (kept the list readable during authoring).
export const RATES = RATE_TABLE.filter((e) => e.synonyms.length > 0);

// The closed list of canonical items — given to the resolver so the model can only pick a
// real table item (it proposes, the table disposes), never invent one.
export const RATE_ITEMS = RATES.map((e) => e.item);

// Fast deterministic synonym match: lowercase substring hit on any synonym. Tried BEFORE the
// model resolver — free, instant, and it catches the common Hindi/English words directly.
export function findBySynonym(text: string): RateEntry | null {
  const t = ` ${text.toLowerCase()} `;
  for (const e of RATES) {
    if (e.synonyms.some((syn) => t.includes(` ${syn.toLowerCase()} `) || t.includes(syn.toLowerCase()))) return e;
  }
  return null;
}

export function findByItem(item: string): RateEntry | null {
  return RATES.find((e) => e.item.toLowerCase() === item.toLowerCase()) ?? null;
}
