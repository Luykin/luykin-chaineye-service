#!/bin/bash
# 为 Supabase Studio 设置 HTTP Basic Auth

# 直接设置用户名和密码
USERNAME="luykin"
PASSWORD="wtf.0813"

# 使用 openssl 生成密码文件（不需要安装额外工具）
# 检查是否安装了 openssl
if ! command -v openssl &> /dev/null; then
    echo "错误: 未找到 openssl 命令"
    echo "请安装 openssl"
    exit 1
fi

# 创建密码文件
PASSWORD_FILE="/etc/nginx/.htpasswd"
sudo mkdir -p /etc/nginx

# 使用 openssl 生成密码哈希（apr1 格式，与 htpasswd 兼容）
echo "创建密码文件..."
PASSWORD_HASH=$(openssl passwd -apr1 "$PASSWORD")
echo "$USERNAME:$PASSWORD_HASH" | sudo tee "$PASSWORD_FILE" > /dev/null

# 设置文件权限
sudo chmod 644 "$PASSWORD_FILE"
sudo chown root:root "$PASSWORD_FILE"

echo "✓ 密码文件已创建: $PASSWORD_FILE"
echo "用户名: $USERNAME"
echo "密码: $PASSWORD"
echo ""
echo "请重启 nginx: sudo nginx -t && sudo systemctl reload nginx"

