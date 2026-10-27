# Base 主网免 API Key RPC 实测记录

## 结论

2026-10-27 22:10–22:26 CST 从当前开发机对候选节点进行了实际 JSON-RPC 请求。以下四个地址均无需 API Key，并且在本次测试中同时通过 `eth_chainId`、`eth_blockNumber` 和指定交易的 `eth_getTransactionReceipt`：

1. `https://base-rpc.publicnode.com`
2. `https://mainnet.base.org`
3. `https://8453.rpc.thirdweb.com`
4. `https://base.gateway.tenderly.co`

建议按以上顺序用于低频只读回执查询；单次成功测试只能证明测试时可用，不等同于可用性 SLA。应用仍应设置单节点超时、顺序故障转移，并记录最终使用的 RPC 和失败原因。

## 实测方法与结果

测试交易：`0x95c0164c1aa2b1977e73148d654b4f579ef005ad077fb1ceff50b4d21a9182ea`

每个地址均直接发送如下三类 HTTP POST JSON-RPC 请求，没有携带鉴权参数或 API Key：

- `eth_chainId`：预期 Base 主网 `0x2105`（十进制 8453）
- `eth_blockNumber`：预期返回当时的最新区块高度
- `eth_getTransactionReceipt`：预期返回上述交易回执

| RPC | `eth_chainId` | `eth_blockNumber` | 交易回执 | 结论 |
| --- | --- | --- | --- | --- |
| PublicNode | HTTP 200，`0x2105` | HTTP 200，返回区块号 | HTTP 200，`status=0x1`，`blockNumber=0x32b22f6` | 通过 |
| Base 官方 | HTTP 200，`0x2105` | HTTP 200，返回区块号 | HTTP 200，`status=0x1`，`blockNumber=0x32b22f6` | 通过 |
| thirdweb | HTTP 200，`0x2105` | HTTP 200，返回区块号 | HTTP 200，`status=0x1`，`blockNumber=0x32b22f6` | 通过 |
| Tenderly | HTTP 200，`0x2105` | HTTP 200，返回区块号 | HTTP 200，`status=0x1`，`blockNumber=0x32b22f6` | 通过 |

回执中的共同关键证据：交易成功（`status=0x1`），交易所在区块为 `0x32b22f6`，交易哈希与请求值一致。

在基础探测通过后，又按项目实际读取链路对最终四个地址分别执行了：

- `eth_getTransactionByHash`
- `eth_getTransactionReceipt`
- `eth_getBlockByNumber`
- 两次 `eth_call`，读取分发合约的 `waitTime` 与 `submittedData`

四个节点全部返回一致结果：合约等待期为 `172800` 秒、当前 `submittedData` 时间为 `0`、交易内包含 2 个收款地址，因此项目能够识别该笔分发为 `executed`。

## 项目配置方式

- 未设置 RPC 环境变量时，代码按本文结论内置上述四个地址并顺序故障转移。
- `E2E_BASE_RPC_URLS` 可用逗号或空格设置自定义地址列表；设置后覆盖默认列表。
- 原有 `E2E_BASE_RPC_URL` 继续兼容：该地址作为第一优先级，后面追加上述免费节点作为回退。

## 官方来源、免费性与限制

### PublicNode

- PublicNode 官方首页将其服务描述为免费的 RPC endpoints，并在页面的 Base 网络数据中列出 `https://base-rpc.publicnode.com`。[PublicNode 官方首页](https://www.publicnode.com/)
- 官方公开页面未给出该端点的明确数字限流或 SLA。不能把“免费”理解为“无限制”；使用时应保留其他节点兜底。

### Base 官方 RPC

- Base 官方连接文档明确列出主网 RPC `https://mainnet.base.org` 和 Chain ID 8453。[Base 官方文档：Connect to Base](https://docs.base.org/get-started/connect-to-base)
- Base 官方明确说明公共端点会限流且不适合生产流量，但没有公布具体 RPS；因此该地址只适合作为当前低频查询的回退节点。[Base 官方文档：Throughput and Limits](https://docs.base.org/specifications/transactions/throughput-and-limits#endpoint-limits)

### thirdweb

- thirdweb 官方 Base 网络页直接展示 `https://8453.rpc.thirdweb.com` 作为 RPC 地址。[thirdweb 官方 Base 页面](https://thirdweb.com/base)
- 本次不带 API Key 的三个请求均成功。页面公开区域没有给出匿名访问的数字限额；同时页面内部网络数据也展示带 `${THIRDWEB_API_KEY}` 的形式，因此匿名访问应视为公共便利入口，而不是有保障的免费配额。

### Tenderly 公共网关

- Tenderly 官方 RPC reference 将 Base Mainnet（Chain ID 8453）映射到 `https://base.gateway.tenderly.co`。[Tenderly 官方 RPC Reference](https://docs.tenderly.co/node-rpc/rpc-reference)
- Tenderly 明确说明所有网络都可在不带 access key 时通过公共网关访问，并按调用方 IP 限制：每天最多返回 1 GB 响应数据；达到限额后返回 HTTP 429 / JSON-RPC `-32005`；单次 `eth_getLogs` 最多 3,000 条结果。[Tenderly 官方 Node RPC Overview：Public endpoint limits](https://docs.tenderly.co/node-rpc/overview#public-endpoint-limits)
- 对当前“每小时查询少量交易回执”的场景，1 GB/日远高于正常消耗，但仍必须正确处理 429 和网络错误。

## 未采用的候选

- `https://base-mainnet.public.blastapi.io`：早期一次三项测试全部成功，但 22:25 CST 复测时 `eth_chainId` 返回 HTTP 429，响应为 compute-units/throughput 超限。它不符合“当前三项都测试 OK 才写入默认列表”的标准，因此不采用。
- `https://base.llamarpc.com`：三项请求均返回 HTTP 525，因此不采用。
- `https://base.drpc.org`：三项测试均成功，dRPC 官方 Base 页面也列出了该地址，但已有四个通过节点，暂不加入默认列表；可作为以后替补。[dRPC 官方 Base Mainnet 页面](https://drpc.org/chainlist/base-mainnet-rpc)

## 运维注意事项

- 这四个都是第三方或公共基础设施，可能在无通知情况下调整限流或匿名访问政策。
- 每次 RPC 尝试应使用较短超时并继续下一个节点，不能让单一节点阻塞整轮任务。
- 只有回执非空且 `status=0x1` 时才能证明交易成功；HTTP 200 本身不代表链上成功。
- 若全部节点失败，应保留结算的待确认状态和错误上下文，交给下一小时任务继续检查。
