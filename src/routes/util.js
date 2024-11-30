const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const PRIVATE_KEY_PATH = path.join(__dirname, "../../private_key.pem");
const PRIVATE_KEY = fs.readFileSync(PRIVATE_KEY_PATH, "utf8");
/**
 * 使用 RSA 解密 AES 密钥
 * @param encryptedKey RSA 加密的 AES 密钥 (Base64)
 * @param privateKey PEM 格式的 RSA 私钥
 * @returns 解密后的 AES 密钥 (Uint8Array)
 */
function decryptAESKeyWithRSA(encryptedKey, privateKey) {
	const buffer = Buffer.from(encryptedKey, "base64");
	
	const decryptedKey = crypto.privateDecrypt(
		{
			key: privateKey,
			padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
			oaepHash: "sha256",
		},
		buffer
	);
	
	return new Uint8Array(decryptedKey);
}

/**
 * 使用 AES-GCM 解密数据
 * @param encryptedData AES 加密的数据 (Base64)
 * @param aesKey 解密用的 AES 密钥 (Uint8Array)
 * @param iv 初始化向量 (Base64)
 * @returns 解密后的数据
 */
function decryptWithAES(encryptedData, aesKey, iv) {
	const ivBuffer = Buffer.from(iv, "base64");
	const encryptedBuffer = Buffer.from(encryptedData, "base64");
	
	const decipher = crypto.createDecipheriv("aes-128-gcm", aesKey, ivBuffer);
	const decrypted = Buffer.concat([decipher.update(encryptedBuffer), decipher.final()]);
	return JSON.parse(decrypted.toString("utf8"));
}

function validateRequestParams(req, res, next) {
  const { encryptedData, encryptedKey, iv } = req.body;
  const requestTimestamp = req.headers["x-request-timestamp"];

  if (!encryptedData || !requestTimestamp || !encryptedKey || !iv) {
    return res.status(400).json({ error: "Invalid request1." });
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
	  const aesKey = decryptAESKeyWithRSA(encryptedKey, PRIVATE_KEY);
	  const decryptedData = decryptWithAES(encryptedData, aesKey, iv);

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
