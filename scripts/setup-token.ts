import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { Contract, JsonRpcProvider, ZeroAddress } from "ethers";
import { envOrThrow, projectRoot, readDeployment } from "./helpers";
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
  console.log(`aaigotchi setup token

Usage:
  TOKEN_ID=1 EXECUTOR_ADDRESS=0x... ALLOW_TARGET=0x... NATIVE_LIMIT_WEI=100000000000000000 COOLDOWN_SECONDS=3600 pnpm setup:token
  TOKEN_ID=1 EXECUTOR_ADDRESS=0x... ALLOW_TARGET=0x... NATIVE_LIMIT_WEI=100000000000000000 COOLDOWN_SECONDS=3600 pnpm setup:token:broadcast
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

async function submitAndWait(
  provider: JsonRpcProvider,
  chainId: number,
  to: string,
  data: string,
  description: string
): Promise<{ txHash: string; blockNumber: string }> {
  const submission = await submitBankrTransaction({
    to,
    chainId,
    data,
    value: 0n,
    description
  });
  const receipt = await waitForReceipt(provider, submission.transactionHash);
  if (Number(receipt.status) !== 1) {
    throw new Error(`Transaction reverted: ${submission.transactionHash}`);
  }
  return {
    txHash: submission.transactionHash,
    blockNumber: receipt.blockNumber.toString()
  };
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  const tokenId = BigInt(envOrThrow("TOKEN_ID"));
  const bankrWallet = resolveBankrWallet();
  const deployment = readDeployment(resolveHardhatNetworkName(parsed.network));
  const provider = new JsonRpcProvider(resolveRpcUrl(parsed.network));
  const chain = await provider.getNetwork();
  const agencyAbi = readArtifactAbi("contracts/AAIWalletAgency.sol/AAIWalletAgency.json");
  const agency = new Contract(deployment.agency, agencyAbi, provider);

  const executor = process.env.EXECUTOR_ADDRESS ?? process.env.DEFAULT_EXECUTOR_ADDRESS ?? ZeroAddress;
  const allowTarget = process.env.ALLOW_TARGET;
  const sendEnabled = process.env.SEND_ENABLED !== "false";
  const swapEnabled = process.env.SWAP_ENABLED === "true";
  const nativeLimitWei = BigInt(process.env.NATIVE_LIMIT_WEI ?? "0");
  const erc20Limit = BigInt(process.env.ERC20_LIMIT ?? "0");
  const cooldownSeconds = Number(process.env.COOLDOWN_SECONDS ?? "0");

  const currentVault = await agency.vaultOf(tokenId);
  const needsVault = currentVault === ZeroAddress;

  console.log(JSON.stringify({
    mode: parsed.broadcast ? "broadcast" : "preview",
    network: parsed.network,
    chainId: Number(chain.chainId),
    caller: bankrWallet,
    tokenId: tokenId.toString(),
    agency: deployment.agency,
    currentVault,
    needsVault,
    executor,
    allowTarget: allowTarget ?? null,
    sendEnabled,
    swapEnabled,
    nativeLimitWei: nativeLimitWei.toString(),
    erc20Limit: erc20Limit.toString(),
    cooldownSeconds
  }, null, 2));

  if (!parsed.broadcast) {
    console.log("Preview only. Re-run with --broadcast to configure through Bankr.");
    return;
  }

  const txs: Array<{ step: string; txHash: string; blockNumber: string }> = [];

  if (needsVault) {
    const vaultData = agency.interface.encodeFunctionData("createVault", [tokenId]);
    txs.push({
      step: "createVault",
      ...(await submitAndWait(
        provider,
        Number(chain.chainId),
        deployment.agency,
        vaultData,
        `aaigotchi create vault for token ${tokenId.toString()} on ${parsed.network}`
      ))
    });
  }

  const policyData = agency.interface.encodeFunctionData("setPolicy", [
    tokenId,
    sendEnabled,
    swapEnabled,
    nativeLimitWei,
    erc20Limit,
    cooldownSeconds,
    executor
  ]);
  txs.push({
    step: "setPolicy",
    ...(await submitAndWait(
      provider,
      Number(chain.chainId),
      deployment.agency,
      policyData,
      `aaigotchi set policy for token ${tokenId.toString()} on ${parsed.network}`
    ))
  });

  if (allowTarget) {
    const allowData = agency.interface.encodeFunctionData("allowTarget", [tokenId, allowTarget, true]);
    txs.push({
      step: "allowTarget",
      ...(await submitAndWait(
        provider,
        Number(chain.chainId),
        deployment.agency,
        allowData,
        `aaigotchi allow target for token ${tokenId.toString()} on ${parsed.network}`
      ))
    });
  }

  const policy = await agency.policyOf(tokenId);
  const vault = await agency.vaultOf(tokenId);

  console.log(JSON.stringify({
    configured: true,
    tokenId: tokenId.toString(),
    vault,
    executor: policy.executor,
    sendEnabled: policy.sendEnabled,
    swapEnabled: policy.swapEnabled,
    nativeLimitWei: policy.nativeLimitWei.toString(),
    erc20Limit: policy.erc20Limit.toString(),
    cooldownSeconds: policy.cooldownSeconds.toString(),
    txs
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
