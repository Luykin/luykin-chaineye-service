#!/usr/bin/env node

/**
 * 生成 Supabase JWT 密钥和 Token
 * 
 * 使用方法:
 * node generate-supabase-keys.js
 * 
 * 或者直接运行:
 * chmod +x generate-supabase-keys.js
 * ./generate-supabase-keys.js
 */

const crypto = require('crypto');

// 生成 JWT Secret (至少 32 个字符)
function generateJWTSecret() {
  return crypto.randomBytes(32).toString('base64');
}

// 生成 JWT Token
function generateJWT(payload, secret) {
  const header = {
    alg: 'HS256',
    typ: 'JWT'
  };

  const base64UrlEncode = (str) => {
    return Buffer.from(JSON.stringify(str))
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');
  };

  const headerEncoded = base64UrlEncode(header);
  const payloadEncoded = base64UrlEncode(payload);

  const signature = crypto
    .createHmac('sha256', secret)
    .update(`${headerEncoded}.${payloadEncoded}`)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');

  return `${headerEncoded}.${payloadEncoded}.${signature}`;
}

// 生成密钥
const jwtSecret = generateJWTSecret();

// 生成 anon key (匿名用户)
const anonPayload = {
  iss: 'supabase-demo',
  role: 'anon',
  exp: 1983812996 // 长期有效
};
const anonKey = generateJWT(anonPayload, jwtSecret);

// 生成 service_role key (服务角色)
const servicePayload = {
  iss: 'supabase-demo',
  role: 'service_role',
  exp: 1983812996 // 长期有效
};
const serviceKey = generateJWT(servicePayload, jwtSecret);

console.log('='.repeat(60));
console.log('Supabase 密钥生成完成');
console.log('='.repeat(60));
console.log('\n请将以下内容添加到您的 .env-pro 文件中:\n');
console.log('# Supabase JWT 配置');
console.log(`SUPABASE_JWT_SECRET=${jwtSecret}`);
console.log(`SUPABASE_ANON_KEY=${anonKey}`);
console.log(`SUPABASE_SERVICE_KEY=${serviceKey}`);
console.log('\n' + '='.repeat(60));
console.log('⚠️  重要提示:');
console.log('1. 请妥善保管这些密钥，不要提交到版本控制系统');
console.log('2. JWT_SECRET 必须至少 32 个字符');
console.log('3. 所有服务必须使用相同的 JWT_SECRET');
console.log('='.repeat(60));

