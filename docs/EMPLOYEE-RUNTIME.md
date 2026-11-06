# AI employee runtime

EnsWhite now executes employee tool loops rather than using the model only to return a task list. `agent-definitions.js` defines role prompts and strict function schemas; `agent-runtime.js` drives bounded Responses calls; `agent-tools.js` validates and executes those calls. Existing `company.js`, ENS authorization, EIP-3009 signing, journaled relayer transactions and vendor receipt verification remain the financial authority.

Each assignment permits eight tool calls, twelve API attempts and a three-minute execution window per invocation. Calls are sequential. Paused work resumes on a relevant delivery/funding observation, without polling the model through approval waits. Failed model requests stop explicitly; the backend never substitutes offline work and calls it successful AI work. Saved actions, function results and opaque Responses reasoning items support continuation. User-visible history exposes tool actions and results, not hidden reasoning.

The Responses request uses strict schemas, `parallel_tool_calls: false`, `store: false` and replayed output/function-result items, following the [official function-calling guide](https://developers.openai.com/api/docs/guides/function-calling). No signing material, unrestricted URL tool, token selection or arbitrary contract call is passed to the model. Tool permissions, current employment, quote consistency, founder approvals and contract policies are enforced separately.

## Persistence and accountability

`agent_runs`, `agent_actions`, `agent_messages` and `agent_memory` retain assignments, actions, handoffs and verified completion summaries. `company_profiles` snapshots founder facts for each mission; `mission_deliverables` keeps the campaign brief, sourced FAQ, review and financial report. `agent_quotes` binds each vendor to its original brief. Existing task IDs and payment journals prevent a repeated purchase request from charging again.

An interrupted tool can replay through the same idempotent purchase path. A crash after a verified submission result can recover completion without another model request. A model's plain final message cannot complete an employee: `submit_work` must pass backend artifact/delivery checks. Exhausted or failed runs remain visible; retry uses the saved run and original payment identities.

Model transport failures receive at most three consecutive attempts, each counted against the same twelve-request cap and invocation deadline. HTTP errors and invalid model outputs still stop explicitly. RPC transport failures inside tools preserve the unfinished function call instead of spending another model tool decision. Retrying a saved run can re-execute its last refused tool with identical arguments, call ID and order identity; employment and spending policies are rechecked. The previous refusal is retained in activity, and this does not raise the eight-tool cap. This handles the connection failures observed during the live November 7 testnet mission without purchasing CopyDesk twice.

Company event history now refreshes incrementally with a twelve-block overlap, canonical checkpoint verification and a head-consistency check. Changed anchors or a lower chain head trigger a historical rebuild; failed reads do not advance the checkpoint or return stale success. Concurrent readers share the current scan, and transport retries repeat only the failed read. A live November 7 check returned the same nine payments while reducing log requests from 22 on initial load to 1 on refresh. Balances, employment, quotes and payment permissions are not cached by this reader. See [live mission evidence](TESTNET-RUNTIME-MISSION.md) for confirmed receipts and remaining validation.

Authenticated routes: `GET /api/agent-runs`, `GET /api/agent-runs/:id`, `POST /api/agent-runs/:id/retry`, and the existing resumable `GET /api/activity/stream`. Founder-only proposal and approval routes are `POST /api/finance/proposal` and `POST /api/allocate` with `proposalId`.

## Actual sample execution

Run `node app/demo-runtime.js --offline`. This creates disposable simulated company/vendor stores, uses the actual tools and signing/receipt simulation, approves the demo banner, prints the execution and removes the disposable data. It never uses a funded wallet. `--sample` also regenerates the public, clearly labeled offline Kit.

The verified offline Acme Candles run executed:

| Employee | Actual tool sequence | Result |
| --- | --- | --- |
| Marketing | read_context → create_campaign_brief → request_quote(CopyDesk) → purchase_service → read_work → request_quote(PixelPress) → purchase_service → submit_work | 8 calls; actual copy and brand passed to design; founder approval awaited |
| Support | read_context → draft_faq → review_faq → request_quote(LinguaLink) → purchase_service → submit_work | 6 calls; founder shipping/returns facts preserved |
| Finance | read_context → read_ledger → review_spending → propose_allocation → prepare_report (wait) → prepare_report → submit_work | 7 calls; gross 0.4, fees 0.004, vendor net 0.396 simulated test USDT |

These are executed offline tool actions, not evidence of a paid model run. The test suite also completes the same workflow with mocked Responses function calls, exercising model-request/result wiring without sending an API request. The public sample contains no fabricated explorer links.

Finance no longer uses 60/30/10. Startup quotes require 0.3 USDT for copy/banner and 0.1 for translation, less existing spendable balances. Finance saves a rationale and proposal; the founder reviews it before any allocation is signed. Existing controlled purchase-shortfall handling remains separately bounded by the launcher policy and hard limits. The model cannot approve its own proposal or grant itself signing authority.

## Run locally

```powershell
npm test
node app/demo-runtime.js --offline
node app/judge-server.js
```

Open `http://localhost:3006`: enter a guest company, enter product/policy facts, simulate a top-up, ask Finance for a proposal, approve it, assign the mission, approve the banner, and inspect Agent Desk/Deliverables. `/sample-kit.html` needs no session. `/proof/` reads the deployed testnets without signing.

For private model mode, configure `AGENT_MODE=llm`, `OPENAI_MODEL` and `OPENAI_API_KEY` only in ignored `.env.company`, then run:

```powershell
node --env-file-if-exists=.env.company app/demo-runtime.js
```

This exercises the real API against disposable simulated funds; model calls incur the account's API charges. A real `gpt-6.1-sol` run completed successfully on November 7, 2026, after increasing API request timeouts to 60 seconds (the earlier 20-second runtime deadline timed out before its first call). Role/tool caps and the three-minute per-invocation runtime limit remain unchanged. For the established testnet company, use `start-company-testnet.ps1` and enter secrets locally. Do not run the simulated four-process launcher alongside the real vendors on ports 4001–4003.

The real-model validation mission `f9463c4b-8dbf-4755-a3f7-749a930ef585` completed Marketing in 8 calls, Support in 6 and Finance in 8. Marketing handed delivered copy to design and waited for the demo banner approval. Support drafted and reviewed sourced FAQ questions before buying translation. Finance read the ledger, reviewed expenses, proposed allocation, waited for delivery, flagged an expense, prepared its report and submitted. All runs had source `llm`; the downloadable Kit assembled successfully. Receipts reconciled CopyDesk 0.1, PixelPress 0.2 and LinguaLink 0.1 simulated USDT. Explorer URLs were null because these were simulated funds. This proves real API/tool execution; it does not prove live settlement by this new runtime or independent semantic quality of the translation. The disposable database was cleaned up and no private model output was published.

The environment example uses fresh workforce-simulated data paths so the new local demo does not reuse or overwrite an older payment-lab simulator. The testnet launcher sets the existing real-testnet paths explicitly.

Public activation in this session was blocked by automatic execution review when attempting to stop the temporary test server and launch a background public service. The ngrok endpoint is still pointed at port 3004. To activate in your own terminal, stop the temporary local test server, after checking that it is the process serving port 3006, run `start-judge.ps1` with the existing origin, and forward the same ngrok hostname to port 3006 as described in [ACTIVATION.md](ACTIVATION.md). The current public prototype still depends on local processes staying online; it is not permanent hosting.

## Current boundaries

- Real model connectivity and complete tool execution are verified with `gpt-6.1-sol` and simulated funds. Independent output quality review and a new real-testnet mission remain pending. Offline FAQs preserve source facts and explicitly do not claim to have translated them.
- Translation is a draft for founder review. Source checks and payment verification do not prove semantic quality.
- The runtime intentionally supports three fixed employees and the complete commerce-launch workflow. It does not execute arbitrary code, unrestricted agent-to-agent payments, tax/payroll or treasury trading.
- ENS discovery migration is now live and independently verified on Sepolia: Marketing 11295, Support 11296 and Finance 11297. ENSIP-25 consent, ERC-8004 ownership/wallet metadata and ENSIP-26 context/web records are configured. The company pointer now resolves to the replacement directory; Whitechain was not redeployed. See [deployment evidence](DISCOVERY-VERIFICATION.md). Reputation feedback and validation services remain a later identity phase.
- Browser-wallet Hire/Fire, Docker runtime and permanent hosting are not newly validated here. The existing ngrok hostname remains a temporary operator-hosted origin.
- GitHub About was updated through the authenticated owner session to: **EnsWhite: a business OS for AI employees with ENS identities, controlled Whitechain payments and verifiable business deliverables.**

![Executed offline employee tools](images/agent-runtime.png)
