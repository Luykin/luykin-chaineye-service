require('dotenv').config();
const { enhanceConsoleWithRequestId } = require('./xhunt/utils/request-id');
enhanceConsoleWithRequestId();
const redis = require('redis');
const TgBot = require('./bot/group-bot');
const bot6666 = new TgBot(process.env.TG_6666BOT_TOKEN, process.env.TG_CRYPTOHUNT_CHART1_ID);

// 初始化 Redis 客户端
const subscriberClient = redis.createClient({
  socket: {
    host: '127.0.0.1',
    port: 6379,
  },
});

const publisherClient = redis.createClient({
  socket: {
    host: '127.0.0.1',
    port: 6379,
  },
});

(async () => {
  try {
    await subscriberClient.connect();
    await publisherClient.connect();
    console.log('[BOT] Redis 客户端连接成功');

    const CHANNEL = 'bot-commands';

    // 订阅任务通道
    await subscriberClient.subscribe(CHANNEL, async (message) => {
      try {
        const command = JSON.parse(message);
        console.log(`[BOT] 收到任务: ${message}`);

        if (command.action === 'createInviteLink') {
          const result = await bot6666.createInviteLink(command.params);

          // 发布结果到响应通道
          if (command.responseChannel) {
            await publisherClient.publish(command.responseChannel, JSON.stringify(result));
            console.log(`[BOT] 任务处理完成，结果已发送至 ${command.responseChannel}`);
          }
        }
      } catch (err) {
        console.error('[BOT] 处理任务失败:', err);
      }
    });

    console.log('[BOT] 开始监听任务通道...');

    // 启动 Telegram Bot
    await bot6666.start();
    console.log('[BOT] Telegram Bot 启动成功');
  } catch (error) {
    console.error('[BOT] Redis 或 Bot 初始化失败:', error);
    process.exit(1); // 确保服务挂掉后被管理器重新拉起
  }
})();
