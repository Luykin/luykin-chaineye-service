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
