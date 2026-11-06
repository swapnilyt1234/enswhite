# EnsWhite

**Hire AI departments, give each a budget, and the books close themselves.**

[Live demo](https://zoning-playhouse-banister.ngrok-free.dev/) · [Public deployment and payment proofs](docs/deployments/enswhite-testnets.json). Founder sign-in is required; obtain demo access from the project team. The tunnel and local company/vendor processes must remain running.

EnsWhite is the money layer for a solo founder's agent company: corporate cards and expense reports for AI employees. Marketing buys copy and a banner. Support buys a translated FAQ. Finance signs allocations, reconciles receipts and flags above-threshold spending. Every vendor payment goes to an independent vendor wallet; departments never pay each other.

**Fiat is simulated. This runs on Whitechain Sepolia and uses test USDT with no real monetary value. No fiat-to-USDT conversion occurs.** The demo allocation is INR 500 → 5 test USDT (INR 100 per test USDT for the founder's display). This is a fixed demo allocation, not an exchange rate.

## How ENSv2 runs EnsWhite

**`enswhite.eth` is owned on Ethereum mainnet. The functional ENSv2 demo uses a separate registration of `enswhite.eth` on Sepolia.** A mainnet registration does not register the same testnet name. `npm run ens:check` checks the real Sepolia ETHRegistry and reports whether that prerequisite is ready.

ENS is the employee directory and policy source; Whitechain is the bank. The Sepolia hierarchy is deployed, all three employee/vendor pairs pass live resolution, and the vendor registry reports `isEmancipated() = true`. The new [verified EnsWhiteCompany](https://explorer.testnet.whitechain.io/address/0xbca635f00C07681f10269f69ca293bDB6536D6aB/contracts) is deployed on Whitechain at block **12353630** with identity enforcement enabled. Its pool received [5 test USDT from the owner](https://explorer.testnet.whitechain.io/tx/0x2f42648a93ecaa4809272f5ba78f0bcd7e52eceb112ef81abd6b6c8a4edf17bc). The live ENS-bound mission paid [CopyDesk](https://explorer.testnet.whitechain.io/tx/0x7123f986638ac983243ba7c024a7cdd3acc0396ce0a8c2aa1b315de397e41cd0), [LinguaLink](https://explorer.testnet.whitechain.io/tx/0x1dfda793a10e024f3a82acc4c6719fc3656315cf3ade74c3c864237b1bdc5f9f) and [PixelPress](https://explorer.testnet.whitechain.io/tx/0x811232ee8b0ecb69ced740e321110a7805d251613f16edde7d6f9d859543ab4e); all delivered. Each `Paid` receipt was checked against the expected department/vendor namehashes. These are test USDT payments, with sandbox fiat and clearly labelled fallback content.

The Sepolia registration has now been independently verified as REGISTERED (status 2), owned by `0x4F961b8Abd8AF7cCdCcc4F76cd7326d8FbEa0594`: [enswhite.eth on Sepolia](https://sepolia.app.ens.domains/enswhite.eth). The readiness check discovers the active `.eth` registry through the Universal Resolver's root rather than assuming a static root deployment.

| Operation | ENSv2 integration |
| --- | --- |
| Create the company | EnsWhiteNames deploys a verifiable UserRegistry for `acme.enswhite.eth` and links the parent hierarchy |
| Hire / renew / fire | Expiring ERC1155 employee names, with founder controls in Team and Sepolia wallet confirmation |
| Employee identity | One Permissioned Resolver per employee; Whitechain coin type **2147485522** points to its existing department wallet |
| Finance delegation | Finance may update only `enswhite.budget.weekly`; it cannot change the vendor allowlist or wallet records |
| Agent status | Each employee has permission to edit only its own `enswhite.status` key |
| Company signup | Team prepares a founder-wallet transaction to create another company registry and namespace; the demo keeps its existing bank/workspace instead of silently moving funds |
| Company branding | A separate company resolver holds default (`0x00`) name/avatar/URL records; the app reads these for the workspace and employee directory |
| Spending | Fresh Universal Resolver reads check employment, expiry, weekly/per-call policy, vendor allowlist, payee and `x402.endpoint` before signing |
| Vendor identities | `copydesk`, `pixelpress` and `lingualink` under `vendors.enswhite.eth`; permanent transferable tokens and individual vendor-controlled resolvers |
| Emancipation | Vendor consent is signed by its wallet; sponsoring gas never changes ownership. Bootstrap revokes dangerous vendor-registry root roles and verifies `isEmancipated()` |
| Cross-chain enforcement | EnsWhiteCompany verifies a request-bound attester signature covering ENS nodes, wallet, vendor, limits and expiry; `Paid` and CSV receipts carry both ENS nodes |

The backend indexes `LabelRegistered` by labelhash and reads current registry state, so mutable token IDs and firing do not leave stale employee tokens in the directory. Ethers 6.17 resolves through the published Universal Resolver proxy; no raw address substitutes for failed ENS resolution. The custom payment scheme is `enswhite-receive`.

### Activate with your wallets

1. Register **enswhite.eth on Sepolia**, using the same original owner account, at [the Sepolia ENS app](https://sepolia.app.ens.domains). It needs Sepolia ETH, not WBT. Your mainnet name remains unchanged. Then run `npm run ens:check`; it must show status **2** and your owner wallet.
2. Run `./bootstrap-enswhite.ps1`. It builds the isolated `ens/` Foundry project, shows the policy and asks for the original encrypted owner-keystore password. It deploys the platform and company registries, hires the three department wallets for 30 days, installs their scoped resolver roles, and creates the vendor namespace with permanent vendor ownership. Every transaction is journaled before broadcast; rerunning resumes the same steps. Deployments allow up to 16 million gas, other calls 8 million, with a maximum execution fee of 0.005 test ETH per transaction. Public configuration is saved in ignored `data/ens/runtime.json`.
3. Run `./prepare-enswhite-company.ps1`, then execute its printed **EnsWhiteCompany** deployment command in your own terminal. The constructor arguments remain last. The old verified RelayCompany cannot acquire new policy checks or event fields without a new deployment. Preparation preserves its history and copies the existing employee keys, encrypted, into a separate `data/company/ens-testnet` ledger; it does not move tokens or overwrite existing keys. Stop the gas watcher before deploying from the same owner account on Whitechain.
4. Run `./configure-enswhite-company.ps1 -CompanyAddress 0xNEW_ADDRESS -DeploymentBlock NEW_BLOCK`. This applies the existing Finance, vendor and spending-limit configuration to the **new** company only.
5. Prefund the new pool with `./fund-company-pool.ps1 -CompanyDataDir data/company/ens-testnet`. The treasury needs 10 test USDT for that existing helper. Old pool funds and old receipts remain where they were; they are not silently migrated.
6. Stop the earlier company/vendor group, then run `./start-company-testnet.ps1`. When both new deployment and ENS runtime configuration exist, it selects the ENS company data automatically and requires the new identity-enforcing contract. All three vendors restart against that new company. Keep the Razorpay test webhook at `/api/webhooks/razorpay`, forwarded to port 3004.
7. In a wallet-enabled browser, Team shows each active ENS name and a contract-term countdown. **Hire**, **Renew** and **Fire** prepare transactions; the founder's connected wallet switches to Sepolia and confirms them. A five-minute demo hire shows expiry without presenting a tokenized employee as a wildcard contractor. The app never asks for the founder's private key.
8. Run a new vendor mission. Its Whitechain receipts include `deptNode` and `vendorNode`, and Books exports those fields. Do not use the earlier legacy payment links as proof of ENS-enforced settlement.

For the Finance scoped-edit demo, give the Finance department wallet a small **Sepolia ETH** gas balance, then run:

```powershell
node ens/scripts/finance-budget.js marketing 4000000 finance-budget-demo-01
```

The Finance wallet signs the resolver edit directly; the script writes only `enswhite.budget.weekly` and saves signed bytes before broadcasting. Stop the company server before using this standalone script, so two processes never use Finance's Sepolia nonce concurrently. Reuse a request ID only to recover that same edit. Its Whitechain WBT balance remains zero. The ENS fork test also attempts a Finance edit of `enswhite.vendors` and proves it reverts.

Team also has a Finance budget form. Its edits and automatic employee status updates share one persistent, sequential ENS transaction queue. Each employee signs its own status; Finance signs only budget changes requested by the founder. The launcher discloses limits: **48 ENS writes per UTC day**, **1 million gas** and **0.0001 Sepolia ETH maximum execution fee per edit**; requested weekly caps are at most **50 test USDT**, and Whitechain's hard limits remain in force. A missing Sepolia gas balance pauses record writes without granting a broader role. Bootstrap installs company branding and sponsors 0.001 test ETH per department once; it never replenishes those balances automatically. Company branding is inherited in the app; separate employee resolver records do not automatically inherit individual text keys from another resolver.

The Finance form has been exercised live: [Finance raised Marketing's weekly limit to 4 test USDT](https://sepolia.etherscan.io/tx/0x3accfeaef63305ea8509f6ebe9ed9b5f0f522e78c4583d14a149de53916d73e0). Automatic statuses also confirmed on Sepolia: [Marketing delivered](https://sepolia.etherscan.io/tx/0x9bd2e668f9f19ebb725cfa1c2914b632ae9434133849917fd3373e8c803a025e) and [Support delivered](https://sepolia.etherscan.io/tx/0x78afc8e9a6baa839e5140b4d337d2efa9087474c630ddc2ed7c7be93d039845e).

For the live lifecycle walkthrough, run `./run-ens-demo.ps1` after completing any mission. It discloses and signs four owner transactions: register a demo company namespace, fire Support, hire it for five minutes, and restore it for 30 days after expiry. It checks denied employee transfer, Finance vendor-policy edits and spoofed payees using read-only calls, then exercises the deployed Whitechain expiry guard with `eth_call`; rejected checks do not broadcast failed payments. This is a tokenized employee expiry demo, not a wildcard contractor. The company server can stay running, but avoid Support missions during that interval. If interrupted, resume with the exact printed `-DemoId`; it preserves signed transactions and the original Support policy. Restoration is attempted even if the final read-only expiry check fails. Do not run another owner signing command on Sepolia concurrently.

The live walkthrough completed on Sepolia: [company signup](https://sepolia.etherscan.io/tx/0x31571264c98c5090664f88ae2c2d89030d5406bdabb1dc0561fcbb8c3a0145e8), [Support fired](https://sepolia.etherscan.io/tx/0x487f2c2bc6bca15ca02163bc72e15f23873e2b5af03f37f5a1d70b927ac10cd9), [five-minute rehire](https://sepolia.etherscan.io/tx/0x8c2a30d74339131651e2bddd85a99c26b0660ccea8933a4dd2ac768c84a4bd49) and [30-day restoration](https://sepolia.etherscan.io/tx/0x58bb4e98c6000f0e5f77fd9e411c9d2d460c20283d0fb4bff5d251347477f191). The script's assertions passed for unauthorized Finance edits, spoofed vendors, firing, expiry and the deployed Whitechain expiry guard. The lifecycle transactions were signed in the operator terminal; the browser-wallet Hire/Fire interaction itself has not been exercised.

To run the existing gas watcher for the new company, use `./start-gas-replenisher.ps1 -CompanyDataDir data/company/ens-testnet` after stopping the old watcher. Wallet filenames, browser storage keys, legacy EIP-712 domains and old deployed contract source retain compatibility names; changing those strings would invalidate signing or strand existing sessions. The public product and repository are **EnsWhite**, at [swapnilyt1234/enswhite](https://github.com/swapnilyt1234/enswhite).

### ENS validation and limits

```powershell
npm test
forge test --match-contract EnsWhiteCompanyTest -vv
$env:ENS_FORK_TEST='true'
$env:ENS_FORK_BLOCK=[string]([long](cast block-number --rpc-url https://ethereum-sepolia-rpc.publicnode.com)-16)
try { forge test --root ens -vv }
finally { Remove-Item Env:ENS_FORK_TEST; Remove-Item Env:ENS_FORK_BLOCK }
```

The ENS fork tests use the actual Sepolia factory, registries and resolver implementation: non-transferable employee ownership, scoped Finance edits, firing, five-minute expiry, signed vendor consent, vendor-registry emancipation and permanent transferable vendor tokens. Whitechain unit tests prove valid attested settlement and rejection of expired names, altered vendor nodes and over-limit payments. Ordinary test runs explicitly skip opt-in fork tests.

Startup retries transient transport failures during the read-only token/network check up to three times, with a ten-second RPC request timeout. Vendors start sequentially and each has a two-minute readiness window. Wrong-chain and token-domain failures stop immediately; transaction signing is never retried by this helper. Dashboard loading errors clear after a successful refresh. Public RPC outages can still pause the demo; payment journals remain intact.

Cross-chain policy attestations last at most **60 seconds** and never beyond the employment expiry. Firing blocks newly authorized payments after fresh ENS resolution; an already signed or broadcast payment can remain valid for that bounded window. Sepolia revocation is not magically instantaneous on another chain. The Whitechain attester is a trusted bridge for these facts, not an ENS light client.

Vendor-registry emancipation removes that registry's revocation authority. The owner of the ancestor `enswhite.eth` namespace can still change its own subregistry pointer; this is not a claim of emancipation across the entire ancestor chain. Wildcard contractors without tokens, namespace aliasing and agent-owned subteams are the explicitly cut stretch features. The implemented five-minute expiry demo is an employee token.

Implementation references: [ENSv2 registries](https://docs.ens.domains/ensv2/permissioned-registry), [resolvers and scoped permissions](https://docs.ens.domains/ensv2/permissioned-resolver), [deployment pattern](https://docs.ens.domains/ensv2/tutorial-contract-developers), and [published deployments](https://docs.ens.domains/learn/deployments).

## Run locally

Requires Node.js 22.13+, Git and, for Solidity, Foundry (tested with 1.4.4).

```powershell
git clone --recurse-submodules https://github.com/swapnilyt1234/enswhite.git
cd enswhite
npm ci
npm test
npm run company
```

Open **http://localhost:3003**. The launcher starts four independent Node processes: the company on 3003, CopyDesk on 4001, PixelPress on 4002 and LinguaLink on 4003. Stop with Ctrl+C. Stop the simulated vendor group before running testnet vendors, because both modes use ports 4001–4003.

1. **Add INR 500**: locally simulates a captured payment, attestation and company credit.
2. **Approve weekly allocations**: Finance signs 60/30/10 allocations within weekly caps.
3. Open **Mission** and launch the Diwali campaign.
4. CopyDesk and LinguaLink deliver after payment. PixelPress waits under **Approvals** because its INR 20 price exceeds Marketing's INR 15 threshold.
5. Approve the banner. PixelPress verifies its payment and delivers an SVG.
6. Open **Books** for the event-derived ledger and accountant CSV. **Show onchain** reveals addresses and, in testnet mode, transaction links.

Simulated payments are labeled and never linked to an explorer. The earlier payment lab is preserved with `npm start`; it uses separate state. See [its notes](docs/payment-lab.md).

## Departments and independent vendors

| Department | Weekly cap | Per-call cap | Daily cap | Approval above |
| --- | ---: | ---: | ---: | ---: |
| Marketing | INR 300 | INR 50 | INR 300 | INR 15 |
| Support | INR 150 | INR 20 | INR 150 | INR 10 |
| Finance | INR 50 | INR 10 | INR 50 | INR 5 |

| Vendor | Service | Gross price | Net receipt | Port |
| --- | --- | ---: | ---: | ---: |
| CopyDesk | Advertising copy | 0.1 test USDT / INR 10 | 0.099 test USDT | 4001 |
| PixelPress | SVG campaign banner | 0.2 test USDT / INR 20 | 0.198 test USDT | 4002 |
| LinguaLink | Hindi / Marathi FAQ | 0.1 test USDT / INR 10 | 0.099 test USDT | 4003 |

Each vendor has its own encrypted wallet, process, order database and earnings page. In testnet mode, `/api/earnings` reads `Paid` events directly from Whitechain filtered by its address. Before delivery, the vendor independently checks the transaction receipt, company contract, request ID, department, vendor and amount. It never trusts a backend declaration of payment. The local simulator uses an explicitly labeled local event store.

## What enforces the money

[RelayCompany.sol](src/RelayCompany.sol) implements:

- `topUp`: EIP-712 attestation credits only prefunded USDT. Each Razorpay payment ID works once. The backend first verifies the exact raw webhook HMAC and independently checks captured status, local order, INR currency and amount through Razorpay's API.
- `allocate`: owner or Finance transfers credited funds to a registered department.
- `allocateBySig`: Finance signs an allocation; the relayer pays gas. Finance therefore needs no WBT. Its nonce prevents replay.
- `registerVendor` / `setLimits`: owner-only vendor prices and department per-call/day caps.
- `pay`: recomputes `keccak256(abi.encode(vendor, requestId, salt))`, checks the registered price, call/day limits and request replay, then executes the department's signed `ReceiveWithAuthorization`. Only the named recipient, RelayCompany, can execute it. The contract sends the vendor the amount minus 1% and emits `Paid`.
- `withdrawFees`: owner-only withdrawal of the recorded USDT fee pool. Company credit is not withdrawable as fees. The separate automatic gas replenisher converts earned fees to WBT through YetiTrade when the relayer needs gas.

The backend reserves budget before signing, enforces weekly caps and founder thresholds, and records approval decisions. Models may propose allowed vendor work; they never choose signing keys, wallet addresses, prices or permissions. A compromised department key can lose its allocated token balance; **there is no claim that a stolen key cannot transfer tokens directly**. Department wallets hold zero WBT and only their allocations.

Signed transactions are saved before broadcast. Unknown broadcasts keep their original bytes and reservations. Vendor delivery retries after confirmed payment do not charge again. Finance signs internal allocations; departments only pay external vendors.

The relayer holds WBT and no USDT. The attester holds neither asset and signs payment confirmations only. Treasury prefunding is signed by the separate USDT treasury and relayed using WBT gas. Relayer code checks a minimum gas balance, caps each transaction at 600,000 gas and estimated 0.05 WBT, and limits newly signed jobs to 120 per day in this single-process demo.

## Optional model-backed agents

Without credentials the UI explicitly labels **seeded fallback** briefs, copy and FAQ. PixelPress deterministically renders an SVG. With a model, Marketing chooses copy, a banner or both, and Support chooses a translation brief; code validates the resulting vendor choices and ignores untrusted extra fields.

Copy [.env.company.example](.env.company.example) to `.env.company`. To enable model-backed work, set `AGENT_MODE=llm`, `OPENAI_API_KEY`, and an `OPENAI_MODEL` available to your account. Calls use the [OpenAI Responses API](https://developers.openai.com/api/docs/guides/text), with an eight-second timeout and fallback. The company loads its own `.env.company`, keeping the original lab's `.env` separate. Never commit API keys.

## Real company deployment

The [RelayCompany is deployed and verified](https://explorer.testnet.whitechain.io/address/0xD36605397FaFefaAe2c3eBfA95af1c732A322B31/contracts) on Whitechain Sepolia, at deployment block **12328348**. Its owner configuration, separate-wallet pool funding, captured Razorpay test payment, Finance allocations, founder approval and three-vendor mission have all completed on testnet. Content used the explicitly labeled seeded fallback and deterministic SVG renderer. The earlier payment-lab wallet and balance were not silently migrated.

Run these from `C:\Users\swapn\Desktop\ethglobal` in your own PowerShell terminal:

1. Run `npm ci`, `git submodule update --init --recursive`, `forge build` and `forge test -vv`.
2. Run `./prepare-company.ps1`. It creates encrypted `relay-relayer`, `relay-treasury`, `relay-attester` keystores, department wallets and vendor wallets, without printing private keys or overwriting existing keystores. It prints the exact `forge create --broadcast --verify` command with constructor arguments last. Run that command.
3. Run its two printed funding commands: **0.2 test WBT to the relayer** and **10 test USDT to the treasury**, from your existing business wallet. Keep the attester empty.
4. Read the deployment block from the explorer. Run `./configure-company.ps1 -CompanyAddress 0xYOUR_COMPANY -DeploymentBlock YOUR_BLOCK`. After a summary and confirmation, it unlocks the owner wallet once and configures Finance, three department limits and three vendor prices. Already-applied settings are skipped, so it safely resumes a partially completed setup. Signed transactions are journaled before broadcast.
5. Run `./fund-company-pool.ps1`. After confirmation, the treasury signs a **10 test USDT** transfer into the pool; the separate relayer submits it and pays gas. The helper saves the signed transaction before sending. Do not delete that journal to blindly repeat a pending transfer.
6. Stop the simulated vendor group and run `./start-company-testnet.ps1`. Enter your public HTTPS origin forwarded to **3004**, Razorpay TEST credentials, relayer and attester passwords, and a founder sign-in password of at least 12 characters. Review the signing policy and type `yes`.
7. Set Razorpay's test webhook to **`https://YOUR-ORIGIN/api/webhooks/razorpay`**, event **`payment.captured`**, with the same webhook secret. Use automatic capture. The URL path is required; `/` returns 404. [Razorpay webhook validation](https://razorpay.com/docs/webhooks/validate-test/).
8. Open the public app, sign in, make the INR 500 **test-mode** payment, allocate, launch a mission and approve the banner. Record the actual company `Paid` links from Books.

All passwords are entered locally and passed through process environments, never command arguments or chat. Private state lives under `data/company/<mode>` and `data/vendors/<mode>`. Department/vendor keys use AES-256-GCM; the role wallets use encrypted Ethereum keystores. Back up the encrypted database and local encryption key together and restrict OS access. Losing keys or founder access is not recoverable through this demo. Changing modes or company addresses requires a fresh company data directory.

Password guide: the **original owner password** unlocks `whitechain-testnet` for deployment and owner configuration. The **new 12+ character role-wallet password** chosen in `prepare-company.ps1` unlocks `relay-relayer`, `relay-treasury`, and `relay-attester`; pool funding asks for it once. The **founder sign-in password** is chosen separately when starting the company and is used only to sign into the app.

## Custom x402 scheme

The company implements **`enswhite-receive`**, a custom scheme over x402 v2 HTTP headers on **`eip155:1874`**. It is deliberately **not called standard `exact`**: that scheme normally signs `TransferWithAuthorization`, whereas EnsWhite signs `ReceiveWithAuthorization` to an enforcing contract.

Vendors return `402` with `PAYMENT-REQUIRED`. EnsWhite checks policy, reserves budget, signs a vendor/order-bound authorization and relays `pay`. `PAYMENT-RESPONSE` carries the confirmed transaction, which the vendor verifies before delivery. Authenticated facilitator endpoints are `/api/x402/supported`, `/api/x402/verify` and `/api/x402/settle`. This is a company-specific facilitator, not a hosted Whitechain service or universal SDK integration. References: [x402 v2](https://github.com/coinbase/x402/blob/main/specs/x402-specification-v2.md), [HTTP transport](https://github.com/coinbase/x402/blob/main/specs/transports-v2/http.md).

## Checks and transaction evidence

```powershell
npm test
forge test -vv
$env:WHITECHAIN_FORK_TEST='true'
try { forge test --match-contract RelayCompanyForkTest -vv }
finally { Remove-Item Env:WHITECHAIN_FORK_TEST }
```

Backend tests cover the company mission, allocations, approvals and reservation release, independent vendor receipt rejection and task binding, ambiguous broadcast recovery, founder sign-in, webhook forgery, session isolation and x402 retries. Contract tests cover replayed payment IDs and requests, unbacked credit, unregistered/redirected vendors, per-call/day limits, fee math, unauthorized allocations and Finance signature replay.

**The new contract passed a local fork test using actual Whitechain USDT**: a zero-WBT department signed the bound receive authorization, the contract paid the vendor net of fees, and company credit remained correctly accounted. Fork tests require explicit opt-in and never broadcast.

Real transactions from the earlier payment milestone:

- [Treasury → agent: 1 test USDT](https://explorer.testnet.whitechain.io/tx/0x0d1d24d4c98021cd5ee8f52f5a88254e6aa541af37a7b99b50ab42f5c6d22b53).
- [Agent → merchant: 0.1 test USDT](https://explorer.testnet.whitechain.io/tx/0xd93c87461e442eaa13d27cb8471721d7a95036ba91243d688444240349ef305a).
- [Successful x402 exact payment: 0.1 test USDT](https://explorer.testnet.whitechain.io/tx/0x69ac20e8501e2345ad7e08855694205d9156174e736d21db831a16cf40e61ddc).
- [Verified storage test contract](https://explorer.testnet.whitechain.io/address/0xEA836Fd7E1179777039856c02b70A3328cD3C1f3/contracts), which is neither RelayCompany nor a USDT payment.

These prove the earlier real-payment milestone. The new company deployment is [0xc003ca83…109b2](https://explorer.testnet.whitechain.io/tx/0xc003ca83d53cd411b65f0e1d6b8c104f4380e2fad32ff3af295c4060e0a109b2), with [verified source](https://explorer.testnet.whitechain.io/address/0xD36605397FaFefaAe2c3eBfA95af1c732A322B31/contracts).

### Completed real company mission

- [Treasury prefunded the pool with 10 test USDT, using relayer gas](https://explorer.testnet.whitechain.io/tx/0x5d7107cde0b1478f2099c27cd8a07d4cb38a14da05e28b624e59e3f398eeada9).
- [Verified INR 500 sandbox payment credited 5 test USDT through the attester](https://explorer.testnet.whitechain.io/tx/0x67321f5bf16cdd257d9d325c9fe6cec6c6fc4dbba4af97f19543e55b980f2e53).
- Finance allocations: [Marketing: 3 USDT](https://explorer.testnet.whitechain.io/tx/0x5039d734fee5c3391eaedc77c4cfb1b6ecf42e89cd816918440c40e0e4614eb7), [Support: 1.5 USDT](https://explorer.testnet.whitechain.io/tx/0xe9930f94ca5428b1afd277302cd87944ebc601152ed5cc855f45618cf2f7f55f), [Finance: 0.5 USDT](https://explorer.testnet.whitechain.io/tx/0xb77a208319de5a52998fe56a2b575c1c2a251c96d5be47f4fd10849960a852f6).

| Department → vendor | Gross test USDT | Fee | Net vendor receipt | Confirmed payment |
| --- | ---: | ---: | ---: | --- |
| Marketing → CopyDesk | 0.1 | 0.001 | 0.099 | [Paid event](https://explorer.testnet.whitechain.io/tx/0xff97023f4278ba601ac130f5f4d74724a8e3fe64c7d6feff266e966bbfc26ea9) |
| Support → LinguaLink | 0.1 | 0.001 | 0.099 | [Paid event](https://explorer.testnet.whitechain.io/tx/0x702ff690599a048e43480382a83554072ad08ee5e51892b5ed29347d99b069d1) |
| Marketing → PixelPress, founder approved | 0.2 | 0.002 | 0.198 | [Paid event](https://explorer.testnet.whitechain.io/tx/0x023791c76c7cc3dfaff14da9e4608947ae9cc07ae2bcf10e533eed1f84eace39) |

All three work orders were delivered after receipt verification. The company fee pool is 0.004 USDT; remaining department balances are Marketing 2.7, Support 1.4 and Finance 0.5 USDT. All three departments still hold **zero WBT**. The three independent vendor earnings endpoints separately report the matching net receipts from chain events. These are real testnet token transfers following simulated fiat; the copy and translation were labeled seeded fallback, not claimed live model output.

See [architecture](docs/architecture.md) and [earlier lab notes](docs/payment-lab.md).

## Why onchain

Agent departments need bounded spending authority across independent services. A contract enforces vendor allowlists, price limits and replay protection. Vendors independently verify payment without trusting EnsWhite's database, and the shared receipt trail makes the accountant export checkable.

## Automatic gas replenishment

Keep the company running, then start a separate watcher in your own PowerShell terminal:

```powershell
.\start-gas-replenisher.ps1
```

The launcher shows the company and relayer addresses and the automatic signing policy, asks for confirmation, then privately unlocks the **original `whitechain-testnet` owner keystore**. The existing deployed contract restricts fee withdrawal to its owner, so no contract migration is required. That owner key stays in this separate terminal process, not the web server. It still grants full company-owner authority: protect that terminal and keystore, and do not run other transactions from the same owner account while the watcher is signing. No relayer or department key is needed by the watcher.

Every minute, the watcher checks the relayer's native WBT. Below **0.05 WBT**, it:

1. Quotes the USDT/WWBT pool at YetiTrade's four standard fee tiers and chooses the best liquid direct route.
2. Leaves the fees untouched unless the minimum expected output covers at least twice a conservative execution-gas budget.
3. Calls `withdrawFees(owner)` and records the actual `FeesWithdrawn` amount. Only those proceeds are eligible for swaps; unrelated owner USDT and company credit are excluded.
4. Resets any stale router allowance, approves the exact input, and swaps at most **10 test USDT per cycle**, with **0.5% slippage** and a **two-minute deadline**.
5. Atomically unwraps the resulting WWBT and sends **native WBT directly to the relayer**. It never leaves USDT in the relayer wallet.

The owner wallet needs its own WBT to execute withdrawal, approval and swap transactions. This prevents a completely empty relayer from blocking its own recovery, but an empty owner wallet still requires a business-side gas top-up. Quotes are not a profitability guarantee; the watcher uses conservative gas bounds and waits when fees are too small. With the current tiny demo fee pool, waiting is expected.

The worker journals each signed transaction **before broadcasting** in ignored `data/company/testnet/gas-replenisher.sqlite`. A restart resumes the identical bytes even if the relayer balance has since recovered. Unswapped fee proceeds remain tracked for later cycles. Unknown RPC responses keep the transaction; three proven reverts in one phase pause signing for operator inspection. Do not delete the journal to retry an ambiguous transfer. A separate SQLite process lock prevents two replenishment workers from signing concurrently and releases automatically if the process exits.

This narrow integration uses the [published YetiTrade SwapRouter02 and QuoterV2 deployments](https://docs.yetitrade.fi/reference/contracts), with the [standard V3 direct-swap interface](https://docs.yetitrade.fi/guides/swap-from-a-contract). No new dependency or company-contract deployment is needed. If no direct USDT/WWBT route is liquid, the worker waits rather than choosing an unverified external route.

Seven worker tests cover the low-gas trigger, economic and liquidity checks, exact allowances, restart recovery, tracked proceeds, slippage/deadline calldata and bounded retries. The integration also passed an actual-contract **local fork** test: fees left RelayCompany, YetiTrade swapped them, native WBT reached the relayer, its USDT balance stayed zero and company credit was unchanged. Run that test without broadcasting:

```powershell
$env:WHITECHAIN_FORK_TEST='true'
try { forge test --match-contract GasReplenisherForkTest -vv }
finally { Remove-Item Env:WHITECHAIN_FORK_TEST }
```

The fork test uses historical block 12330293, where the recorded demo fees exist, so rerunning it does not depend on future fee withdrawals. The watcher uses current live state. No live replenishment transaction is claimed by this test.

## Limits and roadmap

This is a single-founder, single-process hackathon demo, not production custody or payments infrastructure. Department keys are custodial, fiat is simulated and real operations target testnet. Weekly budgets and approvals are enforced by code; the contract enforces credited allocations, funded wallet balances, allowlisted prices, and per-call/day limits. The owner configures policies and withdraws fees in their own terminal. Paid-but-undelivered work retries delivery; it does not automatically refund.

Sales, Product, Design, Engineering and Operations are the five roadmap departments, not fake working agents. Automatic gas replenishment is available through the separate owner-terminal watcher above; it needs enough earned fees, direct-pool liquidity and owner execution gas. Inter-company sales, production onramps, treasury replenishment, refunds and account recovery remain outside this core release. Production licensing and KYC require separate market-specific review.

Show every party in the demo: founder, three departments, three vendor earnings pages, relayer gas tank, approval and real company receipt. Never show keys, passwords, API secrets or data files.
