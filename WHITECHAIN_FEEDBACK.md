# Whitechain integration feedback

EnsWhite is a Scale demo: a founder funds a business through Razorpay test mode; Marketing and Support buy independent vendor services using test USDT on Whitechain Sepolia; the company relayer pays WBT gas. Fiat is explicitly simulated, using a fixed demo allocation rather than fiat conversion.

## What worked

- EVM tooling let us deploy and verify the identity-enforcing [EnsWhiteCompany](https://explorer.testnet.whitechain.io/address/0xbca635f00C07681f10269f69ca293bDB6536D6aB/contracts) using Foundry and Blockscout.
- EIP-3009 authorizations support department wallets signing without WBT. A separate relayer submits transactions; the contract enforces limits and records receipts.
- Separate vendor processes independently check their own Paid event before delivering. [CopyDesk payment proof](https://explorer.testnet.whitechain.io/tx/0x7123f986638ac983243ba7c024a7cdd3acc0396ce0a8c2aa1b315de397e41cd0).
- Sponsor guidance to simulate fiat and keep the Scale story centered on founder funding, agent purchases and receipts unblocked the demo.

## Friction encountered

- Startup and read-only checks encountered transport timeouts. We added bounded retries for transport failures and sequential vendor startup. Configuration/contract failures still fail explicitly. A documented production RPC/failover example would help builders distinguish connectivity failures from contract failures.
- We operated our own facilitator and gas relayer. Our HTTP 402 integration needs chain ID 1874 and the custom `enswhite-receive` scheme: authorization goes to our company contract, which pays the vendor. We do not claim standard exact-client compatibility. A worked custom-network integration would reduce guesswork.
- We inspected the token implementation/ABI to establish the test USDT domain and authorization methods used by the app. An explicit example covering token decimals, EIP-712 domain, supported authorization variants and relayer submission would be useful.
- Test-USDT inventory is separate from WBT gas. Captured sandbox payments initially waited because the company contract had no unreserved test USDT. We added a pool-shortage guard and resumed existing orders after funding, avoiding duplicate checkout/credit.
- Gas replenishment depends on earned fees and executable YetiTrade liquidity/quotes. Small fee pools can be uneconomic, so the watcher leaves them untouched and caps slippage, approval amount and spend per cycle. We did not force a live swap just to create a success screenshot.

## Trust and demo disclosures

ENS lives on Ethereum Sepolia. Whitechain verifies a request-bound attester signature, not a light-client proof of ENS state. Already-signed policy has a maximum 60-second authorization window. The business covers gas; daily transaction, vendor, per-call, daily-spend and founder-approval controls constrain automated signing. No real-value funds are represented by the sandbox fiat flow.

The separate Sepolia controller-deployment gas calibration concerned Ethereum's testnet and is not reported as a Whitechain issue. This file records implementation experience; submission eligibility and final sponsor review have not been independently confirmed here.
