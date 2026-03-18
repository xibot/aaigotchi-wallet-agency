import { expect } from "chai";
import hre from "hardhat";

describe("AAIWalletAgency", function () {
  async function deployFixture() {
    const [deployer, owner, executor, recipient, newOwner] = await hre.ethers.getSigners();

    const Collection = await hre.ethers.getContractFactory("AAIGenNFT");
    const collection = await Collection.deploy("AAi Agentic Collectibles", "AAIC", deployer.address);
    await collection.waitForDeployment();

    const Agency = await hre.ethers.getContractFactory("AAIWalletAgency");
    const agency = await Agency.deploy(await collection.getAddress(), deployer.address);
    await agency.waitForDeployment();

    const MockERC20 = await hre.ethers.getContractFactory("MockERC20");
    const mockToken = await MockERC20.deploy("Mock USD", "mUSD");
    await mockToken.waitForDeployment();

    const MockSwapRouter = await hre.ethers.getContractFactory("MockSwapRouter");
    const mockRouter = await MockSwapRouter.deploy();
    await mockRouter.waitForDeployment();

    await collection.mint(owner.address, "ipfs://aaigotchi/1");

    return { deployer, owner, executor, recipient, newOwner, collection, agency, mockToken, mockRouter };
  }

  it("lets the assigned executor send native funds to an allowlisted target", async function () {
    const { owner, executor, recipient, agency } = await deployFixture();
    const tokenId = 1n;

    await agency.connect(owner).createVault(tokenId);
    const vault = await agency.vaultOf(tokenId);

    await owner.sendTransaction({
      to: vault,
      value: hre.ethers.parseEther("1")
    });

    await agency
      .connect(owner)
      .setPolicy(tokenId, true, false, hre.ethers.parseEther("0.5"), 0, 0, executor.address);
    await agency.connect(owner).allowTarget(tokenId, recipient.address, true);

    const recipientBalanceBefore = await hre.ethers.provider.getBalance(recipient.address);
    const vaultBalanceBefore = await hre.ethers.provider.getBalance(vault);

    const tx = await agency
      .connect(executor)
      .sendNative(tokenId, recipient.address, hre.ethers.parseEther("0.25"), hre.ethers.ZeroHash);
    await tx.wait();

    const recipientBalanceAfter = await hre.ethers.provider.getBalance(recipient.address);
    const vaultBalanceAfter = await hre.ethers.provider.getBalance(vault);

    expect(recipientBalanceAfter - recipientBalanceBefore).to.equal(hre.ethers.parseEther("0.25"));
    expect(vaultBalanceBefore - vaultBalanceAfter).to.equal(hre.ethers.parseEther("0.25"));
  });

  it("lets the assigned executor send ERC20 funds to an allowlisted target", async function () {
    const { owner, executor, recipient, agency, mockToken } = await deployFixture();
    const tokenId = 1n;

    await agency.connect(owner).createVault(tokenId);
    const vault = await agency.vaultOf(tokenId);
    await mockToken.mint(vault, 1_000_000n);

    await agency.connect(owner).setPolicy(tokenId, true, false, 0, 500_000, 0, executor.address);
    await agency.connect(owner).allowTarget(tokenId, recipient.address, true);

    await expect(agency.connect(executor).sendErc20(tokenId, await mockToken.getAddress(), recipient.address, 250_000, hre.ethers.ZeroHash))
      .to.changeTokenBalances(mockToken, [vault, recipient.address], [-250_000n, 250_000n]);
  });

  it("lets the assigned executor call an allowlisted router through the vault with ERC20 input", async function () {
    const { owner, executor, recipient, agency, mockToken, mockRouter } = await deployFixture();
    const tokenId = 1n;

    await agency.connect(owner).createVault(tokenId);
    const vault = await agency.vaultOf(tokenId);
    await mockToken.mint(vault, 1_000_000n);

    await agency.connect(owner).setPolicy(tokenId, false, true, 0, 500_000, 0, executor.address);
    await agency.connect(owner).allowTarget(tokenId, await mockRouter.getAddress(), true);

    const data = mockRouter.interface.encodeFunctionData("pullToken", [
      await mockToken.getAddress(),
      250_000n,
      recipient.address
    ]);

    await expect(
      agency
        .connect(executor)
        .swapWithCall(tokenId, await mockRouter.getAddress(), await mockToken.getAddress(), 250_000, 0, data, hre.ethers.ZeroHash)
    ).to.changeTokenBalances(mockToken, [vault, recipient.address], [-250_000n, 250_000n]);
  });

  it("lets the assigned executor call an allowlisted router through the vault with native input", async function () {
    const { owner, executor, recipient, agency, mockRouter } = await deployFixture();
    const tokenId = 1n;

    await agency.connect(owner).createVault(tokenId);
    const vault = await agency.vaultOf(tokenId);

    await owner.sendTransaction({
      to: vault,
      value: hre.ethers.parseEther("1")
    });

    await agency.connect(owner).setPolicy(tokenId, false, true, hre.ethers.parseEther("0.5"), 0, 0, executor.address);
    await agency.connect(owner).allowTarget(tokenId, await mockRouter.getAddress(), true);

    const data = mockRouter.interface.encodeFunctionData("pullNative", [recipient.address]);

    await expect(
      agency
        .connect(executor)
        .swapWithCall(tokenId, await mockRouter.getAddress(), hre.ethers.ZeroAddress, hre.ethers.parseEther("0.25"), hre.ethers.parseEther("0.25"), data, hre.ethers.ZeroHash)
    ).to.changeEtherBalances([vault, recipient.address], [-hre.ethers.parseEther("0.25"), hre.ethers.parseEther("0.25")]);
  });

  it("auto-revokes the executor when the NFT changes owners", async function () {
    const { owner, executor, recipient, newOwner, collection, agency } = await deployFixture();
    const tokenId = 1n;

    await agency.connect(owner).createVault(tokenId);
    const vault = await agency.vaultOf(tokenId);

    await owner.sendTransaction({
      to: vault,
      value: hre.ethers.parseEther("1")
    });

    await agency
      .connect(owner)
      .setPolicy(tokenId, true, false, hre.ethers.parseEther("0.5"), 0, 0, executor.address);
    await agency.connect(owner).allowTarget(tokenId, recipient.address, true);

    await collection.connect(owner).transferFrom(owner.address, newOwner.address, tokenId);

    await expect(
      agency.connect(executor).sendNative(tokenId, recipient.address, hre.ethers.parseEther("0.1"), hre.ethers.ZeroHash)
    ).to.be.revertedWithCustomError(agency, "NotAuthorized");
  });
});
