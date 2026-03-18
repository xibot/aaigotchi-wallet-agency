import "dotenv/config";
import fs from "node:fs";
import path from "node:path";

function projectRoot(): string {
  return path.resolve(__dirname, "..");
}

function envOrDefault(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

function main(): void {
  const root = projectRoot();
  const svgPath = path.resolve(root, process.env.SVG_PATH ?? "assets/AAi_AGENTIC_COLLECTIBLE.svg");
  const outputDir = path.resolve(root, process.env.METADATA_OUT_DIR ?? "generated");
  const tokenNumber = envOrDefault("TOKEN_NUMBER", "1");
  const tokenName = envOrDefault("TOKEN_NAME", `AAi Agentic Collectible #${tokenNumber}`);
  const description = envOrDefault(
    "TOKEN_DESCRIPTION",
    "An AAi Agentic Collectible: a controlled smart-wallet NFT built for the aaigotchi Synthesis MVP."
  );
  const externalUrl = process.env.TOKEN_EXTERNAL_URL;

  const svg = fs.readFileSync(svgPath, "utf8").trim();
  const imageDataUri = `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
  const metadata: Record<string, unknown> = {
    name: tokenName,
    description,
    image: imageDataUri,
    attributes: [
      { trait_type: "Collection", value: envOrDefault("COLLECTION_NAME", "AAi Agentic Collectibles") },
      { trait_type: "Agentic", value: "Yes" },
      { trait_type: "Wallet Agency", value: "Controlled" }
    ]
  };

  if (externalUrl) {
    metadata.external_url = externalUrl;
  }

  const metadataJson = JSON.stringify(metadata);
  const tokenUri = `data:application/json;base64,${Buffer.from(metadataJson, "utf8").toString("base64")}`;

  fs.mkdirSync(outputDir, { recursive: true });
  const baseName = `token-${tokenNumber}`;
  fs.writeFileSync(path.join(outputDir, `${baseName}.metadata.json`), `${JSON.stringify(metadata, null, 2)}\n`);
  fs.writeFileSync(path.join(outputDir, `${baseName}.token-uri.txt`), `${tokenUri}\n`);

  console.log(JSON.stringify({
    svgPath,
    imageBytes: Buffer.byteLength(svg, "utf8"),
    metadataFile: path.join(outputDir, `${baseName}.metadata.json`),
    tokenUriFile: path.join(outputDir, `${baseName}.token-uri.txt`),
    tokenUriLength: tokenUri.length,
    tokenUri
  }, null, 2));
}

main();
