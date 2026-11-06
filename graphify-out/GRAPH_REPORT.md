# Graph Report - ethglobal  (2026-11-06)

## Corpus Check
- 71 files · ~107,680 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 19 file(s) not represented in the graph (top: .mmd 7, .example 3, (none) 3)

## Summary
- 347 nodes · 709 edges · 17 communities (15 shown, 2 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 14 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `3c21f958`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- Run a Whitechain node
- Whitechain developer playbook
- company-ui.js
- company.js
- EnsWhite: explain the project through diagrams
- payments.js
- bootstrap.js
- node
- app.js
- EnsWhite
- Steps
- company-store.js
- gas-replenisher.js
- agents.js
- Whitechain payment links

## God Nodes (most connected - your core abstractions)
1. `createCompany()` - 22 edges
2. `ethers` - 17 edges
3. `createVendor()` - 15 edges
4. `fail()` - 13 edges
5. `inspectToken()` - 12 edges
6. `EnsWhite` - 12 edges
7. `refresh()` - 11 edges
8. `walletStore()` - 11 edges
9. `esc()` - 10 edges
10. `openStore()` - 10 edges

## Surprising Connections (you probably didn't know these)
- `send()` --calls--> `checkENSTransaction()`  [EXTRACTED]
  ens/scripts/bootstrap.js → app/ens.js
- `send()` --calls--> `checkENSTransaction()`  [EXTRACTED]
  ens/scripts/demo.js → app/ens.js
- `send()` --calls--> `populateENSTransaction()`  [EXTRACTED]
  ens/scripts/bootstrap.js → app/ens.js
- `send()` --calls--> `populateENSTransaction()`  [EXTRACTED]
  ens/scripts/demo.js → app/ens.js
- `createCompany()` --calls--> `planMission()`  [EXTRACTED]
  app/company.js → app/agents.js

## Import Cycles
- None detected.

## Communities (17 total, 2 thin omitted)

### Community 0 - "Run a Whitechain node"
Cohesion: 0.22
Nodes (8): Client, Error handling, Hardware requirements, Network ports, Run a Whitechain node, Security, Steps, Verify sync

### Community 1 - "Whitechain developer playbook"
Cohesion: 0.22
Nodes (8): Default network, Developer context, For edge cases and API changes, Installation, Operating procedure, Routing table, Safety guardrails, Whitechain developer playbook

### Community 2 - "company-ui.js"
Cohesion: 0.20
Nodes (21): act(), api(), empty(), esc(), handler(), icons, images, missionKey (+13 more)

### Community 3 - "company.js"
Cohesion: 0.11
Nodes (32): ALLOCATE_TYPES, boundNonce(), companyDomain(), companyInterface, createRealCompanyChain(), createSimulatedCompanyChain(), identityInterface, parseCompanyLog() (+24 more)

### Community 4 - "EnsWhite: explain the project through diagrams"
Cohesion: 0.09
Nodes (19): EnsWhite architecture, Diagram sources and exports, Connect real testnet settlement, EnsWhite — Whitechain agent payment lab, Limits, Network evidence, Run locally, What is checked (+11 more)

### Community 5 - "payments.js"
Cohesion: 0.13
Nodes (23): abi, checkAuthorization(), createChain(), EXPLORER, inspectToken(), NETWORK, prepare(), retryRPCRead() (+15 more)

### Community 6 - "bootstrap.js"
Cohesion: 0.07
Nodes (34): COMPANY_ABI, IDENTITY_ABI, pendingConfiguration(), contract, directory, checkENSTransaction(), createENSDirectory(), employee() (+26 more)

### Community 7 - "node"
Cohesion: 0.07
Nodes (16): dependencies, ethers, express, engines, node, name, private, scripts (+8 more)

### Community 8 - "app.js"
Cohesion: 0.36
Nodes (10): act(), api(), element(), handler(), ondismiss(), refresh(), renderActivity(), requestKey (+2 more)

### Community 9 - "EnsWhite"
Cohesion: 0.13
Nodes (15): Activate with your wallets, Automatic gas replenishment, Checks and transaction evidence, Completed real company mission, Custom x402 scheme, Departments and independent vendors, ENS validation and limits, EnsWhite (+7 more)

### Community 11 - "Steps"
Cohesion: 0.05
Nodes (37): 1. Check the wallet is on Whitechain Sepolia, 2. Check the current balance, 3. Direct the user to the faucet, 4. Confirm the balance increased, Claim testnet WBT, Error handling, Input validation, Notes (+29 more)

### Community 12 - "company-store.js"
Cohesion: 0.16
Nodes (13): DEPARTMENTS, VENDORS, walletStore(), decrypt(), encrypt(), next, old, setup (+5 more)

### Community 13 - "gas-replenisher.js"
Cohesion: 0.22
Nodes (12): createGasAdapter(), createReplenisher(), run(), lockWorker(), LOW_GAS, main(), MAX_BATCH, routerInterface (+4 more)

### Community 15 - "agents.js"
Cohesion: 0.80
Nodes (4): clean(), modelText(), planMission(), vendorWork()

### Community 16 - "Whitechain payment links"
Cohesion: 0.40
Nodes (4): Current ENS-enabled company, Earlier company demo, Original payment lab, Whitechain payment links

## Knowledge Gaps
- **2 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `ethers` connect `bootstrap.js` to `company.js`, `payments.js`, `node`, `company-store.js`, `gas-replenisher.js`?**
  _High betweenness centrality (0.085) - this node is a cross-community bridge._
- **Should `company.js` be split into smaller, more focused modules?**
  _Cohesion score 0.10963455149501661 - nodes in this community are weakly interconnected._
- **Should `EnsWhite: explain the project through diagrams` be split into smaller, more focused modules?**
  _Cohesion score 0.08695652173913043 - nodes in this community are weakly interconnected._
- **Should `payments.js` be split into smaller, more focused modules?**
  _Cohesion score 0.13363363363363365 - nodes in this community are weakly interconnected._
- **Should `bootstrap.js` be split into smaller, more focused modules?**
  _Cohesion score 0.06745098039215686 - nodes in this community are weakly interconnected._
- **Should `node` be split into smaller, more focused modules?**
  _Cohesion score 0.07142857142857142 - nodes in this community are weakly interconnected._
- **Should `EnsWhite` be split into smaller, more focused modules?**
  _Cohesion score 0.13333333333333333 - nodes in this community are weakly interconnected._