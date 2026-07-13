// Deterministic money math — "the model proposes, code disposes."
// The agent EXTRACTS parameters from the conversation and CALLS these functions; it never
// computes amounts in prose. Why: a model doing arithmetic is sampling likely-looking
// digits. Boundary example: GSTR-3B due 20-Feb, filed 01-Mar — is that 9 days late or 10?
// Depends on whether the filing day counts, and on February's length that year. A model
// gets such off-by-ones wrong just often enough to be dangerous; a date-diff in code is
// exact, and the counting rule is written ONCE, reviewed once, and tested.
//
// Every figure here is sourced from a document in the corpus — the citation ids are part
// of each result so the agent can cite the math's legal basis, not just its output.

export type LateFeeResult = {
  days_late: number;
  fee_per_day: number;
  computed_fee: number;
  cap_applied: number | null;
  payable: number;
  citation_ids: string[];
  explanation: string;
};

// Late fee for GSTR-3B / GSTR-1 under s47, with the reduced per-day amounts and
// turnover-linked caps of Notification 19/2021 & 20/2021 (Central Tax).
export function gstrLateFee(input: {
  due_date: string;          // ISO yyyy-mm-dd
  filing_date: string;       // ISO
  nil_return: boolean;
  annual_turnover_inr: number;
}): LateFeeResult {
  const msPerDay = 86_400_000;
  // Counting rule (written once): days late = whole days AFTER the due date, filing day counts.
  const days_late = Math.max(
    0,
    Math.round((Date.parse(input.filing_date) - Date.parse(input.due_date)) / msPerDay)
  );

  // CGST+SGST combined: nil return ₹20/day; otherwise ₹50/day.
  const fee_per_day = input.nil_return ? 20 : 50;

  // Caps (combined CGST+SGST): nil ₹500; turnover ≤1.5cr ₹2,000; ≤5cr ₹5,000; else ₹10,000.
  const cap = input.nil_return ? 500
    : input.annual_turnover_inr <= 15_000_000 ? 2_000
    : input.annual_turnover_inr <= 50_000_000 ? 5_000
    : 10_000;

  const computed_fee = days_late * fee_per_day;
  const payable = Math.min(computed_fee, cap);
  return {
    days_late,
    fee_per_day,
    computed_fee,
    cap_applied: computed_fee > cap ? cap : null,
    payable,
    citation_ids: ["CGST-ACT/s47", "NOTIF-CT/nt-2021-019", "NOTIF-CT/nt-2021-020"],
    explanation: `${days_late} days late × ₹${fee_per_day}/day = ₹${computed_fee}${computed_fee > cap ? `, capped at ₹${cap}` : ""} (CGST+SGST combined)`,
  };
}

export type InterestResult = {
  days: number;
  rate_percent: number;
  interest: number;
  citation_ids: string[];
  explanation: string;
};

// Interest on delayed tax payment under s50(1): 18% per annum, simple, day-wise.
export function delayedPaymentInterest(input: {
  tax_amount_inr: number;
  due_date: string;
  payment_date: string;
}): InterestResult {
  const msPerDay = 86_400_000;
  const days = Math.max(0, Math.round((Date.parse(input.payment_date) - Date.parse(input.due_date)) / msPerDay));
  const rate_percent = 18;
  const interest = Math.round((input.tax_amount_inr * rate_percent * days) / (100 * 365));
  return {
    days,
    rate_percent,
    interest,
    citation_ids: ["CGST-ACT/s50"],
    explanation: `₹${input.tax_amount_inr} × 18% p.a. × ${days}/365 days = ₹${interest}`,
  };
}

// ---- GENERAL ARITHMETIC — the safe replacement for "the model does math in prose" ----
// A model asked to multiply ₹50,000 by 18% is *sampling* likely digits; this returns the exact
// number. It is a fixed DISPATCHER over a closed set of operations — NEVER eval() — so there is
// no code-injection surface and no way to run anything but arithmetic. It carries NO legal
// citation: a rate/rule must be cited from a source, but "value × rate" is just math, not law.
export type ArithmeticResult = { op: string; values: number[]; result: number | null; explanation: string; error?: string };
export function generalArithmetic(input: { op: string; values: number[] }): ArithmeticResult {
  const v = (input.values ?? []).map(Number).filter((x) => Number.isFinite(x));
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const err = (m: string): ArithmeticResult => ({ op: input.op, values: v, result: null, explanation: "", error: m });
  if (!v.length) return err("no numeric values");
  switch (input.op) {
    case "multiply": { const r = round2(v.reduce((a, b) => a * b, 1)); return { op: input.op, values: v, result: r, explanation: `${v.join(" × ")} = ${r}` }; }
    case "sum": { const r = round2(v.reduce((a, b) => a + b, 0)); return { op: input.op, values: v, result: r, explanation: `${v.join(" + ")} = ${r}` }; }
    case "subtract": { const r = round2(v.slice(1).reduce((a, b) => a - b, v[0])); return { op: input.op, values: v, result: r, explanation: `${v.join(" − ")} = ${r}` }; }
    case "divide": { if (v.slice(1).some((x) => x === 0)) return err("divide by zero"); const r = round2(v.slice(1).reduce((a, b) => a / b, v[0])); return { op: input.op, values: v, result: r, explanation: `${v.join(" ÷ ")} = ${r}` }; }
    case "percent_of": { if (v.length !== 2) return err("percent_of needs [percent, base]"); const r = round2((v[0] / 100) * v[1]); return { op: input.op, values: v, result: r, explanation: `${v[0]}% of ${v[1]} = ${r}` }; }
    default: return err(`unknown op '${input.op}'`);
  }
}

// ---- REGISTRATION THRESHOLD (typed) — must this seller register? ----
// The aggregate-turnover thresholds of section 22: ₹40 lakh for goods (₹20 lakh in special-
// category states), ₹20 lakh for services (₹10 lakh special-category). Returns the applicable
// threshold, whether it's crossed, and the s24 caveat (e-commerce sellers must register
// regardless of turnover). The rule lives here once, in code — not in the model's memory.
export type RegistrationResult = {
  threshold: number; crosses: boolean; must_register: boolean;
  citation_ids: string[]; explanation: string; caveat: string;
};
export function registrationThreshold(input: {
  annual_turnover_inr: number;
  supply_type: "goods" | "services" | "both";
  special_category_state: boolean;
}): RegistrationResult {
  // "both" and services take the lower (services) threshold; goods-only takes the higher.
  const goodsOnly = input.supply_type === "goods";
  const threshold = input.special_category_state
    ? (goodsOnly ? 2_000_000 : 1_000_000)
    : (goodsOnly ? 4_000_000 : 2_000_000);
  const crosses = input.annual_turnover_inr >= threshold;
  return {
    threshold, crosses, must_register: crosses,
    citation_ids: ["CGST-ACT/s22", "CGST-ACT/s24"],
    explanation: `Turnover ₹${input.annual_turnover_inr.toLocaleString("en-IN")} vs threshold ₹${threshold.toLocaleString("en-IN")} → ${crosses ? "crosses (registration required)" : "below threshold"}`,
    caveat: "Agar aap e-commerce operator (Amazon/Flipkart) ke through bechte hain ya inter-state supply karte hain, to section 24 ke tahat turnover se farq nahi padta — registration lena hi padta hai.",
  };
}

// ---- EXPORT REFUND — Rule 89(4) formula (typed) ----
// Refund of unutilised ITC on zero-rated supply made WITHOUT payment of tax (under LUT):
//   Refund = (Zero-rated turnover × Net ITC) ÷ Adjusted Total Turnover.
// A formula the model must never approximate — the three inputs go in, the exact figure comes
// out, cited to Rule 89.
export type RefundResult = { refund: number; citation_ids: string[]; explanation: string };
export function refundExportRule89(input: {
  zero_rated_turnover_inr: number;
  net_itc_inr: number;
  adjusted_total_turnover_inr: number;
}): RefundResult {
  if (input.adjusted_total_turnover_inr <= 0) {
    return { refund: 0, citation_ids: ["CGST-RULES/r89"], explanation: "Adjusted Total Turnover must be greater than 0" };
  }
  const refund = Math.round((input.zero_rated_turnover_inr * input.net_itc_inr) / input.adjusted_total_turnover_inr);
  return {
    refund,
    citation_ids: ["CGST-RULES/r89"],
    explanation: `(₹${input.zero_rated_turnover_inr.toLocaleString("en-IN")} × ₹${input.net_itc_inr.toLocaleString("en-IN")}) ÷ ₹${input.adjusted_total_turnover_inr.toLocaleString("en-IN")} = ₹${refund.toLocaleString("en-IN")} (Rule 89(4))`,
  };
}
