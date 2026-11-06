# Graph Report - ethglobal  (2026-11-06)

## Corpus Check
- 43 files · ~28,685 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 9 file(s) not represented in the graph (top: (none) 3, .example 2, .css 2)

## Summary
- 240 nodes · 497 edges · 14 communities (13 shown, 1 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 6 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `6295d6cf`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- Run a Whitechain node
- Whitechain developer playbook
- company-ui.js
- company.js
- Steps
- payments.test.js
- Steps
- company-server.js
- app.js
- Relay
- node
- agents.js
- run-company.js
- payments.js

## God Nodes (most connected - your core abstractions)
1. `createCompany()` - 19 edges
2. `createVendor()` - 14 edges
3. `fail()` - 12 edges
4. `esc()` - 10 edges
5. `refresh()` - 10 edges
6. `mountX402()` - 10 edges
7. `Relay` - 10 edges
8. `createPayments()` - 9 edges
9. `ethers` - 9 edges
10. `inspectToken()` - 8 edges

## Surprising Connections (you probably didn't know these)
- `createCompany()` --calls--> `planMission()`  [EXTRACTED]
  app/company.js → app/agents.js
- `createVendor()` --calls--> `vendorWork()`  [EXTRACTED]
  app/vendor-server.js → app/agents.js
- `createRealCompanyChain()` --calls--> `inspectToken()`  [EXTRACTED]
  app/company-chain.js → app/chain.js
- `createVendor()` --calls--> `inspectToken()`  [EXTRACTED]
  app/vendor-server.js → app/chain.js
- `createPayments()` --calls--> `checkAuthorization()`  [EXTRACTED]
  app/payments.js → app/chain.js

## Import Cycles
- None detected.

## Communities (14 total, 1 thin omitted)

### Community 0 - "Run a Whitechain node"
Cohesion: 0.22
Nodes (8): Client, Error handling, Hardware requirements, Network ports, Run a Whitechain node, Security, Steps, Verify sync

### Community 1 - "Whitechain developer playbook"
Cohesion: 0.22
Nodes (8): Default network, Developer context, For edge cases and API changes, Installation, Operating procedure, Routing table, Safety guardrails, Whitechain developer playbook

### Community 2 - "company-ui.js"
Cohesion: 0.22
Nodes (20): act(), api(), empty(), esc(), handler(), icons, images, missionKey (+12 more)

### Community 3 - "company.js"
Cohesion: 0.14
Nodes (22): ALLOCATE_TYPES, boundNonce(), COMPANY_ABI, companyDomain(), companyInterface, createRealCompanyChain(), createSimulatedCompanyChain(), readCompanyEvents() (+14 more)

### Community 4 - "Steps"
Cohesion: 0.22
Nodes (9): 1. Collect required inputs, 2. Submit for verification, 3. Poll for result, 4. Return the result, Error handling, Input validation, Proxy contracts, Steps (+1 more)

### Community 5 - "payments.test.js"
Cohesion: 0.13
Nodes (15): pendingConfiguration(), contract, request(), createPayments(), fail(), broadcast(), setup(), createApp() (+7 more)

### Community 6 - "Steps"
Cohesion: 0.06
Nodes (28): 1. Check the wallet is on Whitechain Sepolia, 2. Check the current balance, 3. Direct the user to the faucet, 4. Confirm the balance increased, Claim testnet WBT, Error handling, Input validation, Notes (+20 more)

### Community 7 - "company-server.js"
Cohesion: 0.13
Nodes (17): COMPANY_SCHEME, createCompanyApp(), baseApp(), sessionRoutes(), dependencies, ethers, express, name (+9 more)

### Community 8 - "app.js"
Cohesion: 0.36
Nodes (10): act(), api(), element(), handler(), ondismiss(), refresh(), renderActivity(), requestKey (+2 more)

### Community 9 - "Relay"
Cohesion: 0.10
Nodes (18): Relay architecture, Connect real testnet settlement, Limits, Network evidence, Relay — Whitechain agent payment lab, Run locally, What is checked, x402, added after the core flow passed (+10 more)

### Community 11 - "agents.js"
Cohesion: 0.80
Nodes (4): clean(), modelText(), planMission(), vendorWork()

### Community 12 - "run-company.js"
Cohesion: 0.50
Nodes (3): children, launch(), stop()

### Community 13 - "payments.js"
Cohesion: 0.18
Nodes (18): abi, checkAuthorization(), createChain(), EXPLORER, inspectToken(), NETWORK, prepare(), TOKEN (+10 more)

## Knowledge Gaps
- **1 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `ethers` connect `payments.js` to `company.js`, `payments.test.js`, `company-server.js`?**
  _High betweenness centrality (0.059) - this node is a cross-community bridge._
- **Should `company.js` be split into smaller, more focused modules?**
  _Cohesion score 0.14285714285714285 - nodes in this community are weakly interconnected._
- **Why does `engines` connect `node` to `company-server.js`?**
  _High betweenness centrality (0.033) - this node is a cross-community bridge._
- **Should `payments.test.js` be split into smaller, more focused modules?**
  _Cohesion score 0.1349206349206349 - nodes in this community are weakly interconnected._
- **Should `Steps` be split into smaller, more focused modules?**
  _Cohesion score 0.0625 - nodes in this community are weakly interconnected._
- **Should `company-server.js` be split into smaller, more focused modules?**
  _Cohesion score 0.12631578947368421 - nodes in this community are weakly interconnected._
- **Should `Relay` be split into smaller, more focused modules?**
  _Cohesion score 0.09523809523809523 - nodes in this community are weakly interconnected._