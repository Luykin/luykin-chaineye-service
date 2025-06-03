module.exports = {
	apps: [
		{
			name: "luykin-chaineye-api",         // API 路由服务
			script: "./src/apiServer.js",        // API 路由的启动文件路径
			instances: 4,                        // 启动最大实例数（根据 CPU 核心数自动启动）
			exec_mode: "cluster",                // 使用 cluster 模式
			watch: false,                        // 生产环境关闭文件监视
			time: true,
			interpreter: "node",
			interpreter_args: "--require dd-trace/init",  // 注入 Datadog 自动埋点
			env: {
				NODE_ENV: "development",         // 开发环境变量
				PORT: 8088,                      // API 服务的开发端口
				TZ: "Asia/Shanghai",             // 设置时区为北京时间
				DD_SERVICE: "dev-luykin-chaineye-api",       // Datadog 服务名称（自定义）
				DD_ENV: "development",           // 环境对应
				DD_AGENT_HOST: "localhost",      // Agent 地址（默认 localhost）
				DD_TRACE_AGENT_PORT: 8126,       // 默认 APM 端口
			},
			env_production: {
				TZ: "Asia/Shanghai",
				NODE_ENV: "production",
				PORT: 8087,
				DD_SERVICE: "luykin-chaineye-api",
				DD_ENV: "production",
				DD_AGENT_HOST: "localhost",
				DD_TRACE_AGENT_PORT: 8126,
			}
		},
		{
			name: "luykin-chaineye-crawler",     // 爬虫服务
			script: "./src/crawlerServer.js",        // 爬虫服务的启动文件路径
			instances: 1,                        // 单个实例
			exec_mode: "fork",                   // 使用 fork 模式
			watch: false,                        // 关闭文件监视
			time: true,
			env: {
				TZ: "Asia/Shanghai", // 设置时区为北京时间
				NODE_ENV: "development",          // 开发环境变量
			},
			env_production: {
				TZ: "Asia/Shanghai", // 设置时区为北京时间
				NODE_ENV: "production",           // 生产环境变量
			}
		},
		{
			name: "luykin-chaineye-bot",     // 爬虫服务
			script: "./src/botServer.js",        // 爬虫服务的启动文件路径
			instances: 1,                        // 单个实例
			exec_mode: "fork",                   // 使用 fork 模式
			watch: false,                        // 关闭文件监视
			time: true,
			env: {
				TZ: "Asia/Shanghai", // 设置时区为北京时间
				NODE_ENV: "development",          // 开发环境变量
			},
			env_production: {
				TZ: "Asia/Shanghai", // 设置时区为北京时间
				NODE_ENV: "production",           // 生产环境变量
			}
		}
	]
};
