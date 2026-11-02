import hardhatToolboxMochaEthersPlugin from "@nomicfoundation/hardhat-toolbox-mocha-ethers";
import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import process from "node:process";
import { defineConfig } from "hardhat/config";

config({ path: fileURLToPath(new URL("../.env", import.meta.url)) });

export default defineConfig({
  plugins: [hardhatToolboxMochaEthersPlugin],
  solidity: {
    profiles: {
      default: {
        version: "0.8.34",
      },
      production: {
        version: "0.8.34",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      },
    },
  },
  networks: {
    hardhatMainnet: {
      type: "edr-simulated",
      chainType: "l1",
    },
    hardhatOp: {
      type: "edr-simulated",
      chainType: "op",
    },
    ...(process.env.ALCHEMY_SEPOLIA_URL && process.env.PRIVATE_KEY
      ? {
          sepolia: {
            type: "http",
            chainType: "l1",
            chainId: 11155111,
            url: process.env.ALCHEMY_SEPOLIA_URL,
            accounts: [process.env.PRIVATE_KEY],
          },
        }
      : {}),
  },
});
