# EnsWhite — Whitechain agent payment lab

A small working demo: a sandbox fiat payment funds a per-session agent wallet; that agent signs an EIP-3009 USDT payment for a sample API report; the business relayer pays WBT gas. The report is deterministic demo content, not an AI-generated security audit.

**Fiat is simulated. There is no fiat-to-USDT conversion. Whitechain test USDT has no real monetary value.** The demo allocation is fixed: **INR 100 in Razorpay test mode → 1 test USDT**, with each report costing **0.1 test USDT**. This is a demo budget allocation, not an exchange rate.

## Run locally

Requires Node.js 22.13+ (built-in experimental SQLite).

```powershell
npm install
npm test
npm start
```

Open http://localhost:3000. Click **Simulate ₹100 sandbox payment**, then **Buy report with agent**. Defaults simulate both the payment provider and chain locally; simulated hashes are never linked to an explorer. The agent wallet persists with its HttpOnly browser session cookie. Keep that browser session to return to the same wallet.

## Connect real testnet settlement

The code for real Razorpay test mode and Whitechain Sepolia is implemented. End-to-end execution needs your Razorpay account, a publicly reachable HTTPS endpoint, a funded encrypted keystore, and your local confirmation. No secrets belong in chat.

1. In Razorpay **test mode**, create API keys. Configure **captured** payments with automatic capture, and create a webhook for `payment.captured` at `https://YOUR-APP/api/webhooks/razorpay`. Choose a webhook secret. Checkout success alone never credits a user; the signed webhook and API verification must both pass. See [Razorpay webhook validation](https://razorpay.com/docs/webhooks/validate-test/).
2. Route your own public HTTPS domain or a supported tunnel to `http://127.0.0.1:3001`. Preserve the public Host header. Use that public origin to open the dashboard. Razorpay does not send webhooks directly to localhost and blocks some tunnel providers; check its current documentation.
3. Your `whitechain-testnet` Foundry keystore is used as treasury and relayer by default. It needs **both test USDT and test WBT**. Get WBT from [the faucet](https://faucet.testnet.whitechain.io) and acquire test USDT through the Whitechain testnet ecosystem as advised by the organizers. WBT alone cannot fund the agent's USDT balance. For separate wallets, set `TREASURY_KEYSTORE` and `RELAYER_KEYSTORE` before launching.
4. Run the interactive launcher in your own PowerShell terminal:

```powershell
.\start-testnet.ps1
```

It prompts privately for API secrets and keystore passwords, prints the signing policy, and asks for `yes` before starting the automatic testnet signer. Secrets are passed to Node through the process environment, never CLI arguments, and previous environment values are restored on exit. The launcher uses port **3001**, leaving the simulated preview on port 3000, and stores real testnet state in `data/testnet`.

5. Open the public app URL, finish a **test-mode** INR 100 Razorpay checkout, wait for verified credit and a confirmed treasury-to-agent transfer, and buy a report. The dashboard links each real transaction to Blockscout. For the demo, record the actual **agent-to-merchant USDT payment** explorer URL from Payment activity and use it in your submission. This repository does not claim an unexecuted payment occurred.

No endpoint accepts raw private keys or passwords. Your generated agent wallets are custodial: their signing keys are encrypted using AES-256-GCM with a local `wallet.key` file. Treat the entire data directory as secret, restrict OS access, and back up both the database and encryption key together. Losing the key or session can make an agent wallet inaccessible through this demo. The data directory and `.env` files are ignored by Git.

For manual configuration, see [.env.example](../.env.example). Only `rzp_test_` keys and chain 1874 are accepted. Real testnet transfers cannot be enabled with the local payment simulator. Use a **new DATA_DIR** whenever changing payment or chain mode; simulated credit must never become real spending credit.

## What is checked

- HMAC-SHA256 of the exact raw webhook bytes, using timing-safe comparison.
- Razorpay API independently confirms the captured payment, local order, INR currency and exact amount.
- Unique payment and order IDs prevent duplicate credit, even across event IDs and retries.
- Funding must confirm before the credit is spendable. Each purchase reserves budget synchronously, so concurrent calls cannot overspend.
- EIP-712 signatures bind sender, merchant, amount, validity window, random nonce, chain ID, and token proxy address.
- The live token's domain separator and chain ID are checked before enabling the signer.
- Raw signed transactions are persisted **before** broadcast. Network timeouts keep the reservation and retry those same bytes, including after restart. Proven reverts release purchase reservations; failed funding can be explicitly retried without issuing another fiat credit.
- Access to purchased reports requires the same session and a confirmed token transfer. Unknown/RPC failures never unlock reports. Successful receipts must contain the expected token Transfer log.
- Host/origin checks, HttpOnly SameSite cookies, request-size limits and per-session order limits protect the local demo's HTTP boundary.

## Network evidence

Read-only live check: `npm run check:chain`.

- Whitechain Sepolia: `eip155:1874`.
- Test USDT proxy: [0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7](https://explorer.testnet.whitechain.io/address/0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7).
- The explorer-linked implementation exposes `transferWithAuthorization`, `receiveWithAuthorization`, `authorizationState`, and `permit`: [TetherTokenV2](https://explorer.testnet.whitechain.io/address/0x26425662D126412128967ECf0a02EC48573026F7/contracts).
- Live proxy reads on November 6, 2026 (Asia/Calcutta): 6 decimals; EIP-712 name `Tether USD`, version `1`; matching domain separator for chain 1874 and the proxy address. The app uses the live result, not the implementation address, for signing.
- Earlier storage test contract: [TestContract, deployed and verified](https://explorer.testnet.whitechain.io/address/0xEA836Fd7E1179777039856c02b70A3328cD3C1f3/contracts). **This storage deployment is not a USDT payment.**

## x402, added after the core flow passed

The core flow completed on Whitechain Sepolia:

- [Treasury funded the agent with 1 test USDT](https://explorer.testnet.whitechain.io/tx/0x0d1d24d4c98021cd5ee8f52f5a88254e6aa541af37a7b99b50ab42f5c6d22b53).
- [Agent paid the merchant 0.1 test USDT](https://explorer.testnet.whitechain.io/tx/0xd93c87461e442eaa13d27cb8471721d7a95036ba91243d688444240349ef305a). This is a real testnet USDT payment, following a Razorpay test-mode payment; it is not a fiat conversion and was made through the direct EIP-3009 flow.
- [Agent paid the merchant 0.1 test USDT through x402](https://explorer.testnet.whitechain.io/tx/0x69ac20e8501e2345ad7e08855694205d9156174e736d21db831a16cf40e61ddc). The x402 purchase is recorded as confirmed, and its successful chain-1874 receipt contains the matching USDT Transfer from the agent to the merchant. This is the final demo payment proof.

The final layer now implements the [x402 v2 HTTP transport](https://github.com/coinbase/x402/blob/main/specs/transports-v2/http.md) with the `exact` scheme on `eip155:1874`:

1. Browser requests `POST /api/report`; server returns HTTP 402 and a base64-encoded `PAYMENT-REQUIRED` header.
2. `POST /api/agent/authorize` reserves 0.1 test USDT and produces the agent's signed EIP-3009 authorization. It does **not** submit a transfer. The request needs an `Idempotency-Key` header.
3. Browser repeats the report request with the base64-encoded `PaymentPayload` in `PAYMENT-SIGNATURE`.
4. The in-process facilitator verifies the fixed price, token, network, resource, funded session, signature and nonce, then uses the existing persisted transaction worker for settlement.
5. Only after confirmation, the server returns the report with `PAYMENT-RESPONSE` containing the settlement result. Retries of that same purchase return the saved result without another transfer.

Facilitator base URL: `/api/x402`, with `GET /supported`, `POST /verify`, and `POST /settle` following the [v2 message schemas](https://github.com/coinbase/x402/blob/main/specs/x402-specification-v2.md). This is a deliberately narrow, app-operated facilitator for this report and the app's funded browser sessions, not a public arbitrary-wallet facilitator or a claimed official SDK integration. No hosted Whitechain facilitator is used. Local chain simulation is still explicitly labeled, including when demonstrating the x402 HTTP exchange.

Restart the backend and refresh the page to see **Buy report via x402**. Existing data, wallets, reports and direct-payment API remain available. Signed but unsubmitted authorizations reserve budget for up to five minutes; expiry releases the reservation only after checking that the token nonce is unused. Unknown chain state keeps the reservation.

## Limits

This is a single-process hackathon demo, not a production payments or custody service. Run one backend per database. Browser sessions are capabilities, not full accounts; there is no password recovery, KYC, refund/reconciliation workflow, or external-wallet import. Independent transfers outside the app are not credited to its budget ledger. Never use real fiat, mainnet keys, or valuable tokens. Production requires a separately designed custody and treasury workflow, provider integration, and jurisdiction-specific review.

Ten backend tests cover webhook forgery and duplicate delivery, mismatched payments, concurrent budget reservations, signature tampering/replay boundaries, session isolation, persistence, ambiguous broadcast recovery, the x402 header exchange, idempotent settlement, rejected payment requirements and authorization expiry. Credentialed Razorpay test checkout, treasury funding, direct EIP-3009 settlement and x402 settlement have all passed on Whitechain Sepolia. The payment links above are the corresponding explorer evidence; fiat remains simulated.

An additional **local fork test against the actual testnet USDT contract passed**: treasury funding, EIP-3009 payment submitted by a different caller, zero WBT in the agent wallet, final token balances, nonce consumption and replay rejection. It executes only in Foundry's in-memory fork; it does not broadcast or create an explorer transaction. To rerun it:

```powershell
$env:WHITECHAIN_FORK_TEST='true'
try { forge test --match-contract WhitechainPaymentTest -vv }
finally { Remove-Item Env:WHITECHAIN_FORK_TEST }
```

Without that opt-in environment variable, the network-dependent fork test is explicitly skipped by `forge test`; the local storage tests still run.
