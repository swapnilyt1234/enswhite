# Employee management without a browser wallet

The founder signs in, pays through Razorpay test mode and manages employees using Hire, Fire and Renew. Normal employee actions no longer call MetaMask. The business sponsors the Sepolia gas used for employment records; its existing Whitechain relayer separately sponsors payment gas in WBT. The fiat step remains simulated.

`POST /api/ens/manage` is founder-authenticated, origin-checked and accepts only an action, one of the three configured department labels and a bounded term. It queues a saved request rather than returning a transaction for a browser wallet. New work/payment authorization is paused locally as soon as an employee's removal is queued; confirmed ENS revocation remains the cross-chain permission source. Already signed/broadcast transactions retain the existing attestation-window limits; firing cannot undo settled payments.

The company server and AI models do not unlock the owner. A separate private process, `app/employee-manager.js`, reads the saved queue and unlocks the local original owner keystore. It has no HTTP listener, payment API, arbitrary calldata endpoint or model connection. The deployed controller is owner-only, so this uses its existing ownership rather than redeploying the ENS hierarchy or transferring the parent name. The owner key is nevertheless powerful: the process boundary and validated signing policy are application controls, not a new onchain delegation restriction. A compromised signing worker could misuse the unlocked owner; run it only on the trusted operator machine.

The worker rechecks chain ID 11155111, the controller/company, owner, action, department wallet, term, vendor allowlist and spending-policy bounds. Only Hire, Fire and Renew are allowed. Terms are five minutes for operator demos or 30 days; the normal UI offers 30 days. Weekly policies remain at most 50 test USDT and per-call policy cannot exceed the department's configured maximum. Rehiring reuses the same department wallet and the policy saved at confirmed firing. The existing controller restores discovery records, preserving the ERC-8004 association and scoped roles.

At most 12 requests and 6 signed calls per rolling 24 hours are accepted. Calls allow at most 8 million gas and 0.005 test ETH maximum fee each. An owner funds Sepolia service gas locally; the payer needs neither ETH nor WBT. One leased worker processes the queue sequentially. Each signed transaction is saved before broadcast; restarts reuse its hash and bytes. Unknown/pending transactions are never replaced, reverted calls stop for inspection, and journal/signature fields are omitted from public state.

## Operator setup

Keep the normal company server, public gateway and ngrok running. In a separate PowerShell terminal:

```powershell
.\start-employee-manager.ps1
```

Review its signing policy, type `yes` and enter the original owner-keystore password only in that terminal. It does not need the role-wallet password, Razorpay credentials or model key. Keep this worker running for founder employee actions. Do not run other owner signing commands on Ethereum Sepolia concurrently. The existing Whitechain gas watcher uses a different chain nonce.

Restart the company server once to load the queue API and new UI, then refresh `/owner/`. Public gateway/ngrok do not need restarting for this change. When the worker is unavailable, employee buttons are disabled; users are not redirected to a browser wallet. Advanced ENS namespace registration remains under Show onchain and is an operator workflow; new visitor provisioning is handled separately by the [launch operator](FOUNDER-JOURNEY.md). Never run that operator concurrently with this manager because both use the owner nonce.

Live validation: with no missions running, remove Support from the founder Team page, wait for confirmation and verify new Support work is blocked. Hire Support for 30 days and confirm the same wallet, restored identity binding and normal employment. No new checkout, company funding or vendor purchase is needed. This validation remains pending until the operator starts the private worker and the updated company server.
