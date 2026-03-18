import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { Contract, JsonRpcProvider, ZeroAddress, keccak256 } from "ethers";
import { ReceiptRecord, buildPolicySnapshot, hashIntent, nowIso, projectRoot, readDeployment, writeReceiptRecord } from "./helpers";
import { resolveBankrWallet, submitBankrTransaction, waitForReceipt } from "./bankr";
import { buildUniswapSwapPlan } from "./uniswap";

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
  console.log(`aaigotchi swap-uniswap\n\nEnv:\n  TOKEN_ID=1 TOKEN_OUT=0x... AMOUNT_IN_WEI=10000000000000 TOKEN_IN=0x0000000000000000000000000000000000000000 SLIPPAGE_TOLERANCE=0.5 RECEIPT_NOTE=...\nUsage:\n  pnpm swap:uniswap\n  pnpm swap:uniswap:broadcast\n\nNotes:\n  - Defaults to native ETH input on Base\n  - Requires UNISWAP_API_KEY in the environment\n  - Current NFT vault flow only supports signature-free routes\n`);
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
  const tokenIn = process.env.TOKEN_IN ?? ZeroAddress;
  const tokenOut = envOrThrow("TOKEN_OUT");
  const amountIn = BigInt(envOrThrow("AMOUNT_IN_WEI"));
  const slippageTolerance = Number(process.env.SLIPPAGE_TOLERANCE ?? "0.5");
  const note = process.env.RECEIPT_NOTE ?? "";
  const urgencyRaw = String(process.env.UNISWAP_URGENCY ?? "normal").toLowerCase();
  const urgency = urgencyRaw === "fast" || urgencyRaw === "urgent" ? urgencyRaw : "normal";
  const caller = resolveBankrWallet();
  const policy = await agency.policyOf(tokenId);
  const vault = await agency.vaultOf(tokenId);
  const policySnapshot = buildPolicySnapshot(policy);

  const plan = await buildUniswapSwapPlan({
    chainId: Number(chain.chainId),
    swapper: vault,
    tokenIn,
    tokenOut,
    amount: amountIn,
    slippageTolerance,
    urgency
  });
  const callHash = keccak256(plan.data);

  const preview = {
    action: "swap-uniswap",
    via: "bankr",
    network: networkName,
    chainId: Number(chain.chainId),
    tokenId: tokenId.toString(),
    collection: deployment.collection,
    agency: deployment.agency,
    vault,
    router: plan.router,
    tokenIn: plan.tokenIn,
    tokenOut: plan.tokenOut,
    amountIn: plan.amountIn.toString(),
    valueWei: plan.valueWei.toString(),
    expectedAmountOut: plan.expectedAmountOut,
    routing: plan.routing,
    requestId: plan.requestId,
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
  const data = agency.interface.encodeFunctionData("swapWithCall", [tokenId, plan.router, plan.tokenIn, plan.amountIn, plan.valueWei, plan.data, receiptHash]);
  const submission = await submitBankrTransaction({
    to: deployment.agency,
    chainId: Number(chain.chainId),
    data,
    value: 0n,
    description: `aaigotchi swap-uniswap token ${tokenId.toString()} on ${parsed.network}`
  });
  const receipt = await waitForReceipt(provider, submission.transactionHash);
  if (Number(receipt.status) !== 1) {
    throw new Error(`swap-uniswap reverted: ${submission.transactionHash}`);
  }

  const record: ReceiptRecord = {
    schema: "aaigotchi.wallet-agency.receipt.v1",
    receiptHash,
    status: "confirmed",
    action: "swap-uniswap",
    network: networkName,
    chainId: Number(chain.chainId),
    tokenId: tokenId.toString(),
    collection: deployment.collection,
    agency: deployment.agency,
    vault,
    asset: plan.tokenIn,
    target: plan.router,
    amount: plan.amountIn.toString(),
    caller,
    txHash: submission.transactionHash,
    blockNumber: receipt.blockNumber.toString(),
    timestamp: nowIso(),
    note,
    callHash,
    metadata: {
      executionMode: "bankr",
      swapProvider: "uniswap-trading-api",
      routing: plan.routing,
      requestId: plan.requestId,
      valueWei: plan.valueWei.toString(),
      tokenOut: plan.tokenOut,
      expectedAmountOut: plan.expectedAmountOut,
      calldataBytes: ((plan.data.length - 2) / 2).toString()
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
