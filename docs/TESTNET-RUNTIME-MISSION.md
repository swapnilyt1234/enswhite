# Real-model testnet mission

Mission: `4179ac8e-67a2-4299-aa1b-c4f0c1ef70b3`, Acme Candles sandalwood campaign. November 7, 2026 (Asia/Calcutta).

The founder approved the above-threshold PixelPress purchase in the application. Three independent vendors verified their Whitechain receipts before delivery. Direct RPC checks confirmed receipt success, exact request IDs, gross amounts, fees, employee ENS nodes and vendor ENS nodes for all three payments:

| Vendor | Gross test USDT | Fee test USDT | Whitechain payment |
| --- | --- | --- | --- |
| CopyDesk | 0.1 | 0.001 | [Block 12394277](https://explorer.testnet.whitechain.io/tx/0x64ab17ef452e654837132af51afe734cf1206ecc937b43c8ff67b76883a33b48) |
| PixelPress | 0.2 | 0.002 | [Block 12395647](https://explorer.testnet.whitechain.io/tx/0xba4c99d52bed8e429544665168d3600fb1abdf607242b858a57b40209099b8eb) |
| LinguaLink | 0.1 | 0.001 | [Block 12395129](https://explorer.testnet.whitechain.io/tx/0xdd7e85d2651c906645b937b921118a7c61e1e43fd6077b992deadf601333decb) |

Gross: 0.4 test USDT. Company fees: 0.004. Vendor net: 0.396. Company contract: `0xbca635f00C07681f10269f69ca293bDB6536D6aB`, Whitechain Sepolia 1874. Existing funded budgets were used; this mission did not require another Razorpay checkout.

Marketing completed eight tool calls and Support six, both using the real model. CopyDesk and LinguaLink deliveries are labeled `OpenAI model`; PixelPress uses the deterministic SVG renderer with delivered copy and brand colours. Retrying the interrupted runs reused the existing order identities and CopyDesk receipt.

**Remaining:** Finance encountered RPC timeouts while reading history/proposing allocation. Its unfinished tool is saved; the Campaign Kit is not claimed complete until Finance submits its reconciled report. The new event reader passed 71 backend tests and a live history/refresh comparison (22 initial log-page reads versus 1 refresh, nine payments both times). It requires a company-server restart to load.

Content review: the saved company profile has no specific product name, shipping policy, return policy or customer contact. The generated copy identifies its sandalwood direction as an unverified draft; the Hindi FAQ explicitly flags missing founder facts instead of inventing policies. The banner takes the delivered copy's first line, which in this run is a draft warning rather than the intended advertising headline. These assets need founder facts and editorial review before publication. Payment verification proves settlement and delivery, not advertising or translation quality. No private prompts, model keys or signing journals are included here.
