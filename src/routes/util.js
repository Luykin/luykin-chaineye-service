const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const forge = require("node-forge");

const PRIVATE_KEY_PATH = path.join(__dirname, "../../private_key.pem");
const PRIVATE_KEY = fs.readFileSync(PRIVATE_KEY_PATH, "utf8");

/**
 * 使用 `node-forge` 实现 PKCS#1 v1.5 填充的解密
 * @param encryptedData 前端加密的数据 (Base64 格式)
 * @param privateKey PEM 格式的 RSA 私钥
 * @returns 解密后的原始数据
 */
function decryptDataWithPrivateKey(encryptedData, privateKey) {
	try {
		console.log("开始解密数据...");
		
		// 解码 Base64 加密数据
		const encryptedBuffer = forge.util.decode64(encryptedData);
		
		// 将 PEM 私钥转换为 `forge` 支持的私钥对象
		const forgePrivateKey = forge.pki.privateKeyFromPem(privateKey);
		
		// 解密数据
		const decryptedData = forgePrivateKey.decrypt(encryptedBuffer, "RSAES-PKCS1-V1_5");
		console.log("解密后的数据:", decryptedData);
		
		// 返回 JSON 格式的原始数据
		return JSON.parse(decryptedData);
	} catch (err) {
		console.error("解密失败:", err);
		throw new Error("解密失败，请检查加密数据或私钥");
	}
}

function validateRequestParams(req, res, next) {
  const { encryptedData } = req.body;
  const requestTimestamp = req.headers["x-request-timestamp"];

  if (!encryptedData || !requestTimestamp) {
    return res.status(400).json({ error: "Invalid request." });
  }

  try {
    // 验证时间戳类型
    if (isNaN(Number(requestTimestamp))) {
      throw new Error("Invalid timestamp format.");
    }

    const timestampDate = Number(requestTimestamp);
    const now = Date.now();
    const twoDaysMs = 2 * 24 * 60 * 60 * 1000;

    // 验证时间戳范围
    if (Math.abs(now - timestampDate) > twoDaysMs) {
      throw new Error("Timestamp out of range.");
    }

    // 解密数据
    const decryptedData = decryptDataWithPrivateKey(encryptedData);

    // 验证 paidAt 和时间戳一致
    const { paidAt, paymentChain, paymentHash, expireTime, address } = decryptedData;
    if (Number(paidAt) !== Number(timestampDate)) {
      throw new Error("Timestamp mismatch.");
    }

    if (!paidAt || !paymentChain || !paymentHash || !expireTime || !address) {
      throw new Error("Incomplete data.");
    }
		
		// 验证时间戳类型
    if (isNaN(Number(expireTime))) {
      throw new Error("Invalid timestamp format.");
    }

    req.decryptedData = decryptedData;
    next();
  } catch (error) {
    console.error("Validation error:", error.message);
    return res.status(403).json({ error: "Invalid request." }); // 模糊化错误提示
  }
}

module.exports = {
  validateRequestParams,
};
