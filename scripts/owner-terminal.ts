import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { Contract, JsonRpcProvider, Wallet, ZeroAddress, formatEther, keccak256 } from "ethers";
import {
  ReceiptRecord,
  buildPolicySnapshot,
  hashIntent,
  nowIso,
  projectRoot,
  readDeployment,
  readReceipts,
  writeReceiptRecord
} from "./helpers";
import { resolveBankrWallet, submitBankrTransaction, waitForReceipt } from "./bankr";

type ParsedArgs = {
  network: string;
  command: string;
  options: Record<string, string | boolean>;
};

type ExecutionMode = "bankr" | "local";

type Context = Awaited<ReturnType<typeof buildContext>>;

function parseArgs(argv: string[]): ParsedArgs {
  const options: Record<string, string | boolean> = {};
  const positionals: string[] = [];
  let network = "base";

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--network") {
      network = argv[index + 1] ?? network;
      index += 1;
      continue;
    }

    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) {
        options[key] = true;
      } else {
        options[key] = next;
        index += 1;
      }
      continue;
    }

    positionals.push(arg);
  }

  return {
    network,
    command: positionals[0] ?? "help",
    options
  };
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

function requireOption(options: Record<string, string | boolean>, name: string): string {
  const value = options[name];
  if (!value || typeof value !== "string") {
    throw new Error(`Missing required option: --${name}`);
  }
  return value;
}

function isConfirmed(options: Record<string, string | boolean>): boolean {
  return String(options.confirm ?? "").toLowerCase() === "yes";
}

function resolveExecutionMode(options: Record<string, string | boolean>): ExecutionMode {
  const value = String(options.via ?? "bankr").toLowerCase();
  if (value === "bankr" || value === "local") {
    return value;
  }
  throw new Error(`Unsupported execution mode: ${value}. Use --via bankr or --via local.`);
}

function resolveLocalSigner(provider: JsonRpcProvider): Wallet {
  const privateKey = process.env.DEPLOYER_PRIVATE_KEY ?? "";
  if (!privateKey) {
    throw new Error("Missing DEPLOYER_PRIVATE_KEY in .env for --via local execution");
  }
  return new Wallet(privateKey, provider);
}

async function buildContext(network: string) {
  const hardhatNetwork = resolveHardhatNetworkName(network);
  const deployment = readDeployment(hardhatNetwork);
  const provider = new JsonRpcProvider(resolveRpcUrl(network));
  const chain = await provider.getNetwork();
  const agencyAbi = readArtifactAbi("contracts/AAIWalletAgency.sol/AAIWalletAgency.json");
  const collectionAbi = readArtifactAbi("contracts/AAIGenNFT.sol/AAIGenNFT.json");
  const agency = new Contract(deployment.agency, agencyAbi, provider);
  const collection = new Contract(deployment.collection, collectionAbi, provider);

  return { provider, chain, deployment, agency, collection };
}

async function executeAgencyWrite(
  context: Context,
  mode: ExecutionMode,
  functionName: string,
  args: readonly unknown[],
  description: string
): Promise<{ caller: string; txHash: string; blockNumber: string }> {
  if (mode === "bankr") {
    const caller = resolveBankrWallet();
    const data = context.agency.interface.encodeFunctionData(functionName, args);
    const submission = await submitBankrTransaction({
      to: context.deployment.agency,
      chainId: Number(context.chain.chainId),
      data,
      value: 0n,
      description
    });
    const receipt = await waitForReceipt(context.provider, submission.transactionHash);
    if (Number(receipt.status) !== 1) {
      throw new Error(`Transaction reverted: ${submission.transactionHash}`);
    }
    return {
      caller,
      txHash: submission.transactionHash,
      blockNumber: receipt.blockNumber.toString()
    };
  }

  const signer = resolveLocalSigner(context.provider);
  const agencyWithSigner = context.agency.connect(signer) as Contract & Record<string, (...callArgs: readonly unknown[]) => Promise<{ hash: string; wait: () => Promise<{ blockNumber: bigint }> }>>;
  const tx = await agencyWithSigner[functionName](...args);
  const receipt = await tx.wait();
  return {
    caller: signer.address,
    txHash: tx.hash,
    blockNumber: receipt.blockNumber.toString()
  };
}

async function printStatus(network: string, tokenId: bigint): Promise<void> {
  const { provider, chain, deployment, agency, collection } = await buildContext(network);
  const vault = (await agency.vaultOf(tokenId)) as string;
  const policy = await agency.policyOf(tokenId);
  const owner = (await collection.ownerOf(tokenId)) as string;
  const tokenUri = (await collection.tokenURI(tokenId)) as string;
  const receipts = readReceipts({ tokenId: tokenId.toString(), collection: deployment.collection });
  const balanceWei = vault === ZeroAddress ? 0n : await provider.getBalance(vault);

  console.log(JSON.stringify({
    network,
    chainId: Number(chain.chainId),
    tokenId: tokenId.toString(),
    collection: deployment.collection,
    agency: deployment.agency,
    deploymentMode: deployment.deploymentMode ?? "local-direct",
    owner,
    tokenUri,
    vault,
    vaultNativeBalanceWei: balanceWei.toString(),
    vaultNativeBalanceEth: formatEther(balanceWei),
    policy: buildPolicySnapshot(policy),
    receiptCount: receipts.length,
    latestReceiptAt: receipts[0]?.timestamp ?? null
  }, null, 2));
}

function printReceipts(network: string, tokenId?: bigint): void {
  const deployment = readDeployment(resolveHardhatNetworkName(network));
  const receipts = readReceipts({
    tokenId: tokenId ? tokenId.toString() : undefined,
    collection: deployment.collection
  });
  console.log(JSON.stringify(receipts, null, 2));
}

async function runSendNative(network: string, tokenId: bigint, options: Record<string, string | boolean>): Promise<void> {
  const mode = resolveExecutionMode(options);
  const target = requireOption(options, "to");
  const amountWei = BigInt(requireOption(options, "amount-wei"));
  const note = typeof options.note === "string" ? options.note : "";
  const context = await buildContext(network);
  const vault = (await context.agency.vaultOf(tokenId)) as string;
  const policy = await context.agency.policyOf(tokenId);
  const policySnapshot = buildPolicySnapshot(policy);
  const previewCaller = mode === "bankr" ? resolveBankrWallet() : resolveLocalSigner(context.provider).address;

  const preview = {
    action: "send-native",
    via: mode,
    network,
    tokenId: tokenId.toString(),
    caller: previewCaller,
    vault,
    target,
    amountWei: amountWei.toString(),
    note,
    policy: policySnapshot
  };

  console.log(JSON.stringify(preview, null, 2));
  if (!isConfirmed(options)) {
    console.log("Preview only. Re-run with --confirm yes to execute.");
    return;
  }

  const intent = { ...preview, chainId: Number(context.chain.chainId), collection: context.deployment.collection, agency: context.deployment.agency, notedAt: nowIso() };
  const receiptHash = hashIntent(intent);
  const execution = await executeAgencyWrite(
    context,
    mode,
    "sendNative",
    [tokenId, target, amountWei, receiptHash],
    `aaigotchi send-native token ${tokenId.toString()} on ${network}`
  );

  const record: ReceiptRecord = {
    schema: "aaigotchi.wallet-agency.receipt.v1",
    receiptHash,
    status: "confirmed",
    action: "send-native",
    network: resolveHardhatNetworkName(network),
    chainId: Number(context.chain.chainId),
    tokenId: tokenId.toString(),
    collection: context.deployment.collection,
    agency: context.deployment.agency,
    vault,
    asset: "native",
    target,
    amount: amountWei.toString(),
    caller: execution.caller,
    txHash: execution.txHash,
    blockNumber: execution.blockNumber,
    timestamp: nowIso(),
    note,
    callHash: null,
    metadata: {
      executionMode: mode
    },
    policy: policySnapshot
  };

  const filePath = writeReceiptRecord(record);
  console.log(JSON.stringify({ executed: true, via: mode, txHash: execution.txHash, receiptFile: filePath }, null, 2));
}

async function runSendErc20(network: string, tokenId: bigint, options: Record<string, string | boolean>): Promise<void> {
  const mode = resolveExecutionMode(options);
  const asset = requireOption(options, "asset");
  const target = requireOption(options, "to");
  const amount = BigInt(requireOption(options, "amount"));
  const note = typeof options.note === "string" ? options.note : "";
  const context = await buildContext(network);
  const vault = (await context.agency.vaultOf(tokenId)) as string;
  const policy = await context.agency.policyOf(tokenId);
  const policySnapshot = buildPolicySnapshot(policy);
  const previewCaller = mode === "bankr" ? resolveBankrWallet() : resolveLocalSigner(context.provider).address;

  const preview = {
    action: "send-erc20",
    via: mode,
    network,
    tokenId: tokenId.toString(),
    caller: previewCaller,
    vault,
    asset,
    target,
    amount: amount.toString(),
    note,
    policy: policySnapshot
  };

  console.log(JSON.stringify(preview, null, 2));
  if (!isConfirmed(options)) {
    console.log("Preview only. Re-run with --confirm yes to execute.");
    return;
  }

  const intent = { ...preview, chainId: Number(context.chain.chainId), collection: context.deployment.collection, agency: context.deployment.agency, notedAt: nowIso() };
  const receiptHash = hashIntent(intent);
  const execution = await executeAgencyWrite(
    context,
    mode,
    "sendErc20",
    [tokenId, asset, target, amount, receiptHash],
    `aaigotchi send-erc20 token ${tokenId.toString()} on ${network}`
  );

  const record: ReceiptRecord = {
    schema: "aaigotchi.wallet-agency.receipt.v1",
    receiptHash,
    status: "confirmed",
    action: "send-erc20",
    network: resolveHardhatNetworkName(network),
    chainId: Number(context.chain.chainId),
    tokenId: tokenId.toString(),
    collection: context.deployment.collection,
    agency: context.deployment.agency,
    vault,
    asset,
    target,
    amount: amount.toString(),
    caller: execution.caller,
    txHash: execution.txHash,
    blockNumber: execution.blockNumber,
    timestamp: nowIso(),
    note,
    callHash: null,
    metadata: {
      executionMode: mode
    },
    policy: policySnapshot
  };

  const filePath = writeReceiptRecord(record);
  console.log(JSON.stringify({ executed: true, via: mode, txHash: execution.txHash, receiptFile: filePath }, null, 2));
}

async function runSwapCall(network: string, tokenId: bigint, options: Record<string, string | boolean>): Promise<void> {
  const mode = resolveExecutionMode(options);
  const router = requireOption(options, "router");
  const tokenIn = requireOption(options, "token-in");
  const amountIn = BigInt(requireOption(options, "amount-in"));
  const callData = requireOption(options, "data");
  const valueWei = BigInt(typeof options["value-wei"] === "string" ? options["value-wei"] : "0");
  const note = typeof options.note === "string" ? options.note : "";
  const context = await buildContext(network);
  const vault = (await context.agency.vaultOf(tokenId)) as string;
  const policy = await context.agency.policyOf(tokenId);
  const policySnapshot = buildPolicySnapshot(policy);
  const previewCaller = mode === "bankr" ? resolveBankrWallet() : resolveLocalSigner(context.provider).address;
  const callHash = keccak256(callData as `0x${string}`);

  const preview = {
    action: "swap-call",
    via: mode,
    network,
    tokenId: tokenId.toString(),
    caller: previewCaller,
    vault,
    router,
    tokenIn,
    amountIn: amountIn.toString(),
    valueWei: valueWei.toString(),
    callHash,
    note,
    policy: policySnapshot
  };

  console.log(JSON.stringify(preview, null, 2));
  if (!isConfirmed(options)) {
    console.log("Preview only. Re-run with --confirm yes to execute.");
    return;
  }

  const intent = { ...preview, chainId: Number(context.chain.chainId), collection: context.deployment.collection, agency: context.deployment.agency, notedAt: nowIso() };
  const receiptHash = hashIntent(intent);
  const execution = await executeAgencyWrite(
    context,
    mode,
    "swapWithCall",
    [tokenId, router, tokenIn, amountIn, valueWei, callData, receiptHash],
    `aaigotchi swap-call token ${tokenId.toString()} on ${network}`
  );

  const record: ReceiptRecord = {
    schema: "aaigotchi.wallet-agency.receipt.v1",
    receiptHash,
    status: "confirmed",
    action: "swap-call",
    network: resolveHardhatNetworkName(network),
    chainId: Number(context.chain.chainId),
    tokenId: tokenId.toString(),
    collection: context.deployment.collection,
    agency: context.deployment.agency,
    vault,
    asset: tokenIn,
    target: router,
    amount: amountIn.toString(),
    caller: execution.caller,
    txHash: execution.txHash,
    blockNumber: execution.blockNumber,
    timestamp: nowIso(),
    note,
    callHash,
    metadata: {
      executionMode: mode,
      valueWei: valueWei.toString(),
      calldataBytes: ((callData.length - 2) / 2).toString()
    },
    policy: policySnapshot
  };

  const filePath = writeReceiptRecord(record);
  console.log(JSON.stringify({ executed: true, via: mode, txHash: execution.txHash, receiptFile: filePath }, null, 2));
}

function printHelp(): void {
  console.log(`aaigotchi owner terminal

Commands:
  status --network base --token-id 1
  receipts [--token-id 1]
  send-native --network base --token-id 1 --to 0x... --amount-wei 1000000000000000 [--note "..."] [--via bankr|local] [--confirm yes]
  send-erc20 --network base --token-id 1 --asset 0x... --to 0x... --amount 1000000 [--note "..."] [--via bankr|local] [--confirm yes]
  swap-call --network base --token-id 1 --router 0x... --token-in 0x... --amount-in 1000000 --data 0x... [--value-wei 0] [--note "..."] [--via bankr|local] [--confirm yes]

Action commands print a preview first. Bankr is the default live executor. Add --confirm yes to actually execute.
`);
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  const tokenId = parsed.options["token-id"] ? BigInt(String(parsed.options["token-id"])) : undefined;

  switch (parsed.command) {
    case "status":
      if (!tokenId) {
        throw new Error("status requires --token-id");
      }
      await printStatus(parsed.network, tokenId);
      return;
    case "receipts":
      printReceipts(parsed.network, tokenId);
      return;
    case "send-native":
      if (!tokenId) {
        throw new Error("send-native requires --token-id");
      }
      await runSendNative(parsed.network, tokenId, parsed.options);
      return;
    case "send-erc20":
      if (!tokenId) {
        throw new Error("send-erc20 requires --token-id");
      }
      await runSendErc20(parsed.network, tokenId, parsed.options);
      return;
    case "swap-call":
      if (!tokenId) {
        throw new Error("swap-call requires --token-id");
      }
      await runSwapCall(parsed.network, tokenId, parsed.options);
      return;
    case "help":
    default:
      printHelp();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
