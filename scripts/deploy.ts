import hre from "hardhat";
import { deploymentFile, nowIso, writeJson } from "./helpers";

async function main(): Promise<void> {
  const [deployer] = await hre.ethers.getSigners();
  const network = await hre.ethers.provider.getNetwork();

  const collectionName = process.env.COLLECTION_NAME ?? process.env.AAI_COLLECTION_NAME ?? "AAi Agentic Collectibles";
  const collectionSymbol = process.env.COLLECTION_SYMBOL ?? process.env.AAI_COLLECTION_SYMBOL ?? "AAIC";

  const Collection = await hre.ethers.getContractFactory("AAIGenNFT");
  const collection = await Collection.deploy(collectionName, collectionSymbol, deployer.address);
  await collection.waitForDeployment();

  const Agency = await hre.ethers.getContractFactory("AAIWalletAgency");
  const agency = await Agency.deploy(await collection.getAddress(), deployer.address);
  await agency.waitForDeployment();

  const record = {
    project: "aaigotchi-wallet-agency",
    network: hre.network.name,
    chainId: Number(network.chainId),
    deployer: deployer.address,
    collection: await collection.getAddress(),
    agency: await agency.getAddress(),
    deployedAt: nowIso()
  };

  const filePath = deploymentFile(hre.network.name);
  writeJson(filePath, record);

  console.log(`deployer: ${record.deployer}`);
  console.log(`collection: ${record.collection}`);
  console.log(`agency: ${record.agency}`);
  console.log(`deployment file: ${filePath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
