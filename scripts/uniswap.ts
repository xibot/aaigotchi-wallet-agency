import { ZeroAddress, getAddress } from "ethers";

export const UNISWAP_API_BASE_URL = "https://trade-api.gateway.uniswap.org/v1";
export const UNISWAP_NATIVE_TOKEN = ZeroAddress;

export type UniswapSwapBuildParams = {
  chainId: number;
  swapper: string;
  tokenIn: string;
  tokenOut: string;
  amount: bigint;
  slippageTolerance?: number;
  urgency?: "normal" | "fast" | "urgent";
};

export type UniswapSwapPlan = {
  router: string;
  data: `0x${string}`;
  valueWei: bigint;
  routing: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: bigint;
  quote: unknown;
  requestId: string | null;
  expectedAmountOut: string | null;
};

type JsonRecord = Record<string, unknown>;

type ApiJsonResponse = {
  status: number;
  body: JsonRecord;
  requestId: string | null;
};

function resolveApiKey(): string {
  const apiKey = process.env.UNISWAP_API_KEY ?? process.env.UNISWAP_TRADE_API_KEY;
  if (!apiKey) {
    throw new Error("Missing UNISWAP_API_KEY (or UNISWAP_TRADE_API_KEY) in the environment");
  }
  return apiKey;
}

function requireHexData(value: unknown, field: string): `0x${string}` {
  if (typeof value !== "string" || !value.startsWith("0x") || value.length <= 2) {
    throw new Error(`Uniswap returned invalid ${field}`);
  }
  return value as `0x${string}`;
}

function requireAddress(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new Error(`Uniswap returned invalid ${field}`);
  }
  return getAddress(value);
}

function normaliseToken(address: string): string {
  if (address === ZeroAddress) {
    return ZeroAddress;
  }
  return getAddress(address);
}

function expectedAmountOutFromQuote(quoteEnvelope: JsonRecord): string | null {
  const quote = quoteEnvelope.quote;
  if (!quote || typeof quote !== "object") {
    return null;
  }
  const quoteRecord = quote as JsonRecord;
  const output = quoteRecord.output;
  if (output && typeof output === "object") {
    const amount = (output as JsonRecord).amount;
    if (typeof amount === "string") {
      return amount;
    }
  }
  const outputAmount = quoteRecord.outputAmount;
  if (typeof outputAmount === "string") {
    return outputAmount;
  }
  return null;
}

async function postJson(pathname: string, body: JsonRecord, apiKey: string): Promise<ApiJsonResponse> {
  const response = await fetch(`${UNISWAP_API_BASE_URL}${pathname}`, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "content-type": "application/json",
      accept: "application/json"
    },
    body: JSON.stringify(body)
  });

  const requestId = response.headers.get("x-request-id");
  const payload = (await response.json()) as JsonRecord;
  if (!response.ok) {
    const error = typeof payload.error === "string" ? payload.error : `HTTP ${response.status}`;
    const message = typeof payload.message === "string" ? payload.message : "Uniswap API request failed";
    throw new Error(`${error}: ${message}`);
  }

  return {
    status: response.status,
    body: payload,
    requestId
  };
}

export async function buildUniswapSwapPlan(params: UniswapSwapBuildParams): Promise<UniswapSwapPlan> {
  const apiKey = resolveApiKey();
  const tokenIn = normaliseToken(params.tokenIn);
  const tokenOut = normaliseToken(params.tokenOut);
  const swapper = getAddress(params.swapper);

  const quoteResponse = await postJson(
    "/quote",
    {
      tokenIn,
      tokenOut,
      tokenInChainId: params.chainId,
      tokenOutChainId: params.chainId,
      type: "EXACT_INPUT",
      amount: params.amount.toString(),
      swapper,
      slippageTolerance: params.slippageTolerance ?? 0.5,
      protocols: ["V2", "V3", "V4"],
      urgency: params.urgency ?? "normal"
    },
    apiKey
  );

  const routing = quoteResponse.body.routing;
  if (typeof routing !== "string") {
    throw new Error("Uniswap quote response did not include routing");
  }
  if (!["CLASSIC", "WRAP", "UNWRAP"].includes(routing)) {
    throw new Error(`Unsupported Uniswap routing for NFT vault execution: ${routing}`);
  }
  if (quoteResponse.body.permitData) {
    throw new Error("Uniswap requested Permit2 signing. The current NFT vault flow only supports signature-free routes.");
  }
  if (!quoteResponse.body.quote || typeof quoteResponse.body.quote !== "object") {
    throw new Error("Uniswap quote response did not include a quote payload");
  }

  const swapResponse = await postJson(
    "/swap",
    {
      quote: quoteResponse.body.quote
    },
    apiKey
  );

  const swapEnvelope = swapResponse.body.swap;
  if (!swapEnvelope || typeof swapEnvelope !== "object") {
    throw new Error("Uniswap swap response did not include a swap transaction");
  }
  const swap = swapEnvelope as JsonRecord;
  const router = requireAddress(swap.to, "swap.to");
  const from = requireAddress(swap.from, "swap.from");
  const data = requireHexData(swap.data, "swap.data");
  const valueString = typeof swap.value === "string" ? swap.value : "0";
  const chainId = Number(swap.chainId);

  if (from !== swapper) {
    throw new Error(`Uniswap built the swap for ${from}, expected vault ${swapper}`);
  }
  if (chainId !== params.chainId) {
    throw new Error(`Uniswap built the swap for chain ${chainId}, expected ${params.chainId}`);
  }

  const valueWei = BigInt(valueString);
  if (tokenIn === ZeroAddress && valueWei !== params.amount) {
    throw new Error(`Native-input swap value mismatch: expected ${params.amount.toString()}, got ${valueWei.toString()}`);
  }

  return {
    router,
    data,
    valueWei,
    routing,
    tokenIn,
    tokenOut,
    amountIn: params.amount,
    quote: quoteResponse.body.quote,
    requestId: swapResponse.requestId ?? quoteResponse.requestId,
    expectedAmountOut: expectedAmountOutFromQuote(quoteResponse.body)
  };
}
