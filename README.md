# AAi Agentic Collectibles

Hackathon MVP for The Synthesis.

Submitted project slug: `aaigotchi-8642`.

This project turns an aaigotchi NFT into a controlled onchain actor:

- one NFT per collectible
- one vault per NFT
- owner-set permissions
- executor support for aaigotchi / OpenClaw
- auditable receipts for each action
- a simple owner terminal to view status and trigger approved actions

## MVP scope

Latest live proof is captured in `LIVE_PROOF.md`.


The MVP now ships two main action paths:

1. `send-native`
2. `swap-uniswap`

It also keeps the lower-level `swap-call` and `send-erc20` paths for advanced or prebuilt calldata flows.

## Live execution model

The live path is **Bankr-first**:

- deployment uses the Bankr wallet through the standard `0x4e59...` deployer contract on Base
- owner-terminal actions default to `--via bankr`
- action scripts preview first and only go live with `--broadcast` or `--confirm yes`
- local private-key execution is kept only as an explicit dev fallback with `--via local`

That keeps the deployed operator truly agentic instead of hiding the real signer behind a raw key.

## Environment

Create a local `.env` in this folder, starting from `.env.example`:

```bash
BASE_SEPOLIA_RPC_URL=https://sepolia.base.org
BASE_RPC_URL=https://mainnet.base.org
BANKR_EVM_WALLET=0x...
COLLECTION_NAME=AAi Agentic Collectibles
COLLECTION_SYMBOL=AAIC
DEPLOYMENT_SALT_NAMESPACE=aaigotchi-wallet-agency-v1
DEFAULT_EXECUTOR_ADDRESS=0x...
UNISWAP_API_KEY=...

# Optional local-dev fallback only
DEPLOYER_PRIVATE_KEY=0x...
```

Notes:

- `BANKR_API_KEY` is usually read from the installed Bankr config on the VM
- `BANKR_EVM_WALLET` is optional if `bankr whoami` works on the VM
- `UNISWAP_API_KEY` is required for the Uniswap Trading API flow
- `DEPLOYER_PRIVATE_KEY` is only needed for explicit `--via local` testing

## Commands

```bash
pnpm install
pnpm compile
pnpm test

# Preview the Bankr deployment route
pnpm deploy:base

# Broadcast the Bankr deployment route
pnpm deploy:base:broadcast

TOKEN_TO=0x... TOKEN_URI=ipfs://aaigotchi/1 pnpm mint:demo
TOKEN_TO=0x... TOKEN_URI=ipfs://aaigotchi/1 pnpm mint:demo:broadcast
TOKEN_ID=1 EXECUTOR_ADDRESS=0x... ALLOW_TARGET=0x... NATIVE_LIMIT_WEI=10000000000000 COOLDOWN_SECONDS=0 pnpm setup:token
TOKEN_ID=1 EXECUTOR_ADDRESS=0x... ALLOW_TARGET=0x... NATIVE_LIMIT_WEI=10000000000000 COOLDOWN_SECONDS=0 pnpm setup:token:broadcast

TOKEN_ID=1 TO=0x... AMOUNT_WEI=10000000000000 RECEIPT_NOTE="tiny proof send" pnpm send:demo
TOKEN_ID=1 TO=0x... AMOUNT_WEI=10000000000000 RECEIPT_NOTE="tiny proof send" pnpm send:demo:broadcast

TOKEN_ID=1 TOKEN_OUT=0x... AMOUNT_IN_WEI=10000000000000 RECEIPT_NOTE="uniswap preview" pnpm swap:uniswap
TOKEN_ID=1 TOKEN_OUT=0x... AMOUNT_IN_WEI=10000000000000 RECEIPT_NOTE="uniswap live" pnpm swap:uniswap:broadcast
```

## Owner terminal

The owner terminal is the preferred live interface.

```bash
pnpm terminal status --network base --token-id 1
pnpm terminal receipts --token-id 1
pnpm terminal send-native --network base --token-id 1 --to 0x... --amount-wei 10000000000000 --note "preview only"
pnpm terminal send-native --network base --token-id 1 --to 0x... --amount-wei 10000000000000 --note "live" --confirm yes
pnpm terminal send-erc20 --network base --token-id 1 --asset 0x... --to 0x... --amount 1000000 --confirm yes
pnpm terminal swap-call --network base --token-id 1 --router 0x... --token-in 0x... --amount-in 1000000 --data 0x... --confirm yes
```

## Uniswap swap flow

`swap-uniswap` is the high-level path for the Uniswap track.

What it does:

1. fetches a real quote from the Uniswap Trading API
2. turns that quote into unsigned calldata through `POST /swap`
3. validates that the route is signature-free and compatible with the NFT vault
4. submits the final `swapWithCall(...)` through Bankr
5. writes an auditable receipt with the Uniswap request metadata

Current constraint:

- the cleanest supported route today is **native ETH input on Base**
- ERC20 input may require Permit2 signatures, which the NFT vault does not sign
- the lower-level `swap-call` path remains available for advanced calldata flows

## Outputs

- deployment files land in `deployments/`
- receipts land in `receipts/<collection-address>/`
- tracked publishable proof snapshots live in `proof/base-mainnet/`
- policy templates can live in `policies/`

## Notes

- executor permissions auto-expire on NFT transfer because the stored executor owner must still match the current token owner
- targets must be allowlisted before funds can move
- cooldowns are enforced onchain
- native-input swaps use the NFTs native spend limit
- ERC20-input swaps use the NFT's ERC20 spend limit
- targets are not enumerable onchain, so keep policy files aligned with your allowlist changes

## Onchain image + metadata

The bundled SVG can be used as fully onchain NFT metadata.

Build the metadata and token URI:

```bash
pnpm exec tsx scripts/build-onchain-metadata.ts
```

That writes:

- `generated/token-1.metadata.json`
- `generated/token-1.token-uri.txt`

Then mint using the generated token URI:

```bash
TOKEN_TO=0x... TOKEN_URI="$(cat generated/token-1.token-uri.txt)" pnpm mint:demo:broadcast
```
