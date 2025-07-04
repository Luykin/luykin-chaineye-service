#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// 配置文件路径
const CONFIG_PATHS = {
	siteConfig: '/etc/nginx/sites-available/test-kb.cryptohunt.ai',
	nginxConfig: '/etc/nginx/nginx.conf',
	siteEnabled: '/etc/nginx/sites-enabled/test-kb.cryptohunt.ai'
};

// 本地配置文件路径
const LOCAL_CONFIGS = {
	siteConfig: path.join(__dirname, '../nginx/test-kb.cryptohunt.ai.conf'),
	nginxConfig: path.join(__dirname, '../nginx/nginx.conf')
};

/**
 * 检查是否以 root 权限运行
 */
function checkRootPermission() {
	if (process.getuid && process.getuid() !== 0) {
		console.error('❌ 错误: 此脚本需要 root 权限运行');
		console.log('请使用: sudo node scripts/update-nginx-config.js');
		process.exit(1);
	}
}

/**
 * 检查文件是否存在
 */
function checkFileExists(filePath) {
	return fs.existsSync(filePath);
}

/**
 * 创建备份文件
 */
function createBackup(filePath) {
	if (!checkFileExists(filePath)) {
		console.log(`⚠️  文件不存在，跳过备份: ${filePath}`);
		return null;
	}
	
	const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
	const backupPath = `${filePath}.backup.${timestamp}`;
	
	try {
		fs.copyFileSync(filePath, backupPath);
		console.log(`✅ 已创建备份: ${backupPath}`);
		return backupPath;
	} catch (error) {
		console.error(`❌ 创建备份失败: ${error.message}`);
		throw error;
	}
}

/**
 * 复制配置文件
 */
function copyConfigFile(sourcePath, targetPath) {
	if (!checkFileExists(sourcePath)) {
		console.error(`❌ 源文件不存在: ${sourcePath}`);
		throw new Error(`源文件不存在: ${sourcePath}`);
	}
	
	try {
		// 确保目标目录存在
		const targetDir = path.dirname(targetPath);
		if (!checkFileExists(targetDir)) {
			fs.mkdirSync(targetDir, { recursive: true });
			console.log(`📁 已创建目录: ${targetDir}`);
		}
		
		fs.copyFileSync(sourcePath, targetPath);
		console.log(`✅ 已复制配置文件: ${sourcePath} -> ${targetPath}`);
	} catch (error) {
		console.error(`❌ 复制文件失败: ${error.message}`);
		throw error;
	}
}

/**
 * 创建软链接
 */
function createSymlink(targetPath, linkPath) {
	try {
		// 如果软链接已存在，先删除
		if (checkFileExists(linkPath)) {
			fs.unlinkSync(linkPath);
			console.log(`🗑️  已删除旧的软链接: ${linkPath}`);
		}
		
		fs.symlinkSync(targetPath, linkPath);
		console.log(`🔗 已创建软链接: ${linkPath} -> ${targetPath}`);
	} catch (error) {
		console.error(`❌ 创建软链接失败: ${error.message}`);
		throw error;
	}
}

/**
 * 测试 Nginx 配置
 */
function testNginxConfig() {
	try {
		console.log('🔍 正在测试 Nginx 配置...');
		execSync('nginx -t', { stdio: 'pipe' });
		console.log('✅ Nginx 配置测试通过');
		return true;
	} catch (error) {
		console.error('❌ Nginx 配置测试失败:');
		console.error(error.stdout?.toString() || error.message);
		return false;
	}
}

/**
 * 重载 Nginx 配置
 */
function reloadNginx() {
	try {
		console.log('🔄 正在重载 Nginx 配置...');
		execSync('systemctl reload nginx', { stdio: 'pipe' });
		console.log('✅ Nginx 配置已重载');
		return true;
	} catch (error) {
		console.error('❌ Nginx 重载失败:');
		console.error(error.stdout?.toString() || error.message);
		return false;
	}
}

/**
 * 恢复备份文件
 */
function restoreBackup(backupPath, originalPath) {
	if (!backupPath || !checkFileExists(backupPath)) {
		console.error(`❌ 备份文件不存在: ${backupPath}`);
		return false;
	}
	
	try {
		fs.copyFileSync(backupPath, originalPath);
		console.log(`✅ 已恢复备份: ${backupPath} -> ${originalPath}`);
		return true;
	} catch (error) {
		console.error(`❌ 恢复备份失败: ${error.message}`);
		return false;
	}
}

/**
 * 主函数
 */
async function main() {
	console.log('🚀 开始更新 Nginx 配置文件...\n');
	
	// 检查权限
	checkRootPermission();
	
	// 检查本地配置文件是否存在
	for (const [name, localPath] of Object.entries(LOCAL_CONFIGS)) {
		if (!checkFileExists(localPath)) {
			console.error(`❌ 本地配置文件不存在: ${localPath}`);
			process.exit(1);
		}
	}
	
	const backups = {};
	let success = false;
	
	try {
		// 1. 创建备份
		console.log('📦 创建配置文件备份...');
		backups.siteConfig = createBackup(CONFIG_PATHS.siteConfig);
		backups.nginxConfig = createBackup(CONFIG_PATHS.nginxConfig);
		console.log('');
		
		// 2. 复制新的配置文件
		console.log('📋 复制新的配置文件...');
		copyConfigFile(LOCAL_CONFIGS.siteConfig, CONFIG_PATHS.siteConfig);
		copyConfigFile(LOCAL_CONFIGS.nginxConfig, CONFIG_PATHS.nginxConfig);
		console.log('');
		
		// 3. 创建或更新软链接
		console.log('🔗 更新站点软链接...');
		createSymlink(CONFIG_PATHS.siteConfig, CONFIG_PATHS.siteEnabled);
		console.log('');
		
		// 4. 测试配置
		console.log('🧪 测试 Nginx 配置...');
		if (!testNginxConfig()) {
			throw new Error('Nginx 配置测试失败');
		}
		console.log('');
		
		// 5. 重载 Nginx
		console.log('🔄 重载 Nginx 服务...');
		if (!reloadNginx()) {
			throw new Error('Nginx 重载失败');
		}
		
		success = true;
		console.log('\n🎉 Nginx 配置更新成功！');
		
		// 显示备份信息
		console.log('\n📋 备份文件信息:');
		for (const [name, backupPath] of Object.entries(backups)) {
			if (backupPath) {
				console.log(`  ${name}: ${backupPath}`);
			}
		}
		
	} catch (error) {
		console.error(`\n❌ 更新失败: ${error.message}`);
		
		// 尝试恢复备份
		console.log('\n🔧 尝试恢复备份配置...');
		let restored = true;
		
		if (backups.siteConfig) {
			restored &= restoreBackup(backups.siteConfig, CONFIG_PATHS.siteConfig);
		}
		if (backups.nginxConfig) {
			restored &= restoreBackup(backups.nginxConfig, CONFIG_PATHS.nginxConfig);
		}
		
		if (restored) {
			console.log('🔄 重新测试和重载 Nginx...');
			if (testNginxConfig()) {
				reloadNginx();
				console.log('✅ 已恢复到备份配置');
			} else {
				console.error('❌ 恢复后配置仍有问题，请手动检查');
			}
		} else {
			console.error('❌ 恢复备份失败，请手动恢复配置');
		}
		
		process.exit(1);
	}
	
	// 清理选项
	if (success) {
		console.log('\n🧹 清理选项:');
		console.log('如需清理备份文件，可运行:');
		for (const [name, backupPath] of Object.entries(backups)) {
			if (backupPath) {
				console.log(`  sudo rm "${backupPath}"`);
			}
		}
	}
}

// 处理未捕获的异常
process.on('uncaughtException', (error) => {
	console.error('\n💥 未捕获的异常:', error.message);
	process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
	console.error('\n💥 未处理的 Promise 拒绝:', reason);
	process.exit(1);
});

// 运行主函数
if (require.main === module) {
	main().catch(error => {
		console.error('\n💥 脚本执行失败:', error.message);
		process.exit(1);
	});
}

module.exports = { main };
