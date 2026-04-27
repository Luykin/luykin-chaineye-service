// 一次性脚本：将当前硬编码的 VIP / 内测名单导入数据库
// 用法: node scripts/seed-vip-lists.js
// 执行前请确保数据库连接正常（PG_HOST 等环境变量已配置）

require("dotenv").config({
  path: `${process.env.NODE_ENV === "development" ? ".env-dev" : ".env-pro"}`,
});

const { setupPostgres, XhuntVipTestUser } = require("../src/models/postgres-start");

const VIP_USERNAMES = [
  "LuykinAI", "kotaweb3", "Sea_Bitcoin", "FloriaT96249", "alpha_gege",
  "DeFiTeddy2020", "maid_crypto", "Paris13Jeanne", "momochenming", "Rita88",
  "vvickym2", "web3annie", "charles48011843", "bocaibocai_", "0x_xifeng",
  "Meta8Mate", "zohanlin", "qqzsss", "0xAllen888", "NeohexWu",
  "ScarlettWeb3", "AirdropAlchemis", "timbrobro", "blockTVBee", "0xMoon6626",
  "captain_kent", "0xborder", "DRbitcoin36", "bclaobai", "love_doge123",
  "0xcryptoHowe", "Monica_xiaoM", "aiSunny224737", "Cyrus_G3", "0xJuliechen",
  "chaozuoye", "unaiyang", "VireGeek", "Ru7Longcrypto", "EleveResearch",
  "0xjasonli", "dabiaoge", "KuiGas", "tmel0211", "Rocky_Bitcoin",
  "Bitwux", "fishkiller", "Alvin0617", "0xBeyondLee", "CryptoPainter",
  "0xTodd", "luyaoyuan", "CandyDAO_leaf", "Web3Feng", "jason_chen998",
  "Wuhuoqiu", "BroLeon", "Guomin184935", "jessezheng", "cuegod001",
  "XYiduo", "zdxg119", "bcointrader", "CryptoPomeloCat", "meta7sol",
  "GameFI_EZ", "Baili1018", "qklxsqf", "crypto_pumpman", "Crypto_He",
  "yueya_eth", "wang_xiaolou", "xingpt", "wenxue600", "Airdrop_Guard",
  "Jay21871836", "egyptk6", "Joensmoon", "MEJ50749", "guiguziben",
  "xingxingjun8888", "taowang1", "btcpiggy", "liushezhang", "WWTLitee",
  "Web3SisterA", "amelia_xuu", "S_memek", "nftsiy", "gcsbtc",
  "cheuk_baby", "abyssofgambling", "flyiiawei", "TTMBbo", "shouyi16",
  "dakuan_x", "wuliao_btc", "0xshunshun", "ZhanweiC", "BitKieran",
  "0xsmall_", "qingerqq2024", "wangchangfu88", "candywantfly1", "HYSFL1",
  "Web3Veteran1", "weiyu320169", "Siberiaxx1909", "PWenzhen76938", "QF88688",
  "aiqiang888", "jiroucaigou", "BongePlanet", "Multichannel_", "web3_dadgod",
  "hisevenih", "btcmiko", "anchornode", "0xXiaoXiong", "xx03199",
  "artistkatty_", "JiuHuangBuHuang", "AntBTC", "sparkwang9", "JIBAIWeb3",
  "UFoust13797", "lianyanshe", "spark888", "imwudi666"
];

const INTERNAL_TEST_USERNAMES = [
  "defiteddy2020", "biteye_sister", "alpha_gege", "cuegod001",
  "xhuntcn", "web3sistera", "s_memek", "luoyukun4", "shouyi16",
  "TTMBbo", "LuykinAI"
];

async function seed() {
  await setupPostgres();

  let vipCount = 0;
  let internalCount = 0;

  for (const username of VIP_USERNAMES) {
    const name = username.toLowerCase().trim();
    if (!name) continue;
    const [_, created] = await XhuntVipTestUser.findOrCreate({
      where: { username: name, listType: "vip" },
      defaults: { username: name, listType: "vip" },
    });
    if (created) vipCount++;
  }

  for (const username of INTERNAL_TEST_USERNAMES) {
    const name = username.toLowerCase().trim();
    if (!name) continue;
    const [_, created] = await XhuntVipTestUser.findOrCreate({
      where: { username: name, listType: "internal_test" },
      defaults: { username: name, listType: "internal_test" },
    });
    if (created) internalCount++;
  }

  console.log(`[seed-vip-lists] 完成: 新增 VIP ${vipCount} 人, 新增内测 ${internalCount} 人`);
  const total = await XhuntVipTestUser.findAll({
    attributes: ["listType"],
    raw: true,
  });
  const totalVip = total.filter((r) => r.listType === "vip").length;
  const totalInternal = total.filter((r) => r.listType === "internal_test").length;
  console.log(`[seed-vip-lists] 当前数据库总计: VIP ${totalVip} 人, 内测 ${totalInternal} 人`);
  process.exit(0);
}

seed().catch((err) => {
  console.error("[seed-vip-lists] 失败:", err);
  process.exit(1);
});
