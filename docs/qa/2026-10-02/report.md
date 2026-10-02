# GSTPilot — free FMEA and regression review, 2 October 2026

The matrix covers **108 distinct possible failure scenarios across all 12 Power Coding categories**. It does not claim that many bugs: 7 scenario rows are addressed by 3 grouped corrective changes. Existing controls, residual risks, product limits, historical limits and unverified cases are identified separately.

Baseline commit: `7b7acb456ee85d994eb632acde7c8aafdd92a697`. This is a local candidate, not a deployment receipt. The worker made no real provider calls or live-data writes and did not operate a deployment.

## Corrective changes

- A percentage and a digit used to bypass historical source coverage even for a current-rate question. A strict supplied-arithmetic predicate now requires the calculation lane, explicit numbers and an operation, while rejecting legal applicability language.
- The permitted arithmetic path uses only the current question. Prior legal context, remembered defaults and a pending tax calculator cannot contaminate it; failed extraction asks for numbers instead of entering a legal calculator.
- Date slots reject impossible calendar dates by ISO round-trip comparison, including non-leap February 29 and rolled-over February 30.
- Provider rejection telemetry now preserves bounded HTTP status and request reference without logging provider error text, prompts or keys.

## Evidence and scoring

Statuses: `controlled` 92, `fixed` 7, `residual_risk` 2, `product_limit` 5, `unverified` 2.

Evidence kinds: `source_inspection` 47, `automated` 57, `not_run` 4.

[fmea.csv](fmea.csv) and [fmea.json](fmea.json) contain each scenario, source/test reference, effect/control, S/O/D, RPN and priority. Scores are product-aware ordinal judgments, not measured probabilities. For fixed rows the score describes the pre-fix risk; for other rows it describes current controls or the remaining evidence gap. RPN=S×O×D; P0≥200, P1≥100, P2<100. All pre-fix P0 rows have corrective code and executed regressions; source-inspected cases are not labelled tested.

Validation: 33 provider and fmea vitest, 11 client node tests, 18 postgres repository checks, 2 provider postgres fixture cases, 49 compiled http unique checks, 60 compiled http assertions, 58 compiled http requests. Counts represent different test scopes and must not be added to claim unique user scenarios. Production build passed; TypeScript passed.

Checks use real code with local PostgreSQL, normal account flows and intercepted/fixture provider transports. Non-loopback network access is denied in the server/SDK fixture runners. No configured provider credentials are loaded. A model-authored/session-authored response is marked as a simulation, never provider acceptance. Safe HTTP receipts and a validation inventory are saved alongside this report.

The parent owns browser evidence. The keyless normal-auth preview is `http://127.0.0.1:9003`; screenshots and any final browser receipt are maintained by the parent. Scoped browser acceptance is recorded in [browser-qa.json](browser-qa.json), including screenshot hashes. Only those named checks are verified; no broader UI acceptance is inferred.

## Remaining limits

- The shipped legal illustration remains January 2022 GSTR-3B, using user-supplied dates and turnover. Neither these tests nor a previous successful extraction prove current Indian tax-law accuracy.
- Official source-link availability was not checked during network-denied QA. Optional post-answer memory extraction can still fail without a user warning.
- Legacy ingestion/embedding/eval CLI commands are excluded because they can spend or use historical infrastructure; hosted load and provider semantic quality remain unverified.
- The standalone arithmetic routing regressions use clearly labelled session-proxy model output. Normal HTTP fixtures verify actual routes and persistence, not a real provider’s reasoning.

## Release gates

The parent must review the exact diff, package/build the exact Linux image, preserve live environment/mounts, smoke it without network, and perform the approved release plus normal-account readback. No paid quality, current-law or load claim is implied by a green fixture.
