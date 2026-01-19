// 配置：目标服务器的基础接口地址（保留到open/，支持下级路径动态拼接）
const TARGET_API_BASE_URL = "https://kb.cryptohunt.ai/api/rootdatapro/open/";
// 配置：自定义超时时间
const CUSTOM_TIMEOUT = 50000; // 单位：毫秒（50s）

export default {
  async fetch(request, env, ctx) {
    // 你可以在可观测性仪表板中查看日志
    console.info({ message: '接口转发请求已接收!' });

    // 1. 封装超时Promise，用于实现50秒主动超时
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Request timed out after ${CUSTOM_TIMEOUT / 1000} seconds`));
      }, CUSTOM_TIMEOUT);
    });

    // 2. 封装核心转发业务逻辑（抽离为函数，用于Promise.race竞争）
    const forwardBusinessLogic = async () => {
      // 解析原始请求的核心信息：方法、URL、头信息
      const method = request.method;
      const originalUrl = new URL(request.url);
      const headers = new Headers(request.headers);

      // 处理路径拼接和URL参数（优化：处理requestPath前置/，避免重复斜杠）
      const requestPath = originalUrl.pathname;

      // 仅允许根路径返回 HTML（用于打开文档/落地页等）；其他路径不允许 HTML
      // 注意：Cloudflare Worker 中 requestPath 通常以 "/" 开头
      const allowHtmlResponse = requestPath === "/";

      // 核心优化：移除requestPath前置的/（若存在），避免拼接后出现//
      const normalizedRequestPath = requestPath.startsWith('/') ? requestPath.slice(1) : requestPath;
      // 拼接完整目标URL（无重复斜杠，URL格式规范）
      const fullTargetUrl = TARGET_API_BASE_URL + normalizedRequestPath + originalUrl.search;

      // 保留pro-api-key，仅删除可能泄露转发行为的头信息
      headers.delete("host");
      headers.delete("referer");
      headers.delete("origin");

      // 构建转发到目标服务器的请求（添加AbortSignal优化，终止底层网络请求）
      const forwardRequest = new Request(fullTargetUrl, {
        method: method,
        headers: headers, // 携带包含pro-api-key的所有保留头信息
        body: method !== "GET" && method !== "HEAD" ? await request.text() : null,
        redirect: "follow",
        signal: AbortSignal.timeout(CUSTOM_TIMEOUT) // 底层网络请求超时终止，释放资源
      });

      // 发送请求并获取目标服务器响应
      const response = await fetch(forwardRequest);

      // 3. 核心：校验并过滤返回结果，防止出现<!DOCTYPE html>的错误页面
      // 3.1 先判断响应头Content-Type，快速筛选非预期响应
      const responseContentType = response.headers.get("Content-Type") || "";
      // 3.2 读取响应内容（先转为文本，方便正则校验；若为JSON后续可再转换）
      const responseText = await response.text();
      // 3.3 正则匹配是否包含HTML文档标识（<!DOCTYPE html>或<html>标签）
      const isHtmlErrorPage = /<!DOCTYPE html>|<html/i.test(responseText);

      // 3.4 若检测到HTML页面：仅允许根路径(/)返回；其他路径一律拦截
      if (isHtmlErrorPage && !allowHtmlResponse) {
        console.error({ message: 'Detected HTML page returned by target API on non-root path, filtered out' });
        return new Response(JSON.stringify({
          code: 502,
          msg: "API forwarding failed, the target service is temporarily unavailable",
          detail: "The upstream service returned an abnormal page and cannot be parsed normally"
        }), {
          status: 502,
          headers: { 
            "Content-Type": "application/json; charset=utf-8",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Headers": "pro-api-key, Content-Type"
          }
        });
      }

      // 3.5 若为正常响应，构建返回给调用者的响应（白名单模式，隐藏目标服务器信息，支持跨域）
      const returnHeaders = new Headers();

      // 只保留必要的、安全的响应头（白名单机制）
      if (response.headers.has("Cache-Control")) returnHeaders.set("Cache-Control", response.headers.get("Cache-Control"));
      if (response.headers.has("Expires")) returnHeaders.set("Expires", response.headers.get("Expires"));
      if (response.headers.has("ETag")) returnHeaders.set("ETag", response.headers.get("ETag"));

      // 根据场景设置 Content-Type
      if (isHtmlErrorPage && allowHtmlResponse) {
        // 根路径的 HTML 响应，保留 text/html
        returnHeaders.set("Content-Type", responseContentType);
        // 设置前端页面缓存2小时
        returnHeaders.set("Cache-Control", "public, max-age=7200");
      } else {
        // 其他所有情况，统一返回 application/json
        returnHeaders.set("Content-Type", "application/json; charset=utf-8");
      }

      // 设置跨域头
      returnHeaders.set("Access-Control-Allow-Origin", "*");
      returnHeaders.set("Access-Control-Allow-Headers", "pro-api-key, Content-Type");

      return new Response(responseText, {
        status: response.status,
        statusText: response.statusText,
        headers: returnHeaders
      });
    };

    try {
      // 4. Promise.race实现50秒超时竞争：业务逻辑与超时Promise谁先完成执行谁
      const result = await Promise.race([forwardBusinessLogic(), timeoutPromise]);
      return result;
    } catch (error) {
      // 5. 异常处理：区分超时错误和其他错误，返回自定义响应（隐藏目标API信息，全英文）
      console.error({ message: 'API forwarding failed', errorDetail: error.message });
      
      // 5.1 处理50秒自定义超时错误（全英文）
      if (error.message.includes("timed out")) {
        return new Response(JSON.stringify({ 
          code: 408, 
          msg: "API request timed out, the target service responded too slowly", 
          detail: `The request was not completed after more than ${CUSTOM_TIMEOUT / 1000} seconds, please try again later`
        }), {
          status: 408,
          headers: { 
            "Content-Type": "application/json; charset=utf-8",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Headers": "pro-api-key, Content-Type"
          }
        });
      }

      // 5.2 处理其他转发错误（如网络错误、请求构建错误等，全英文）
      return new Response(JSON.stringify({ 
        code: 500, 
        msg: "API forwarding failed", 
        detail: "Internal forwarding logic exception, please contact the administrator"
      }), {
        status: 500,
        headers: { 
          "Content-Type": "application/json; charset=utf-8",
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Headers": "pro-api-key, Content-Type"
        }
      });
    }
  }
};