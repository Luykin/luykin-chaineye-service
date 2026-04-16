# LLM 调用中心设计文档（LangChain 版）

## 1. 概述

基于 LangChain 框架搭建的 LLM 调用中心，支持从简单调用到复杂 Agent 的平滑演进。

## 2. 技术栈

| 包名 | 用途 |
|------|------|
| `langchain` | 核心框架 |
| `@langchain/openai` | OpenAI/LiteLLM 适配 |
| `zod` | Schema 验证 |

## 3. 配置

### 3.1 环境变量

```bash
# .env-dev / .env-pro
LLM_API_KEY=your_api_key_here
```

### 3.2 代码默认配置

```javascript
// src/lib/llm/config.js
const DEFAULT_CONFIG = {
  baseURL: 'https://aaii.xclaw.info/v1/',
  defaultModel: 'gemini-3.1-flash-lite-preview',
  temperature: 0.3,  // 对话类建议 0.7
  timeout: 60000,
  maxRetries: 3,
};
```

## 4. 常见问题

### 4.1 LangChain 会增加 Token 消耗吗？

**结论：不会显著增加，主要开销是系统提示模板**

| 开销来源 | 说明 | 估算 |
|----------|------|------|
| **Prompt 模板** | LangChain 的系统提示模板 | 100-500 tokens（一次性） |
| **对话内容** | 用户输入 + 模型输出 | 和直接调用 OpenAI SDK **完全一样** |
| **结构化输出** | Schema 描述（可选） | 200-1000 tokens（取决于 Schema 复杂度） |

**可能增加 Token 的场景：**
- 使用复杂的 few-shot examples（示例对话）
- Schema 描述写得很详细（传给模型看的）
- 启用了某些自动化的 chain-of-thought 提示

**控制 Token 的方法：**
```javascript
// 1. 精简 Schema 描述
const schema = z.object({
  sentiment: z.enum(['positive', 'negative']).describe('情感')  // 简短描述
  // 不要写长段落描述每个字段
});

// 2. 不传不必要的 history
await chat('你好', { history: [] });  // 明确不传历史

// 3. 限制输出长度
await chat('总结', { maxTokens: 200 });
```

### 4.2 不同场景用什么方式？

#### 场景 A：单次问答，不需要历史记录

**推荐：** 直接用 `chat()` / `structuredChat()`，不传 `history`

```javascript
const { structuredChat } = require('../lib/llm');

// 每次独立调用，无状态
const result = await structuredChat(
  `分析这个项目：${project.description}`,
  AnalysisSchema
);
// 下一次调用完全不记得上一次的内容
```

**适用场景：**
- 项目分析、推文分析
- 数据摘要生成
- 单轮分类/提取任务

#### 场景 B：多轮对话，需要记住上下文

**方案 1：手动传 History（简单场景，推荐）**

```javascript
// 前端把历史记录传过来
app.post('/api/chat', async (req, res) => {
  const { message, history } = req.body;  // history 由前端维护
  
  const reply = await chat(message, {
    history: history  // [{ role: 'user', content: '...' }, ...]
  });
  
  res.json({ reply, history: [...history, { role: 'assistant', content: reply }] });
});
```

**优点：** 简单、无状态、易扩展  
**缺点：** 每次请求都带完整历史，Token 消耗随对话增长

**方案 2：LangChain Memory（复杂场景）**

```javascript
const { chatWithMemory } = require('../lib/llm');

// 用 sessionId 区分不同用户的对话
const reply = await chatWithMemory(message, {
  sessionId: 'user_123',  // 唯一标识
  memoryType: 'buffer',   // buffer / window / summary
  maxHistory: 10          // 只保留最近 N 轮
});
```

**Memory 类型对比：**

| 类型 | 说明 | Token 消耗 | 适用 |
|------|------|-----------|------|
| `BufferMemory` | 保存完整历史 | 持续增长 | 短对话（<10轮） |
| `BufferWindowMemory` | 只保留最近 K 轮 | 固定 | 中等对话 |
| `SummaryMemory` | 自动摘要历史 | 固定且少 | 长对话 |

**选择建议：**
- 对话 **< 5 轮** → 手动传 history
- 对话 **5-20 轮** → BufferWindowMemory
- 对话 **> 20 轮** → SummaryMemory

### 4.3 chat vs structuredChat 有什么区别？

| 对比项 | `chat()` | `structuredChat()` |
|--------|----------|-------------------|
| **返回值** | 纯文本字符串 | 结构化对象（按 Schema） |
| **输出格式** | 自由格式，模型自己决定 | 强制按指定字段返回 |
| **适用场景** | 对话、写作、总结、翻译 | 数据分析、字段提取、分类 |
| **代码示例** | `const text = await chat('讲个故事')` | `const data = await structuredChat('分析', Schema)` |
| **Token 消耗** | 少（无 Schema 描述） | 稍多（需传 Schema 给模型） |
| **解析可靠性** | 需自己处理文本 | 自动解析为对象，类型安全 |

**具体区别：**

```javascript
// ========== chat() ==========
// 返回纯文本，格式不确定
const text = await chat('分析比特币走势');
console.log(text);
// "比特币近期走势强劲，主要受机构入场影响..."
// 你需要自己从文本中提取关键信息

// ========== structuredChat() ==========
// 返回固定格式的对象
const schema = z.object({
  trend: z.enum(['up', 'down', 'sideways']),
  confidence: z.number(),
  reasons: z.array(z.string())
});

const data = await structuredChat('分析比特币走势', schema);
console.log(data);
// {
//   trend: 'up',
//   confidence: 0.85,
//   reasons: ['机构入场', 'ETF通过']
// }
// 直接能用，不用解析文本
```

**什么时候用哪个？**

| 场景 | 推荐方法 | 原因 |
|------|---------|------|
| 聊天机器人回复 | `chat()` | 自然语言，自由发挥 |
| 生成文章/摘要 | `chat()` | 长文本输出 |
| 翻译/改写 | `chat()` | 直接返回文本 |
| 分析项目信息并提取字段 | `structuredChat()` | 需要结构化数据入库 |
| 情感分析分类 | `structuredChat()` | 返回枚举值 |
| 提取推文中的代币/人物 | `structuredChat()` | 需要数组/对象 |
| 多字段评估报告 | `structuredChat()` | 返回 JSON 存数据库 |

**混合使用示例：**

```javascript
// 第一步：用 structuredChat 提取结构化数据
const analysis = await structuredChat(projectDesc, ProjectAnalysisSchema);
// 得到：{ category, riskLevel, score }

// 第二步：用 chat 生成自然语言总结
const summary = await chat(
  `根据以下分析结果生成一句话总结：${JSON.stringify(analysis)}`
);
// 得到："这是一个高风险高回报的DeFi项目..."
```

## 5. 架构设计

```
src/lib/llm/
├── index.js              # 主入口，导出便捷方法
├── config.js             # 默认配置
├── models.js             # LangChain ChatModel 初始化
├── chains/
│   ├── base.js           # 基础 Chain 封装
│   ├── structured.js     # 结构化输出 Chain
│   └── streaming.js      # 流式输出 Chain
├── prompts/
│   ├── templates/        # Prompt 模板目录
│   │   ├── analysis.js   # 分析类模板
│   │   └── generation.js # 生成类模板
│   └── index.js          # 模板管理
├── parsers/
│   ├── zod.js            # Zod Schema 解析器
│   └── json.js           # JSON 解析器（备用）
├── memory/
│   └── index.js          # 记忆管理（后续扩展）
├── tools/
│   └── index.js          # 工具定义（后续扩展）
└── agents/
    └── index.js          # Agent 封装（后续扩展）
```

## 6. 分层设计

### 6.1 第1层：便捷方法（现在主要用这个）

```javascript
const { chat, structuredChat, streamChat } = require('../lib/llm');

// 普通对话
const result = await chat('你好');

// 结构化输出
const { z } = require('zod');
const schema = z.object({ answer: z.string() });
const data = await structuredChat('1+1=?', schema);

// 流式
for await (const chunk of streamChat('讲个故事')) {
  console.log(chunk);
}
```

### 6.2 第2层：基础实例（复杂场景，直接用 LangChain）

当便捷方法不够用，需要自定义 Chain、PromptTemplate、Agent 时，使用 `getChatModel()` 获取预配置的 LLM 实例。

```javascript
const { getChatModel } = require('../lib/llm');
const { ChatPromptTemplate } = require('@langchain/core/prompts');
const { RunnableSequence } = require('@langchain/core/runnables');

// 1. 获取预配置的 ChatOpenAI 实例
const llm = getChatModel({ 
  model: 'gpt-4o',        // 可选
  temperature: 0.3        // 可选
});

// 2. 然后自由使用 LangChain 的所有能力
const prompt = ChatPromptTemplate.fromMessages([
  ['system', '你是专业的区块链分析师'],
  ['human', '分析这个项目：\n{input}']
]);

const chain = RunnableSequence.from([
  prompt,
  llm,
  (result) => result.content.toUpperCase()  // 自定义后处理
]);

const result = await chain.invoke({ 
  input: projectDescription 
});
```

**和便捷方法的区别：**

| 方式 | 代码量 | 灵活性 | 适用场景 |
|------|--------|--------|----------|
| `chat()` | 极少 | 低 | 简单对话 |
| `getChatModel() + LangChain` | 中等 | **高** | 复杂 pipeline |

**其他导出方法：**

```javascript
const { getChatModel, clearModelCache, getCacheStats } = require('../lib/llm');

// 清空模型缓存（配置变更时）
clearModelCache();

// 查看缓存状态
console.log(getCacheStats());  // { size: 3, keys: ['model1_temp1_0', ...] }
```

### 6.3 第3层：Agent 系统（后续复杂场景）

```javascript
const { createAgent } = require('../services/llm/agents');

const agent = createAgent({
  tools: [searchTool, calculatorTool],
  memory: true
});

const result = await agent.invoke('分析这个项目并计算估值');
```

## 7. API 详解

### 7.1 便捷方法

#### `chat(message, options)`

```javascript
const { chat } = require('../lib/llm');

// 最简单的调用
const text = await chat('你好');

// 完整参数
const text = await chat('你好', {
  model: 'gpt-4o',           // 可选，默认 gemini-3.1-flash-lite-preview
  temperature: 0.7,          // 可选，默认 0.3，对话建议 0.7
  systemPrompt: '你是专家',   // 可选
  history: [                 // 可选，历史消息
    { role: 'user', content: '之前的问题' },
    { role: 'assistant', content: '之前的回答' }
  ]
});
```

**temperature（温度）建议：**

| 场景 | 推荐温度 | 说明 |
|------|---------|------|
| 数据分析、提取字段 | 0 - 0.3 | 确定性强，结果稳定 |
| 项目评估、分类 | 0.3 - 0.5 | 默认就是这个范围 |
| 聊天对话 | 0.7 - 1.0 | 更有温度，不机械 |
| 创意写作 | 1.0 - 1.5 | 天马行空，但可能跑偏 |

#### `structuredChat(message, schema, options)`

```javascript
const { structuredChat } = require('../lib/llm');
const { z } = require('zod');

// 定义 Schema
const AnalysisSchema = z.object({
  sentiment: z.enum(['positive', 'negative', 'neutral']),
  confidence: z.number().min(0).max(1),
  keywords: z.array(z.string()),
  summary: z.string().max(100)
}).describe('推文分析结果');  // describe 会传给模型

// 调用
const result = await structuredChat(
  '分析这条推文：比特币大涨！',
  AnalysisSchema,
  { 
    model: 'gpt-4o',  // 结构化输出建议用好模型
    name: 'tweet_analysis'  // 用于日志追踪
  }
);

// result 自动解析为对象
console.log(result.sentiment);  // 'positive'
```

#### `streamChat(message, options)`

```javascript
const { streamChat } = require('../lib/llm');

// Express SSE 示例
app.post('/api/chat', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  
  const stream = await streamChat(req.body.message, {
    model: req.body.model
  });
  
  for await (const chunk of stream) {
    res.write(`data: ${JSON.stringify({ text: chunk })}\n\n`);
  }
  
  res.end();
});
```

### 7.2 Prompt 模板

```javascript
// src/lib/llm/prompts/templates/analysis.js
const { ChatPromptTemplate } = require('@langchain/core/prompts');

// 简单模板
const simpleTemplate = ChatPromptTemplate.fromTemplate(`
你是一个专业的{role}。
请分析以下内容：
{content}
`);

// 带系统消息的模板
const projectAnalysisTemplate = ChatPromptTemplate.fromMessages([
  ['system', '你是区块链项目分析专家，擅长评估项目潜力和风险。'],
  ['human', `请分析以下项目：
名称：{projectName}
描述：{description}
融资轮次：{fundingRound}
`]
]);

module.exports = {
  simpleTemplate,
  projectAnalysisTemplate
};
```

### 7.3 自定义 Chain

```javascript
const { RunnableSequence } = require('@langchain/core/runnables');
const { createStructuredOutputChain } = require('../services/llm/chains/structured');

// 创建一个可复用的分析 Chain
const projectChain = createStructuredOutputChain({
  prompt: projectAnalysisTemplate,
  schema: ProjectAnalysisSchema,
  model: 'gpt-4o'
});

// 使用
const result = await projectChain.invoke({
  projectName: 'Uniswap',
  description: '去中心化交易所...',
  fundingRound: 'A轮'
});
```

## 8. 使用示例

Schema 定义在使用的地方，更灵活。

### 8.1 API Route 中使用

```javascript
// src/routes/llm.js
const express = require('express');
const router = express.Router();
const { structuredChat, z } = require('../lib/llm');

// 在使用的地方定义 Schema
const ProjectAnalysisSchema = z.object({
  projectName: z.string(),
  category: z.enum(['DeFi', 'NFT', 'GameFi', 'Infra', 'Other']),
  riskLevel: z.enum(['low', 'medium', 'high']),
  summary: z.string().max(200),
});

router.post('/analyze-project', async (req, res) => {
  try {
    const { name, description, fundingRound } = req.body;
    
    const analysis = await structuredChat(
      `分析项目：${name}\n描述：${description}\n融资：${fundingRound}`,
      ProjectAnalysisSchema,
      { name: 'project_analysis' }
    );
    
    res.json({ success: true, data: analysis });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
```

### 8.2 Service 中使用

```javascript
// src/services/tweetAnalysisService.js
const { structuredChat, chat, z } = require('../lib/llm');

// 在 Service 内部定义 Schema
const TweetAnalysisSchema = z.object({
  sentiment: z.enum(['positive', 'negative', 'neutral']),
  confidence: z.number().min(0).max(1),
});

class TweetAnalysisService {
  async analyze(tweetText) {
    return await structuredChat(
      tweetText,
      TweetAnalysisSchema,
      { model: 'gemini-3.1-flash-lite-preview' }
    );
  }
  
  async generateReply(tweetText, tone = 'friendly') {
    return await chat(`请用${tone}的语气回复这条推文：${tweetText}`, {
      temperature: 0.8
    });
  }
}

module.exports = new TweetAnalysisService();
```

## 9. 错误处理

```javascript
// src/lib/llm/utils/errors.js

class LLMError extends Error {
  constructor(message, type, retryable = false) {
    super(message);
    this.type = type;
    this.retryable = retryable;
  }
}

class LLMTimeoutError extends LLMError {
  constructor() {
    super('请求超时', 'TIMEOUT', true);
  }
}

class LLMRateLimitError extends LLMError {
  constructor() {
    super('触发速率限制', 'RATE_LIMIT', true);
  }
}

class LLMSchemaError extends LLMError {
  constructor(originalError) {
    super(`Schema 解析失败: ${originalError.message}`, 'SCHEMA_ERROR', false);
  }
}

// 自动重试包装
async function withRetry(fn, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (!error.retryable || i === maxRetries - 1) throw error;
      await sleep(1000 * Math.pow(2, i));  // 指数退避
    }
  }
}
```

## 10. 日志 & 监控

```javascript
// 每次调用自动记录
{
  "type": "llm_call",
  "timestamp": "2026-03-16T14:00:00Z",
  "model": "gemini-3.1-flash-lite-preview",
  "method": "structuredChat",  // chat / structuredChat / streamChat
  "schema_name": "tweet_analysis",
  "duration_ms": 1250,
  "input_tokens": 150,
  "output_tokens": 80,
  "success": true,
  "error_type": null
}
```

## 11. 演进路线

### Phase 1: 基础调用（现在）
- ✅ 便捷方法：`chat`, `structuredChat`, `streamChat`
- ✅ Prompt 模板
- ✅ 结构化输出

### Phase 2: 记忆 & 上下文（后续）
- 对话历史管理
- BufferMemory / BufferWindowMemory
- Redis 持久化

### Phase 3: 工具 & Agent（后续）
- Tool 定义
- ReAct Agent
- 多工具调用

### Phase 4: RAG（后续）
- 文档加载
- Embedding
- 向量数据库
- Retrieval Chain

## 12. 管理后台 LLM 测试工具

提供了一个 Web 界面用于测试和调试 LLM 调用。

### 12.1 访问地址

登录管理后台后访问：`/admin/llm-test`

### 12.2 功能

- **提示词输入**：输入要测试的 prompt
- **系统提示词**：可选，设定 AI 角色
- **模型选择**：支持 6 种模型
  - Gemini 3 Flash Preview（默认）
  - Gemini 3 Pro Preview
  - Gemini 2.5 Flash
  - Kimi K2.5
  - GPT-5 Mini
  - DeepSeek V3.2
- **温度调节**：0-2 滑块控制
- **输出格式**：文本 或 JSON（结构化）
- **JSON Schema 编辑器**：当选择 JSON 格式时，可自定义输出结构

### 12.3 JSON Schema 示例

```json
{
  "type": "object",
  "properties": {
    "sentiment": {
      "type": "string",
      "enum": ["positive", "negative", "neutral"],
      "description": "情感倾向"
    },
    "confidence": {
      "type": "number",
      "minimum": 0,
      "maximum": 1,
      "description": "置信度"
    },
    "keywords": {
      "type": "array",
      "items": { "type": "string" },
      "description": "关键词"
    }
  },
  "required": ["sentiment", "confidence"]
}
```

### 12.4 实现文件

- API：`src/admin/api/llm-test.js`
- 页面：`src/xhunt/views/partials/llm-test-stats.ejs`（集成在管理后台 stats 页面）
- 路由：`/api/admin/llm-test` (已挂载在 `apiServer.js`)

## 13. 安装

```bash
yarn add langchain @langchain/openai zod
```

## 14. 环境变量

```bash
# .env-dev
LLM_API_KEY=your_api_key_here
```

---

**文档版本**: v2.0 (LangChain)  
**更新日期**: 2026-03-16  
**作者**: AI Assistant
