import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { Contract, JsonRpcProvider, keccak256 } from "ethers";
import { ReceiptRecord, buildPolicySnapshot, hashIntent, nowIso, projectRoot, readDeployment, writeReceiptRecord } from "./helpers";
import { resolveBankrWallet, submitBankrTransaction, waitForReceipt } from "./bankr";

type ParsedArgs = { network: string; broadcast: boolean };

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
  console.log(`aaigotchi swap-call\n\nEnv:\n  TOKEN_ID=1 ROUTER=0x... TOKEN_IN=0x... AMOUNT_IN=1000000 CALL_DATA=0x... VALUE_WEI=0 RECEIPT_NOTE=...\nUsage:\n  pnpm swap:call\n  pnpm swap:call:broadcast\n`);
}

function resolveHardhatNetworkName(network: string): string {
  if (network === "base-sepolia") return "baseSepolia";
  if (network === "base") return "base";
  throw new Error(`Unsupported network: ${network}`);
}

function resolveRpcUrl(network: string): string {
  if (network === "base-sepolia") return process.env.BASE_SEPOLIA_RPC_URL ?? "https://sepolia.base.org";
  if (network === "base") return process.env.BASE_RPC_URL ?? "https://mainnet.base.org";
  throw new Error(`Unsupported network: ${network}`);
}

function readArtifactAbi(relativePath: string): unknown[] {
  const artifactPath = path.join(projectRoot(), "artifacts", relativePath);
  const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8")) as { abi: unknown[] };
  return artifact.abi;
}

function envOrThrow(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  const networkName = resolveHardhatNetworkName(parsed.network);
  const deployment = readDeployment(networkName);
  const provider = new JsonRpcProvider(resolveRpcUrl(parsed.network));
  const chain = await provider.getNetwork();
  const agencyAbi = readArtifactAbi("contracts/AAIWalletAgency.sol/AAIWalletAgency.json");
  const agency = new Contract(deployment.agency, agencyAbi, provider);

  const tokenId = BigInt(envOrThrow("TOKEN_ID"));
  const router = envOrThrow("ROUTER");
  const tokenIn = envOrThrow("TOKEN_IN");
  const amountIn = BigInt(envOrThrow("AMOUNT_IN"));
  const callData = envOrThrow("CALL_DATA");
  const valueWei = BigInt(process.env.VALUE_WEI ?? "0");
  const note = process.env.RECEIPT_NOTE ?? "";
  const caller = resolveBankrWallet();
  const policy = await agency.policyOf(tokenId);
  const vault = await agency.vaultOf(tokenId);
  const policySnapshot = buildPolicySnapshot(policy);
  const callHash = keccak256(callData as `0x${string}`);

  const preview = {
    action: "swap-call",
    via: "bankr",
    network: networkName,
    chainId: Number(chain.chainId),
    tokenId: tokenId.toString(),
    collection: deployment.collection,
    agency: deployment.agency,
    vault,
    asset: tokenIn,
    target: router,
    amountIn: amountIn.toString(),
    valueWei: valueWei.toString(),
    caller,
    note,
    callHash,
    policy: policySnapshot
  };

  console.log(JSON.stringify(preview, null, 2));
  if (!parsed.broadcast) {
    console.log("Preview only. Re-run with --broadcast to execute through Bankr.");
    return;
  }

  const receiptHash = hashIntent({ ...preview, notedAt: nowIso() });
  const data = agency.interface.encodeFunctionData("swapWithCall", [tokenId, router, tokenIn, amountIn, valueWei, callData, receiptHash]);
  const submission = await submitBankrTransaction({
    to: deployment.agency,
    chainId: Number(chain.chainId),
    data,
    value: 0n,
    description: `aaigotchi swap-call token ${tokenId.toString()} on ${parsed.network}`
  });
  const receipt = await waitForReceipt(provider, submission.transactionHash);
  if (Number(receipt.status) !== 1) {
    throw new Error(`swap-call reverted: ${submission.transactionHash}`);
  }

  const record: ReceiptRecord = {
    schema: "aaigotchi.wallet-agency.receipt.v1",
    receiptHash,
    status: "confirmed",
    action: "swap-call",
    network: networkName,
    chainId: Number(chain.chainId),
    tokenId: tokenId.toString(),
    collection: deployment.collection,
    agency: deployment.agency,
    vault,
    asset: tokenIn,
    target: router,
    amount: amountIn.toString(),
    caller,
    txHash: submission.transactionHash,
    blockNumber: receipt.blockNumber.toString(),
    timestamp: nowIso(),
    note,
    callHash,
    metadata: {
      executionMode: "bankr",
      valueWei: valueWei.toString(),
      calldataBytes: ((callData.length - 2) / 2).toString()
    },
    policy: policySnapshot
  };

  const filePath = writeReceiptRecord(record);
  console.log(JSON.stringify({ executed: true, txHash: submission.transactionHash, receiptFile: filePath }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
