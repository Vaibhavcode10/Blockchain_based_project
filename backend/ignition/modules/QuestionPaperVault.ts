import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

export default buildModule("QuestionPaperVaultModule", (m) => {
  const vault = m.contract("QuestionPaperVault");
  return { vault };
});
