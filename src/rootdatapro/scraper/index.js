const fs = require("fs").promises;
const path = require("path");
const { buildRootdataUrl } = require("./url-builder");
const { fetchHtml } = require("./fetcher");
const { getRedisClient } = require("../../lib/redisClient");

// const { parsePage } = require('./parser'); // 下一步实现的占位符
// const { updateDatabase } = require('./db-updater'); // 下一步实现的占位符

const TYPEMAP_DIR = path.join(__dirname, "typemap");

/**
 * 生成一个介于 min 和 max 之间的随机整数
 * @param {number} min 最小值
 * @param {number} max 最大值
 * @returns {number}
 */
function getRandomInt(min, max) {
  min = Math.ceil(min);
  max = Math.floor(max);
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * 爬取项目（Project）页面。
 * @param {string} url 要爬取的完整 URL。
 * @param {object} item 从 typemap JSON 文件中读取的条目对象。
 */
async function scrapeProject(url, item) {
  console.log(`[Project] 开始爬取 URL: ${url}`);
  // TODO: 实现项目页面的 HTML 获取、解析和数据存储逻辑
}

/**
 * 爬取组织（Organization/VC）页面。
 * @param {string} url 要爬取的完整 URL。
 * @param {object} item 从 typemap JSON 文件中读取的条目对象。
 */
async function scrapeOrganization(url, item) {
  console.log(`[Organization] 开始爬取 URL: ${url}`);
  // TODO: 实现组织页面的 HTML 获取、解析和数据存储逻辑
}

/**
 * 爬取个人（Person）页面。
 * @param {string} url 要爬取的完整 URL。
 * @param {object} item 从 typemap JSON 文件中读取的条目对象。
 */
async function scrapePerson(url, item) {
  console.log(`[Person] 开始爬取 URL: ${url}`);
  // TODO: 实现个人页面的 HTML 获取、解析和数据存储逻辑
}

/**
 * 处理 typemap 目录中的所有 JSON 文件，以爬取所有实体。
 * @returns {Promise<void>}
 */
async function processTypemaps() {
  let redisClient;
  try {
    redisClient = await getRedisClient();
  } catch (err) {
    console.error("rootdatapro 无法连接到 Redis，爬取过程终止。", err);
    return;
  }

  console.log(`rootdatapro 开始从 typemap 目录进行批量处理: ${TYPEMAP_DIR}`);
  try {
    const files = await fs.readdir(TYPEMAP_DIR);
    const jsonFiles = files.filter((file) => file.endsWith(".json"));

    if (jsonFiles.length === 0) {
      console.warn(
        "rootdatapro 在 typemap 目录中未找到 JSON 文件。没有要处理的内容。"
      );
      return;
    }

    for (const file of jsonFiles) {
      const filePath = path.join(TYPEMAP_DIR, file);
      console.log(`rootdatapro 正在处理文件: ${file}`);

      try {
        const fileContent = await fs.readFile(filePath, "utf-8");
        const items = JSON.parse(fileContent);

        let type;
        if (file.includes("project")) {
          type = 1;
        } else if (file.includes("organization") || file.includes("vc")) {
          type = 2;
        } else if (file.includes("person")) {
          type = 3;
        } else {
          console.warn(
            `rootdatapro 无法从文件名 ${file} 推断类型，跳过此文件。`
          );
          continue;
        }

        console.log(
          `rootdatapro 文件 ${file} 包含 ${items.length} 个条目，类型为 ${type}。`
        );

        for (const item of items) {
          if (!item.id || !item.name) {
            console.warn("rootdatapro 条目缺少 id 或 name，已跳过:", item);
            continue;
          }

          const redisKey = `rootdatapro:scraped:${type}:${item.id}`;
          const isScraped = await redisClient.exists(redisKey);

          if (isScraped) {
            console.log(
              `rootdatapro 条目 ${item.id} (类型 ${type}) 已于近期爬取，本次跳过。`
            );
            continue;
          }

          const { fullLink } = buildRootdataUrl(item.id, item.name, type);

          try {
            let success = false;
            switch (type) {
              case 1:
                await scrapeProject(fullLink, item);
                success = true; // 假设成功
                break;
              case 2:
                await scrapeOrganization(fullLink, item);
                success = true; // 假设成功
                break;
              case 3:
                await scrapePerson(fullLink, item);
                success = true; // 假设成功
                break;
              default:
                console.warn(
                  `rootdatapro 不支持的类型: ${type}，已跳过项目 ${item.id}`
                );
                break;
            }

            if (success) {
              const expirationDays = getRandomInt(10, 30);
              const expirationSeconds = expirationDays * 24 * 60 * 60;
              await redisClient.set(redisKey, "1", { EX: expirationSeconds });
              console.log(
                `rootdatapro 条目 ${item.id} (类型 ${type}) 已标记为已爬取，${expirationDays} 天后过期。`
              );
            }
          } catch (scrapeError) {
            console.error(
              `rootdatapro 爬取 ${fullLink} (条目 ${item.id}) 时失败:`,
              scrapeError.message
            );
          }

          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      } catch (err) {
        console.error(`rootdatapro 处理文件 ${filePath} 时出错:`, err.message);
      }
    }
  } catch (error) {
    console.error(`rootdatapro 读取 typemap 目录时出错:`, error.message);
  }
  console.log("rootdatapro 所有 typemap 文件处理完毕。");
}

module.exports = {
  processTypemaps,
  scrapeProject,
  scrapeOrganization,
  scrapePerson,
};
