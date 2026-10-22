# 生产环境 Node.js 22.23.4 升级与回滚 Runbook

日期：2026-10-22
目标主机：150.5.158.179:8864
项目目录：/root/luykin-chaineye-service
目标版本：Node.js 22.23.4、PM2 6.0.8
当前回滚版本：系统 Node.js 18.19.1

## 变更原则

- 本次只切换 Node.js/PM2 运行时，不修改代码、数据库、Nginx 或环境变量。
- 保留 /usr/bin/node 和 /usr/local/lib/node_modules/pm2，作为快速回滚路径。
- NVM 安装在 /root/.nvm。生产默认 shell 是 fish，而 NVM 不原生支持 fish，因此全部 NVM 操作必须在 Bash 中执行。
- 切换前不在生产目录执行 yarn install、npm install 或 npm rebuild。先用 Node 22 加载现有关键依赖；如果失败，应停止切换并在非生产环境解决兼容性问题。
- PM2 dump 可能包含环境变量，备份目录必须保持 0700、文件保持 0600，不要复制到工单、聊天或 Git。
- 管理后台的“紧急回滚”只回滚 Git 代码，不能回滚 Node.js 运行时。本次运行时回滚必须使用本文命令。

## 推荐执行窗口

- 预留 30–45 分钟，预计切换中断通常为几十秒。
- 操作期间暂停其他发布、迁移和 PM2 操作。
- 至少保留一个独立 SSH 会话；不要只依赖正在执行向导的单一终端。
- 先确认数据库、Redis、第三方 API 没有已知故障，避免把既有问题误判为 Node 升级导致。

## 方式 A：执行交互式向导

在本地工作区把向导复制到服务器：

~~~bash
scp -P 8864 \
  scripts/node-22-security-upgrade-wizard.sh \
  root@150.5.158.179:/root/node-22-security-upgrade-wizard.sh
~~~

连接生产并运行：

~~~bash
ssh root@150.5.158.179 -p 8864
bash /root/node-22-security-upgrade-wizard.sh
~~~

向导会执行以下阶段：

1. 只读预检和基线健康检查。
2. 刷新 PM2 dump，并写入 /root/node-upgrade-backups/时间戳。
3. 从 NVM 官方固定标签 v0.40.8 安装 NVM。
4. 安装 Node.js 22.23.4 和 PM2 6.0.8。
5. 在不停止服务的情况下检查入口文件和关键原生依赖。
6. 输入 UPGRADE 后才停止旧 PM2 daemon 并切换。
7. 检查每个 XHunt 进程的真实可执行文件版本和 API 健康状态。
8. 可选创建 pm2-root systemd 开机自启单元。

脚本不会自动在“已经成功”的状态下回滚。若自动验证失败，会询问是否立即回滚。

## 方式 B：人工逐步执行

优先使用方式 A。下面的命令用于审阅向导行为，或在无法运行向导时人工操作。

### 1. 进入 Bash 并定义固定参数

~~~bash
exec bash

export PROJECT_ROOT=/root/luykin-chaineye-service
export NVM_DIR=/root/.nvm
export TARGET_NODE_VERSION=22.23.4
export NVM_VERSION=v0.40.8
export PM2_VERSION=6.0.8
export HEALTH_URL=http://127.0.0.1:8087/api/internal-x9k2m7p4q8/health
export SYSTEM_PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
export UPGRADE_BACKUP=/root/node-upgrade-backups/$(date +%Y%m%d-%H%M%S)

umask 077
~~~

### 2. 只读预检

~~~bash
/usr/bin/node --version
/usr/bin/node /usr/local/lib/node_modules/pm2/bin/pm2 --version
/usr/bin/node /usr/local/lib/node_modules/pm2/bin/pm2 ls
git -C "$PROJECT_ROOT" rev-parse HEAD
git -C "$PROJECT_ROOT" status --short
df -h /root "$PROJECT_ROOT"
curl -fsS --max-time 10 "$HEALTH_URL"
~~~

预期：

- Node 显示 v18.19.1。
- API、crawler、bot、jobs 全部 online。
- 健康接口返回 status 为 ok。
- 工作树当前可能存在已知的未跟踪运行产物；本流程不会清理或覆盖它们。

若健康接口在升级前已经失败，应先停止操作并确认原因。

### 3. 创建回滚点

~~~bash
install -d -m 700 "$UPGRADE_BACKUP"

env PATH="$SYSTEM_PATH" \
  /usr/bin/node /usr/local/lib/node_modules/pm2/bin/pm2 save --force

cp /root/.pm2/dump.pm2 "$UPGRADE_BACKUP/dump.before-cutover.pm2"

env PATH="$SYSTEM_PATH" \
  /usr/bin/node /usr/local/lib/node_modules/pm2/bin/pm2 jlist \
  > "$UPGRADE_BACKUP/pm2-jlist.before-cutover.json"

chmod 600 "$UPGRADE_BACKUP"/*
~~~

不要输出或上传 pm2-jlist.before-cutover.json，它可能包含生产环境变量。

### 4. 安装 NVM

下载固定版本的官方安装器，不修改 fish 或 Bash profile：

~~~bash
curl -fsSL --proto '=https' --tlsv1.2 \
  "https://raw.githubusercontent.com/nvm-sh/nvm/$NVM_VERSION/install.sh" \
  -o "$UPGRADE_BACKUP/nvm-install-$NVM_VERSION.sh"

PROFILE=/dev/null bash "$UPGRADE_BACKUP/nvm-install-$NVM_VERSION.sh"

. "$NVM_DIR/nvm.sh"
nvm --version
~~~

预期 NVM 版本为 0.40.8。

### 5. 安装 Node.js 22.23.4 和独立 PM2

~~~bash
. "$NVM_DIR/nvm.sh"
nvm install "$TARGET_NODE_VERSION"
nvm alias chaineye-production "$TARGET_NODE_VERSION"
nvm use "$TARGET_NODE_VERSION"

node --version
npm install --global "pm2@$PM2_VERSION"
pm2 --version

export TARGET_NODE=$(nvm which "$TARGET_NODE_VERSION")
export TARGET_BIN=$(dirname "$TARGET_NODE")
export TARGET_PM2="$TARGET_BIN/pm2"
~~~

预期：

- node --version 显示 v22.23.4。
- pm2 --version 显示 6.0.8。
- /usr/bin/node --version 仍显示 v18.19.1。

### 6. 切换前兼容性检查

~~~bash
cd "$PROJECT_ROOT"

"$TARGET_NODE" --check src/apiServer.js
"$TARGET_NODE" --check src/crawlerServer.js
"$TARGET_NODE" --check src/botServer.js
"$TARGET_NODE" --check src/singletonJobsServer.js

"$TARGET_NODE" -e '
  const modules = ["axios", "dd-trace", "express", "pg", "redis", "sqlite3"];
  for (const name of modules) {
    require(name);
    console.log("loaded", name);
  }
'
~~~

任何一项失败都不要执行切换。此时在线服务仍使用 Node 18，可直接停止操作。

### 7. 最后刷新 PM2 dump

~~~bash
env PATH="$SYSTEM_PATH" \
  /usr/bin/node /usr/local/lib/node_modules/pm2/bin/pm2 save --force

cp /root/.pm2/dump.pm2 "$UPGRADE_BACKUP/dump.immediately-before-cutover.pm2"
chmod 600 "$UPGRADE_BACKUP/dump.immediately-before-cutover.pm2"
~~~

### 8. 切换 PM2 daemon 和业务进程

以下命令会产生短暂中断：

~~~bash
env PATH="$SYSTEM_PATH" \
  /usr/bin/node /usr/local/lib/node_modules/pm2/bin/pm2 kill

env PATH="$TARGET_BIN:$SYSTEM_PATH" \
  "$TARGET_PM2" resurrect

env PATH="$TARGET_BIN:$SYSTEM_PATH" \
  "$TARGET_PM2" restart \
    luykin-chaineye-api \
    luykin-chaineye-crawler \
    luykin-chaineye-bot \
    luykin-chaineye-jobs \
    --update-env

env PATH="$TARGET_BIN:$SYSTEM_PATH" \
  "$TARGET_PM2" save --force
~~~

resurrect 后再次带 --update-env 重启非常重要：它会把 Node 22 的 PATH 更新到业务进程，避免旧 PM2 dump 中保存的系统 PATH 继续解析到 Node 18。

### 9. 验证实际进程版本

先查看 PM2：

~~~bash
env PATH="$TARGET_BIN:$SYSTEM_PATH" "$TARGET_PM2" ls
~~~

再从 /proc 检查真实可执行文件，而不是只检查当前 shell：

~~~bash
env PATH="$TARGET_BIN:$SYSTEM_PATH" "$TARGET_PM2" jlist |
  "$TARGET_NODE" -e '
    let input = "";
    process.stdin.on("data", chunk => input += chunk);
    process.stdin.on("end", () => {
      for (const app of JSON.parse(input)) {
        if (String(app.name || "").startsWith("luykin-chaineye-")) {
          console.log(app.name, app.pid);
        }
      }
    });
  ' |
  while read -r name pid; do
    printf '%-32s pid=%-8s exe=%s version=' "$name" "$pid" "$(readlink -f /proc/$pid/exe)"
    /proc/$pid/exe --version
  done
~~~

所有 XHunt 业务进程必须显示 v22.23.4。

### 10. 健康检查与日志

~~~bash
curl -fsS --max-time 10 "$HEALTH_URL"

env PATH="$TARGET_BIN:$SYSTEM_PATH" \
  "$TARGET_PM2" logs \
    luykin-chaineye-api \
    luykin-chaineye-crawler \
    luykin-chaineye-bot \
    luykin-chaineye-jobs \
    --lines 80 \
    --nostream
~~~

重点观察：

- API 是否持续 online，重启计数是否继续快速增长。
- PostgreSQL、Redis 连接是否正常。
- sqlite3、Puppeteer、Axios/Undici 是否出现 Node ABI 或 TLS 错误。
- 登录、认证中心 token introspect、Crawler 和 Bot 的核心路径是否正常。

建议观察 15–30 分钟后再认定升级成功。

### 11. 可选配置开机自启

生产审计时没有发现 PM2 systemd 单元。确认 Node 22 稳定后执行：

~~~bash
env PATH="$TARGET_BIN:$SYSTEM_PATH" \
  "$TARGET_PM2" startup systemd -u root --hp /root

env PATH="$TARGET_BIN:$SYSTEM_PATH" \
  "$TARGET_PM2" save --force

systemctl status pm2-root --no-pager
~~~

如果准备很快进行其他运行时变更，也可以暂时跳过，但服务器重启后需要人工恢复 PM2。

## 回滚到系统 Node.js 18

适用情况：

- 任何业务进程没有使用 v22.23.4。
- 健康接口失败且短时间不能确认原因。
- 出现原生模块 ABI、数据库、Redis、Crawler、Bot 或认证回归。
- PM2 进程反复崩溃。

### 1. 禁用 Node 22 的 systemd 单元

仅在已经创建 pm2-root 时执行：

~~~bash
if systemctl list-unit-files pm2-root.service --no-legend 2>/dev/null | grep -q pm2-root; then
  systemctl disable --now pm2-root
fi
~~~

### 2. 停止当前 PM2 daemon

~~~bash
export SYSTEM_PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
export HEALTH_URL=http://127.0.0.1:8087/api/internal-x9k2m7p4q8/health

env PATH="$SYSTEM_PATH" \
  /usr/bin/node /usr/local/lib/node_modules/pm2/bin/pm2 kill || true
~~~

### 3. 使用系统 Node 恢复进程

~~~bash
env PATH="$SYSTEM_PATH" \
  /usr/bin/node /usr/local/lib/node_modules/pm2/bin/pm2 resurrect

env PATH="$SYSTEM_PATH" \
  /usr/bin/node /usr/local/lib/node_modules/pm2/bin/pm2 restart \
    luykin-chaineye-api \
    luykin-chaineye-crawler \
    luykin-chaineye-bot \
    luykin-chaineye-jobs \
    --update-env

env PATH="$SYSTEM_PATH" \
  /usr/bin/node /usr/local/lib/node_modules/pm2/bin/pm2 save --force
~~~

再次使用 --update-env 是为了清除 Node 22 的 PATH，确保业务进程真正回到 /usr/bin/node。

### 4. 验证回滚

~~~bash
env PATH="$SYSTEM_PATH" \
  /usr/bin/node /usr/local/lib/node_modules/pm2/bin/pm2 ls

curl -fsS --max-time 10 "$HEALTH_URL"
~~~

业务进程的 /proc/PID/exe 版本应重新显示 v18.19.1。

### 5. 如需恢复系统 Node 的开机自启

仅当回滚前已经启用了 pm2-root，或者明确需要开机自启时执行：

~~~bash
env PATH="$SYSTEM_PATH" \
  /usr/bin/node /usr/local/lib/node_modules/pm2/bin/pm2 startup systemd -u root --hp /root

env PATH="$SYSTEM_PATH" \
  /usr/bin/node /usr/local/lib/node_modules/pm2/bin/pm2 save --force

systemctl status pm2-root --no-pager
~~~

## 回滚后处理

- 不需要删除 /root/.nvm；保留现场便于排查。
- 不要删除 /root/node-upgrade-backups 下本次目录。
- 记录失败时间、PM2 状态、各进程真实 Node 版本和相关错误日志。
- 在非生产环境复现并解决问题后，再重新执行升级。

## 成功后的后续工作

- 为仓库补充明确的 Node engines、.nvmrc 和 CI 运行时版本。
- 将 Dockerfile 的浮动 node:22 标签锁定到安全补丁版本或镜像 digest。
- 在 Node 22 于 2027-04-30 EOL 前完成 Node 24 LTS 迁移。
- 单独调查生产 PM2 重启计数偏高的问题。
- 确认 Redis 6379 和 PostgreSQL 5432 的防火墙/安全组访问范围。
