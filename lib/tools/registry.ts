// THE TOOL REGISTRY — one declaration of what each deterministic tool needs to run.
// This file is the SCHEMA the ASK move reads: when a lane routes a question to a tool, the
// tool's *required slots that are still missing* ARE the questions we ask the user. Keeping
// these declarations in one place (not scattered inside lane handlers) means adding a new
// tool automatically teaches the clarifier what to ask for it — the ASK move never has to be
// hand-written per tool. "The tool declares its inputs; the clarifier turns the missing ones
// into one friendly question."

// A slot is one input a tool needs. `type` tells the extractor how to validate the value the
// user gave (a date must look like a date, a boolean must be yes/no); `options` are the
// choices we OFFER when we have to ask (this is what makes "which return — GSTR-3B, GSTR-1,
// or annual GSTR-9?" possible); only `required` slots ever trigger a clarification.
export type SlotType = "date" | "number" | "boolean" | "enum";

export type SlotSpec = {
  name: string;          // machine key — matches the calculator's input field exactly
  ask: string;           // the friendly phrase shown in the bundled clarification question
  type: SlotType;
  required: boolean;     // only missing required slots make the agent ask
  options?: string[];    // enum choices — offered to the user AND enforced on extraction
  example?: string;      // a concrete example, shown to the extractor to anchor the format
};

// A tool spec is a tool's name, a one-line purpose (shown to the slot extractor so it knows
// what it's filling for), and its slots. Purpose doubles as the "I can do that —" opener of
// a clarification, so the user hears WHAT we're about to do before we ask for details.
export type ToolSpec = {
  name: string;
  purpose: string;
  slots: SlotSpec[];
  // The general RULE the tool encodes, pre-written with its own citations — used as the "answer
  // the general rule" lead when the user hasn't given inputs yet. It's deterministic and already
  // cited (the rule is literally the constants the calculator applies), so it never depends on
  // retrieval or the citation gate. Optional: tools without a tidy standing rule fall back to RAG.
  generalRule?: string;
};

// The two legal calculators from Phase 6. Their slots mirror the function inputs in
// lib/calculators/index.ts exactly — the registry and the code can't drift because the
// extractor fills these names and the calculator reads the same names.
export const TOOL_SPECS: Record<string, ToolSpec> = {
  gstr_late_fee: {
    name: "gstr_late_fee",
    purpose: "calculate your exact GST return late fee",
    generalRule: [
      "GSTR-3B / GSTR-1 late file karne pe late fee ₹50/day hai (nil return pe ₹20/day), CGST+SGST milaake. [CGST-ACT/s47]",
      "- Turnover-based cap: ₹2,000 (turnover ≤ ₹1.5 crore), ₹5,000 (≤ ₹5 crore), ₹10,000 (usse zyada); nil return ka cap ₹500. Ye reduced amounts Notification 19/2021 & 20/2021 (Central Tax) se hain. [NOTIF-CT/nt-2021-019]",
    ].join("\n"),
    slots: [
      {
        name: "return_type",
        ask: "which return is late",
        type: "enum",
        required: true,
        options: ["GSTR-3B", "GSTR-1", "GSTR-9"],
        example: "GSTR-3B",
      },
      { name: "due_date", ask: "the due date", type: "date", required: true, example: "2025-01-20" },
      { name: "filing_date", ask: "the date you filed (or plan to file)", type: "date", required: true, example: "2025-02-05" },
      { name: "nil_return", ask: "was it a nil return (no sales that period)", type: "boolean", required: true },
      { name: "annual_turnover_inr", ask: "your annual turnover in rupees (to apply the right cap)", type: "number", required: true, example: "4000000" },
    ],
  },
  delayed_payment_interest: {
    name: "delayed_payment_interest",
    purpose: "calculate your exact interest on a delayed GST payment (section 50)",
    generalRule: "Late GST payment pe interest 18% per annum lagta hai (section 50), simple interest, day-wise count hota hai. [CGST-ACT/s50]",
    slots: [
      { name: "tax_amount_inr", ask: "the tax amount paid late, in rupees", type: "number", required: true, example: "50000" },
      { name: "due_date", ask: "the date the tax was due", type: "date", required: true, example: "2025-01-20" },
      { name: "payment_date", ask: "the date you actually paid (or plan to pay)", type: "date", required: true, example: "2025-03-01" },
    ],
  },
  registration_threshold: {
    name: "registration_threshold",
    purpose: "check whether you must register for GST",
    generalRule: [
      "GST registration ki aggregate-turnover limit: goods ke liye ₹40 lakh (special-category states mein ₹20 lakh), services ke liye ₹20 lakh (₹10 lakh special-category). [CGST-ACT/s22]",
      "- Lekin agar aap Amazon/Flipkart jaise e-commerce ke through bechte hain ya inter-state supply karte hain, to turnover se farq nahi padta — registration compulsory hai. [CGST-ACT/s24]",
    ].join("\n"),
    slots: [
      { name: "annual_turnover_inr", ask: "your annual aggregate turnover in rupees", type: "number", required: true, example: "4500000" },
      { name: "supply_type", ask: "do you sell goods, services, or both", type: "enum", required: true, options: ["goods", "services", "both"] },
      { name: "special_category_state", ask: "are you in a special-category state (NE states, Himachal, Uttarakhand, J&K)", type: "boolean", required: true },
    ],
  },
};
