const axios = require("axios");
const retry = require("async-retry");

// 统一的登录 Cookie，与旧爬虫保持一致
const LOGIN_COOKIE_STRING = [
  "_ga=GA1.1.1402673237.1726906805",
  "i18n_redirected=en",
  "rd_v1.theme=light",
  "rd_v1.uuid=d61dd521-025b-4858-9a4d-2879bd62c381",
  "rd_v1.currency=FIAT_USD",
  "rd_v1.auth._token.local1=false",
  "rd_v1.auth._token_expiration.local1=false",
  "rd_v1.auth.strategy=local3",
  "rd_v1.auth._token.local3=f9z34n5sby-70155-58-k68qapsgjb-1761787942202",
  "rd_v1.auth._token_expiration.local3=1764379950916",
  "_ga_TXPS04VGH2=GS2.1.s1761793200$o126$g1$t1761795302$j43$l0$h0",
].join("; ");

/**
 * 使用 axios 拉取 HTML，自动重试
 * @param {string} url
 * @param {number} [maxRetries=3]
 * @returns {Promise<string>} HTML 字符串
 */
async function fetchHtml(url, maxRetries = 3) {
  const res = await retry(
    async (bail, attempt) => {
      try {
        const response = await axios.get(url, {
          timeout: 20000,
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
            Accept:
              "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
            "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
            "Accept-Encoding": "gzip, deflate, br, zstd",
            "Cache-Control": "max-age=0",
            Connection: "keep-alive",
            Cookie: LOGIN_COOKIE_STRING,
            "Sec-Ch-Ua":
              '"Google Chrome";v="141", "Not?A_Brand";v="8", "Chromium";v="141"',
            "Sec-Ch-Ua-Mobile": "?0",
            "Sec-Ch-Ua-Platform": '"macOS"',
            "Sec-Fetch-Dest": "document",
            "Sec-Fetch-Mode": "navigate",
            "Sec-Fetch-Site": "same-origin",
            "Sec-Fetch-User": "?1",
            "Upgrade-Insecure-Requests": "1",
          },
          maxRedirects: 0,
          validateStatus: (status) => status >= 200 && status < 400,
        });
        return response.data;
      } catch (err) {
        // 遇到重定向直接终止重试
        if (
          err.response &&
          err.response.status >= 300 &&
          err.response.status < 400
        ) {
          bail(new Error(`Redirect to ${err.response.headers.location}`));
          return;
        }
        throw err;
      }
    },
    {
      retries: maxRetries,
      minTimeout: 1000,
      factor: 2,
    }
  );

  return typeof res === "string" ? res : res.toString("utf8");
}

module.exports = { fetchHtml };
