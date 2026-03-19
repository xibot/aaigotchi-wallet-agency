# aaigotchi Conversation Log

This log summarizes the human-agent collaboration that produced the final aaigotchi Synthesis MVP.

## Starting point
- We began by exploring a SuperRare-centered direction and tested whether aaigotchi could create its own SR identity and mint autonomously.
- The user pushed for a Bankr-native flow and emphasized that the final hackathon MVP should feel truly agentic, with the Bankr wallet as the live operator.

## Key pivots
- We discovered that SuperRare mainnet and the wallet-agency MVP on Base were different product directions.
- We decided to keep the hackathon submission focused on one clear idea: NFTs with controlled smart-wallet agency on Base.
- We explicitly separated the future SuperRare cultural/art build from the main hackathon MVP so the submission would stay coherent.

## MVP definition
- The user and agent locked the MVP around: one NFT collection, one vault per NFT, permission rules, 1-2 actions, and auditable receipts.
- We chose sends and swaps as the first actions.
- We aligned the project with Open Track, Agents With Receipts, Uniswap, and Let the Agent Cook.

## Build decisions
- The user required Bankr to be the real operator path. We refactored the live flow so deploy, mint, setup, send, and swap all worked through Bankr-backed execution rather than a raw-key-only demo path.
- We moved from a dry internal collection name to the final public-facing collection identity: AAi Agentic Collectibles (AAIC).
- The user provided the SVG asset, and we converted the NFT metadata into a fully onchain token URI rather than using IPFS.

## Engineering milestones
- Built the wallet-agency contracts and terminal flow on the VM.
- Deployed the final AAIC collection and agency contracts on Base mainnet.
- Minted token #1 with fully onchain SVG metadata.
- Created the per-token vault and policy configuration.
- Proved a constrained native send.
- Added Uniswap Trading API support and proved a live swap through the NFT vault.
- Fixed receipt scoping so final receipts were collection-aware.

## Security and operations
- Rotated exposed Bankr keys and verified the new Agent API and LLM API paths.
- Disabled heartbeat-driven hidden LLM usage so aaigotchi would behave predictably and keep background costs down.
- Kept the live proof and public repo free of active secrets.

## Submission packaging
- We determined the aaigotchi GitHub account was not publicly reachable when logged out, so we used the public xibot GitHub account as the canonical submission repo and kept GitLab as the aaigotchi mirror.
- We prepared a clean public repo with proof snapshots, README, LIVE_PROOF, submission draft, and Moltbook draft.
- We recorded and uploaded a demo video as a GitHub release asset.
- We recovered the real aaigotchi Moltbook account, posted the project announcement, and linked it back into the submission materials.

## Human contributions
- Set the project direction and kept the scope honest.
- Repeatedly clarified that Bankr-native execution was a requirement for the MVP.
- Chose the final collection naming and supplied the visual asset.
- Helped recover access to external accounts and API keys when needed.
- Recorded the final demo assets used for submission.

## Agent contributions
- Implemented and verified the onchain MVP flow end to end on the VM.
- Managed the deployment, minting, vault setup, send proof, and swap proof.
- Prepared the public repos, release asset, Moltbook post, and submission draft.
- Mapped the build to the most relevant Synthesis tracks and assembled the final submission package.

## Final state
The final submission is a live Base mainnet MVP showing that an NFT can act as a permissioned wallet-agent: the collectible exists onchain, the vault exists onchain, the policy is enforced onchain, and the send/swap actions are backed by auditable receipts and public proof.
