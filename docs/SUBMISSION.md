# EnsWhite submission

## Project description

EnsWhite turns a business idea into a company with AI employees. Founders choose departments, fund a budget through Razorpay test checkout and give a mission. Marketing, Support and Finance run bounded tool loops, commission outside services, hand work to each other and return a Campaign Kit with rupee receipts. ENSv2 supplies the company hierarchy, employee identity, expiring employment and delegated records; Whitechain settles the actual test-USDT purchases with business-paid gas.

Submit to **Whitechain Scale: Payments Nobody Notices** and **Best Use of ENSv2**. The project does not claim the Whitechain Tokenize prize: it does not issue or finance an RWA.

## Links for the showcase

- [Hosted landing page and guest demo](https://enswhite.onrender.com/)
- [Real company onboarding](https://zoning-playhouse-banister.ngrok-free.dev/launch/)
- [Keyless onchain Live Proof](https://enswhite.onrender.com/proof/)
- Guest demo: click **Try the guest demo** on the landing page. Guests have isolated simulated funds and offline content; this is labelled separately from the real testnet flow.
- [Public source](https://github.com/swapnilyt1234/enswhite), [MIT licence](../LICENSE)
- **Demo video: pending founder recording and public upload.** Follow the [3:15 recording plan](DEMO-VIDEO.md). Do not claim the video requirement is complete until its link is added here and to the showcase.

The guest demo and read-only Live Proof run on Render without the operator's machine; a free instance can take about a minute to wake. Real company onboarding, checkout and signing remain on the separate ngrok origin and require the operator's machine and services to stay online.

## Whitechain Scale requirements

| Requirement | Implementation and evidence |
| --- | --- |
| Deployed and verified on chain 1874 | Four company deployments verified on Blockscout; [current check](deployments/submission-checks.json). Canonical [Acme contract](https://explorer.testnet.whitechain.io/address/0xbca635f00C07681f10269f69ca293bDB6536D6aB/contracts); complete-flow [Cedar contract](https://explorer.testnet.whitechain.io/address/0xDD9E8EdD5488B9DfBb3AE6f98FdA10b3E7d3EbAd/contracts). |
| Official test USDT settles a main-flow payment | Token `0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7`. [CopyDesk payment](https://explorer.testnet.whitechain.io/tx/0x8fa7bca9f5ea4155954d6db4f2e68d4438ebaafc34e35282bf47b12962a57a4c), [PixelPress](https://explorer.testnet.whitechain.io/tx/0x4ae3dfae29629dd56252529ba3dcdba88a40659f38d47a7a644bd355a7bdaf41), [LinguaLink](https://explorer.testnet.whitechain.io/tx/0xa894b8f06c823df97529aa340bdb433b94bd9bd42a0c72a3c797a67eb260b2b5). |
| Payer needs no WBT, seed or browser transaction | Founder uses Razorpay test checkout. Department EIP-3009 signatures are created by bounded backend role wallets; the separate relayer broadcasts and pays WBT. Current proof checks all three Cedar department WBT balances are zero. |
| Business gas source and drain protection | Relayer starts with operator-funded WBT. Requests are bound to company, department, vendor, price, nonce and expiry. Allowlisted vendors, contract caps, approved budgets, founder thresholds, saved sequential transactions and rate/mission quotas constrain spending. Fee-funded gas replenishment is implemented with swap/approval/slippage caps; no forced live swap is claimed. |
| Why onchain stablecoin settlement | The company atomically checks spending rules and emits a vendor-verifiable USDT settlement receipt before delivery. A regular payment rail would need a separate trusted ledger and confirmation integration; its receipt cannot itself execute these contract rules or produce the Paid event that vendors inspect. |
| Public source and steady history | The default branch preserves the incremental hackathon commits; no squash or one-shot upload. Setup, architecture and limitations are in the README and linked runbooks. |
| Honest integration feedback | [WHITECHAIN_FEEDBACK.md](../WHITECHAIN_FEEDBACK.md) documents RPC failures, self-hosted relaying, token authorization details, inventory/backing and swap economics. |
| 2–4 minute video showing every party | **Pending the founder's recording/upload.** Script includes founder, departments, vendors, approvals, USDT receipt and delivered work. |

## ENSv2 requirements

| Requirement | Implementation and evidence |
| --- | --- |
| ENSv2 on mainnet or Sepolia | Sepolia chain 11155111. Contracts import the real ENS `contracts-v2` dependency, pinned as a submodule. [EnsWhiteNames source](../ens/src/EnsWhiteNames.sol), [deployment manifest](deployments/enswhite-testnets.json), [discovery verification](DISCOVERY-VERIFICATION.md). |
| ENSv2 is central | `enswhite.eth` contains separate company registries, department names and a vendor namespace. Before a vendor payment is authorized, the backend resolves employment, expiry, wallet, endpoint and policy and signs a request-bound cross-chain attestation. The verified Whitechain contract checks that attestation and its deadline. |
| Hierarchy and lifecycle | Company UserRegistries, expiring non-transferable employee names, firing/rehiring, and vendor-registry emancipation. The live lifecycle demo showed fired/expired Support refused, then restored. The ancestor namespace owner still controls its registry pointer; unconditional forever independence is not claimed. |
| Permissioned Resolver and EAC | Employees can update their own status record. Finance has delegated permission for the weekly-budget record within the controller's policy. Unauthorized edits and transfers are tested. Each employee has a resolver and portable context. |
| Real agent identities | Departments and vendors own ERC-8004 identities. ENSIP-25 consent and ENSIP-26 context/web records are checked; reputation includes paid Whitechain proof and uses a non-empty department client list. These discovery standards are labelled as drafts. |
| Functional public demo, not hardcoded balances | Real onboarding, paid vendor receipts and reviews are recorded in [Cedar evidence](deployments/cedar-studio-1107.json). Live Proof reads chain data. The workspace displays live balances independently of the background ENS directory view; signing always performs fresh ENS checks. Guests are explicitly isolated simulations. |
| Live URL and accessible source | Links above. Operator availability, prefunding and daily quotas apply to real testnet launches. |

## Verification and remaining operator work

Run `npm ci`, `npm test`, `forge test`, `forge test --root ens`, and `node app/verify-submission.js`. The last command checks live Whitechain receipts, the specified token, net vendor transfers, distinct gas payer, zero department WBT and explorer verification; it never signs. Last saved checks: [submission-checks.json](deployments/submission-checks.json).

Keep services running, record/upload the video and paste its public link into the showcase. For additional INR 500 sandbox top-ups, reserve 5 **uncredited** test USDT in the specific company pool per checkout. Existing company credit and reserved fees cannot back a second payment. Current operator quotas are two new companies per UTC day and five missions per visitor company.

AI content still needs editorial review. Wallets are operator-custodied, fiat is simulated, x402 uses the custom enswhite-receive scheme, and the ENS-to-Whitechain policy boundary trusts an attester. A temporary RPC outage can pause new actions; a saved receipt is never substituted for fresh spending authorization.
