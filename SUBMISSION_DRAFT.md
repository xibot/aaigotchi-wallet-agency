# Synthesis Submission Draft — aaigotchi

## Core fields

- Project name: `aaigotchi`
- Repo URL: `https://github.com/xibot/aaigotchi-wallet-agency`
- Optional mirror: `https://gitlab.com/aaigotchi/aaigotchi-wallet-agency`

## Track UUIDs

```json
[
  "fdb76d08812b43f6a5f454744b66f590",
  "3bf41be958da497bbb69f1a150c76af9",
  "020214c160fc43339dd9833733791e6b",
  "10bd47fac07e4f85bda33ba482695b24"
]
```

## Track names

1. `Synthesis Open Track`
2. `Agents With Receipts — ERC-8004`
3. `Agentic Finance (Best Uniswap API Integration)`
4. `🤖 Let the Agent Cook — No Humans Required`

## 1-line description

Building NFTs with controlled smart-wallet agency, so each collectible can perform approved onchain actions with clear permissions and auditable receipts.

## Description

`aaigotchi` turns NFTs into permissioned wallet-agents. Each collectible gets a controlled smart-wallet identity with owner-defined execution rules, so it can perform approved onchain actions like sends and swaps through a real agent operator and return auditable receipts for every action.

The live MVP is built around `AAi Agentic Collectibles` on Base mainnet. We deployed the collection and agency contracts, minted a fully onchain SVG NFT, created a per-token vault, configured policy controls, executed a constrained native send, and then executed a real Uniswap swap through the Uniswap Trading API and Bankr wallet flow. Every action is traceable through both onchain transactions and structured receipt files in the repo.

## Problem Statement

Most NFTs stop at ownership and display. They can represent identity or access, but they cannot safely act on behalf of their holders without collapsing back into a normal wallet model or requiring full custody handoffs to an agent. That makes NFT utility shallow and hard to trust.

`aaigotchi` solves this by giving each NFT its own constrained wallet agency: per-token vaults, explicit permissions, spending caps, allowlisted targets, and receipts that record what happened. Owners keep control, agents get bounded authority, and each collectible becomes a usable onchain actor instead of a static asset.

## Submission metadata

```json
{
  "agentFramework": "other",
  "agentFrameworkOther": "custom smart-contract and OpenClaw/Bankr workflow",
  "agentHarness": "codex-cli",
  "model": "gpt-5.4",
  "skills": [
    "bankr"
  ],
  "tools": [
    "OpenClaw",
    "Bankr",
    "Hardhat",
    "ethers.js",
    "pnpm",
    "Base",
    "Uniswap Trading API",
    "GitHub",
    "GitLab"
  ],
  "helpfulResources": [
    "https://synthesis.devfolio.co/submission/skill.md",
    "https://synthesis.devfolio.co/catalog?page=1&limit=50",
    "https://api-docs.uniswap.org/",
    "https://api-docs.uniswap.org/guides/integration_guide",
    "https://docs.github.com/en/github/administering-a-repository/setting-repository-visibility"
  ],
  "helpfulSkills": [
    {
      "name": "bankr",
      "reason": "Bankr was the live signing and execution layer for the MVP, including the Base mainnet deployment, NFT actions, and final Uniswap swap proof."
    }
  ],
  "intention": "continuing",
  "intentionNotes": "We plan to keep developing aaigotchi as a live NFT wallet-agency system and expand the collectible, policy, and agent execution layers after the hackathon.",
  "moltbookPostURL": "PASTE_MOLTBOOK_URL_HERE"
}
```

## Optional fields to fill after the video

```json
{
  "videoURL": "https://github.com/xibot/aaigotchi-wallet-agency/releases/download/v0.1.0/AAi-Synthesis-Hackathon-Final-1920px.mp4",
  "coverImageURL": "PASTE_COVER_IMAGE_URL_HERE",
  "pictures": "PASTE_OPTIONAL_SCREENSHOT_URLS_HERE"
}
```

## Live proof links to mention

- GitHub repo: `https://github.com/xibot/aaigotchi-wallet-agency`
- Collection: `0x7e1c18832308D1d639A195E0a2414d7A9f650A86`
- Agency: `0xa1d7Aceb82bad61acD931859461870eC0eb44179`
- Mint tx: `0x134af4251246fc814c2118ffdb666c1aadfa2661af3f702ac5285bb5e2cd3630`
- Send tx: `0x7fdcc49c79a2a903ebab543333af62a341c98e883d2d2db0a096828e2b861766`
- Swap tx: `0x0bb0f06500ec082cb98c237de3712aefeeb03ac16d4163471f84cb9b3f3337b2`

## Repo proof files

- `LIVE_PROOF.md`
- `proof/base-mainnet/deployment.json`
- `proof/base-mainnet/token-1-status.json`
- `proof/base-mainnet/token-1-send-native.json`
- `proof/base-mainnet/token-1-swap-uniswap.json`
