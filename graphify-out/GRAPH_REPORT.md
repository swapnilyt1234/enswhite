# Graph Report - ethglobal  (2026-11-06)

## Corpus Check
- 62 files · ~37,882 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 11 file(s) not represented in the graph (top: .example 3, (none) 3, .css 2)

## Summary
- 309 nodes · 648 edges · 15 communities (14 shown, 1 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 12 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `2a8c073c`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- Run a Whitechain node
- Whitechain developer playbook
- company-ui.js
- company.js
- Connecting to Whitechain Sepolia
- payments.test.js
- bootstrap.js
- package.json
- app.js
- EnsWhite
- Steps
- payments.js
- gas-replenisher.js
- agents.js

## God Nodes (most connected - your core abstractions)
1. `createCompany()` - 21 edges
2. `ethers` - 16 edges
3. `createVendor()` - 15 edges
4. `fail()` - 12 edges
5. `EnsWhite` - 12 edges
6. `walletStore()` - 11 edges
7. `inspectToken()` - 10 edges
8. `esc()` - 10 edges
9. `refresh()` - 10 edges
10. `openStore()` - 10 edges

## Surprising Connections (you probably didn't know these)
- `send()` --calls--> `checkENSTransaction()`  [EXTRACTED]
  ens/scripts/bootstrap.js → app/ens.js
- `send()` --calls--> `populateENSTransaction()`  [EXTRACTED]
  ens/scripts/bootstrap.js → app/ens.js
- `createCompany()` --calls--> `planMission()`  [EXTRACTED]
  app/company.js → app/agents.js
- `createVendor()` --calls--> `vendorWork()`  [EXTRACTED]
  app/vendor-server.js → app/agents.js
- `createRealCompanyChain()` --calls--> `inspectToken()`  [EXTRACTED]
  app/company-chain.js → app/chain.js

## Import Cycles
- None detected.

## Communities (15 total, 1 thin omitted)

### Community 0 - "Run a Whitechain node"
Cohesion: 0.22
Nodes (8): Client, Error handling, Hardware requirements, Network ports, Run a Whitechain node, Security, Steps, Verify sync

### Community 1 - "Whitechain developer playbook"
Cohesion: 0.22
Nodes (8): Default network, Developer context, For edge cases and API changes, Installation, Operating procedure, Routing table, Safety guardrails, Whitechain developer playbook

### Community 2 - "company-ui.js"
Cohesion: 0.20
Nodes (20): act(), api(), empty(), esc(), handler(), icons, images, missionKey (+12 more)

### Community 3 - "company.js"
Cohesion: 0.12
Nodes (22): ALLOCATE_TYPES, boundNonce(), companyDomain(), companyInterface, createRealCompanyChain(), createSimulatedCompanyChain(), IDENTITY_ABI, identityInterface (+14 more)

### Community 4 - "Connecting to Whitechain Sepolia"
Cohesion: 0.07
Nodes (24): 1. Check the wallet is on Whitechain Sepolia, 2. Check the current balance, 3. Direct the user to the faucet, 4. Confirm the balance increased, Claim testnet WBT, Error handling, Input validation, Notes (+16 more)

### Community 5 - "payments.test.js"
Cohesion: 0.20
Nodes (16): checkAuthorization(), createGateway(), request(), createPayments(), fail(), broadcast(), setup(), createApp() (+8 more)

### Community 6 - "bootstrap.js"
Cohesion: 0.08
Nodes (26): pendingConfiguration(), contract, checkENSTransaction(), createENSDirectory(), employee(), resolver(), ENS_NAMES_ABI, ENS_REGISTRY_ABI (+18 more)

### Community 7 - "package.json"
Cohesion: 0.07
Nodes (16): dependencies, ethers, express, engines, node, name, private, scripts (+8 more)

### Community 8 - "app.js"
Cohesion: 0.36
Nodes (10): act(), api(), element(), handler(), ondismiss(), refresh(), renderActivity(), requestKey (+2 more)

### Community 9 - "EnsWhite"
Cohesion: 0.08
Nodes (23): EnsWhite architecture, Connect real testnet settlement, EnsWhite — Whitechain agent payment lab, Limits, Network evidence, Run locally, What is checked, x402, added after the core flow passed (+15 more)

### Community 11 - "Steps"
Cohesion: 0.15
Nodes (13): 1. Confirm the target network, 2. Set up the signer, 3. Compile, 4. Show deployment summary and wait for confirmation, 5. Deploy, 6. Return the result, Deploy a contract on Whitechain, Error handling (+5 more)

### Community 12 - "payments.js"
Cohesion: 0.10
Nodes (31): abi, createChain(), EXPLORER, inspectToken(), NETWORK, prepare(), TOKEN, types (+23 more)

### Community 13 - "gas-replenisher.js"
Cohesion: 0.24
Nodes (12): createGasAdapter(), createReplenisher(), run(), lockWorker(), LOW_GAS, main(), MAX_BATCH, routerInterface (+4 more)

### Community 14 - "agents.js"
Cohesion: 0.80
Nodes (4): clean(), modelText(), planMission(), vendorWork()

## Knowledge Gaps
- **1 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `ethers` connect `bootstrap.js` to `company.js`, `payments.test.js`, `package.json`, `payments.js`, `gas-replenisher.js`?**
  _High betweenness centrality (0.098) - this node is a cross-community bridge._
- **Should `company.js` be split into smaller, more focused modules?**
  _Cohesion score 0.11895161290322581 - nodes in this community are weakly interconnected._
- **Should `Connecting to Whitechain Sepolia` be split into smaller, more focused modules?**
  _Cohesion score 0.07142857142857142 - nodes in this community are weakly interconnected._
- **Should `bootstrap.js` be split into smaller, more focused modules?**
  _Cohesion score 0.08292682926829269 - nodes in this community are weakly interconnected._
- **Should `package.json` be split into smaller, more focused modules?**
  _Cohesion score 0.07407407407407407 - nodes in this community are weakly interconnected._
- **Should `EnsWhite` be split into smaller, more focused modules?**
  _Cohesion score 0.07692307692307693 - nodes in this community are weakly interconnected._
- **Should `payments.js` be split into smaller, more focused modules?**
  _Cohesion score 0.10299003322259136 - nodes in this community are weakly interconnected._