# GSTPilot — Product Brief

## One-liner
A citation-grounded AI agent that answers GST questions for Indian small businesses and e-commerce sellers from the live body of law — every claim cites an exact section or notification, the agent abstains when the law doesn't cover the question, and escalates to a human professional (CA) when stakes demand it.

## Problem
SMB owners burn hours on GST confusion. CA time is expensive for routine questions. Generic chatbots hallucinate rates and due dates. Rules change constantly via notifications — sellers find out after the penalty.

## Users
E-commerce sellers (multi-state, HSN-heavy) first; service SMBs and freelancers second.

## This build = Level 1–2 of a larger ladder
- **Q&A with citations:** answer + exact notification cited, or honest "the sources don't cover this."
- **Deterministic calculators:** late-fee/interest math in code, never in the model's prose.
- **Risk tiers on every question:** T1 routine → answer · T2 money/deadline → answer through gates · T3 (notice, penalty, dispute) → "consult a CA" + clean handoff summary. T3 classification recall must be 1.0.
- **Notification watcher (Phase 9):** the ingestion pipeline doubles as "the rate on your HSN changed last week" alerts.
- **Admin surfaces for the builder:** Chunk Inspector, Retrieval Playground, Quarantine Review — read/approve only; law text is never hand-edited (audit trail).

## Deliberately NOT building now
Autonomous filing (auth stays with the taxpayer; agent-prepares-human-approves is a later level) · company registration (professional certification required by law) · SGST state acts (mirror CGST) · case law.

## Non-negotiable quality bar
- Every legal claim cites a chunk that was actually retrieved — enforced by a deterministic gate.
- **False-answer rate ≈ 0** on the unanswerable golden slice.
- **T3 recall = 1.0.**
- Every rate/date/threshold is retrieved from a document or computed in code — never from model memory.

## Architecture at a glance
Corpus (consolidated Acts + Rules base + notification stream, versioned) → Python extraction → TS ingestion (structure-aware chunking, metadata, cheap-model labels) → Supabase (dense vectors + keyword index + metadata filters, one table) → hybrid retrieval (meaning + exact-word, rank-fused) → query transformation → multi-agent flow (intake/tier → retrieval → resolution → reply) with validation gates → grounded generation + citation verification → evals (golden dataset, Vitest, Langfuse, CI) wrapped around everything.

## Success metrics
recall@10 ≥ 0.9 · false-answer ≈ 0 · T3 recall = 1.0 · 10 beta sellers, ≥4 weekly-active in week 4.
