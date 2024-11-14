module.exports = {
	apps: [
		{
			name: "luykin-chaineye-service",       // 应用名称，可以自定义
			script: "./src/index.js",          // 启动文件的路径
			instances: 1,                // 启动单个实例
			exec_mode: "fork",           // 使用 fork 模式
			watch: false,                // 是否开启文件监视，适合开发时开启，生产环境建议关闭
			env: {
				NODE_ENV: "development",   // 开发环境变量
				PORT: 8088                 // 可自定义其他环境变量
			},
			env_production: {
				NODE_ENV: "production",    // 生产环境变量
				PORT: 8087                 // 生产环境端口
			}
		}
	]
};
