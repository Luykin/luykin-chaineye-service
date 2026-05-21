module.exports = {
  apps: [
    {
      name: "luykin-chaineye-binance-square-crawler",
      script: "./src/binanceSquareCrawlerServer.js",
      instances: 1,
      exec_mode: "fork",
      watch: false,
      time: true,
      env: {
        TZ: "Asia/Shanghai",
        NODE_ENV: "development",
        BINANCE_SQUARE_PROXY_LINE_COUNT: 8,
        BINANCE_SQUARE_TARGET_LIMIT: 1000,
        BINANCE_SQUARE_BATCH_WRITE_USERS: 25,
        BINANCE_SQUARE_BATCH_WRITE_MAX_POSTS: 800,
        BINANCE_SQUARE_PROGRESS_EVERY_USERS: 5,
      },
      env_production: {
        TZ: "Asia/Shanghai",
        NODE_ENV: "production",
        BINANCE_SQUARE_PROXY_LINE_COUNT: 8,
        BINANCE_SQUARE_TARGET_LIMIT: 1000,
        BINANCE_SQUARE_BATCH_WRITE_USERS: 25,
        BINANCE_SQUARE_BATCH_WRITE_MAX_POSTS: 800,
        BINANCE_SQUARE_PROGRESS_EVERY_USERS: 5,
      },
    },
  ],
};
