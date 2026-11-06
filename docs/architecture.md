# EnsWhite architecture

```mermaid
flowchart LR
  Founder[Founder: mission + approvals] --> Backend[EnsWhite backend]
  Razorpay[Razorpay test checkout] --> Webhook[Raw HMAC + captured-payment API check]
  Webhook --> Attester[Empty attester signs TopUp]
  Treasury[USDT-only treasury] --> Pool[Prefunded EnsWhiteCompany pool]
  Attester --> Pool
  Finance[Finance signs allocation] --> Relayer[WBT-only relayer]
  Pool --> Departments[Marketing / Support / Finance: zero WBT]
  Backend --> Departments
  Departments --> Auth[Bound ReceiveWithAuthorization]
  Auth --> Relayer
  Relayer --> Policy[EnsWhiteCompany.pay checks vendor and limits]
  Policy --> Vendors[CopyDesk / PixelPress / LinguaLink]
  Vendors --> Verify[Independent Paid receipt verification]
  Verify --> Delivery[Copy / SVG / translated FAQ]
  Policy --> Books[Event-derived ledger + CSV]
```

Each vendor is an independent Node process with its own encrypted wallet and order database. Testnet delivery and earnings query chain receipts directly. The local simulator's event database is explicitly a test substitute.

The backend serializes jobs and saves signed bytes before submission. A timeout preserves the original transaction. Founder decisions are recorded separately. Model proposals pass through an allowlisted tool plan and deterministic code; the model never controls keys, prices or policy.

The original payment lab stays under `data/testnet`. The company uses `data/company/testnet`, vendors use `data/vendors/testnet/<vendor>`, and all private state is ignored by Git.
