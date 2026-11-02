import { expect } from "chai";
import { AbiCoder, getBytes, id, keccak256 } from "ethers";
import { network } from "hardhat";

const { ethers } = await network.create();

describe("QuestionPaperVault", function () {
  async function deployVault() {
    const [admin, viewer, otherViewer] = await ethers.getSigners();
    const vault = await ethers.deployContract("QuestionPaperVault");
    return { vault, admin, viewer, otherViewer };
  }

  it("sets the deployer as admin and lets the admin register a paper", async function () {
    const { vault, admin } = await deployVault();

    expect(await vault.admin()).to.equal(admin.address);
    await expect(vault.createPaper(1n, "paper-hash"))
      .to.emit(vault, "PaperCreated")
      .withArgs(1n, "paper-hash");

    const paper = await vault.papers(1n);
    expect(paper.paperHash).to.equal("paper-hash");
    expect(paper.exists).to.equal(true);
  });

  it("rejects non-admin and duplicate paper registrations", async function () {
    const { vault, viewer } = await deployVault();
    await vault.createPaper(1n, "paper-hash");

    await expect(
      vault.connect(viewer).createPaper(2n, "unauthorized-hash"),
    ).to.be.revertedWith("Only admin can perform this action");
    await expect(vault.createPaper(1n, "duplicate-hash")).to.be.revertedWith(
      "Paper already exists",
    );
  });

  it("logs access only for registered papers and records unique viewers", async function () {
    const { vault, admin, viewer, otherViewer } = await deployVault();

    await expect(
      vault.connect(viewer).accessPaper(1n, id("user-1"), 100n, 0n, "0x"),
    ).to.be.revertedWith("Paper does not exist");
    await vault.createPaper(1n, "paper-hash");

    const signAccess = async (viewerAddress: string, appUserId: string, nonce: bigint) => {
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
      const encoded = AbiCoder.defaultAbiCoder().encode(
        ["uint256", "address", "uint256", "address", "bytes32", "uint256", "uint256"],
        [
          await ethers.provider.getNetwork().then((network) => network.chainId),
          await vault.getAddress(),
          1n,
          viewerAddress,
          appUserId,
          deadline,
          nonce,
        ],
      );
      const signature = await admin.signMessage(getBytes(keccak256(encoded)));
      return { deadline, signature };
    };

    const viewerId = id("user-1");
    const firstAuthorization = await signAccess(viewer.address, viewerId, 0n);
    await expect(
      vault.connect(viewer).accessPaper(
        1n,
        viewerId,
        firstAuthorization.deadline,
        0n,
        firstAuthorization.signature,
      ),
    ).to.emit(vault, "PaperAccessed");

    const secondAuthorization = await signAccess(viewer.address, viewerId, 1n);
    await vault.connect(viewer).accessPaper(
      1n,
      viewerId,
      secondAuthorization.deadline,
      1n,
      secondAuthorization.signature,
    );

    const otherViewerId = id("user-2");
    const otherAuthorization = await signAccess(otherViewer.address, otherViewerId, 0n);
    await vault.connect(otherViewer).accessPaper(
      1n,
      otherViewerId,
      otherAuthorization.deadline,
      0n,
      otherAuthorization.signature,
    );

    expect(await vault.getAccessLogs(1n)).to.deep.equal([
      viewer.address,
      otherViewer.address,
    ]);
    expect(await vault.hasAccessed(1n, viewer.address)).to.equal(true);
    expect(await vault.hasAccessed(1n, otherViewer.address)).to.equal(true);
  });

  it("rejects forged, expired, and replayed access authorizations", async function () {
    const { vault, admin, viewer, otherViewer } = await deployVault();
    await vault.createPaper(1n, "paper-hash");
    const appUserId = id("user-1");
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);

    const signAccess = async (signer: typeof admin, expiresAt = deadline) => {
      const encoded = AbiCoder.defaultAbiCoder().encode(
        ["uint256", "address", "uint256", "address", "bytes32", "uint256", "uint256"],
        [
          await ethers.provider.getNetwork().then((network) => network.chainId),
          await vault.getAddress(),
          1n,
          viewer.address,
          appUserId,
          expiresAt,
          0n,
        ],
      );
      return signer.signMessage(getBytes(keccak256(encoded)));
    };

    await expect(
      vault.connect(viewer).accessPaper(
        1n,
        appUserId,
        deadline,
        0n,
        await signAccess(otherViewer),
      ),
    ).to.be.revertedWith("Invalid access authorization");
    await expect(
      vault.connect(viewer).accessPaper(
        1n,
        appUserId,
        1n,
        0n,
        await signAccess(admin, 1n),
      ),
    ).to.be.revertedWith("Access authorization expired");

    const validSignature = await signAccess(admin);
    await vault.connect(viewer).accessPaper(1n, appUserId, deadline, 0n, validSignature);
    await expect(
      vault.connect(viewer).accessPaper(1n, appUserId, deadline, 0n, validSignature),
    ).to.be.revertedWith("Invalid access nonce");
  });
});
