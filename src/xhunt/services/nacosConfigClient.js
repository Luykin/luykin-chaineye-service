const axios = require("axios");

const NACOS_BASE_URL = process.env.NACOS_BASE_URL || "http://127.0.0.1:8848";
const NACOS_USERNAME = process.env.NACOS_USERNAME || "nacos";
const NACOS_PASSWORD = process.env.NACOS_PASSWORD || "nacos";

let nacosTokenCache = { token: null, expireAt: 0 };

async function getNacosAccessToken() {
  const now = Date.now();
  if (nacosTokenCache.token && now < nacosTokenCache.expireAt - 10_000) {
    return nacosTokenCache.token;
  }

  const resp = await axios.post(
    `${NACOS_BASE_URL}/nacos/v1/auth/users/login`,
    new URLSearchParams({
      username: NACOS_USERNAME,
      password: NACOS_PASSWORD,
    }).toString(),
    {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      timeout: 8000,
      validateStatus: () => true,
    }
  );

  if (resp.status !== 200 || !resp.data) {
    throw new Error(`Nacos 登录失败: status=${resp.status}`);
  }

  const token = resp.data.accessToken || resp.data.token || resp.data.access_token;
  const ttlSec = Number(resp.data.tokenTtl || resp.data.token_ttl || 1800);

  if (!token) {
    throw new Error("Nacos 登录失败: 未返回 accessToken");
  }

  nacosTokenCache = {
    token,
    expireAt: now + ttlSec * 1000,
  };

  return token;
}

async function nacosRequest(method, path, { params, data, headers, timeout = 10000 } = {}) {
  const token = await getNacosAccessToken();
  const url = `${NACOS_BASE_URL}${path}`;

  const resp = await axios({
    method,
    url,
    params: { ...(params || {}), accessToken: token },
    data,
    headers,
    timeout,
    validateStatus: () => true,
  });

  if (resp.status === 401 || resp.status === 403) {
    nacosTokenCache = { token: null, expireAt: 0 };
    const token2 = await getNacosAccessToken();
    return axios({
      method,
      url,
      params: { ...(params || {}), accessToken: token2 },
      data,
      headers,
      timeout,
      validateStatus: () => true,
    });
  }

  return resp;
}

async function getNacosConfigContent({ dataId, group = "DEFAULT_GROUP", tenant, timeout = 10000 }) {
  if (!dataId) {
    throw new Error("缺少 Nacos dataId");
  }

  const resp = await nacosRequest("GET", "/nacos/v1/cs/configs", {
    params: { dataId, group, ...(tenant ? { tenant } : {}) },
    timeout,
  });

  if (resp.status !== 200) {
    throw new Error(`读取 Nacos 配置失败: dataId=${dataId} status=${resp.status}`);
  }

  return typeof resp.data === "string" ? resp.data : JSON.stringify(resp.data);
}

module.exports = {
  getNacosAccessToken,
  nacosRequest,
  getNacosConfigContent,
};
