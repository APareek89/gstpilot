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
