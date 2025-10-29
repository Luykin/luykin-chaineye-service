/**
 * 调试 JSON 字段查询问题
 */

const { Sequelize } = require("sequelize");

const pgInstance = new Sequelize({
  dialect: "postgres",
  host: process.env.PG_HOST || "150.5.158.179",
  port: parseInt(process.env.PG_PORT || "5432", 10),
  database: process.env.PG_DATABASE || "luykindatabase",
  username: process.env.PG_USERNAME || "luykin",
  password: process.env.PG_PASSWORD || "wtf.0813",
  logging: console.log,
  timezone: "+00:00",
});

async function debugJsonField() {
  try {
    console.log("🔌 连接数据库...\n");
    await pgInstance.authenticate();

    // 1. 检查字段类型
    console.log("=".repeat(60));
    console.log("检查 socialLinks 字段的实际类型");
    console.log("=".repeat(60));
    const columnInfo = await pgInstance.query(
      `SELECT column_name, data_type, udt_name
       FROM information_schema.columns
       WHERE table_name = 'Projects' AND column_name = 'socialLinks'`,
      { type: Sequelize.QueryTypes.SELECT }
    );
    console.log("字段信息:", JSON.stringify(columnInfo, null, 2));

    // 2. 直接查看 Polychain 的 socialLinks 原始数据
    console.log("\n" + "=".repeat(60));
    console.log("查看 Polychain 项目的原始数据");
    console.log("=".repeat(60));
    const rawData = await pgInstance.query(
      `SELECT 
        id,
        "projectName",
        "socialLinks",
        pg_typeof("socialLinks") as field_type,
        "socialLinks"::text as socialLinks_text,
        "socialLinks"->'x' as x_value_json,
        "socialLinks"->>'x' as x_value_text
       FROM "Projects" 
       WHERE "projectName" = 'Polychain'
       LIMIT 1`,
      { type: Sequelize.QueryTypes.SELECT }
    );
    console.log("原始数据:", JSON.stringify(rawData, null, 2));

    // 3. 测试不同的查询方式
    console.log("\n" + "=".repeat(60));
    console.log("测试不同的查询方式");
    console.log("=".repeat(60));

    const testUrl = "https://x.com/polychain";

    // 测试 1: 精确匹配
    console.log("\n测试 1: 精确匹配");
    const test1 = await pgInstance.query(
      `SELECT id, "projectName"
       FROM "Projects" 
       WHERE "socialLinks"->>'x' = '${testUrl}'`,
      { type: Sequelize.QueryTypes.SELECT }
    );
    console.log(`结果: ${test1.length > 0 ? "✅ 找到" : "❌ 未找到"}`);

    // 测试 2: 去掉引号的精确匹配
    console.log("\n测试 2: 使用 ->> 操作符 + LOWER");
    const test2 = await pgInstance.query(
      `SELECT id, "projectName"
       FROM "Projects" 
       WHERE LOWER("socialLinks"->>'x') = LOWER('${testUrl}')`,
      { type: Sequelize.QueryTypes.SELECT }
    );
    console.log(`结果: ${test2.length > 0 ? "✅ 找到" : "❌ 未找到"}`);

    // 测试 3: 使用 TRIM 去除空格
    console.log("\n测试 3: 使用 TRIM 去除可能的空格");
    const test3 = await pgInstance.query(
      `SELECT id, "projectName"
       FROM "Projects" 
       WHERE TRIM("socialLinks"->>'x') = '${testUrl}'`,
      { type: Sequelize.QueryTypes.SELECT }
    );
    console.log(`结果: ${test3.length > 0 ? "✅ 找到" : "❌ 未找到"}`);

    // 测试 4: 检查是否有隐藏字符
    console.log("\n测试 4: 检查提取的值的长度");
    const test4 = await pgInstance.query(
      `SELECT 
        "projectName",
        "socialLinks"->>'x' as x_value,
        LENGTH("socialLinks"->>'x') as value_length,
        LENGTH('${testUrl}') as expected_length,
        octet_length("socialLinks"->>'x') as byte_length
       FROM "Projects" 
       WHERE "projectName" = 'Polychain'`,
      { type: Sequelize.QueryTypes.SELECT }
    );
    console.log("值详情:", JSON.stringify(test4, null, 2));

    // 测试 5: 使用 JSONB 操作符（如果是 JSONB）
    console.log("\n测试 5: 尝试使用 JSONB 操作符");
    try {
      const test5 = await pgInstance.query(
        `SELECT id, "projectName"
         FROM "Projects" 
         WHERE "socialLinks" @> '{"x":"${testUrl}"}'::jsonb`,
        { type: Sequelize.QueryTypes.SELECT }
      );
      console.log(`结果: ${test5.length > 0 ? "✅ 找到" : "❌ 未找到"}`);
    } catch (err) {
      console.log("❌ JSONB 操作符不适用:", err.message);
    }

    // 测试 6: 字符编码对比
    console.log("\n测试 6: 字符编码对比");
    const test6 = await pgInstance.query(
      `SELECT 
        "projectName",
        encode("socialLinks"->>'x'::bytea, 'hex') as x_hex,
        encode('${testUrl}'::bytea, 'hex') as url_hex
       FROM "Projects" 
       WHERE "projectName" = 'Polychain'`,
      { type: Sequelize.QueryTypes.SELECT }
    );
    console.log("编码对比:", JSON.stringify(test6, null, 2));
  } catch (error) {
    console.error("❌ 错误:", error);
  } finally {
    await pgInstance.close();
    console.log("\n🔌 数据库连接已关闭");
  }
}

if (require.main === module) {
  debugJsonField()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
