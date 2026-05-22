module.exports = {
  apps: [
    {
      name: "luykin-chaineye-binance-square-crawler",
      script: "./src/binanceSquareCrawlerServer.js",
      instances: 1,
      exec_mode: "fork",
      node_args: "--max-old-space-size=4096",
      max_memory_restart: "4500M",
      watch: false,
      time: true,
      env: {
        TZ: "Asia/Shanghai",
        NODE_ENV: "development",
        BINANCE_SQUARE_PROXY_LINE_COUNT: 5,
        BINANCE_SQUARE_TARGET_LIMIT: 1000,
        BINANCE_SQUARE_BATCH_WRITE_USERS: 10,
        BINANCE_SQUARE_BATCH_WRITE_MAX_POSTS: 300,
        BINANCE_SQUARE_MAX_PAGES_PER_FILTER: 30,
        BINANCE_SQUARE_PROGRESS_EVERY_USERS: 5,
      },
      env_production: {
        TZ: "Asia/Shanghai",
        NODE_ENV: "production",
        BINANCE_SQUARE_PROXY_LINE_COUNT: 5,
        BINANCE_SQUARE_TARGET_LIMIT: 1000,
        BINANCE_SQUARE_BATCH_WRITE_USERS: 10,
        BINANCE_SQUARE_BATCH_WRITE_MAX_POSTS: 300,
        BINANCE_SQUARE_MAX_PAGES_PER_FILTER: 30,
        BINANCE_SQUARE_PROGRESS_EVERY_USERS: 5,
      },
    },
  ],
};
