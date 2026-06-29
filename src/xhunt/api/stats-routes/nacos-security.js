const express = require("express");
const axios = require("axios");
const crypto = require("crypto");
const path = require("path");
const fs = require("fs").promises;
const fsSync = require("fs");
const {
  adminAuth,
  requirePermission,
} = require("../../../admin/middleware/adminAuth");
const { logAdminAction } = require("./shared");

const router = express.Router();

const CHECK_TIMEOUT_MS = Number(process.env.NACOS_SECURITY_CHECK_TIMEOUT_MS || 5000);
const MAX_RESPONSE_BYTES = Number(process.env.NACOS_SECURITY_MAX_RESPONSE_BYTES || 256 * 1024);
const PROBE_DATA_ID = "__xhunt_security_probe_not_exist__";
const DEFAULT_GROUP = "DEFAULT_GROUP";

const SENSITIVE_KEY_PATTERNS = [
  /password/i,
  /passwd/i,
  /secret/i,
  /token/i,
  /private[_-]?key/i,
  /access[_-]?key/i,
  /api[_-]?key/i,
  /jwt/i,
  /redis/i,
  /pg[_-]?password/i,
  /database[_-]?url/i,
  /dsn/i,
  /webhook/i,
];

function findProjectRoot(startDir) {
  let currentDir = startDir;

  while (true) {
    const hasPackageJson = fsSync.existsSync(path.join(currentDir, "package.json"));
    const hasAdminWeb = fsSync.existsSync(path.join(currentDir, "admin-web"));

    if (hasPackageJson && hasAdminWeb) {
      return currentDir;
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      return path.resolve(__dirname, "../../../..");
    }

    currentDir = parentDir;
  }
}

const PROJECT_ROOT = process.env.PROJECT_ROOT
  ? path.resolve(process.env.PROJECT_ROOT)
  : findProjectRoot(__dirname);

function normalizeOrigin(value) {
  const raw = String(value || "").trim().replace(/\/+$/, "");
  if (!raw) return "";
  try {
    const url = new URL(raw);
    if (!["http:", "https:"].includes(url.protocol)) return "";
    return `${url.protocol}//${url.host}`;
  } catch (e) {
    return "";
  }
}

function getCheckOrigin(req) {
  const configured = normalizeOrigin(process.env.NACOS_SECURITY_CHECK_ORIGIN);
  if (configured) return configured;

  const forwardedProto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim();
  const forwardedHost = String(req.headers["x-forwarded-host"] || "").split(",")[0].trim();
  const proto = forwardedProto || req.protocol || "https";
  const host = forwardedHost || req.get("host");
  return normalizeOrigin(`${proto}://${host}`);
}

function sha256(value) {
  return crypto.createHash("sha256").update(value || "").digest("hex");
}

function truncateText(value, max = 2048) {
  const text = String(value || "");
  return text.length > max ? `${text.slice(0, max)}...[truncated]` : text;
}

function detectSensitiveKeys(text) {
  const source = String(text || "");
  const keys = new Set();
  const keyValueRegex = /["']?([A-Za-z0-9_.-]*(?:password|passwd|secret|token|private[_-]?key|access[_-]?key|api[_-]?key|jwt|redis|pg[_-]?password|database[_-]?url|dsn|webhook)[A-Za-z0-9_.-]*)["']?\s*[:=]/gi;
  let match;
  while ((match = keyValueRegex.exec(source)) && keys.size < 20) {
    keys.add(match[1]);
  }

  if (!keys.size) {
    SENSITIVE_KEY_PATTERNS.forEach((pattern) => {
      if (pattern.test(source)) keys.add(pattern.source.replace(/\\/g, ""));
    });
  }

  return Array.from(keys).slice(0, 20);
}

function summarizeBody(data) {
  let body = "";
  if (typeof data === "string") {
    body = data;
  } else if (Buffer.isBuffer(data)) {
    body = data.toString("utf8");
  } else if (data !== undefined && data !== null) {
    try {
      body = JSON.stringify(data);
    } catch (e) {
      body = String(data);
    }
  }

  return {
    contentLength: Buffer.byteLength(body, "utf8"),
    bodySha256: body ? sha256(body) : null,
    detectedSensitiveKeys: detectSensitiveKeys(body),
    sample: body ? redactSample(body) : "",
  };
}

function redactSample(text) {
  const sample = truncateText(text, 1500);
  return sample
    .replace(/([A-Za-z0-9_.-]*(?:password|passwd|secret|token|private[_-]?key|access[_-]?key|api[_-]?key|jwt|dsn)[A-Za-z0-9_.-]*["']?\s*[:=]\s*)["']?[^,"'\n\r}]+/gi, "$1[REDACTED]")
    .replace(/(accessToken["']?\s*[:=]\s*)["']?[^,"'\n\r}]+/gi, "$1[REDACTED]");
}

function statusTone(status) {
  if (status === 401 || status === 403) return "blocked";
  if (status === 404 || status === 405) return "not_found";
  if (status >= 200 && status < 300) return "success";
  if (status >= 400 && status < 500) return "client_error";
  if (status >= 500) return "server_error";
  return "unknown";
}

function makeCheck({ id, title, method, path: checkPath, category, expectedBlocked = true, riskWhenReachable = "high", recommendation }) {
  return { id, title, method, path: checkPath, category, expectedBlocked, riskWhenReachable, recommendation };
}

function getRuntimeChecks() {
  const query = `dataId=${encodeURIComponent(PROBE_DATA_ID)}&group=${encodeURIComponent(DEFAULT_GROUP)}`;
  return [
    makeCheck({
      id: "nacos-configs-read",
      title: "/nacos-configs 未授权读取探测",
      method: "GET",
      path: `/nacos-configs?${query}`,
      category: "public_proxy",
      riskWhenReachable: "critical",
      recommendation: "关闭 /nacos-configs，或改为后端白名单只读代理并增加 adminAuth / 内部签名。",
    }),
    makeCheck({
      id: "nacos-configs-write-post",
      title: "/nacos-configs 写入入口探测（无效 payload，不写真实配置）",
      method: "POST",
      path: "/nacos-configs",
      category: "public_proxy",
      riskWhenReachable: "critical",
      recommendation: "禁止公网直连 Nacos 写接口；至少在 Nginx 层拒绝 POST/PUT/DELETE。",
    }),
    makeCheck({
      id: "nacos-configs-delete",
      title: "/nacos-configs 删除入口探测（不存在 dataId）",
      method: "DELETE",
      path: `/nacos-configs?${query}`,
      category: "public_proxy",
      riskWhenReachable: "critical",
      recommendation: "禁止公网直连 Nacos 删除接口；写操作只允许后端管理接口在鉴权后执行。",
    }),
    makeCheck({
      id: "nacos-configs-options",
      title: "/nacos-configs CORS 与方法暴露检查",
      method: "OPTIONS",
      path: "/nacos-configs",
      category: "cors",
      expectedBlocked: false,
      riskWhenReachable: "high",
      recommendation: "配置中心接口不应返回 Access-Control-Allow-Origin:* 或允许 POST/DELETE 等跨域方法。",
    }),
    makeCheck({
      id: "nacos-root-basic-auth",
      title: "/nacos/ 入口 Basic Auth 检查",
      method: "GET",
      path: "/nacos/",
      category: "console",
      riskWhenReachable: "medium",
      recommendation: "整个 /nacos/ 前缀应统一加 Basic Auth、IP 白名单或直接关闭公网访问。",
    }),
    makeCheck({
      id: "nacos-index-bypass",
      title: "/nacos/index.html 绕过入口认证检查",
      method: "GET",
      path: "/nacos/index.html",
      category: "console",
      riskWhenReachable: "high",
      recommendation: "不要只保护 location = /nacos/；应保护 location ^~ /nacos/。",
    }),
    makeCheck({
      id: "nacos-api-configs-bypass",
      title: "/nacos/v1/cs/configs 原生 API 暴露检查",
      method: "GET",
      path: `/nacos/v1/cs/configs?${query}`,
      category: "native_api",
      riskWhenReachable: "critical",
      recommendation: "Nacos 原生 API 不应公网暴露；如果必须代理，应先过 Nginx/后端鉴权。",
    }),
    makeCheck({
      id: "nacos-server-state",
      title: "/nacos/v1/console/server/state 信息泄露检查",
      method: "GET",
      path: "/nacos/v1/console/server/state",
      category: "native_api",
      riskWhenReachable: "high",
      recommendation: "禁止未授权访问 Nacos console/server/state 等状态接口。",
    }),
  ];
}

function classifyRuntimeResult(check, response) {
  if (response.error) {
    return {
      severity: "low",
      passed: false,
      conclusion: `请求失败：${response.error}`,
    };
  }

  const status = response.status;
  const tone = statusTone(status);
  const allowMethods = String(response.headers?.["access-control-allow-methods"] || "");
  const allowOrigin = String(response.headers?.["access-control-allow-origin"] || "");
  const bodySummary = response.bodySummary || {};
  const hasSensitive = Array.isArray(bodySummary.detectedSensitiveKeys) && bodySummary.detectedSensitiveKeys.length > 0;

  if (check.id === "nacos-configs-options") {
    const exposesWrite = /POST|PUT|DELETE/i.test(allowMethods);
    const allowCredentials = String(response.headers?.["access-control-allow-credentials"] || "").toLowerCase() === "true";
    const wildcardWithCredentials = allowOrigin === "*" && allowCredentials;
    if (exposesWrite || wildcardWithCredentials) {
      return {
        severity: "high",
        passed: false,
        conclusion: `CORS 过宽：Origin=${allowOrigin || "-"} Methods=${allowMethods || "-"}`,
      };
    }
    return {
      severity: "pass",
      passed: true,
      conclusion: "未发现明显 CORS 写方法暴露。",
    };
  }

  if (tone === "blocked") {
    return { severity: "pass", passed: true, conclusion: `已被 ${status} 拦截。` };
  }

  if (tone === "not_found") {
    return { severity: "pass", passed: true, conclusion: `返回 ${status}，未发现入口可用。` };
  }

  if (status >= 200 && status < 300) {
    return {
      severity: hasSensitive ? "critical" : check.riskWhenReachable,
      passed: false,
      conclusion: hasSensitive
        ? `未授权请求返回成功并疑似包含敏感键：${bodySummary.detectedSensitiveKeys.join(", ")}`
        : "未授权请求返回成功，说明入口可被访问。",
    };
  }

  if (status === 400 || status === 422) {
    return {
      severity: check.category === "console" ? "medium" : "high",
      passed: false,
      conclusion: `返回 ${status} 参数/业务错误，说明请求可能已经绕过外层鉴权进入上游逻辑。`,
    };
  }

  if (status >= 500) {
    return {
      severity: "high",
      passed: false,
      conclusion: `返回 ${status} 上游错误，说明请求可能已经触达 Nacos 或代理层。`,
    };
  }

  return {
    severity: "medium",
    passed: false,
    conclusion: `返回 ${status}，需要人工确认是否绕过鉴权。`,
  };
}

async function runHttpCheck(origin, check) {
  const url = `${origin}${check.path}`;
  const startedAt = Date.now();
  const headers = {
    Accept: "application/json,text/plain,*/*",
    "User-Agent": "XHunt-Admin-Nacos-Security-Check/1.0",
  };

  let data;
  if (check.method === "POST") {
    data = new URLSearchParams({
      dataId: "",
      group: DEFAULT_GROUP,
      content: "",
      type: "text",
    }).toString();
    headers["Content-Type"] = "application/x-www-form-urlencoded";
  }

  try {
    const resp = await axios({
      method: check.method,
      url,
      data,
      headers,
      timeout: CHECK_TIMEOUT_MS,
      maxRedirects: 0,
      maxContentLength: MAX_RESPONSE_BYTES,
      validateStatus: () => true,
      transformResponse: [(body) => body],
    });
    const durationMs = Date.now() - startedAt;
    const responseHeaders = {
      "content-type": resp.headers?.["content-type"],
      "www-authenticate": resp.headers?.["www-authenticate"],
      "access-control-allow-origin": resp.headers?.["access-control-allow-origin"],
      "access-control-allow-methods": resp.headers?.["access-control-allow-methods"],
      "access-control-allow-credentials": resp.headers?.["access-control-allow-credentials"],
      location: resp.headers?.location,
      server: resp.headers?.server,
    };
    const bodySummary = summarizeBody(resp.data);
    const classified = classifyRuntimeResult(check, { status: resp.status, headers: responseHeaders, bodySummary });

    return {
      ...check,
      url: check.path,
      status: resp.status,
      durationMs,
      headers: responseHeaders,
      bodySummary,
      ...classified,
    };
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    const message = error.code === "ERR_FR_TOO_MANY_REDIRECTS"
      ? "重定向过多"
      : error.code === "ECONNABORTED"
        ? "请求超时"
        : error.message || "请求失败";
    return {
      ...check,
      url: check.path,
      status: error.response?.status || null,
      durationMs,
      headers: {},
      bodySummary: summarizeBody(error.response?.data || ""),
      severity: "low",
      passed: false,
      conclusion: message,
      error: message,
    };
  }
}

function severityRank(severity) {
  return { pass: 0, low: 1, medium: 2, high: 3, critical: 4 }[severity] || 0;
}

function overallSeverity(items) {
  return items.reduce((max, item) => (severityRank(item.severity) > severityRank(max) ? item.severity : max), "pass");
}

function getLine(content, pattern) {
  const lines = content.split(/\r?\n/);
  const index = lines.findIndex((line) => pattern.test(line));
  if (index < 0) return null;
  return { line: index + 1, text: lines[index].trim() };
}

function getLocationBlock(content, startPattern) {
  const lines = content.split(/\r?\n/);
  const startIndex = lines.findIndex((line) => startPattern.test(line));
  if (startIndex < 0) return null;

  const blockLines = [];
  let depth = 0;
  for (let index = startIndex; index < lines.length; index += 1) {
    const line = lines[index];
    blockLines.push({ line: index + 1, text: line });
    depth += (line.match(/{/g) || []).length;
    depth -= (line.match(/}/g) || []).length;
    if (index > startIndex && depth <= 0) break;
  }
  return blockLines;
}

function getLineInBlock(block, pattern) {
  if (!block) return null;
  const found = block.find((line) => pattern.test(line.text));
  return found ? { line: found.line, text: found.text.trim() } : null;
}

async function scanNginxConfig() {
  const configuredPath = process.env.NACOS_SECURITY_NGINX_CONFIG_PATH;
  const configPath = configuredPath
    ? path.resolve(configuredPath)
    : path.join(PROJECT_ROOT, "nginx", "kb.cryptohunt.ai.conf");

  try {
    const content = await fs.readFile(configPath, "utf8");
    const findings = [];
    const nacosConfigsBlock = getLocationBlock(content, /location\s+(?:\^~\s+)?\/nacos-configs\b/);
    const nacosConfigsLine = nacosConfigsBlock?.[0]
      ? { line: nacosConfigsBlock[0].line, text: nacosConfigsBlock[0].text.trim() }
      : null;
    const nacosConfigsBlockText = nacosConfigsBlock
      ? nacosConfigsBlock.map((line) => line.text).join("\n")
      : "";
    const nacosConfigsProxy = getLineInBlock(nacosConfigsBlock, /proxy_pass\s+http:\/\/127\.0\.0\.1:8848\/nacos\/v1\/cs\/configs/);
    const allowWriteMethods = getLineInBlock(nacosConfigsBlock, /Access-Control-Allow-Methods.*(?:POST|PUT|DELETE)/i);
    const wildcardCors = getLineInBlock(nacosConfigsBlock, /Access-Control-Allow-Origin\s+"?\*"?/i);
    const allowCredentials = getLineInBlock(nacosConfigsBlock, /Access-Control-Allow-Credentials\s+"?true"?/i);
    const readOnlyMethodGuard = getLineInBlock(nacosConfigsBlock, /\$request_method\s+!~\s+\^\(GET\|HEAD\)\$/)
      || getLineInBlock(nacosConfigsBlock, /limit_except\s+(?:GET|HEAD|OPTIONS)/i);
    const dataIdWhitelist = getLineInBlock(nacosConfigsBlock, /\$arg_dataId\s+!~\s+\^\([^)]*xhunt_config/);
    const groupWhitelist = getLineInBlock(nacosConfigsBlock, /\$arg_group\s+!=\s+"DEFAULT_GROUP"/);
    const publicDataIds = [
      "xhunt_config",
      "xhunt_i18n",
      "xhunt_campaigns",
      "xhunt_built_in_tag",
      "xhunt_built_in_tag_en",
      "xhunt_message",
    ];
    const hasExpectedDataIdWhitelist = publicDataIds.every((dataId) => nacosConfigsBlockText.includes(dataId));
    const hasReadOnlyCors = !allowWriteMethods && /Access-Control-Allow-Methods\s+"GET,\s*HEAD,\s*OPTIONS"/i.test(nacosConfigsBlockText);
    const hasNoCredentialCors = !allowCredentials;
    const nacosConfigsReadOnlyWhitelistOk = !!(
      nacosConfigsLine &&
      nacosConfigsProxy &&
      readOnlyMethodGuard &&
      dataIdWhitelist &&
      groupWhitelist &&
      hasExpectedDataIdWhitelist &&
      hasReadOnlyCors &&
      hasNoCredentialCors
    );
    const exactNacosAuth = getLine(content, /location\s+=\s+\/nacos\//);
    const unauthNacosApi = getLine(content, /location\s+~\s+\^\/nacos\/\(v1\|v2\|v3\|console/);
    const unauthNacosPrefix = getLine(content, /location\s+\/nacos\//);

    if (nacosConfigsReadOnlyWhitelistOk) {
      findings.push({
        id: "nginx-nacos-configs-public-readonly-whitelist",
        severity: "pass",
        title: "Nginx /nacos-configs 已限制为公网只读白名单",
        evidence: [nacosConfigsLine, nacosConfigsProxy, readOnlyMethodGuard, dataIdWhitelist, groupWhitelist].filter(Boolean),
        conclusion: "/nacos-configs 仍代理 Nacos 原生读取接口，但已限制 GET/HEAD、dataId 白名单、DEFAULT_GROUP，且未开放写方法或 credentials。",
        recommendation: "保持白名单最小化；新增 dataId 前确认不含密钥、token、数据库连接串等敏感字段。",
        passed: true,
      });
    } else if (nacosConfigsLine && nacosConfigsProxy) {
      findings.push({
        id: "nginx-nacos-configs-public-proxy",
        severity: "critical",
        title: "Nginx 暴露 /nacos-configs 到 Nacos 原生配置接口",
        evidence: [nacosConfigsLine, nacosConfigsProxy, readOnlyMethodGuard, dataIdWhitelist, groupWhitelist].filter(Boolean),
        conclusion: "/nacos-configs 直接反代到 /nacos/v1/cs/configs，但未同时发现只读方法限制、dataId 白名单和 group 白名单。",
        recommendation: "公网只读入口必须同时限制 GET/HEAD、dataId 白名单和 group 白名单；写配置只能走后端鉴权接口。",
      });
    }

    if (allowWriteMethods) {
      findings.push({
        id: "nginx-nacos-configs-write-methods",
        severity: "critical",
        title: "/nacos-configs 允许写入/删除类 HTTP 方法",
        evidence: [allowWriteMethods],
        conclusion: "配置中心代理暴露 GET/POST/PUT/DELETE/OPTIONS，写操作入口风险过高。",
        recommendation: "公网入口禁止 POST/PUT/DELETE；写配置只能走 adminAuth + 权限校验后的后端接口。",
      });
    }

    if (wildcardCors && (allowCredentials || allowWriteMethods)) {
      findings.push({
        id: "nginx-nacos-configs-wildcard-cors",
        severity: "high",
        title: "Nginx 对配置中心接口返回 Access-Control-Allow-Origin:*",
        evidence: [wildcardCors, allowCredentials, allowWriteMethods].filter(Boolean),
        conclusion: "配置中心接口使用通配 CORS 时，不应同时允许 credentials 或写入类方法。",
        recommendation: "公开只读配置可使用 Origin:*，但必须仅允许 GET/HEAD/OPTIONS，且不能返回 Access-Control-Allow-Credentials:true。",
      });
    }

    if (exactNacosAuth && (unauthNacosApi || unauthNacosPrefix)) {
      findings.push({
        id: "nginx-nacos-basic-auth-bypass",
        severity: "high",
        title: "/nacos/ 只保护精确入口，其他 Nacos 路径可能绕过 Basic Auth",
        evidence: [exactNacosAuth, unauthNacosApi, unauthNacosPrefix].filter(Boolean),
        conclusion: "location = /nacos/ 只匹配精确路径；/nacos/v1/...、/nacos/index.html 等路径可能进入无认证 location。",
        recommendation: "将认证放到 location ^~ /nacos/，或完全关闭公网 Nacos 代理。",
      });
    }

    return {
      path: path.relative(PROJECT_ROOT, configPath) || configPath,
      exists: true,
      findings,
    };
  } catch (error) {
    return {
      path: path.relative(PROJECT_ROOT, configPath) || configPath,
      exists: false,
      findings: [
        {
          id: "nginx-config-read-failed",
          severity: "low",
          title: "未能读取 Nginx 配置文件",
          evidence: [],
          conclusion: error.message || "读取失败",
          recommendation: "确认 NACOS_SECURITY_NGINX_CONFIG_PATH 或仓库中的 nginx/kb.cryptohunt.ai.conf 是否存在。",
        },
      ],
    };
  }
}

router.post(
  "/security/nacos/check",
  adminAuth,
  requirePermission(["security-check", "nacos_config"]),
  async (req, res) => {
    const startedAt = Date.now();
    try {
      const origin = getCheckOrigin(req);
      if (!origin) {
        return res.status(400).json({ success: false, error: "无法确定检测目标 Origin" });
      }

      const [nginxScan, runtimeChecks] = await Promise.all([
        scanNginxConfig(),
        Promise.all(getRuntimeChecks().map((check) => runHttpCheck(origin, check))),
      ]);

      const allFindings = [...(nginxScan.findings || []), ...runtimeChecks];
      const severity = overallSeverity(allFindings);
      const summary = {
        severity,
        checkedAt: new Date().toISOString(),
        origin,
        durationMs: Date.now() - startedAt,
        total: allFindings.length,
        failed: allFindings.filter((item) => item.passed === false || item.severity !== "pass").length,
        critical: allFindings.filter((item) => item.severity === "critical").length,
        high: allFindings.filter((item) => item.severity === "high").length,
        medium: allFindings.filter((item) => item.severity === "medium").length,
      };

      await logAdminAction(req, {
        action: "nacos-security-check",
        success: severityRank(severity) < severityRank("high"),
        message: `severity=${severity} origin=${origin} critical=${summary.critical} high=${summary.high}`,
      });

      res.json({
        success: true,
        data: {
          summary,
          nginx: nginxScan,
          runtimeChecks,
          notes: [
            "运行时探测只请求固定路径，不允许前端传任意 URL。",
            "POST/DELETE 使用无效或不存在 dataId，不写入真实配置。",
            "响应内容仅保留长度、hash、敏感键摘要和脱敏 sample。",
          ],
        },
      });
    } catch (error) {
      console.error("[nacos-security-check] failed:", error);
      await logAdminAction(req, {
        action: "nacos-security-check",
        success: false,
        message: error.message || "failed",
      }).catch(() => {});
      res.status(500).json({ success: false, error: error.message || "Nacos 安全检查失败" });
    }
  }
);

module.exports = router;
