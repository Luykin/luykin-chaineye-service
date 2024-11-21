# 数据爬虫系统

### 安装必要的系统依赖

在 Ubuntu 或 Debian 系统上，运行以下命令以确保安装 Puppeteer 所需的依赖库：

```bash
sudo apt update
sudo apt install -y \
  libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libx11-xcb1 \
  libxcomposite1 libxdamage1 libxrandr2 libgbm1 libasound2 \
  libgtk-3-0 libxshmfence1 libpango-1.0-0 libpangoft2-1.0-0 \
  libcairo2 fonts-liberation libgdk-pixbuf2.0-0
sudo apt install -y libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 libxcomposite1 libxrandr2 libgbm1 libasound2 libxshmfence1 libxdamage1 libpango-1.0-0 libx11-xcb1
```
日志清除
```bash
# 安装 pm2-logrotate 模块
pm2 install pm2-logrotate

# 设置日志最大文件大小为 10M，超出时自动轮转
pm2 set pm2-logrotate:max_size 10M

# 设置日志的保存天数为 7 天
pm2 set pm2-logrotate:retain 7

# 设置轮转时间间隔 (每天)
pm2 set pm2-logrotate:rotateInterval '0 0 * * *'
```
不上传database.sqlite
```bash
# 停止追踪 database.sqlite
git rm --cached database.sqlite
#提交停止追踪 database.sqlite 的操作，并推送到远程仓库。
# 在远程服务器的仓库根目录执行
git update-index --assume-unchanged database.sqlite
```
# Redis 安装指南

## 在 Mac 上安装 Redis

### 1. 如何安装

在 macOS 上可以使用 Homebrew 来安装 Redis。如果您还没有安装 Homebrew，可以通过以下命令进行安装：

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```
安装 Homebrew 后，运行以下命令来安装 Redis：

```bash
brew install redis
```
### 2. 启动服务

如果你想直接运行 Redis，可以使用以下命令启动 Redis 服务器：

```bash
redis-server
```
如果你想将 Redis 作为后台服务运行，可以使用以下命令：
```bash
brew services start redis
```
### 3. 设置开机自启动

将 Redis 配置为开机自启：

```bash
brew services start redis
```
### 4. 查看端口，检查是否安装成功

使用以下命令检查 Redis 是否正在运行：

```bash
redis-cli ping
```
如果返回 `PONG`，说明 Redis 已成功安装并运行在默认端口 6379。

## 在 Debian/Ubuntu 上安装 Redis

### 1. 如何安装

首先更新包管理器，然后安装 Redis：

```bash
sudo apt update
sudo apt install redis-server -y
```
### 2. 启动服务

启动 Redis 并确保服务正在运行：

```bash
sudo systemctl start redis-server
```
### 3. 设置开机自启动

配置 Redis 服务为开机自启动：

```bash
sudo systemctl enable redis-server
```
### 4. 查看端口，检查是否安装成功

运行以下命令检查 Redis 是否正常运行：

```bash
redis-cli ping
```
如果返回 `PONG`，表示 Redis 已成功安装并正在端口 6379 上运行。

## 注意事项

- **生产环境安全**：建议为 Redis 设置密码并限制网络访问，以提高安全性。
- **Docker 安装**：如果在 Docker 中安装 Redis，请确保正确配置端口映射和网络设置。

### 1. 设置 Redis 密码

Redis 默认不需要密码即可连接，您可以通过编辑 Redis 配置文件（通常位于 `/etc/redis/redis.conf` 或 `/usr/local/etc/redis.conf`）来启用密码保护。

- 打开 Redis 配置文件：

```bash
sudo nano /etc/redis/redis.conf
  ```
- 找到以下行，并取消注释（去掉前面的 `#`），然后设置您的密码：

```bash
conf requirepass yourpassword
```
  将 `yourpassword` 替换为您希望设置的密码。

- 保存并退出，然后重启 Redis 服务以应用更改：

```bash
sudo systemctl restart redis-server
  ```
- 验证：在客户端连接时输入密码。

```bash
redis-cli
AUTH yourpassword
```
  如果返回 `OK`，表示密码配置成功。

### 2. 限制 Redis 的网络访问

默认情况下，Redis 监听 127.0.0.1 本地接口，仅允许本地连接。如果您希望限制外部访问，确保 Redis 只监听 localhost（127.0.0.1）。

- 在配置文件中找到以下行，并确保设置为 127.0.0.1：

```bash
conf bind 127.0.0.1
  ```
- 确保未注释 `protected-mode` 行，保持 `yes` 状态，这会自动阻止外部 IP 访问：

```bash
conf protected-mode yes
```
- 保存并重启服务：

```bash
sudo systemctl restart redis-server
```
### 3. 使用防火墙进一步限制网络访问（可选）

如需更严格的访问控制，可以使用防火墙（如 ufw）来限制 Redis 的端口（默认 6379）访问。

- 允许本地访问（默认情况下是开放的）：

```bash
sudo ufw allow from 127.0.0.1 to any port 6379
```
- 禁止外部访问：

```bash
sudo ufw deny 6379
```
这样配置后，Redis 将仅允许来自本地主机的连接并拒绝外部网络访问。
