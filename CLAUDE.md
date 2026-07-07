# GSTPilot — CLAUDE.md

## Project summary
GSTPilot is a citation-grounded AI agent that answers GST (India's Goods & Services Tax) questions for small businesses and e-commerce sellers, from the live body of law. Every legal claim cites an exact section or notification; the agent abstains when the sources don't cover the question; high-stakes questions (notices, penalties, disputes) escalate to a human CA. All rates/dates/thresholds come from retrieved documents or code — never from model memory. Full brief: `docs/PRODUCT_BRIEF.md`.

Stack: Next.js 15 (App Router, TypeScript, pnpm) · Supabase (Postgres + pgvector, one chunks table) · Anthropic models · Langfuse (observability) · Python 3.12 only for PDF extraction (`scripts/extract/`) · Vitest evals · deployed on Render.

---

# The Teaching Contract

Building and learning must happen together. These rules govern every session:

1. **Explain before you build.** Before any code: what this piece does, why it exists, what breaks without it, how it connects to what came before. Wait for my "go" on architectural choices.
2. **Plain language.** No unexplained acronyms/jargon. First use of any technical term gets a one-line bracket explanation — e.g. "embedding (turning text into a list of numbers so similar meanings land near each other)". I'm smart but new to this domain.
3. **Narrate the code.** Every file opens with a 3–4 sentence plain-English comment. Every function gets a what-and-why comment. Don't explain language syntax itself.
4. **Small steps, checkpoints.** Increments I can run and see. After each: how to run, what I should see, one question to check my understanding.
5. **Honest tradeoffs.** Two reasonable ways? Show both in 2–3 lines, recommend one with a reason. Never silently pick.
6. **Flag human tasks.** "⚠️ HUMAN TASK" always means Anand's task, never Claude's. When you hit one (or anything only Anand can do): stop, print it as a checklist addressed to Anand, and wait for his confirmation before continuing.
7. **Learning log.** Append to LEARNING_LOG.md each session: what we built, 3 key concepts, the 1 thing most likely to break later.

---

## Roadmap (Phases 0–10)

- **Phase 0 — Skeleton & infrastructure:** repo scaffold, Supabase + pgvector, key verification, shared mental map of online/offline paths.
- **Phase 1 — Corpus acquisition:** TypeScript downloader pulls consolidated Acts, Rules, and the notification stream; versioned on disk.
- **Phase 2 — Extraction:** Python (pdfplumber) batch-converts PDFs into clean, structured text.
- **Phase 3 — Ingestion & chunking:** structure-aware chunking with metadata and cheap-model labels, loaded into the Supabase chunks table.
- **Phase 4 — Hybrid retrieval:** dense-vector + keyword search, rank-fused, with metadata filters; recall@10 measured.
- **Phase 5 — Agent flow:** query transformation and the multi-agent pipeline (intake/tier → retrieval → resolution → reply).
- **Phase 6 — Gates & calculators:** deterministic citation-verification gate, tier gates, and late-fee/interest calculators in code.
- **Phase 7 — Deploy:** ship the chat UI and API to Render.
- **Phase 8 — Admin surfaces:** Chunk Inspector, Retrieval Playground, Quarantine Review (read/approve only, audit trail).
- **Phase 9 — Notification watcher:** reuse the ingestion pipeline to alert "the rate on your HSN changed last week."
- **Phase 10 — Evals hardening & beta:** golden dataset, Vitest + Langfuse in CI, 10 beta sellers.

Evals are not a single phase — a starter golden dataset appears as soon as retrieval exists (Phase 4) and grows every phase after.
