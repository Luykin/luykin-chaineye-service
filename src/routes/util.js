const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const PRIVATE_KEY_PATH = path.join(__dirname, "../../private_key.pem");
const PRIVATE_KEY = fs.readFileSync(PRIVATE_KEY_PATH, "utf8");

function decryptDataWithPrivateKey(encryptedData) {
  const buffer = Buffer.from(encryptedData, "base64");
  const decryptedData = crypto.privateDecrypt(
    {
      key: PRIVATE_KEY,
      padding: crypto.constants.RSA_PKCS1_PADDING,
      oaepHash: "sha256",
    },
    buffer
  );

  return JSON.parse(decryptedData.toString("utf8"));
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
