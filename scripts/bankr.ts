import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { JsonRpcProvider, TransactionReceipt } from "ethers";

type BankrConfig = {
  apiKey: string;
  apiUrl: string;
};

type SubmitParams = {
  to: string;
  chainId: number;
  data: string;
  value?: bigint;
  description: string;
  waitForConfirmation?: boolean;
};

type SubmitResult = {
  transactionHash: string;
  raw: unknown;
};

const BANKR_CONFIG_PATHS = [
  path.join(process.env.HOME ?? "", ".openclaw", "skills", "bankr", "config.json"),
  path.join(process.env.HOME ?? "", ".openclaw", "workspace", "skills", "bankr", "config.json"),
  path.join(process.env.HOME ?? "", ".bankr", "config.json")
];

function readJsonConfig(filePath: string): Record<string, string> | null {
  if (!filePath || !fs.existsSync(filePath)) {
    return null;
  }

  return JSON.parse(fs.readFileSync(filePath, "utf8")) as Record<string, string>;
}

export function resolveBankrConfig(): BankrConfig {
  const envKey = process.env.BANKR_API_KEY;
  const envUrl = process.env.BANKR_API_URL;
  if (envKey) {
    return {
      apiKey: envKey,
      apiUrl: envUrl ?? "https://api.bankr.bot"
    };
  }

  for (const configPath of BANKR_CONFIG_PATHS) {
    const parsed = readJsonConfig(configPath);
    const apiKey = parsed?.apiKey;
    if (apiKey) {
      return {
        apiKey,
        apiUrl: parsed?.apiUrl ?? "https://api.bankr.bot"
      };
    }
  }

  throw new Error("BANKR_API_KEY not found in env or Bankr config");
}

export function resolveBankrWallet(): string {
  if (process.env.BANKR_EVM_WALLET) {
    return process.env.BANKR_EVM_WALLET;
  }

  const output = execFileSync("bankr", ["whoami"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  const match = output.match(/(?:^|\n)\s*EVM(?:\s+wallet:)?\s+(0x[a-fA-F0-9]{40})/i);
  if (!match) {
    throw new Error("Could not parse Bankr EVM wallet from `bankr whoami`");
  }
  return match[1];
}

export async function submitBankrTransaction(params: SubmitParams): Promise<SubmitResult> {
  const { apiKey, apiUrl } = resolveBankrConfig();
  const response = await fetch(`${apiUrl}/agent/submit`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": apiKey
    },
    body: JSON.stringify({
      transaction: {
        to: params.to,
        chainId: params.chainId,
        value: (params.value ?? 0n).toString(),
        data: params.data
      },
      description: params.description,
      waitForConfirmation: params.waitForConfirmation ?? true
    })
  });

  const raw = await response.json();
  if (!response.ok || !raw?.success || !raw?.transactionHash) {
    throw new Error(`Bankr submit failed: ${JSON.stringify(raw)}`);
  }

  return {
    transactionHash: String(raw.transactionHash),
    raw
  };
}

export async function waitForReceipt(
  provider: JsonRpcProvider,
  txHash: string,
  timeoutMs = 300_000,
  pollMs = 4_000
): Promise<TransactionReceipt> {
  const start = Date.now();
  while (true) {
    const receipt = await provider.getTransactionReceipt(txHash);
    if (receipt) {
      return receipt;
    }

    if (Date.now() - start >= timeoutMs) {
      throw new Error(`Timed out waiting for receipt: ${txHash}`);
    }

    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}
