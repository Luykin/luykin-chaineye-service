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
			},
			// 最大内存限制数，超出自动重启
			max_memory_restart: 8,
			// 自定义应用程序的错误日志文件(错误日志文件)
			error_file: './logs/app-err.log',
			// 自定义应用程序日志文件(正常日志文件)
			out_file: './logs/app-out.log',
			// 设置追加日志而不是新建日志
			merge_logs: true,
			// 指定日志文件的时间格式
			log_date_format: 'YYYY-MM-DD HH:mm:ss',
			// 最小运行时间，这里设置的是60s即如果应用程序在* 60s内退出，pm2会认为程序异常退出，此时触发重启* max_restarts设置数量，应用运行少于时间被认为是异常启动
			min_uptime: '60s',
			// 设置应用程序异常退出重启的次数，默认15次（从0开始计数）,最大异常重启次数，即小于min_uptime运行时间重启次数；
			max_restarts: 10,
			// 启用/禁用应用程序崩溃或退出时自动重启，默认为true, 发生异常的情况下自动重启
			autorestart: true,
			// 定时启动，解决重启能解决的问题，crontab时间格式重启应用，目前只支持cluster模式;
			cron_restart: '',
			// 异常重启情况下，延时重启时间
			restart_delay: '60s'
		}
	]
};
