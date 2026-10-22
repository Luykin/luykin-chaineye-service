# Node.js 2026 年 10 月安全发布调研

调研日期：2026-10-22  
范围：Node.js 官方安全公告、官方发布日志、公开修复提交和 Node.js Release Working Group 发布周期。本文只整理上游事实与升级判断标准，**不包含任何生产服务器检查结果**。

---

## 结论摘要

Node.js 于 2026-10-21 为仍受支持的 **22.x、24.x、26.x** 发布安全修复，最高严重性为 **High**；最低包含完整修复的版本分别是：

| 版本线 | 最低安全版本 | 发布阶段/说明 |
|---|---:|---|
| 22.x | **22.23.4** | LTS；官方发布日志列出 7 个 Node.js CVE 修复及多项依赖更新 |
| 24.x | **24.22.1** | LTS；官方发布日志列出 8 个 Node.js CVE 修复及多项依赖更新 |
| 26.x | **26.12.1** | Current；官方发布日志列出全部 10 个 Node.js CVE 修复 |

官方公告没有披露每个问题精确的“首次受影响补丁版本”。因此生产评估应采用保守口径：**只要运行的是公告列出的主版本线，且版本低于上表对应安全版本，就按受影响处理**。20.x 及更早版本已经 EOL；官方特别说明 EOL 版本在安全发布发生时应视为受影响，且不会得到该轮修复，应迁移到受支持版本。[1][5]

若生产命中受影响版本，建议优先做**同主版本补丁升级**（22.x → 至少 22.23.4，24.x → 至少 24.22.1，26.x → 至少 26.12.1），不需要为本次应急修复直接跨主版本。升级后必须重启实际承载请求的 Node/PM2 进程并再次核对进程所使用的二进制版本；只替换磁盘上的 Node 可执行文件不会更新已经运行的进程。

## CVE 与影响面

官方公告共列出 10 个 Node.js CVE：4 个 High、3 个 Medium、3 个 Low。[1]

| CVE | 严重性 | 受影响版本线 | 触发条件与影响（基于公开修复提交） |
|---|---|---|---|
| CVE-2026-105482 | High | 22、24、26 | 应用把含 `NUL`（`\0`）的攻击者可控名称传给 `dns.resolve*()`、`dns.reverse()` 或 Resolver 的 `setLocalAddress()`。c-ares 按 C 字符串处理，会静默丢弃 NUL 后内容，例如代码看到 `example.com\0.trusted.corp`，实际查询 `example.com`；可形成域名校验、allowlist 或 SSRF 边界绕过。[6] |
| CVE-2026-105483 | High | 24、26 | 应用对攻击者可控的非 ASCII IP 写法发起 TLS 连接，例如全角数字 `１２７.0.0.1`。旧逻辑在 IP/域名判断与 IDNA 归一化之间产生差异，可能让该地址走 DNS SAN/CN 匹配而绕过预期的 IP SAN 校验。[1][7] |
| CVE-2026-106069 | High | 22、24、26 | 应用对攻击者可控的“可被宽松解析为 IP”的主机名发起 TLS 连接，例如八进制/十六进制/整数/缩写 IPv4（`0177.0.0.1`、`0x7f.0.0.1`、`2130706433`、`127.1`）。证书校验侧的归一化结果和平台解析器最终连接地址可能不同，导致 hostname 校验绕过。[8] |
| CVE-2026-111497 | High | 22、24、26 | 应用或其依赖把攻击者构造的数据送入 Node/Brotli 解码器。无效 block switch 未被及时报告，可导致越界写；官方将后果定为潜在远程代码执行。实际可达性取决于业务或依赖是否解压不可信 `br` 数据。[1][9] |
| CVE-2026-105481 | Medium | 22、24、26 | 核心 `http.Agent` 使用 keep-alive 复用出站 socket；对端在 socket 空闲时预先写入一个响应，且同一事件循环时机内 socket 在 I/O poll 前被下一请求复用。旧代码可能把预写响应当成后一个请求的响应，造成响应混淆/投毒。修复会在复用前检查内核读缓冲并销毁“有待处理数据”的空闲 socket。[10] |
| CVE-2026-106072 | Medium | 22、24、26 | 应用使用非规范 IPv4 主机名建立 TLS 连接；旧证书验证可能允许 DNS SAN 对实际为 IP endpoint 的目标完成认证。与 CVE-2026-106069 共用“拒绝非规范 IP 主机名”的修复路径。[1][8] |
| CVE-2026-106074 | Medium | 22、24、26 | 只影响把已填充的 `crypto.randomUUID()` / `randomInt()` 熵缓存保存到用户启动快照或 SEA 的场景。多个从同一快照反序列化的进程会重放相同随机值；普通、不使用用户启动快照/SEA 的 Node 进程不满足该触发条件。[11] |
| CVE-2026-106070 | Low | 仅 26 | 应用使用 26.x 的 `zlib.ZipFile` 读取攻击者构造的 file-backed ZIP。局部头与 central directory 校验失败后，旧实现仍缓存半初始化状态；第二次读取可能从文件描述符当前位置返回攻击者控制的前缀字节，形成扫描器与实际解包结果不一致。[12] |
| CVE-2026-106071 | Low | 仅 26 | 启用了 Node Permission Model，并使用 `--allow-fs-read` / `--allow-fs-write` 通配符授权。radix tree 的 wildcard 节点可能错误地把比授权前缀更短的路径也判为允许，例如 `/tmp/test*` 错误覆盖 `/tmp/tes`。[13] |
| CVE-2026-106073 | Low | 22、24、26 | 启用了 Node Permission Model，且受限代码能调用 `fs.realpathSync()` 探测未授权路径。该入口缺少与 `realpathSync.native()`、Promise API 等价的前置权限检查，可充当授权范围外文件存在性 oracle，并绕过 Permission Model 对该 API 的预期限制。[14] |

### 严重性口径说明

CVE-2026-105483 的公开修复提交消息称该回归“low-severity”且“不易利用”，但 2026-10-21 的最终安全公告与 24.22.1/26.12.1 发布日志均将它列为 **High**。生产决策应采用正式安全公告/发布日志的最终等级，即 High；提交消息只能用于理解利用前提，不能用于下调处置优先级。[1][3][4][7]

## 随安全版本一并更新的依赖

安全公告还明确说明本轮版本包含用于修复公开漏洞的依赖更新：[1]

- 22.x：c-ares、eMudhra Intermediate CA 相关根证书、OpenSSL、SQLite、Undici；
- 24.x：c-ares、eMudhra Intermediate CA 相关根证书、OpenSSL、Undici；
- 26.x：c-ares、eMudhra Intermediate CA 相关根证书、Undici。

对应发布日志记录的关键版本包括：22.23.4 使用 c-ares 1.34.9、OpenSSL 3.5.9、SQLite 3.53.4、Undici 6.29.1；24.22.1 使用 c-ares 1.34.9、OpenSSL 3.5.9、Undici 7.30.1；26.12.1 使用 c-ares 1.34.9、Undici 8.12.2。[2][3][4]

这意味着仅在业务代码中规避某个 Node CVE，不能替代升级官方安全版本，因为同一版本还承载了 CA 与内置依赖修复。

## 生产判定规则与升级建议

### 判定规则

| 生产实际版本 | 判断 | 建议 |
|---|---|---|
| 22.x 且 `< 22.23.4` | 受影响 | 尽快升至 22.23.4 或同线更高版本 |
| 24.x 且 `< 24.22.1` | 受影响 | 尽快升至 24.22.1 或同线更高版本 |
| 26.x 且 `< 26.12.1` | 受影响 | 尽快升至 26.12.1 或同线更高版本 |
| 上述最低安全版本或更高的同主版本 | 已包含本轮修复 | 仍需确认所有服务进程实际使用该二进制，且容器/PM2 未保留旧进程 |
| 20.x 或更早、奇数主版本等 EOL 版本 | 无本轮受支持修复 | 迁移到受支持的 LTS 版本；不要只等待旧线补丁 |

### 优先级

1. **只要版本命中就升级，不以“当前代码好像没调用相关 API”为延后理由。** Brotli 越界写/RCE、TLS hostname bypass 与 HTTP keep-alive 响应混淆均处于通用运行时或常用出站网络路径；依赖链也可能间接调用这些能力。
2. **应急处置采用同主版本补丁升级。** 这是变更面最小、同时获得全部 Node 与内置依赖修复的方案。
3. **不要把升级到 26.x Current 当成本轮修复的必要条件。** 22.23.4 和 24.22.1 都是官方提供的安全版本；生产若目前在 LTS，优先留在原主版本完成补丁升级。
4. **若生产仍在 EOL 20.x，则风险高于单一 CVE。** Node.js 20 已于 2026-04-30 EOL，官方周期表不再把它列为受支持版本；应规划升级到受支持 LTS，而不是寻找 20.x 的本轮补丁。[5]
5. **升级验证应覆盖运行中进程。** 至少核对交互 shell、PM2 daemon/worker、systemd 或容器镜像中的 Node 版本；完成发布后再从实际进程路径核验，并做与出站 HTTP/TLS、Brotli、基础 API 相关的轻量回归。

## 上游支持周期背景

Node.js Release Working Group 的 2026-10-22 周期表显示：22.x EOL 为 2027-04-30，24.x EOL 为 2028-04-30，26.x 当时仍为 Current、计划于 2026-10-28 进入 LTS，EOL 为 2029-04-30；20.x 已于 2026-04-30 EOL。[5]

因此，若生产当前是 22.x/24.x，最小风险路径是先安装对应同线安全补丁；是否随后跨主版本，应作为独立兼容性升级评估，不与本次紧急安全修复捆绑。

## 资料限制

- 官方公告只给出受影响的**主版本线**，未给出每个 CVE 的精确引入版本或 CVSS 向量；本文没有把未公开的信息推断成精确版本区间。
- 公开 Node.js 提交足以确认修复逻辑和测试触发条件，但关联的 `nodejs-private/node-private` PR 不公开；因此本文对利用条件的描述限定在公开 diff、测试与提交消息能够直接支持的范围。
- 本文未连接生产服务器，也未检查仓库业务代码是否走到相关 API；最终“是否需要升级”必须结合生产实际 Node 版本判断。不过，只要版本落入上面的受影响区间，官方层面的结论就是需要升级。

## 参考资料

1. [Node.js 官方安全公告：Wednesday, October 21, 2026 Security Releases](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases)
2. [Node.js v22.23.4 (LTS) 官方发布日志](https://nodejs.org/en/blog/release/v22.23.4/)
3. [Node.js v24.22.1 (LTS) 官方发布日志](https://nodejs.org/en/blog/release/v24.22.1/)
4. [Node.js v26.12.1 (Current) 官方发布日志](https://nodejs.org/en/blog/release/v26.12.1/)
5. [Node.js Release Working Group：官方 release schedule](https://github.com/nodejs/Release#release-schedule)
6. [CVE-2026-105482 公开修复提交：拒绝 DNS 参数中的 NUL](https://github.com/nodejs/node/commit/6b78ea171d)
7. [CVE-2026-105483 公开修复提交：修复 IP normalization regression](https://github.com/nodejs/node/commit/cd4b05469c)
8. [CVE-2026-106069 / CVE-2026-106072 公开修复提交：拒绝非规范 IP 地址](https://github.com/nodejs/node/commit/ad788ccd07)
9. [CVE-2026-111497 公开修复提交：更新 Brotli decoder](https://github.com/nodejs/node/commit/a6040b50d9)
10. [CVE-2026-105481 公开修复提交：复用 keep-alive socket 前检查待读数据](https://github.com/nodejs/node/commit/0683ee5f7d)
11. [CVE-2026-106074 公开修复提交：跨快照重置随机数缓存](https://github.com/nodejs/node/commit/acffa610db)
12. [CVE-2026-106070 公开修复提交：ZIP header 校验失败后不缓存无效状态](https://github.com/nodejs/node/commit/745ad77156)
13. [CVE-2026-106071 公开修复提交：修正 Permission Model wildcard radix lookup](https://github.com/nodejs/node/commit/c273a408c9)
14. [CVE-2026-106073 公开修复提交：为 `fs.realpathSync()` 增加权限检查](https://github.com/nodejs/node/commit/cc244131aa)
