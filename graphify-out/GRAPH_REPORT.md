# Graph Report - ethglobal  (2026-11-06)

## Corpus Check
- 20 files · ~12,839 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 4 file(s) not represented in the graph (top: .example 1, (none) 1, .css 1)

## Summary
- 145 nodes · 221 edges · 11 communities
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 1 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- Run a Whitechain node
- Whitechain developer playbook
- Steps
- payments.js
- Steps
- payments.test.js
- Connecting to Whitechain Sepolia
- package.json
- app.js
- Relay — Whitechain agent payment lab
- x402.js

## God Nodes (most connected - your core abstractions)
1. `mountX402()` - 10 edges
2. `createPayments()` - 9 edges
3. `fail()` - 8 edges
4. `Whitechain developer playbook` - 8 edges
5. `Steps` - 8 edges
6. `Run a Whitechain node` - 8 edges
7. `checkAuthorization()` - 7 edges
8. `renderActivity()` - 7 edges
9. `Relay — Whitechain agent payment lab` - 7 edges
10. `status()` - 6 edges

## Surprising Connections (you probably didn't know these)
- `createPayments()` --calls--> `checkAuthorization()`  [EXTRACTED]
  app/payments.js → app/chain.js
- `createApp()` --calls--> `fail()`  [EXTRACTED]
  app/server.js → app/payments.js
- `setup()` --calls--> `createPayments()`  [EXTRACTED]
  app/payments.test.js → app/payments.js
- `createApp()` --calls--> `mountX402()`  [EXTRACTED]
  app/server.js → app/x402.js
- `mountX402()` --calls--> `checkAuthorization()`  [EXTRACTED]
  app/x402.js → app/chain.js

## Import Cycles
- None detected.

## Communities (11 total, 0 thin omitted)

### Community 0 - "Run a Whitechain node"
Cohesion: 0.22
Nodes (8): Client, Error handling, Hardware requirements, Network ports, Run a Whitechain node, Security, Steps, Verify sync

### Community 1 - "Whitechain developer playbook"
Cohesion: 0.22
Nodes (8): Default network, Developer context, For edge cases and API changes, Installation, Operating procedure, Routing table, Safety guardrails, Whitechain developer playbook

### Community 2 - "Steps"
Cohesion: 0.15
Nodes (13): 1. Confirm the target network, 2. Set up the signer, 3. Compile, 4. Show deployment summary and wait for confirmation, 5. Deploy, 6. Return the result, Deploy a contract on Whitechain, Error handling (+5 more)

### Community 3 - "payments.js"
Cohesion: 0.17
Nodes (12): abi, createChain(), EXPLORER, inspectToken(), NETWORK, prepare(), TOKEN, types (+4 more)

### Community 4 - "Steps"
Cohesion: 0.18
Nodes (9): 1. Collect required inputs, 2. Submit for verification, 3. Poll for result, 4. Return the result, Error handling, Input validation, Proxy contracts, Steps (+1 more)

### Community 5 - "payments.test.js"
Cohesion: 0.19
Nodes (8): createPayments(), openStore(), broadcast(), setup(), createApp(), publicDir, setup(), express

### Community 6 - "Connecting to Whitechain Sepolia"
Cohesion: 0.12
Nodes (15): 1. Check the wallet is on Whitechain Sepolia, 2. Check the current balance, 3. Direct the user to the faucet, 4. Confirm the balance increased, Claim testnet WBT, Error handling, Input validation, Notes (+7 more)

### Community 7 - "package.json"
Cohesion: 0.12
Nodes (14): dependencies, ethers, express, engines, node, name, private, scripts (+6 more)

### Community 8 - "app.js"
Cohesion: 0.36
Nodes (10): act(), api(), element(), handler(), ondismiss(), refresh(), renderActivity(), requestKey (+2 more)

### Community 9 - "Relay — Whitechain agent payment lab"
Cohesion: 0.25
Nodes (7): Connect real testnet settlement, Limits, Network evidence, Relay — Whitechain agent payment lab, Run locally, What is checked, x402, added after the core flow passed

### Community 10 - "x402.js"
Cohesion: 0.35
Nodes (10): checkAuthorization(), createGateway(), request(), fail(), decodePayment(), encodePayment(), mountX402(), sameRequirements() (+2 more)

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `ethers` connect `package.json` to `payments.js`, `payments.test.js`?**
  _High betweenness centrality (0.058) - this node is a cross-community bridge._
- **Should `Connecting to Whitechain Sepolia` be split into smaller, more focused modules?**
  _Cohesion score 0.11764705882352941 - nodes in this community are weakly interconnected._
- **Why does `Deploy a contract on Whitechain` connect `Steps` to `Steps`?**
  _High betweenness centrality (0.036) - this node is a cross-community bridge._
- **Should `package.json` be split into smaller, more focused modules?**
  _Cohesion score 0.11764705882352941 - nodes in this community are weakly interconnected._