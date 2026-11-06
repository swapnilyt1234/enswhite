# Current implementation pass

User direction: implement now; feedback file and demo recording later. Keep the Scale story: start a business, hire AI departments, fund a mission, buy external work, deliver a usable Campaign Kit with verifiable receipts.

## Work order

1. Persistent Agent Desk activity and resumable SSE; deterministic narration from real decisions/transactions, including refusals.
2. Configured OpenAI Responses planning/content, explicit offline header, mission-aware fallback; CopyDesk headline passed to PixelPress after copy delivery.
3. Marketing-owned Campaign Kit with safe downloadable HTML and Finance cost/receipt memo.
4. Finance budget-request workflow: explain decisions from spend history, use scoped ENS weekly-budget writes, then signed Whitechain allocations. Keep 50 test USDT ceiling and all hard contract limits and approvals.
5. Anonymous per-session simulated guest workspace with strict quotas and no paid model calls; separate keyless Live Proof service reading ENS and Whitechain directly. Expose both through existing public origin; Docker-ready Node 22 deployment. User chose existing public origin for now.
6. Live employee ID cards and vendor storefronts; no false claim that ancestor-pointer control has been removed.
7. ENSIP-26 discovery and ENSIP-25 / ERC-8004 identity binding. Existing resolver admin roles belong to the deployed EnsWhiteNames contract, whose ABI has no generic metadata setter. Prepare a controlled resolver/registry migration rather than pretending the owner or status key can edit arbitrary metadata. Keep the emancipated vendor registry and mainnet name intact.
8. Short README judge front page; move current runbook to docs/RUNBOOK.md. User explicitly requests removing generated graph from Git; keep local graph updates but ignore future generated output.

User will configure AGENT_MODE=llm, OPENAI_API_KEY and OPENAI_MODEL locally in ignored .env.company. Never print or commit the key. Do not use paid AI in the anonymous guest service.

## Implemented and checked

- Business profile, persistent Agent Desk/SSE, deterministic narration/refusals, mission-aware content and the copy-to-banner handoff.
- Reconciled Campaign Kit, downloadable safe HTML and receipt memo.
- Persistent Finance requests, liquidity/cumulative-week checks, scoped ENS edits before allocations, original approvals and contract limits retained.
- Fresh guest workspaces with offline-only environments, five-mission/one-hour quotas; separate read-only live proof, employee profiles and vendor storefronts. Fixed owner/webhook proxy and sanitized public launcher.
- Employee ID details use current resolver roles and actual hire/role-change receipts. Discovery metadata survives same-wallet rehire; current-owner mismatch invalidates the ERC-8004 binding.
- Controlled ENS discovery migration script and narrow metadata controller. Sepolia fork checks include adoption, register/update on the published ERC-8004 registry, scoped records and same-block rehire.
- README shortened, old instructions preserved in RUNBOOK, activation guide and public-service Docker source prepared.

Browser verification completed a guest top-up, allocations, mission, banner approval, Campaign Kit and live SSE log. Live Proof read three employees, three vendors and six real payment receipts; one transport failure displayed an explicit unavailable notice and recovered on retry.

Pending operator activation: local .env.company was absent at the check (no paid AI call performed); setup-agent-discovery.ps1 has not been broadcast; restart private service and point the existing public tunnel to the judge server on 3006. Browser-wallet Hire/Fire and Docker runtime are not tested. Sponsor feedback and recording remain explicitly deferred.

## Primary specifications checked

- https://docs.ens.domains/ensip/25 — draft, `agent-registration[<ERC-7930 registry address>][<agentId>]`, any non-empty value, verification fails when missing.
- https://docs.ens.domains/ensip/26 — draft, `agent-context`, optional `agent-endpoint[web]`, MCP/A2A only if actual supported protocols exist.
- https://eips.ethereum.org/EIPS/eip-8004 — Identity ERC-721 registration and metadata; reputation/validation optional. Payments are separate. Discovery is not a proof of honesty or a payment permission.
- https://platform.openai.com/docs/api-reference/responses/create — existing direct Responses API contract remains suitable.

Do not broadcast owner transactions or unlock owner keystores inside the agent. Prepare concrete scripts/policies; operator enters passwords in their own terminal. Keep funded-company data and journals intact.
