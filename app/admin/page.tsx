// Admin home (placeholder until Phase 8).
// This route will hold the builder-only surfaces: Chunk Inspector (browse what the law was
// chunked into), Retrieval Playground (type a question, see exactly which chunks come back),
// and Quarantine Review (approve/reject suspicious ingested text). Read/approve only —
// law text is never hand-edited, so the audit trail stays trustworthy.

export default function AdminPage() {
  return (
    <main style={{ padding: "2rem", fontFamily: "system-ui" }}>
      <h1>GSTPilot Admin</h1>
      <p>Chunk Inspector · Retrieval Playground · Quarantine Review — coming in Phase 8.</p>
    </main>
  );
}
