/**
 * 邮件发送服务
 * 
 * 使用 emailjs 库发送邮件，支持 Outlook/Office 365
 * 
 * 环境变量配置：
 * - OUTLOOK_USER: 邮箱地址
 * - OUTLOOK_PASS: 应用密码（不是普通密码）
 * - OUTLOOK_FROM: 发件人显示名称（可选，默认使用 OUTLOOK_USER）
 * 
 * 获取应用密码：
 * 1. 访问：https://account.microsoft.com/security
 * 2. 进入"高级安全选项" -> "应用密码"
 * 3. 生成应用密码
 * 4. 将应用密码设置为 OUTLOOK_PASS 环境变量
 * 
 * 注意：
 * - OUTLOOK_PASS 必须是应用密码，不是账户的普通密码
 * - 应用密码需要账户启用两步验证
 * - 个人账户（@outlook.com, @hotmail.com）可能无法使用 SMTP AUTH
 * - 建议使用企业账户（Office 365/Microsoft 365）
 */

// emailjs 是 ES Module，需要使用动态导入
let SMTPClient;

/**
 * 获取 SMTP 配置
 * @returns {object} SMTP 配置对象
 */
function getSMTPConfig() {
  const user = process.env.OUTLOOK_USER;
  const pass = process.env.OUTLOOK_PASS;
  const from = process.env.OUTLOOK_FROM || `XHunt Server <${user}>`;
  
  if (!user || !pass) {
    throw new Error("Outlook 配置不完整，请检查 OUTLOOK_USER 和 OUTLOOK_PASS 环境变量");
  }
  
  // 清理密码（移除空格）
  const cleanPass = pass.replace(/\s+/g, '');
  
  return {
    user,
    pass: cleanPass,
    host: 'smtp.office365.com', // 使用 smtp.office365.com（更稳定）
    port: 587, // Outlook 使用 587 端口（STARTTLS）
    tls: true, // 使用 STARTTLS，让系统自动选择安全的 TLS 版本和加密套件
    timeout: 30000, // 30秒超时
    from
  };
}

/**
 * 使用 emailjs 发送邮件
 * @param {string} to - 收件人邮箱
 * @param {string} subject - 邮件主题
 * @param {string} html - HTML 内容
 * @param {string} text - 纯文本内容（可选）
 * @returns {Promise<void>}
 */
async function sendEmailViaSMTP(to, subject, html, text = null) {
  // 动态导入 emailjs（ES Module）
  if (!SMTPClient) {
    const emailjs = await import('emailjs');
    SMTPClient = emailjs.SMTPClient;
  }
  
  // 获取 SMTP 配置
  const smtpConfig = getSMTPConfig();
  
  console.log(`[emailService] 准备发送邮件配置：`);
  console.log(`[emailService] - 邮箱账户: ${smtpConfig.user}`);
  console.log(`[emailService] - 应用密码长度: ${smtpConfig.pass.length} 字符`);
  console.log(`[emailService] - SMTP 服务器: ${smtpConfig.host}:${smtpConfig.port}`);
  console.log(`[emailService] - 收件人: ${to}`);
  
  // 创建 SMTP 客户端
  const clientOptions = {
    user: smtpConfig.user,
    password: smtpConfig.pass,
    host: smtpConfig.host,
    port: smtpConfig.port,
    tls: smtpConfig.tls
  };
  
  // 添加超时配置（如果支持）
  if (smtpConfig.timeout) {
    clientOptions.timeout = smtpConfig.timeout;
  }
  
  const client = new SMTPClient(clientOptions);
  
  // 构建邮件消息
  // emailjs 支持 text 字段作为纯文本，attachment 中的 alternative: true 作为 HTML
  const plainText = text || html.replace(/<[^>]*>/g, '');
  
  const message = {
    text: plainText, // 纯文本内容
    from: smtpConfig.from,
    to: to,
    subject: subject,
    attachment: [
      { data: html, alternative: true } // HTML 内容（alternative: true 表示这是 HTML 正文）
    ]
  };
  
  // 发送邮件（使用 Promise 包装回调）
  return new Promise((resolve, reject) => {
    console.log(`[emailService] 开始发送邮件...`);
    
    client.send(message, (err, result) => {
      if (err) {
        console.error('[emailService] ❌ 邮件发送失败:', err);
        
        // 提供详细的错误信息
        if (err.message) {
          console.error('[emailService] 错误详情:', err.message);
        }
        
        // 如果是连接超时错误
        if (err.message && (
          err.message.includes('timeout') || 
          err.message.includes('timedout') ||
          err.message.includes('timed out') ||
          err.message.includes('ECONNRESET') ||
          err.message.includes('ENOTFOUND')
        )) {
          console.error('[emailService] ==========================================');
          console.error('[emailService] 连接超时排查步骤：');
          console.error('[emailService] ');
          console.error('[emailService] 1. 检查网络连接：');
          console.error('[emailService]    - 确认服务器可以访问互联网');
          console.error('[emailService]    - 测试连接：telnet smtp.office365.com 587');
          console.error('[emailService] ');
          console.error('[emailService] 2. 检查防火墙设置：');
          console.error('[emailService]    - 确认端口 587 未被阻止');
          console.error('[emailService]    - 检查服务器防火墙规则');
          console.error('[emailService] ');
          console.error('[emailService] 3. 尝试使用备用 SMTP 服务器：');
          console.error('[emailService]    - smtp.office365.com:587（当前使用）');
          console.error('[emailService]    - smtp-mail.outlook.com:587');
          console.error('[emailService] ==========================================');
        }
        
        // 如果是认证错误，提供排查信息
        if (err.message && (
          err.message.includes('535') || 
          err.message.includes('Authentication') ||
          err.message.includes('authentication') ||
          err.message.includes('authorization.failed')
        )) {
          console.error('[emailService] ==========================================');
          console.error('[emailService] 认证失败排查步骤：');
          console.error('[emailService] ');
          console.error('[emailService] Outlook/Office 365:');
          console.error('[emailService] - 个人账户（@outlook.com, @hotmail.com）可能无法使用 SMTP AUTH');
          console.error('[emailService] - 确认使用应用密码（不是普通密码）');
          console.error('[emailService] - 企业账户需要管理员启用 SMTP AUTH');
          console.error('[emailService] - 获取应用密码：https://account.microsoft.com/security -> 高级安全选项 -> 应用密码');
          console.error('[emailService] ==========================================');
        }
        
        reject(err);
      } else {
        console.log('[emailService] ✅ 邮件发送成功');
        console.log('[emailService] 发送结果:', result);
        resolve(result);
      }
    });
  });
}

/**
 * 发送邮件
 * @param {string} to - 收件人邮箱
 * @param {string} subject - 邮件主题
 * @param {string} html - HTML 内容
 * @param {string} text - 纯文本内容（可选）
 * @returns {Promise<void>}
 */
async function sendEmail(to, subject, html, text = null) {
  console.log(`[emailService] 使用 emailjs 发送邮件到: ${to}`);
  await sendEmailViaSMTP(to, subject, html, text);
  console.log(`[emailService] ✅ 邮件发送完成: ${to}`);
}

module.exports = {
  sendEmail,
  sendEmailViaSMTP
};
