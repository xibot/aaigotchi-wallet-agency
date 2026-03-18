# Live Proof: AAi Agentic Collectibles

This file captures the final live MVP proof for the `AAi Agentic Collectibles` (`AAIC`) deployment on Base mainnet.

Tracked repo snapshots for this proof live in `proof/base-mainnet/`.

## Final deployment

- Collection: `0x7e1c18832308D1d639A195E0a2414d7A9f650A86`
- Agency: `0xa1d7Aceb82bad61acD931859461870eC0eb44179`
- Token owner / executor wallet: `0xb96B48a6B190A9d509cE9312654F34E9770F2110`
- Token #1 vault: `0xFd8349a30B4aD0FcDC05ee49837B829B5441349b`

## Deployment transactions

- Collection deploy: `0x612391b4dfc0474af23eea3861d88742e23c4de313ea173b13dbd641531782f4`
- Agency deploy: `0xff24ed7d7ba03efaf7a96f09a573ac582d461a3bf9ae59c20688953a286bbf03`
- Token #1 mint: `0x134af4251246fc814c2118ffdb666c1aadfa2661af3f702ac5285bb5e2cd3630`

## Live action proofs

### Proof 1: native send

- Action: `send-native`
- Tx: `0x7fdcc49c79a2a903ebab543333af62a341c98e883d2d2db0a096828e2b861766`
- Receipt file: `proof/base-mainnet/token-1-send-native.json`
- Policy at execution:
  - `sendEnabled = true`
  - `swapEnabled = false`
  - `nativeLimitWei = 10000000000000`

### Proof 2: Uniswap swap

- Action: `swap-uniswap`
- Tx: `0x0bb0f06500ec082cb98c237de3712aefeeb03ac16d4163471f84cb9b3f3337b2`
- Receipt file: `proof/base-mainnet/token-1-swap-uniswap.json`
- Swap details:
  - provider: `uniswap-trading-api`
  - route: `CLASSIC`
  - token in: native ETH
  - token out: Base USDC `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`
  - input: `5000000000000` wei (`0.000005 ETH`)
  - expected output: `11661`
  - router: `0x6fF5693b99212Da76ad316178A184AB56D299b43`

## Final live state

- `sendEnabled = true`
- `swapEnabled = true`
- `nativeLimitWei = 10000000000000`
- Vault ETH balance after proofs: `0.000005`
- Vault Base USDC balance after swap: `11661`

## Inspection commands

Run these on the VM inside the project:

```bash
cd /home/ubuntu/.openclaw/workspace/aaigotchi-wallet-agency
BASE_RPC_URL=https://base-rpc.publicnode.com pnpm terminal status --network base --token-id 1
pnpm terminal receipts --network base --token-id 1
```

## Metadata

- Collection name: `AAi Agentic Collectibles`
- Symbol: `AAIC`
- Token #1 image + metadata are fully onchain from `assets/AAi_AGENTIC_COLLECTIBLE.svg`
- Generated token URI source: `generated/token-1.token-uri.txt`
