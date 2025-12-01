/**
 * 生成随机密码并打印原始密码和 bcrypt hash
 *
 * 使用方法：
 *   node scripts/generate-password.js [passwordLength]
 * 如果不传 length，默认 16 位。
 */

const crypto = require("crypto");
const bcrypt = require("bcryptjs");

async function main() {
  const lengthArg = parseInt(process.argv[2], 10);
  const length = Number.isFinite(lengthArg) && lengthArg > 0 ? lengthArg : 16;

  // 随机生成密码：包含字母、数字和符号
  const charset = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%^&*()";
  let rawPassword = "";
  for (let i = 0; i < length; i++) {
    const idx = crypto.randomInt(0, charset.length);
    rawPassword += charset[idx];
  }

  const passwordHash = await bcrypt.hash(rawPassword, 10);

  console.log("=== Password Generator ===");
  console.log(`Plain Password: ${rawPassword}`);
  console.log(`Bcrypt Hash:    ${passwordHash}`);
  console.log("==========================");
}

main().catch((err) => {
  console.error("生成密码失败:", err);
  process.exit(1);
});

