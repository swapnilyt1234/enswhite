# Activate the updated demo

Keep passwords and API keys in your own terminal or ignored environment files. Existing company balances, mission receipts and Whitechain contract stay in place.

## Private AI configuration

In ignored `.env.company`, set:

```dotenv
AGENT_MODE=llm
OPENAI_MODEL=your-supported-model-id
OPENAI_API_KEY=your-local-key
```

The private launcher loads this file. OpenAI Responses planning and copy/FAQ generation use the key. The SVG renderer uses the delivered headline. A model failure pauses the run or vendor delivery explicitly; no offline substitute is presented as successful AI work. Guest environments never inherit the key. Do not commit `.env.company`.

## ENS discovery migration

1. Stop the company server with Ctrl+C. Avoid other owner or department Sepolia signing commands during migration.
   Let queued company/ENS signing jobs and in-progress Finance requests finish first. The script refuses a migration across outstanding transactions; preserve all journals.
2. Run `.\setup-agent-discovery.ps1` from the project directory. Enter the same public HTTPS origin and original owner-keystore password locally.
3. It prepares a replacement directory while the active pointer stays intact. Employees keep their names, wallets, remaining terms and policies. Each signs its ERC-8004 registration, metadata update and status. The founder writes ENSIP-26 context/web keys and the exact ENSIP-25 ERC-7930 registration consent key.
4. Once ready, the owner attaches the company subregistry pointer and retires the old controller's registrar role. Mainnet, vendor registry and Whitechain funds stay in place. The new registrar retains company signup support.
5. Signed journals stay private under `data/ens/agent-discovery-v1`. If interrupted, keep the company stopped and resume **the same script and origin**. Do not delete journals or run the old bootstrap. The original runtime is preserved in the migration plan.

Sepolia only: owner fees at most 0.005 test ETH per transaction; department transactions at most 0.0005 each. Contract deployments permit at most 20 million total gas; other calls remain limited to 8 million. Department wallets need Sepolia ETH. The script prints public transaction links and writes sanitized manifests under `docs/deployments`.

Record calls include 20% gas headroom within the existing caps. If a discovery record edit has a confirmed reverted receipt, resuming can re-estimate the identical edit into at most two `.retry-N.json` journals. The original journal is preserved. Successful steps are skipped; pending/unknown transactions and reverted deployments or registrations are never automatically replaced. This recovers the observed Support binding failure without registering another identity.

The live controller deployment was estimated at 18,459,191 gas and failed bounded simulation at 16 million. Sepolia's [Glamsterdam upgrade](https://blog.ethereum.org/2026/09/17/glamsterdam-testnet-announcement) changed state-creation gas accounting; [EIP-8037](https://eips.ethereum.org/EIPS/eip-8037) separately meters state gas beyond the execution cap. The local deployment allowance is calibrated to that observed total; maximum ETH fees, network checks and balance checks remain unchanged.

The new controller permits founder edits only to discovery keys through `setAgentMetadata`; employee status and Finance budget scopes remain separate. Verification checks NFT ownership, agent wallet, current ENS ownership, ENS consent and registration metadata. Missing or mismatched identities show unverified. No MCP/A2A, reputation or validation claims are invented.

## Existing public origin

1. Restart `.\start-company-testnet.ps1` with the existing origin and local credentials. Company: **3004**; vendors: **4001–4003**. The updated policy includes automatic Finance requests within 50 test USDT; hard limits and founder approvals remain.
2. Separately run `.\start-judge.ps1` using the same origin. Its child receives only selected OS variables, the origin and fixed owner-proxy flag; no paid AI or signing credentials are forwarded.
3. Forward the existing ngrok hostname to **http://127.0.0.1:3006**. For example: `ngrok http --url=zoning-playhouse-banister.ngrok-free.dev 3006`. Keep one tunnel for that hostname.
4. Public home: `/`. Read-only proof: `/proof/`. Founder: `/owner/`. Vendors: `/vendors/copydesk` (and other vendor IDs). Employee discovery: `/agents/marketing` (and Support/Finance).
5. Razorpay webhook remains `/api/webhooks/razorpay`. Its raw body streams to the fixed loopback company service; keep `payment.captured` active. No other root payment API is exposed.

Forwarding back to 3004 restores the private entry point if needed. After discovery setup, restart both services to load the new manifests.

## Demonstrate

Business profile → sandbox top-up → allocations → mission → Agent Desk → banner approval → Campaign Kit download → Live Proof and vendor earnings. Shortages create Finance requests; they wait if company credit is absent. If funded, Finance explains its decision, makes a scoped ENS budget change when needed, then signs an allocation. The Desk shows both confirmed transaction links.

Browser-wallet Hire/Fire still needs an operator smoke test. Live terminal firing, expiry and restoration were demonstrated previously. The feedback file is now included; recording remains deferred.

## Docker—public service only

Build `docker build -t enswhite-judge .`, then run with port 3006 and `APP_ORIGIN` set to the public HTTPS origin. The image copies code and public manifests only—no environment files, funded keystores, company databases or private journals. The owner proxy is disabled by default. Configure HTTPS at the host. Docker has not been exercised in this workstation session.
