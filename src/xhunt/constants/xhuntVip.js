// XHunt VIP usernames (handles)
// Exported as a Set for efficient membership checks

const XHUNT_VIP = new Set([
  "kotaweb3",
  "sea_bitcoin",
  "floriat96249",
  "luoyukun4",
  "alpha_gege",
  "defiteddy2020",
  "maid_crypto",
  "paris13jeanne",
  "momochenming",
  "mimoo1201",
  "vvickym2",
  "web3annie",
  "charles48011843",
  "bocaibocai_",
  "0x_xifeng",
  "meta8mate",
  "zohanlin",
  "qqzsss",
  "0xallen888",
  "neohexwu",
  "scarlettweb3",
  "airdropalchemis",
  "timbro_bro",
  "blocktvbee",
  "0xmoon6626",
  "captain_kent",
  "border_crypto",
  "drbitcoin36",
  "bclaobai",
  "love_doge123",
  "0xcryptohowe",
  "monica_xiaom",
  "aisunny224737",
  "cyrus_g3",
  "0xjuliechen",
  "chaozuoye",
  "unaiyang",
  "viregeek",
  "ru7longcrypto",
  "eleveresearch",
  "0xjasonli",
  "dabiaogeggg",
  "kuigas",
  "tmel0211",
  "rocky_bitcoin",
  "btw0205",
  "fishkiller",
  "alvin0617",
  "0xbeyondlee",
  "cryptopainter_x",
  "0x_todd",
  "luyaoyuan1",
  "candydao_leaf",
  "web3feng",
  "jason_chen998",
  "wuhuoqiu",
  "broleonaus",
  "guomin184935",
  "jesse_meta",
	"cuegod001",
	"xyiduo",
	"zdxg119",
	"bcointrader",
  "cryptopomelocat",
  "meta7sol",
  "gamefi_ez",
  "baili1018",
  "qklxsqf",
  "crypto_pumpman",
  "crypto_he",
  "yueya_eth",
  "wang_xiaolou",
  "xingpt",
  "wenxue600",
  "airdrop_guard",
  "jay21871836",
  "egyptk6",
  "joensmoon",
  "mej50749",
  "guiguziben",
  "xingxingjun8888",
  "taowang1",
  "btcpiggy",
  "liushezhang",
  "wwtlitee",
  "web3sistera",
  "amelia_xuu",
  "s_memek",
  "dabiaoge",
  "nftsiy",
  "gcsbtc",
  "cheuk_baby",
  "egyptk6",
  "0xborder",
  "abyssofgambling",
  "flyiiawei"
]);

const INTERNAL_TEST_USERS = new Set([
  "defiteddy2020",
  "biteye_sister",
  "alpha_gege",
  "cuegod001",
  "xhuntcn",
  "web3sistera",
  "s_memek",
  "luoyukun4",
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
