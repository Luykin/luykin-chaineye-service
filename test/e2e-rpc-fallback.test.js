const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { ethers } = require("ethers");

const rootDir = path.resolve(__dirname, "..");
const servicePath = path.join(rootDir, "src/echohunt/e2e/services/e2ePaymentService.js");
const axiosPath = require.resolve("axios");
const previousAxios = require.cache[axiosPath];
const previousRpcUrls = process.env.E2E_BASE_RPC_URLS;
const previousRpcUrl = process.env.E2E_BASE_RPC_URL;
const calls = [];
const txHash = `0x${"9".repeat(64)}`;
const transactionInput = "0x16f81bd145a955ce2274fcfd178b112faeddca58a41b7a1ea6cec4d552780a4fd19a3bdf000000000000000000000000833589fcd6edb6e08f4c7c32d4f71b54bda02913000000000000000000000000000000000000000000000000000000000000008000000000000000000000000000000000000000000000000000000000000000e000000000000000000000000000000000000000000000000000000000000000020000000000000000000000001027eddc76efd67fee4bb6e32688cb6bc3604624000000000000000000000000725a55cab4a586dfc8c628c00d1199dc5637d924000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000186a000000000000000000000000000000000000000000000000000000000000f4240";
const contractAddress = "0xdddddddd4c6b351a5368cbf31adb5daa0e5c1585";
const distributionInterface = new ethers.utils.Interface([
  "function waitTime() view returns(uint256)",
  "function submittedData(bytes32) view returns(uint256,address)",
]);

process.env.E2E_BASE_RPC_URLS = "https://rpc-one.invalid, https://rpc-two.invalid";
delete process.env.E2E_BASE_RPC_URL;
require.cache[axiosPath] = {
  id: axiosPath,
  filename: axiosPath,
  loaded: true,
  exports: {
    post: async (url, payload) => {
      calls.push({ url, ids: payload.map((item) => item.id) });
      if (url === "https://rpc-one.invalid") throw new Error("primary unavailable");
      if (payload[0].id === 1) {
        return {
          data: [
            { jsonrpc: "2.0", id: 1, result: { hash: txHash, to: contractAddress, input: transactionInput } },
            { jsonrpc: "2.0", id: 2, result: { status: "0x1", blockNumber: "0x123" } },
          ],
        };
      }
      return {
        data: [
          { jsonrpc: "2.0", id: 3, result: { timestamp: "0x65000000" } },
          { jsonrpc: "2.0", id: 4, result: distributionInterface.encodeFunctionResult("waitTime", [172800]) },
          {
            jsonrpc: "2.0",
            id: 5,
            result: distributionInterface.encodeFunctionResult(
              "submittedData",
              [0, "0x0000000000000000000000000000000000000000"]
            ),
          },
        ],
      };
    },
  },
};

delete require.cache[servicePath];
const { getExternalDistributionExecutionInfo } = require(servicePath);

test.after(() => {
  delete require.cache[servicePath];
  if (previousAxios) require.cache[axiosPath] = previousAxios;
  else delete require.cache[axiosPath];
  if (previousRpcUrls === undefined) delete process.env.E2E_BASE_RPC_URLS;
  else process.env.E2E_BASE_RPC_URLS = previousRpcUrls;
  if (previousRpcUrl === undefined) delete process.env.E2E_BASE_RPC_URL;
  else process.env.E2E_BASE_RPC_URL = previousRpcUrl;
});

test("falls back to the next Base RPC and keeps using the healthy endpoint", async () => {
  const result = await getExternalDistributionExecutionInfo(txHash);

  assert.equal(result.phase, "executed");
  assert.equal(result.waitTimeSeconds, 172800);
  assert.equal(result.recipients.length, 2);
  assert.deepEqual(calls, [
    { url: "https://rpc-one.invalid", ids: [1, 2] },
    { url: "https://rpc-two.invalid", ids: [1, 2] },
    { url: "https://rpc-two.invalid", ids: [3, 4, 5] },
  ]);
});
