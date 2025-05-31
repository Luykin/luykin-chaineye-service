module.exports = {
	apps: [
		{
			name: "dev-luykin-chaineye-api",         // API 路由服务
			script: "./src/apiServer.js",            // API 路由的启动文件路径
			instances: 1,                    // 启动最大实例数（根据 CPU 核心数自动启动）
			exec_mode: "cluster",                // 使用 cluster 模式
			watch: false,                        // 生产环境关闭文件监视
			time: true,
			env: {
				NODE_ENV: "development",          // 开发环境变量
				PORT: 8088,                        // API 服务的开发端口
				TZ: "Asia/Shanghai", // 设置时区为北京时间
			},
			env_production: {
				TZ: "Asia/Shanghai", // 设置时区为北京时间
				NODE_ENV: "development",           // 生产环境变量
				PORT: 8088                        // API 服务的生产端口
			}
		},
	]
};
