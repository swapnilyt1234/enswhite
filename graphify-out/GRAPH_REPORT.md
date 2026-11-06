# Graph Report - ethglobal  (2026-11-06)

## Corpus Check
- 41 files · ~25,389 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 8 file(s) not represented in the graph (top: .example 2, (none) 2, .css 2)

## Summary
- 235 nodes · 484 edges · 13 communities (12 shown, 1 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 6 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `194cf2ca`
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

## God Nodes (most connected - your core abstractions)
1. `createCompany()` - 19 edges
2. `createVendor()` - 14 edges
3. `fail()` - 12 edges
4. `esc()` - 10 edges
5. `refresh()` - 10 edges
6. `mountX402()` - 10 edges
7. `Relay` - 10 edges
8. `createPayments()` - 9 edges
9. `inspectToken()` - 8 edges
10. `money()` - 8 edges

## Surprising Connections (you probably didn't know these)
- `createCompany()` --calls--> `planMission()`  [EXTRACTED]
  app/company.js → app/agents.js
- `createVendor()` --calls--> `vendorWork()`  [EXTRACTED]
  app/vendor-server.js → app/agents.js
- `createCompany()` --calls--> `fail()`  [EXTRACTED]
  app/company.js → app/payments.js
- `createCompany()` --calls--> `decodePayment()`  [EXTRACTED]
  app/company.js → app/x402.js
- `createCompany()` --calls--> `encodePayment()`  [EXTRACTED]
  app/company.js → app/x402.js

## Import Cycles
- None detected.

## Communities (13 total, 1 thin omitted)

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
Cohesion: 0.10
Nodes (38): abi, createChain(), EXPLORER, inspectToken(), NETWORK, prepare(), TOKEN, types (+30 more)

### Community 4 - "Steps"
Cohesion: 0.22
Nodes (9): 1. Collect required inputs, 2. Submit for verification, 3. Poll for result, 4. Return the result, Error handling, Input validation, Proxy contracts, Steps (+1 more)

### Community 5 - "payments.test.js"
Cohesion: 0.21
Nodes (15): checkAuthorization(), request(), createPayments(), fail(), broadcast(), setup(), createApp(), publicDir (+7 more)

### Community 6 - "Steps"
Cohesion: 0.06
Nodes (28): 1. Check the wallet is on Whitechain Sepolia, 2. Check the current balance, 3. Direct the user to the faucet, 4. Confirm the balance increased, Claim testnet WBT, Error handling, Input validation, Notes (+20 more)

### Community 7 - "company-server.js"
Cohesion: 0.12
Nodes (17): COMPANY_SCHEME, createCompanyApp(), baseApp(), sessionRoutes(), dependencies, ethers, express, name (+9 more)

### Community 8 - "app.js"
Cohesion: 0.36
Nodes (10): act(), api(), element(), handler(), ondismiss(), refresh(), renderActivity(), requestKey (+2 more)

### Community 9 - "Relay"
Cohesion: 0.10
Nodes (18): Relay architecture, Connect real testnet settlement, Limits, Network evidence, Relay — Whitechain agent payment lab, Run locally, What is checked, x402, added after the core flow passed (+10 more)

### Community 11 - "agents.js"
Cohesion: 0.46
Nodes (4): clean(), modelText(), planMission(), vendorWork()

### Community 12 - "run-company.js"
Cohesion: 0.50
Nodes (3): children, launch(), stop()

## Knowledge Gaps
- **1 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `ethers` connect `company.js` to `payments.test.js`, `company-server.js`?**
  _High betweenness centrality (0.055) - this node is a cross-community bridge._
- **Should `company.js` be split into smaller, more focused modules?**
  _Cohesion score 0.10437710437710437 - nodes in this community are weakly interconnected._
- **Why does `engines` connect `node` to `company-server.js`?**
  _High betweenness centrality (0.033) - this node is a cross-community bridge._
- **Should `Steps` be split into smaller, more focused modules?**
  _Cohesion score 0.0625 - nodes in this community are weakly interconnected._
- **Should `company-server.js` be split into smaller, more focused modules?**
  _Cohesion score 0.11904761904761904 - nodes in this community are weakly interconnected._
- **Should `Relay` be split into smaller, more focused modules?**
  _Cohesion score 0.09523809523809523 - nodes in this community are weakly interconnected._