module.exports = {
	apps: [
		{
			name: "luykin-chaineye-api",         // API 路由服务
			script: "./src/apiServer.js",            // API 路由的启动文件路径
			instances: "4",                    // 启动最大实例数（根据 CPU 核心数自动启动）
			exec_mode: "cluster",                // 使用 cluster 模式
			watch: false,                        // 生产环境关闭文件监视
			env: {
				NODE_ENV: "development",          // 开发环境变量
				PORT: 8088                        // API 服务的开发端口
			},
			env_production: {
				NODE_ENV: "production",           // 生产环境变量
				PORT: 8087                        // API 服务的生产端口
			}
		},
		{
			name: "luykin-chaineye-crawler",     // 爬虫服务
			script: "./src/crawlerServer.js",        // 爬虫服务的启动文件路径
			instances: 1,                        // 单个实例
			exec_mode: "fork",                   // 使用 fork 模式
			watch: false,                        // 关闭文件监视
			env: {
				NODE_ENV: "development",          // 开发环境变量
				PORT: 8092                        // 爬虫服务的开发端口
			},
			env_production: {
				NODE_ENV: "production",           // 生产环境变量
				PORT: 8091                        // 爬虫服务的生产端口
			}
		}
	]
};
