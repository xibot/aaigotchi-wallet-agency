import fs from "node:fs";
import path from "node:path";
import { keccak256, toUtf8Bytes } from "ethers";

export type DeploymentRecord = {
  project: string;
  network: string;
  chainId: number;
  deployer: string;
  collection: string;
  agency: string;
  deployedAt: string;
  deploymentMode?: string;
  deployerContract?: string;
  saltNamespace?: string;
  collectionSalt?: string;
  agencySalt?: string;
  collectionTxHash?: string;
  agencyTxHash?: string;
};

export type PolicySnapshot = {
  sendEnabled: boolean;
  swapEnabled: boolean;
  nativeLimitWei: string;
  erc20Limit: string;
  cooldownSeconds: number;
  lastActionAt: string;
  executor: string;
  executorOwner: string;
};

export type ReceiptRecord = {
  schema: string;
  receiptHash: string;
  status: string;
  action: string;
  network: string;
  chainId: number;
  tokenId: string;
  collection: string;
  agency: string;
  vault: string;
  asset: string;
  target: string;
  amount: string;
  caller: string;
  txHash: string;
  blockNumber: string;
  timestamp: string;
  note: string;
  callHash: string | null;
  metadata?: Record<string, string>;
  policy: PolicySnapshot;
};

export type ReceiptFilters = {
  tokenId?: string;
  collection?: string;
  agency?: string;
  network?: string;
};

export function ensureDir(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true });
}

export function projectRoot(): string {
  return process.cwd();
}

export function deploymentsDir(): string {
  return path.join(projectRoot(), "deployments");
}

export function receiptsDir(): string {
  return path.join(projectRoot(), "receipts");
}

export function deploymentFile(networkName: string): string {
  return path.join(deploymentsDir(), `${networkName}.latest.json`);
}

export function readDeployment(networkName: string): DeploymentRecord {
  const filePath = deploymentFile(networkName);
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as DeploymentRecord;
}

export function writeJson(filePath: string, value: unknown): void {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function hashIntent(intent: unknown): string {
  return keccak256(toUtf8Bytes(JSON.stringify(intent)));
}

export function envOrThrow(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

export function buildPolicySnapshot(policy: {
  sendEnabled: boolean;
  swapEnabled: boolean;
  nativeLimitWei: bigint | { toString(): string };
  erc20Limit: bigint | { toString(): string };
  cooldownSeconds: number | bigint | { toString(): string };
  lastActionAt: number | bigint | { toString(): string };
  executor: string;
  executorOwner: string;
}): PolicySnapshot {
  return {
    sendEnabled: policy.sendEnabled,
    swapEnabled: policy.swapEnabled,
    nativeLimitWei: policy.nativeLimitWei.toString(),
    erc20Limit: policy.erc20Limit.toString(),
    cooldownSeconds: Number(policy.cooldownSeconds),
    lastActionAt: policy.lastActionAt.toString(),
    executor: policy.executor,
    executorOwner: policy.executorOwner
  };
}

function normalizeAddress(value: string | undefined): string | undefined {
  return value ? value.toLowerCase() : undefined;
}

function receiptCollectionDir(collection: string): string {
  return path.join(receiptsDir(), normalizeAddress(collection) ?? "unknown-collection");
}

function listReceiptFiles(dirPath: string): string[] {
  if (!fs.existsSync(dirPath)) {
    return [];
  }

  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...listReceiptFiles(fullPath));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".json")) {
      files.push(fullPath);
    }
  }
  return files;
}

export function writeReceiptRecord(record: ReceiptRecord): string {
  const fileName = `${record.timestamp.replaceAll(":", "-")}-token-${record.tokenId}-${record.action}.json`;
  const filePath = path.join(receiptCollectionDir(record.collection), fileName);
  writeJson(filePath, record);
  return filePath;
}

export function readReceipts(filters: ReceiptFilters = {}): ReceiptRecord[] {
  const files = listReceiptFiles(receiptsDir());
  const collection = normalizeAddress(filters.collection);
  const agency = normalizeAddress(filters.agency);

  return files
    .map((filePath) => JSON.parse(fs.readFileSync(filePath, "utf8")) as ReceiptRecord)
    .filter((record) => (filters.tokenId ? record.tokenId === filters.tokenId : true))
    .filter((record) => (collection ? normalizeAddress(record.collection) === collection : true))
    .filter((record) => (agency ? normalizeAddress(record.agency) === agency : true))
    .filter((record) => (filters.network ? record.network === filters.network : true))
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}
