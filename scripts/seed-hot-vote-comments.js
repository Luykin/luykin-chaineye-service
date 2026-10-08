/**
 * scripts/seed-hot-vote-comments.js
 *
 * 为指定 HotVote 议题 (topicId) 批量添加假评论数据到 XHuntHotVoteComments 表。
 *
 * 特性：
 * 1. 严格支持环境配置（.env-dev / .env-pro / 命令行 --env-file）。
 * 2. 议题合法性校验：写入前先检查 topicId 是否存在；若不存在则友好打印库中最新议题列表供选择。
 * 3. 拟真 Web3 推特假用户数据：包含用户名、展示昵称、Dicebear 头像、推特雪花数字 ID。
 * 4. 拟真多样性评语：正方、反方、中立、吃瓜、中英文混合，严格限制在 200 字内。
 * 5. 错落有致的时间戳：在过去 24 小时内按时间先后分布，真实自然。
 * 6. 可选自动生成选民投票记录 (--with-votes，默认开启)：若议题包含 options，为假用户同步写入 XHuntHotVoteRecords，
 *    确保前端评论区能展示选民的投票立场标签。
 * 7. Redis 缓存自愈：插入成功后自动触发议题留言与投票的 Redis 版本号递增，避免命中旧缓存。
 * 8. 支持 --dry-run 模式：仅预览待插入数据，即使无网络/离线也可预览生成的假数据结构。
 *
 * 用法：
 *   node scripts/seed-hot-vote-comments.js <topicId>
 *   node scripts/seed-hot-vote-comments.js --topicId=<topicId> --count=20
 *   node scripts/seed-hot-vote-comments.js <topicId> --env-file=.env-pro
 *   node scripts/seed-hot-vote-comments.js <topicId> --no-votes
 *   node scripts/seed-hot-vote-comments.js <topicId> --dry-run
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// -------------------------------------------------------------
// 1. 参数解析
// -------------------------------------------------------------
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    topicId: null,
    count: 20,
    withVotes: true,
    dryRun: false,
    envFile: null,
    help: false,
  };

  for (const arg of args) {
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg.startsWith("--topicId=")) {
      options.topicId = arg.split("=")[1].trim();
    } else if (arg.startsWith("--topic=")) {
      options.topicId = arg.split("=")[1].trim();
    } else if (arg.startsWith("--count=")) {
      const val = parseInt(arg.split("=")[1].trim(), 10);
      if (!isNaN(val) && val > 0) options.count = Math.min(val, 100);
    } else if (arg === "--no-votes" || arg === "--with-votes=false") {
      options.withVotes = false;
    } else if (arg === "--with-votes" || arg === "--with-votes=true") {
      options.withVotes = true;
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg.startsWith("--env-file=")) {
      options.envFile = arg.split("=")[1].trim();
    } else if (arg === "--env-pro") {
      options.envFile = ".env-pro";
    } else if (arg === "--env-dev") {
      options.envFile = ".env-dev";
    } else if (!arg.startsWith("-") && !options.topicId) {
      options.topicId = arg.trim();
    }
  }

  return options;
}

const parsedArgs = parseArgs();

if (parsedArgs.help) {
  console.log(`
使用方法:
  node scripts/seed-hot-vote-comments.js <topicId> [选项]

选项:
  --topicId=<uuid>      目标议题的 UUID (也可以直接作为第一个位置参数)
  --count=<number>      生成评论条数 (默认 20，最大 100)
  --with-votes          同时为每个评论生成一条对应选项的投票记录 (默认开启)
  --no-votes            仅向 XHuntHotVoteComments 插入留言，不生成投票记录
  --dry-run             预演模式，只生成并打印假数据，不写入数据库
  --env-file=<path>     指定环境配置文件 (如 .env-pro / .env-dev)
  --env-pro             快捷指定使用 .env-pro
  --env-dev             快捷指定使用 .env-dev
  -h, --help            查看帮助信息

示例:
  node scripts/seed-hot-vote-comments.js 3fa85f64-5717-4562-b3fc-2c963f66afa6
  node scripts/seed-hot-vote-comments.js 3fa85f64-5717-4562-b3fc-2c963f66afa6 --count=20
  node scripts/seed-hot-vote-comments.js 3fa85f64-5717-4562-b3fc-2c963f66afa6 --dry-run
`);
  process.exit(0);
}

// -------------------------------------------------------------
// 2. 加载环境变量
// -------------------------------------------------------------
function loadEnv(customFile) {
  const rootDir = path.resolve(__dirname, "..");
  let chosenFile = customFile;

  if (!chosenFile) {
    if (process.env.ENV_FILE) {
      chosenFile = process.env.ENV_FILE;
    } else if (process.env.NODE_ENV === "production" && fs.existsSync(path.join(rootDir, ".env-pro"))) {
      chosenFile = ".env-pro";
    } else if (fs.existsSync(path.join(rootDir, ".env-pro"))) {
      chosenFile = ".env-pro";
    } else if (fs.existsSync(path.join(rootDir, ".env-dev"))) {
      chosenFile = ".env-dev";
    }
  }

  if (chosenFile) {
    const fullPath = path.isAbsolute(chosenFile) ? chosenFile : path.join(rootDir, chosenFile);
    if (fs.existsSync(fullPath)) {
      require("dotenv").config({ path: fullPath });
      console.log(`[Env] 已加载环境配置: ${chosenFile}`);
      return true;
    }
  }

  require("dotenv").config();
  console.log(`[Env] 未找到专属环境配置文件，使用当前系统环境变量`);
  return false;
}

// -------------------------------------------------------------
// 3. 拟真推特用户 & 评论语料库
// -------------------------------------------------------------
const MOCK_PROFILES = [
  {
    userName: "CryptoWhale_0x",
    displayName: "Whale Watcher 🐋",
    avatar: "https://api.dicebear.com/7.x/identicon/svg?seed=CryptoWhale_0x",
  },
  {
    userName: "0xAlphaHunter",
    displayName: "Alpha Hunter 🏹",
    avatar: "https://api.dicebear.com/7.x/identicon/svg?seed=0xAlphaHunter",
  },
  {
    userName: "web3_sarah",
    displayName: "Sarah | Web3 Dev 👩‍💻",
    avatar: "https://api.dicebear.com/7.x/identicon/svg?seed=web3_sarah",
  },
  {
    userName: "degen_trader_sam",
    displayName: "Sam The Degen 🎲",
    avatar: "https://api.dicebear.com/7.x/identicon/svg?seed=degen_trader_sam",
  },
  {
    userName: "vitalik_watcher",
    displayName: "Vitalik Fan 👓",
    avatar: "https://api.dicebear.com/7.x/identicon/svg?seed=vitalik_watcher",
  },
  {
    userName: "block_researcher",
    displayName: "Block Researcher 📊",
    avatar: "https://api.dicebear.com/7.x/identicon/svg?seed=block_researcher",
  },
  {
    userName: "crypto_panda_cn",
    displayName: "加密大熊猫 🐼",
    avatar: "https://api.dicebear.com/7.x/identicon/svg?seed=crypto_panda_cn",
  },
  {
    userName: "satoshi_son",
    displayName: "Satoshi Son ⚡",
    avatar: "https://api.dicebear.com/7.x/identicon/svg?seed=satoshi_son",
  },
  {
    userName: "eth_ultrasound",
    displayName: "Ultrasound Money 🦇🔊",
    avatar: "https://api.dicebear.com/7.x/identicon/svg?seed=eth_ultrasound",
  },
  {
    userName: "solana_surfer",
    displayName: "Solana Surfer 🌊",
    avatar: "https://api.dicebear.com/7.x/identicon/svg?seed=solana_surfer",
  },
  {
    userName: "onchain_detective",
    displayName: "0xDetective 🔍",
    avatar: "https://api.dicebear.com/7.x/identicon/svg?seed=onchain_detective",
  },
  {
    userName: "defi_ape_king",
    displayName: "DeFi Ape King 🦍",
    avatar: "https://api.dicebear.com/7.x/identicon/svg?seed=defi_ape_king",
  },
  {
    userName: "layer2_optimist",
    displayName: "Rollup Maxi 🚀",
    avatar: "https://api.dicebear.com/7.x/identicon/svg?seed=layer2_optimist",
  },
  {
    userName: "yield_farmer_joe",
    displayName: "Farmer Joe 🚜",
    avatar: "https://api.dicebear.com/7.x/identicon/svg?seed=yield_farmer_joe",
  },
  {
    userName: "zk_fanatic",
    displayName: "ZK Proof Fan 🛡️",
    avatar: "https://api.dicebear.com/7.x/identicon/svg?seed=zk_fanatic",
  },
  {
    userName: "tokenomics_geek",
    displayName: "Tokenomics Geek 📈",
    avatar: "https://api.dicebear.com/7.x/identicon/svg?seed=tokenomics_geek",
  },
  {
    userName: "cindy_crypto_eth",
    displayName: "Cindy Crypto 💎",
    avatar: "https://api.dicebear.com/7.x/identicon/svg?seed=cindy_crypto_eth",
  },
  {
    userName: "hodl_forever_99",
    displayName: "Diamond Hands 💎🙌",
    avatar: "https://api.dicebear.com/7.x/identicon/svg?seed=hodl_forever_99",
  },
  {
    userName: "macro_crypto_guy",
    displayName: "Macro Economist 📉",
    avatar: "https://api.dicebear.com/7.x/identicon/svg?seed=macro_crypto_guy",
  },
  {
    userName: "ai_web3_builder",
    displayName: "AI x Web3 Explorer 🤖",
    avatar: "https://api.dicebear.com/7.x/identicon/svg?seed=ai_web3_builder",
  },
  {
    userName: "mempool_sniper",
    displayName: "Mempool Sniper 🎯",
    avatar: "https://api.dicebear.com/7.x/identicon/svg?seed=mempool_sniper",
  },
  {
    userName: "crypto_grandpa",
    displayName: "Crypto OG 2017 👴",
    avatar: "https://api.dicebear.com/7.x/identicon/svg?seed=crypto_grandpa",
  },
  {
    userName: "luna_survivor",
    displayName: "Risk Manager 🛡️",
    avatar: "https://api.dicebear.com/7.x/identicon/svg?seed=luna_survivor",
  },
  {
    userName: "pixel_pete",
    displayName: "Pete | NFT Degen 🖼️",
    avatar: "https://api.dicebear.com/7.x/identicon/svg?seed=pixel_pete",
  },
  {
    userName: "arbitrage_bot_dev",
    displayName: "Arb Hunter ⚡",
    avatar: "https://api.dicebear.com/7.x/identicon/svg?seed=arbitrage_bot_dev",
  },
];

const MOCK_COMMENTS = [
  "这波必须站正方，链上链下数据很吻合，长线逻辑非常扎实。",
  "纯粹围观吃瓜 🍉 双方都有依据，就看接下来的交付和执行力了。",
  "Solid thesis and narrative. Community engagement here is genuinely organic.",
  "完全不看好，代币经济学设计硬伤明显，解禁抛压太大，谨慎参与。",
  "技术架构选得很大胆，如果真能落地会是颠覆性的，值得投一票支持创新。",
  "观望为主，目前整体情绪太狂热了，等这轮回调洗盘后再看。",
  "Team has a proven track record. Dev activity on GitHub is consistently active.",
  "别光听营销吹嘘，多关注活跃地址数和协议实际捕获的真实费率收益。",
  "投完票了！长线基本面明显强于竞品，拿住等主网大版本更新。",
  "这个机制设计得很有巧思，经济模型有飞轮效应，继续跟踪观察。",
  "市场有分歧才是好事，一边倒的时候往往就是顶部，我看好反转。",
  "Execution risk remains high, but risk/reward profile is definitely asymmetric.",
  "笑死，评论区两极分化太严重了，但这就是加密市场的魅力所在。",
  "跨链安全性和流动性割裂怎么解决？在没有给出实质方案前我持保留态度。",
  "早期阶段多给建设者一些包容，支持踏实做事的团队！",
  "Interesting dynamics at play. Curious to see how TVL evolves next quarter.",
  "基本面没啥毛病，关键看市场流动性环境能不能配合起来了。",
  "不跟风、不盲从，独立思考后投出了这一票，静待时间给出答案。",
  "有点高估了短期影响，但低估了长期潜力，建议拉长周期来看。",
  "坚定支持！从测试网一直跟到现在，项目方的迭代节奏非常稳健。",
  "虽然有争议，但争议本身带来了极高关注度，流量就是 Web3 最硬的共识。",
  "Not financial advice, but this has the highest upside potential in this cycle.",
  "治理机制还需要进一步去中心化，目前中心化权重还是太重了。",
  "先投一票表态，无论结果如何，这种公开透明的议题辩论很有意义！",
  "看好这次升级，TPS 和体验提上来之后生态应用才会真正爆发。",
];

// -------------------------------------------------------------
// 4. 辅助函数
// -------------------------------------------------------------
function shuffle(array) {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function generateTwitterId(index) {
  const prefix = "188";
  const timestampPart = String(Date.now()).slice(-8);
  const randomPart = String(Math.floor(1000 + Math.random() * 9000));
  const seqPart = String(index + 1).padStart(3, "0");
  return `${prefix}${timestampPart}${randomPart}${seqPart}`;
}

function buildMockData(topicId, count, options, withVotes) {
  const shuffledProfiles = shuffle(MOCK_PROFILES);
  const shuffledComments = shuffle(MOCK_COMMENTS);

  const comments = [];
  const votes = [];

  const now = Date.now();
  const timeWindowMs = 24 * 3600 * 1000;
  const timeStep = Math.floor(timeWindowMs / (count + 1));

  for (let i = 0; i < count; i++) {
    const profile = shuffledProfiles[i % shuffledProfiles.length];
    const commentText = shuffledComments[i % shuffledComments.length];
    const twitterId = generateTwitterId(i);
    const isAnonymous = i % 10 === 7; // 10% 匿名
    const recordTime = new Date(now - (count - i) * timeStep + Math.floor(Math.random() * 300000));

    const commentId = crypto.randomUUID();
    comments.push({
      id: commentId,
      topicId,
      twitterId,
      xHuntUserId: null,
      userName: profile.userName,
      displayName: profile.displayName,
      userAvatar: profile.avatar,
      content: commentText,
      isAnonymous,
      isDeleted: false,
      createdAt: recordTime,
      updatedAt: recordTime,
    });

    if (withVotes && options && options.length > 0) {
      const selectedOption = options[i % options.length];
      votes.push({
        id: crypto.randomUUID(),
        topicId,
        twitterId,
        xHuntUserId: null,
        optionId: selectedOption.id,
        previousOptionId: null,
        revoteCount: 0,
        voteWeight: 1,
        voterRankSnapshot: null,
        isAnonymous,
        clientIp: "127.0.0.1",
        createdAt: recordTime,
        updatedAt: recordTime,
      });
    }
  }

  return { comments, votes };
}

function printPreview(comments, votes) {
  console.log(`\n🎯 假数据生成预览 (${comments.length} 条评论` + (votes.length > 0 ? ` + ${votes.length} 条投票流水):` : "):"));
  console.log("--------------------------------------------------------------------------------");
  comments.slice(0, 5).forEach((c, idx) => {
    const voteOpt = votes[idx] ? ` | 站队立场: [${votes[idx].optionId}]` : "";
    console.log(`[#${idx + 1}] ${c.isAnonymous ? "【匿名用户】" : c.displayName + " (@" + c.userName + ")"}${voteOpt}`);
    console.log(`     评语: ${c.content}`);
    console.log(`     时间: ${c.createdAt.toLocaleString()} | TwitterID: ${c.twitterId}`);
  });
  if (comments.length > 5) {
    console.log(`... 剩余 ${comments.length - 5} 条评论格式相同，已就绪`);
  }
  console.log("--------------------------------------------------------------------------------\n");
}

// -------------------------------------------------------------
// 5. 主执行逻辑
// -------------------------------------------------------------
async function run() {
  loadEnv(parsedArgs.envFile);

  const { topicId, count, withVotes, dryRun } = parsedArgs;

  // 纯 dryRun 且未指定数据库或未连上数据库时的离线兜底
  if (dryRun && topicId) {
    console.log(`\nℹ️  [Dry Run 模式] 目标 Topic ID: ${topicId}`);
    const mockOptions = [
      { id: "option_1", name: "正方" },
      { id: "option_2", name: "反方" },
    ];
    const { comments, votes } = buildMockData(topicId, count, mockOptions, withVotes);
    printPreview(comments, votes);
    console.log("✅ [Dry Run] 数据生成逻辑测试通过，未进行任何数据库写入。");
    process.exit(0);
  }

  let pgInstance;
  let XHuntHotVoteTopic;
  let XHuntHotVoteComment;
  let XHuntHotVoteRecord;

  try {
    const models = require("../src/models/postgres-start");
    pgInstance = models.pgInstance;
    XHuntHotVoteTopic = models.XHuntHotVoteTopic;
    XHuntHotVoteComment = models.XHuntHotVoteComment;
    XHuntHotVoteRecord = models.XHuntHotVoteRecord;
  } catch (err) {
    console.error("加载模型模块失败:", err.message);
    process.exit(1);
  }

  try {
    await pgInstance.authenticate();
    console.log("[Database] 数据库连接成功");
  } catch (err) {
    console.error("\n❌ [Database] 数据库连接失败:", err.message);
    if (dryRun) {
      console.log("ℹ️  [Dry Run] 数据库连不上但处于 dry-run 状态，已生成模拟数据供预览。");
      process.exit(0);
    }
    console.error("请检查数据库连接配置（如 PG_HOST, PG_PORT, PG_USERNAME, PG_PASSWORD）或通过 --env-file 指定环境文件。\n");
    process.exit(1);
  }

  try {
    if (!topicId) {
      console.error("\n❌ 错误: 未指定目标议题 topicId！");
      console.log("\n正在检索数据库中最近的 HotVote 议题供参考...\n");

      const recentTopics = await XHuntHotVoteTopic.findAll({
        attributes: ["id", "title", "status", "topicType", "options", "createdAt"],
        order: [["createdAt", "DESC"]],
        limit: 5,
      });

      if (recentTopics && recentTopics.length > 0) {
        console.log("---------------- 最近的议题列表 ----------------");
        recentTopics.forEach((t, idx) => {
          const optSummary = Array.isArray(t.options)
            ? t.options.map((o) => o.name || o.id).join(" vs ")
            : "无选项";
          console.log(`[${idx + 1}] ID: ${t.id}`);
          console.log(`    标题: ${t.title}`);
          console.log(`    状态: ${t.status} | 形式: ${t.topicType} | 选项: ${optSummary}`);
          console.log(`    时间: ${new Date(t.createdAt).toLocaleString()}`);
          console.log("");
        });
        console.log("------------------------------------------------");
        console.log(`💡 提示: 请复制上方议题的 ID 并重新执行脚本:`);
        console.log(`   node scripts/seed-hot-vote-comments.js ${recentTopics[0].id}\n`);
      } else {
        console.log("（数据库中暂无任何 HotVote 议题记录）\n");
      }
      return;
    }

    // 校验议题是否存在
    const topic = await XHuntHotVoteTopic.findByPk(topicId);
    if (!topic) {
      console.error(`\n❌ 找不到对应议题记录: topicId = ${topicId}`);
      console.error("请确认输入的议题 ID 是否正确。\n");
      return;
    }

    console.log("\n================ 目标议题信息 ================");
    console.log(`ID:       ${topic.id}`);
    console.log(`标题:     ${topic.title}`);
    console.log(`状态:     ${topic.status}`);
    console.log(`形式:     ${topic.topicType}`);
    const options = Array.isArray(topic.options) ? topic.options : [];
    console.log(`选项数量: ${options.length}个 (${options.map((o) => `${o.name || o.id} [${o.id}]`).join(", ") || "无"})`);
    console.log("==============================================\n");

    const { comments, votes } = buildMockData(topic.id, count, options, withVotes);
    printPreview(comments, votes);

    if (dryRun) {
      console.log("ℹ️  [Dry Run] 处于预演模式，未向数据库写入任何数据。");
      return;
    }

    // 事务入库
    const transaction = await pgInstance.transaction();
    try {
      await XHuntHotVoteComment.bulkCreate(comments, { transaction });
      console.log(`✅ 成功写入 ${comments.length} 条数据到 XHuntHotVoteComments 表`);

      if (votes.length > 0) {
        await XHuntHotVoteRecord.bulkCreate(votes, { transaction });
        console.log(`✅ 成功写入 ${votes.length} 条数据到 XHuntHotVoteRecords 投票流水表`);
      }

      await transaction.commit();
      console.log("🎉 数据库事务已提交，全部假数据落库成功！\n");
    } catch (err) {
      await transaction.rollback();
      console.error("❌ 数据入库失败，事务已回滚:", err);
      return;
    }

    // 刷新 Redis 缓存
    try {
      const {
        invalidateTopicCommentsCache,
        invalidateTopicVotesCache,
      } = require("../src/xhunt/utils/hot-vote-cache");
      const { getRedisClient } = require("../src/lib/redisClient");
      const redisClient = await getRedisClient().catch(() => null);

      if (redisClient && redisClient.isOpen) {
        await invalidateTopicCommentsCache(redisClient, topic.id);
        if (votes.length > 0) {
          await invalidateTopicVotesCache(redisClient, topic.id);
        }
        console.log(`⚡ 已成功刷新议题 ${topic.id} 的 Redis 缓存版本号`);
      } else {
        console.log(`💡 提示: 若接口开启了 Redis 缓存，可执行以下命令清除旧缓存或使版本失效:`);
        console.log(`   redis-cli INCR hotvote:version:comments:${topic.id}`);
        if (votes.length > 0) {
          console.log(`   redis-cli INCR hotvote:version:votes:${topic.id}`);
          console.log(`   redis-cli DEL hotvote:counts:${topic.id}`);
        }
      }
    } catch (e) {
      console.warn("刷新 Redis 缓存提醒:", e.message);
    }

    console.log("\n🚀 操作完成！请前往管理后台或前台页面刷新查看议题留言。");
  } finally {
    if (pgInstance) {
      await pgInstance.close().catch(() => {});
    }
  }
}

run().catch((err) => {
  console.error("脚本运行异常:", err);
  process.exit(1);
});
