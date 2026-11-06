# Live employee discovery verification

Verified against Ethereum Sepolia RPC on November 6, 2026. These are live registrations, separate from the offline employee-runtime demo.

| Employee | ERC-8004 agent ID | Registration transaction |
| --- | --- | --- |
| marketing.acme.enswhite.eth | 11295 | [Register](https://sepolia.etherscan.io/tx/0x7a7b5d97609ca36b659a86282f4f61d80dd4ae62325adf7e038dc47210318a58) |
| support.acme.enswhite.eth | 11296 | [Register](https://sepolia.etherscan.io/tx/0x1f6e78c647557f0f6faf4f41744c551ad66f8fa392561b9035234f39c539bf49) |
| finance.acme.enswhite.eth | 11297 | [Register](https://sepolia.etherscan.io/tx/0x94c7d7b2c19d339da9b68f127c4a7111bf733dc1898ae57624bb40809de56161) |

For all three, the backend independently confirmed active ENS employment, the exact ERC-7930 ENSIP-25 consent key, matching ERC-8004 NFT owner/agent wallet and name-bound registration metadata. ENSIP-26 context and web records are present. MCP/A2A endpoints, reputation feedback and validation services are not advertised.

The parent company pointer matches registry `0x6eE8218dC98ee838a70E271d2781040649C8D1D4`, managed by controller `0x95555c8f27F72C3352698AFAC6867a408b9da352`.

- [Attach replacement directory](https://sepolia.etherscan.io/tx/0x81b7ea2af26f7f83e103203027445b8d4db6633a2c113ccdcc87b596fd224299): successful, block 12078286.
- [Retire old registrar role](https://sepolia.etherscan.io/tx/0x9ef837c1506345144d90197530e98e01b687b0ffda3efbb5ce274d4f538da13b): successful, block 12078287.
- [Recover Support consent edit](https://sepolia.etherscan.io/tx/0x18e2d3c469f584ea0e8de226fdc6636a11997a68521feb76b670556bc92a44f0): successful, block 12078277. The original reverted journal was retained; the existing Support identity was reused.

Public addresses and identity manifests are in `docs/deployments`. Private signed journals remain ignored under `data/ens/agent-discovery-v1`. Whitechain contracts, token balances and vendor registry were not modified by this migration. The saved web URLs still require the public service/tunnel activation described in [ACTIVATION.md](ACTIVATION.md); a configured discovery record alone does not prove endpoint availability.
