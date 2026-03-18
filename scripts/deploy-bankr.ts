import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { AbiCoder, JsonRpcProvider, getCreate2Address, keccak256, toUtf8Bytes } from "ethers";
import { deploymentFile, nowIso, projectRoot, writeJson } from "./helpers";
import { resolveBankrWallet, submitBankrTransaction, waitForReceipt } from "./bankr";

type ParsedArgs = {
  network: string;
  broadcast: boolean;
  saltNamespace?: string;
};

type ChainConfig = {
  label: string;
  hardhatNetwork: string;
  chainId: number;
  rpcUrl: string;
  explorerTxBase: string;
  explorerAddressBase: string;
  deployerContract: string;
};

type Artifact = {
  abi: Array<{ type?: string; inputs?: Array<{ type: string }> }>;
  bytecode: string;
};

type DeploymentStep = {
  label: string;
  address: string;
  txHash: string;
  salt: string;
  blockNumber: string;
  reused?: boolean;
};

const DEFAULT_DEPLOYER = process.env.BANKR_DEPLOYER_ADDRESS ?? "0x4e59b44847b379578588920cA78FbF26c0B4956C";

function parseArgs(argv: string[]): ParsedArgs {
  let network = "base";
  let broadcast = false;
  let saltNamespace: string | undefined;

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
    if (arg === "--salt-namespace") {
      saltNamespace = argv[index + 1] ?? saltNamespace;
      index += 1;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return { network, broadcast, saltNamespace };
}

function printHelp(): void {
  console.log(`aaigotchi Bankr deploy

Usage:
  pnpm deploy:base-sepolia
  pnpm deploy:base-sepolia:broadcast
  pnpm deploy:base
  pnpm deploy:base:broadcast

Flags:
  --network base-sepolia|base
  --broadcast
  --salt-namespace <text>
`);
}

function resolveChain(network: string): ChainConfig {
  if (network === "base-sepolia") {
    return {
      label: network,
      hardhatNetwork: "baseSepolia",
      chainId: 84532,
      rpcUrl: process.env.BASE_SEPOLIA_RPC_URL ?? "https://sepolia.base.org",
      explorerTxBase: "https://sepolia.basescan.org/tx/",
      explorerAddressBase: "https://sepolia.basescan.org/address/",
      deployerContract: DEFAULT_DEPLOYER
    };
  }

  if (network === "base") {
    return {
      label: network,
      hardhatNetwork: "base",
      chainId: 8453,
      rpcUrl: process.env.BASE_RPC_URL ?? "https://mainnet.base.org",
      explorerTxBase: "https://basescan.org/tx/",
      explorerAddressBase: "https://basescan.org/address/",
      deployerContract: DEFAULT_DEPLOYER
    };
  }

  throw new Error(`Unsupported network: ${network}`);
}

function readArtifact(relativePath: string): Artifact {
  const filePath = path.join(projectRoot(), "artifacts", relativePath);
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as Artifact;
}

function buildInitCode(relativePath: string, constructorArgs: readonly unknown[]): string {
  const artifact = readArtifact(relativePath);
  const constructorAbi = artifact.abi.find((item) => item.type === "constructor");
  const abiCoder = AbiCoder.defaultAbiCoder();
  const encodedArgs = constructorAbi?.inputs?.length
    ? abiCoder.encode(constructorAbi.inputs.map((input) => input.type), constructorArgs)
    : "0x";

  return `${artifact.bytecode}${encodedArgs.slice(2)}`;
}

function deriveSalt(namespace: string, label: string): string {
  return keccak256(toUtf8Bytes(`${namespace}:${label}`));
}

async function waitForCode(
  provider: JsonRpcProvider,
  address: string,
  timeoutMs = 30_000,
  pollMs = 2_000
): Promise<void> {
  const start = Date.now();
  while (true) {
    const code = await provider.getCode(address);
    if (code !== "0x") {
      return;
    }

    if (Date.now() - start >= timeoutMs) {
      throw new Error(`Timed out waiting for deployed code at ${address}`);
    }

    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}

async function deployWithBankr(
  provider: JsonRpcProvider,
  chain: ChainConfig,
  namespace: string,
  label: string,
  initCode: string,
  description: string
): Promise<DeploymentStep> {
  const salt = deriveSalt(namespace, label);
  const address = getCreate2Address(chain.deployerContract, salt, keccak256(initCode));
  const existingCode = await provider.getCode(address);
  if (existingCode !== "0x") {
    return {
      label,
      address,
      txHash: "",
      salt,
      blockNumber: "0",
      reused: true
    };
  }

  const payload = `0x${salt.slice(2)}${initCode.slice(2)}`;
  const submission = await submitBankrTransaction({
    to: chain.deployerContract,
    chainId: chain.chainId,
    data: payload,
    value: 0n,
    description
  });

  const receipt = await waitForReceipt(provider, submission.transactionHash);
  if (Number(receipt.status) !== 1) {
    throw new Error(`${label} deployment reverted: ${submission.transactionHash}`);
  }

  await waitForCode(provider, address);

  return {
    label,
    address,
    txHash: submission.transactionHash,
    salt,
    blockNumber: receipt.blockNumber.toString()
  };
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  const chain = resolveChain(parsed.network);
  const provider = new JsonRpcProvider(chain.rpcUrl);
  const bankrWallet = resolveBankrWallet();
  const collectionName = process.env.COLLECTION_NAME ?? process.env.AAI_COLLECTION_NAME ?? "AAi Agentic Collectibles";
  const collectionSymbol = process.env.COLLECTION_SYMBOL ?? process.env.AAI_COLLECTION_SYMBOL ?? "AAIC";
  const saltNamespace = parsed.saltNamespace ?? process.env.DEPLOYMENT_SALT_NAMESPACE ?? `aaigotchi-wallet-agency:${chain.label}:${Date.now()}`;

  const collectionInitCode = buildInitCode("contracts/AAIGenNFT.sol/AAIGenNFT.json", [
    collectionName,
    collectionSymbol,
    bankrWallet
  ]);
  const collectionSalt = deriveSalt(saltNamespace, "collection");
  const collectionAddress = getCreate2Address(chain.deployerContract, collectionSalt, keccak256(collectionInitCode));

  const agencyInitCode = buildInitCode("contracts/AAIWalletAgency.sol/AAIWalletAgency.json", [
    collectionAddress,
    bankrWallet
  ]);
  const agencySalt = deriveSalt(saltNamespace, "agency");
  const agencyAddress = getCreate2Address(chain.deployerContract, agencySalt, keccak256(agencyInitCode));

  console.log(JSON.stringify({
    mode: parsed.broadcast ? "broadcast" : "preview",
    network: chain.label,
    chainId: chain.chainId,
    bankrWallet,
    deployerContract: chain.deployerContract,
    saltNamespace,
    collection: {
      name: collectionName,
      symbol: collectionSymbol,
      predictedAddress: collectionAddress,
      explorer: `${chain.explorerAddressBase}${collectionAddress}`
    },
    agency: {
      predictedAddress: agencyAddress,
      explorer: `${chain.explorerAddressBase}${agencyAddress}`
    }
  }, null, 2));

  if (!parsed.broadcast) {
    console.log("Preview only. Re-run with --broadcast to deploy through Bankr.");
    return;
  }

  const collectionStep = await deployWithBankr(
    provider,
    chain,
    saltNamespace,
    "collection",
    collectionInitCode,
    `aaigotchi wallet-agency collection deploy on ${chain.label}`
  );

  const agencyStep = await deployWithBankr(
    provider,
    chain,
    saltNamespace,
    "agency",
    agencyInitCode,
    `aaigotchi wallet-agency agency deploy on ${chain.label}`
  );

  const record = {
    project: "aaigotchi-wallet-agency",
    network: chain.hardhatNetwork,
    chainId: chain.chainId,
    deployer: bankrWallet,
    collection: collectionStep.address,
    agency: agencyStep.address,
    deployedAt: nowIso(),
    deploymentMode: "bankr-create2",
    deployerContract: chain.deployerContract,
    saltNamespace,
    collectionSalt: collectionStep.salt,
    agencySalt: agencyStep.salt,
    collectionTxHash: collectionStep.txHash,
    agencyTxHash: agencyStep.txHash
  };

  const filePath = deploymentFile(chain.hardhatNetwork);
  writeJson(filePath, record);

  console.log(JSON.stringify({
    deployed: true,
    deploymentFile: filePath,
    collection: {
      address: collectionStep.address,
      txHash: collectionStep.txHash,
      reused: collectionStep.reused ?? false,
      explorer: collectionStep.txHash ? `${chain.explorerTxBase}${collectionStep.txHash}` : `${chain.explorerAddressBase}${collectionStep.address}`
    },
    agency: {
      address: agencyStep.address,
      txHash: agencyStep.txHash,
      reused: agencyStep.reused ?? false,
      explorer: agencyStep.txHash ? `${chain.explorerTxBase}${agencyStep.txHash}` : `${chain.explorerAddressBase}${agencyStep.address}`
    }
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
