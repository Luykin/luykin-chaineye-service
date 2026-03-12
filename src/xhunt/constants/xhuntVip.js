// XHunt VIP usernames (handles)
// Exported as a Set for efficient membership checks

const XHUNT_VIP = new Set([
  "LuykinAI",
  "kotaweb3",
  "Sea_Bitcoin",
  "FloriaT96249",
  "alpha_gege",
  "DeFiTeddy2020",
  "maid_crypto",
  "Paris13Jeanne",
  "momochenming",
  "Rita88",
  "vvickym2",
  "web3annie",
  "charles48011843",
  "bocaibocai_",
  "0x_xifeng",
  "Meta8Mate",
  "zohanlin",
  "qqzsss",
  "0xAllen888",
  "NeohexWu",
  "ScarlettWeb3",
  "AirdropAlchemis",
  "timbrobro",
  "blockTVBee",
  "0xMoon6626",
  "captain_kent",
  "0xborder",
  "DRbitcoin36",
  "bclaobai",
  "love_doge123",
  "0xcryptoHowe",
  "Monica_xiaoM",
  "aiSunny224737",
  "Cyrus_G3",
  "0xJuliechen",
  "chaozuoye",
  "unaiyang",
  "VireGeek",
  "Ru7Longcrypto",
  "EleveResearch",
  "0xjasonli",
  "dabiaoge",
  "KuiGas",
  "tmel0211",
  "Rocky_Bitcoin",
  "Bitwux",
  "fishkiller",
  "Alvin0617",
  "0xBeyondLee",
  "CryptoPainter",
  "0xTodd",
  "luyaoyuan",
  "CandyDAO_leaf",
  "Web3Feng",
  "jason_chen998",
  "Wuhuoqiu",
  "BroLeon",
  "Guomin184935",
  "jessezheng",
  "cuegod001",
  "XYiduo",
  "zdxg119",
  "bcointrader",
  "CryptoPomeloCat",
  "meta7sol",
  "GameFI_EZ",
  "Baili1018",
  "qklxsqf",
  "crypto_pumpman",
  "Crypto_He",
  "yueya_eth",
  "wang_xiaolou",
  "xingpt",
  "wenxue600",
  "Airdrop_Guard",
  "Jay21871836",
  "egyptk6",
  "Joensmoon",
  "MEJ50749",
  "guiguziben",
  "xingxingjun8888",
  "taowang1",
  "btcpiggy",
  "liushezhang",
  "WWTLitee",
  "Web3SisterA",
  "amelia_xuu",
  "S_memek",
  "dabiaoge",
  "nftsiy",
  "gcsbtc",
  "cheuk_baby",
  "egyptk6",
  "0xborder",
  "abyssofgambling",
  "flyiiawei",
  "TTMBbo",
	"shouyi16",
  "dakuan_x",
  "wuliao_btc",
  "0xshunshun",
  "ZhanweiC",
  "BitKieran",
  "0xsmall_",
  "qingerqq2024",
  "wangchangfu88",
  "candywantfly1",
  "HYSFL1",
  "Web3Veteran1",
  "weiyu320169",
  "Siberiaxx1909",
  "PWenzhen76938",
  "QF88688",
  "aiqiang888",
  "jiroucaigou",
  "BongePlanet",
  "Multichannel_",
  "web3_dadgod",
  "hisevenih",
  "btcmiko",
  "anchornode",
  "0xXiaoXiong",
  "xx03199",
  "artistkatty_",
  "JiuHuangBuHuang",
  "AntBTC",
  "sparkwang9",
  "JIBAIWeb3",
  "UFoust13797",
  "lianyanshe",
  "spark888"
].map((s) => s.toLowerCase()));

const INTERNAL_TEST_USERS = new Set([
  "defiteddy2020",
  "biteye_sister",
  "alpha_gege",
  "cuegod001",
  "xhuntcn",
  "web3sistera",
  "s_memek",
  "luoyukun4",
	"shouyi16"
]);


function isXHuntVipHandle(handle) {
  if (!handle || typeof handle !== "string") return false;
  return XHUNT_VIP.has(handle.toLowerCase());
}

function isInternalTestUserHandle(handle) {
  if (!handle || typeof handle !== "string") return false;
  return INTERNAL_TEST_USERS.has(handle.toLowerCase());
}

function isRequestXHuntVip(req) {
  try {
    const raw = req && req.headers ? req.headers["x-user-id"] : null;
    if (!raw || typeof raw !== "string") return false;
    return isXHuntVipHandle(raw);
  } catch (_) {
    return false;
  }
}

function isRequestInternalTestUser(req) {
  try {
    const raw = req && req.headers ? req.headers["x-user-id"] : null;
    if (!raw || typeof raw !== "string") return false;
    return isInternalTestUserHandle(raw);
  } catch (_) {
    return false;
  }
}

module.exports = { XHUNT_VIP, isXHuntVipHandle, isRequestXHuntVip, INTERNAL_TEST_USERS, isInternalTestUserHandle, isRequestInternalTestUser };
