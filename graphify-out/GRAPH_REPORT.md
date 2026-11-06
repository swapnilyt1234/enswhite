# Graph Report - ethglobal  (2026-11-06)

## Corpus Check
- 66 files · ~39,081 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 11 file(s) not represented in the graph (top: .example 3, (none) 3, .css 2)

## Summary
- 318 nodes · 679 edges · 16 communities (14 shown, 2 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 14 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `69508abd`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- Run a Whitechain node
- Whitechain developer playbook
- company-ui.js
- company.js
- Connecting to Whitechain Sepolia
- payments.js
- bootstrap.js
- company-server.js
- app.js
- EnsWhite
- Steps
- company-setup.js
- gas-replenisher.js
- ref_node_assert
- node

## God Nodes (most connected - your core abstractions)
1. `createCompany()` - 21 edges
2. `ethers` - 17 edges
3. `createVendor()` - 15 edges
4. `inspectToken()` - 12 edges
5. `fail()` - 12 edges
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

## Communities (16 total, 2 thin omitted)

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
Cohesion: 0.12
Nodes (24): ALLOCATE_TYPES, boundNonce(), COMPANY_ABI, companyDomain(), companyInterface, createRealCompanyChain(), createSimulatedCompanyChain(), IDENTITY_ABI (+16 more)

### Community 4 - "Connecting to Whitechain Sepolia"
Cohesion: 0.12
Nodes (15): 1. Check the wallet is on Whitechain Sepolia, 2. Check the current balance, 3. Direct the user to the faucet, 4. Confirm the balance increased, Claim testnet WBT, Error handling, Input validation, Notes (+7 more)

### Community 5 - "payments.js"
Cohesion: 0.15
Nodes (26): abi, checkAuthorization(), createChain(), inspectToken(), NETWORK, prepare(), retryRPCRead(), TOKEN (+18 more)

### Community 6 - "bootstrap.js"
Cohesion: 0.10
Nodes (28): checkENSTransaction(), createENSDirectory(), employee(), resolver(), ENS_NAMES_ABI, ENS_REGISTRY_ABI, IDENTITY_TYPES, populateENSTransaction() (+20 more)

### Community 7 - "company-server.js"
Cohesion: 0.11
Nodes (20): COMPANY_SCHEME, createCompanyApp(), baseApp(), sessionRoutes(), dependencies, ethers, express, engines (+12 more)

### Community 8 - "app.js"
Cohesion: 0.36
Nodes (10): act(), api(), element(), handler(), ondismiss(), refresh(), renderActivity(), requestKey (+2 more)

### Community 9 - "EnsWhite"
Cohesion: 0.08
Nodes (23): EnsWhite architecture, Connect real testnet settlement, EnsWhite — Whitechain agent payment lab, Limits, Network evidence, Run locally, What is checked, x402, added after the core flow passed (+15 more)

### Community 11 - "Steps"
Cohesion: 0.08
Nodes (22): 1. Confirm the target network, 2. Set up the signer, 3. Compile, 4. Show deployment summary and wait for confirmation, 5. Deploy, 6. Return the result, Deploy a contract on Whitechain, Error handling (+14 more)

### Community 12 - "company-setup.js"
Cohesion: 0.13
Nodes (15): pendingConfiguration(), directory, DEPARTMENTS, VENDORS, walletStore(), decrypt(), encrypt(), next (+7 more)

### Community 13 - "gas-replenisher.js"
Cohesion: 0.22
Nodes (13): EXPLORER, createGasAdapter(), createReplenisher(), run(), lockWorker(), LOW_GAS, main(), MAX_BATCH (+5 more)

### Community 14 - "ref_node_assert"
Cohesion: 0.25
Nodes (5): clean(), modelText(), planMission(), vendorWork(), contract

## Knowledge Gaps
- **2 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `ethers` connect `bootstrap.js` to `company.js`, `payments.js`, `company-server.js`, `company-setup.js`, `gas-replenisher.js`, `ref_node_assert`?**
  _High betweenness centrality (0.100) - this node is a cross-community bridge._
- **Should `company.js` be split into smaller, more focused modules?**
  _Cohesion score 0.11553030303030302 - nodes in this community are weakly interconnected._
- **Why does `engines` connect `company-server.js` to `node`?**
  _High betweenness centrality (0.044) - this node is a cross-community bridge._
- **Should `Connecting to Whitechain Sepolia` be split into smaller, more focused modules?**
  _Cohesion score 0.11764705882352941 - nodes in this community are weakly interconnected._
- **Why does `node` connect `node` to `company-server.js`?**
  _High betweenness centrality (0.041) - this node is a cross-community bridge._
- **Should `payments.js` be split into smaller, more focused modules?**
  _Cohesion score 0.145748987854251 - nodes in this community are weakly interconnected._
- **Should `bootstrap.js` be split into smaller, more focused modules?**
  _Cohesion score 0.1 - nodes in this community are weakly interconnected._