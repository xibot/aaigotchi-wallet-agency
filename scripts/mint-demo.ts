import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { Contract, JsonRpcProvider } from "ethers";
import { nowIso, projectRoot, readDeployment } from "./helpers";
import { resolveBankrWallet, submitBankrTransaction, waitForReceipt } from "./bankr";

type ParsedArgs = {
  network: string;
  broadcast: boolean;
};

function parseArgs(argv: string[]): ParsedArgs {
  let network = "base";
  let broadcast = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--network") {
      network = argv[index + 1] ?? network;
      index += 1;
      continue;
    }
    if (arg === "--broadcast") {
      broadcast = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return { network, broadcast };
}

function printHelp(): void {
  console.log(`aaigotchi mint demo

Usage:
  pnpm mint:demo
  pnpm mint:demo:broadcast

Env:
  TOKEN_TO=0x...
  TOKEN_URI=ipfs://...
`);
}

function resolveHardhatNetworkName(network: string): string {
  if (network === "base-sepolia") {
    return "baseSepolia";
  }
  if (network === "base") {
    return "base";
  }
  throw new Error(`Unsupported network: ${network}`);
}

function resolveRpcUrl(network: string): string {
  if (network === "base-sepolia") {
    return process.env.BASE_SEPOLIA_RPC_URL ?? "https://sepolia.base.org";
  }
  if (network === "base") {
    return process.env.BASE_RPC_URL ?? "https://mainnet.base.org";
  }
  throw new Error(`Unsupported network: ${network}`);
}

function readArtifactAbi(relativePath: string): unknown[] {
  const artifactPath = path.join(projectRoot(), "artifacts", relativePath);
  const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8")) as { abi: unknown[] };
  return artifact.abi;
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  const bankrWallet = resolveBankrWallet();
  const deployment = readDeployment(resolveHardhatNetworkName(parsed.network));
  const provider = new JsonRpcProvider(resolveRpcUrl(parsed.network));
  const chain = await provider.getNetwork();
  const collectionAbi = readArtifactAbi("contracts/AAIGenNFT.sol/AAIGenNFT.json");
  const collection = new Contract(deployment.collection, collectionAbi, provider);

  const mintTo = process.env.TOKEN_TO ?? bankrWallet;
  const tokenUri = process.env.TOKEN_URI ?? `ipfs://aaigotchi/demo/${Date.now()}`;
  const predictedTokenId = (await collection.nextTokenId()) + 1n;

  console.log(JSON.stringify({
    mode: parsed.broadcast ? "broadcast" : "preview",
    network: parsed.network,
    chainId: Number(chain.chainId),
    caller: bankrWallet,
    collection: deployment.collection,
    mintTo,
    predictedTokenId: predictedTokenId.toString(),
    tokenUri
  }, null, 2));

  if (!parsed.broadcast) {
    console.log("Preview only. Re-run with --broadcast to mint through Bankr.");
    return;
  }

  const data = collection.interface.encodeFunctionData("mint", [mintTo, tokenUri]);
  const submission = await submitBankrTransaction({
    to: deployment.collection,
    chainId: Number(chain.chainId),
    data,
    value: 0n,
    description: `aaigotchi mint token ${predictedTokenId.toString()} on ${parsed.network}`
  });
  const receipt = await waitForReceipt(provider, submission.transactionHash);
  if (Number(receipt.status) !== 1) {
    throw new Error(`Mint reverted: ${submission.transactionHash}`);
  }

  console.log(JSON.stringify({
    minted: true,
    tokenId: predictedTokenId.toString(),
    owner: mintTo,
    tokenUri,
    txHash: submission.transactionHash,
    blockNumber: receipt.blockNumber.toString(),
    timestamp: nowIso()
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
