#!/bin/bash
# 为 Supabase Studio 设置 HTTP Basic Auth

# 直接设置用户名和密码
USERNAME="luykin"
PASSWORD="wtf.0813"

# 检查是否安装了 htpasswd
if ! command -v htpasswd &> /dev/null; then
    echo "错误: 未找到 htpasswd 命令"
    echo "请安装 apache2-utils (Ubuntu/Debian) 或 httpd-tools (CentOS/RHEL)"
    echo "Ubuntu/Debian: sudo apt-get install apache2-utils"
    echo "CentOS/RHEL: sudo yum install httpd-tools"
    exit 1
fi

# 创建密码文件
PASSWORD_FILE="/etc/nginx/.htpasswd"
sudo mkdir -p /etc/nginx

# 创建或更新密码文件
if [ -f "$PASSWORD_FILE" ]; then
    echo "更新现有密码文件..."
    echo "$PASSWORD" | sudo htpasswd -i "$PASSWORD_FILE" "$USERNAME"
else
    echo "创建新密码文件..."
    echo "$PASSWORD" | sudo htpasswd -ci "$PASSWORD_FILE" "$USERNAME"
fi

# 设置文件权限
sudo chmod 644 "$PASSWORD_FILE"
sudo chown root:root "$PASSWORD_FILE"

echo "✓ 密码文件已创建: $PASSWORD_FILE"
echo "用户名: $USERNAME"
echo "密码: $PASSWORD"
echo ""
echo "请重启 nginx: sudo nginx -t && sudo systemctl reload nginx"

