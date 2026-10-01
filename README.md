# GSTPilot

GSTPilot is a source-oriented GST workspace for small businesses. Ask in English or Hinglish, review citations and remembered business details, or inspect a historical filing calculation. Its corpus is limited and dated; it does not verify current tax liability or submit returns.

Live app: **[GSTPilot](https://gstpilot.3-6-183-210.sslip.io)**. Live account, prepared-example and one historical filing-analysis path were verified on 1 October 2026.

## Try it in three steps

1. Open the live app and create an account with an email and a password of at least 12 characters.
2. Choose **Try with an example · Free**. The prepared January 2022 GSTR-3B example uses fixed server-owned inputs, the existing calculator and normal conversation persistence, without a provider request.
3. Open **Inputs and calculation** and the official source links. Reload to restore the conversation, or choose **Analyze your own facts** to start a separate editable analysis.

The prepared example illustrates six days at ₹50 per day, giving ₹300. The due date is supplied as an input. That calculation is not a determination of current liability, all State provisions, exemptions or later amendments.

## What works together

- **Chat:** the existing intake, lane routing, clarification, citation, calculator, memory-confirmation and Chartered Accountant handoff flows.
- **Filing analysis:** one bounded model request extracts fields, then code validates the historical scope and applies the existing formula. Supported scope is January 2022 GSTR-3B, supplied February 2022 due dates, filing by March 2022 and turnover up to ₹5 crore. Missing or unsupported facts produce a clarification or limit.
- **Account history:** conversations, extracted filing inputs and prepared provenance are stored under the signed-in owner. Profile and memory controls support corrections and deletion.
- **Evidence views:** read-only source inspection, owner-scoped conversations, retrieval traces, evaluation runs, architecture diagrams and personal feedback triage. Retrieval and label drafting require explicit submission and can use the configured provider.
- **Shared UI:** self-hosted Inter and Roboto Mono, Lucide icons, neutral Lovable tokens, light/dark themes, compact mobile navigation and contained evidence tables.

Changing accounts clears the visible workspace and rejects delayed JSON or streamed results. The server separately checks sessions, ownership and mutations; browser state is not an authorization source.

## Local development

Use Node 24 and the repository's pinned pnpm dependencies. Provision a **fresh** PostgreSQL database with pgvector; apply the eleven ordered files in `supabase/migrations` as an administrator. These paths retain their historical name; the hosted application uses direct PostgreSQL, not Supabase. Use a separate runtime role with data permissions only, read-only access to the shared corpus and no corpus-refresh function permission.

Configure the current variables from `.env.example`, including the application origin, Auth.js secret, database name/URL and verified database CA. Do not reuse an old database or service-role key. Start development with `pnpm dev`. For a separate local production preview, set `PUBLIC_ORIGIN` and `AUTH_URL` to the same loopback URL and port used in the browser. Retain the explicit local-preview and mock settings from `.env.example`, and bind only to loopback:

```bash
export PUBLIC_ORIGIN=http://127.0.0.1:8981
export AUTH_URL=http://127.0.0.1:8981
GSTPILOT_DIST_DIR=.next-integrated pnpm build
GSTPILOT_DIST_DIR=.next-integrated pnpm start --hostname 127.0.0.1 --port 8981
```

Set `GSTPILOT_MOCK_MODE=1` with blank provider keys for local provider-free tests. The canonical prepared example remains free when mock mode is off. Ordinary editable input is never silently treated as the prepared example.

## Verification and limits

The original app baseline and calculation-routing repair passed before authentication and UI changes. Final validation includes 11 client regressions, 18 PostgreSQL contracts, two provider/PostgreSQL contracts and 48 compiled Auth.js/API checks (58 assertions across 57 requests). TypeScript and the coherent production build pass. Live two-account checks made 29 requests with zero providers; browser checks covered account flows, history, prepared and ordinary filing, themes, compact layouts and evidence views with no console errors.

One ordinary filing POST on 1 October 2026, 09:55:20.640–09:55:22.974 UTC, completed without retries: OpenAI `gpt-4o-mini` used 608 input and 78 output tokens, with zero cached tokens. The recorded token-rate estimate was **USD 0.000138**, not an invoice. Field extraction fed the historical formula and saved the ₹300 result; an independent read verified the owner's saved result and rejected another owner's request. This proves one extraction/calculation/persistence path, not current-law accuracy, return submission or a fully paid general-chat pipeline.

The deployed image is `sha256:ca026ef671cea06a8860712d53d82eb33593b3423778893c45103f884f128b45`, with logical Docker tag `portfolio/gstpilot:f8058a32493897f9`. The ordinary live runtime uses verified PostgreSQL TLS, a nonroot process and a read-only filesystem.

Google sign-in and password recovery are not configured. The fresh hosted corpus and draft evaluation set do not establish complete GST coverage. General chat can invoke several model stages, unlike the bounded filing action. Historical CLI commands such as `check-setup`, corpus ingestion/embedding and some eval commands retain Supabase/Anthropic or laptop-path assumptions and are not certified for this hosted deployment; some can make paid calls. Corpus writes require separately reviewed operator tooling.

The **Accounts and historical filing** diagram describes the launch account and filing path. The older **MASTER** diagram renders but retains historical details, including transient-failure wording, fire-and-forget memory and a lane graph without the hosted coverage gate. Do not treat it as a complete map of current production behavior.

See [architecture flows](docs/ARCHITECTURE_FLOW.md), [handoff](HANDOFF.md) and [learning notes](LEARNING_LOG.md). Font attribution and licenses are in `public/fonts`.
