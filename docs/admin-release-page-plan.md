# 管理后台发布页面方案

> 目标：在已有「紧急回滚」页面基础上，新增一个 super 专用的「发布上线」页面，让发布流程可视化、可确认、可审计，并保留终端命令作为兜底。

## 1. 背景

当前项目已经有：

- `package.json` 中的紧急回滚/恢复脚本
- 管理后台「紧急回滚」页面
- 后端 `/admin/deploy/*` 类接口，支持查看版本、回滚、恢复

但日常上线仍主要依赖终端操作，例如：

```bash
git pull
npm run admin-web:build
pm2 restart all
```

这类操作存在几个问题：

1. 发布前状态不够直观：不知道当前线上版本、远程最新版本、将发布哪些提交。
2. 发布步骤靠人工记忆：容易漏 `fetch`、漏构建、漏重启。
3. 发布结果缺少后台审计：不方便追踪谁在什么时间发布了哪个版本。
4. 和紧急回滚割裂：发布后如果有问题，需要切换到另一个页面/终端判断。

因此建议新增一个「发布上线」页面，和「紧急回滚」形成一套完整的发布闭环。

---

## 2. 页面定位

页面名称建议：

- 菜单名：`发布上线`
- 路由：`#/release-deploy`
- 权限：`deploy:release`
- 角色限制：仅 `super`

和现有「紧急回滚」区分：

| 页面 | 用途 | 主要动作 |
|---|---|---|
| 发布上线 | 从远程分支发布新版本 | fetch、预览提交、pull/reset、build、pm2 restart |
| 紧急回滚 | 线上出问题后回退旧版本 | 选择 commit/tag、reset、pm2 restart |

---

## 3. 核心设计原则

### 3.1 不做任意命令执行

后端必须继续使用：

```js
child_process.execFile
```

禁止把用户输入拼进 shell 字符串。

页面只能触发有限白名单动作：

- `git fetch origin --tags`
- `git rev-parse HEAD`
- `git rev-parse origin/main`
- `git log HEAD..origin/main`
- `git reset --hard origin/main` 或 `git pull --ff-only`
- `npm run admin-web:build`
- `pm2 restart <target>`

### 3.2 发布前必须预览差异

页面必须展示：

- 当前线上 HEAD
- 远程 `origin/main` HEAD
- 本次将发布的 commit 列表：`git log HEAD..origin/main`
- 本地是否有未提交改动
- 当前分支
- PM2 重启目标

如果没有新提交，应提示「当前已经是最新版本」。

### 3.3 高危操作必须二次确认

执行发布前，要求输入确认词：

```txt
DEPLOY
```

并清楚展示：

- 将发布到哪个 commit
- 将包含多少个提交
- 是否会构建 admin-web
- 是否会重启 PM2
- 工作区有未提交改动时会先 stash

### 3.4 必须写审计日志

发布动作写入 `XhuntAdminAuditLog`：

- action: `deploy-release`
- adminId / email
- before commit
- after commit
- commit count
- 是否 build admin-web
- pm2 restart target
- 成功/失败
- 错误信息

---

## 4. 推荐发布流程

### 4.1 默认流程

推荐默认采用这个顺序：

1. `git fetch origin --tags`
2. 读取当前版本：`git rev-parse HEAD`
3. 读取远程版本：`git rev-parse origin/main`
4. 预览差异：`git log HEAD..origin/main --oneline`
5. 如果工作区有未提交改动：`git stash push -u -m admin-release-<timestamp>`
6. 更新代码：`git reset --hard origin/main`
7. 可选构建：`npm run admin-web:build`
8. 写审计日志
9. 返回接口响应
10. 异步执行：`pm2 restart all`

> 说明：使用 `reset --hard origin/main` 比 `git pull` 更可控，避免本地分支状态异常导致 merge commit 或交互式冲突。

### 4.2 为什么先响应再重启

如果接口内直接同步执行 `pm2 restart all`，当前 Node 进程会被重启，HTTP 请求可能中断，前端体验不好。

建议和紧急回滚页面保持一致：

```js
res.json({ success: true, ... })
schedulePm2Restart('release:origin/main')
```

这样页面能先拿到发布结果，再提示「PM2 即将重启」。

---

## 5. 后端接口方案

建议继续放在：

```txt
src/admin/api/admin.js
```

和现有紧急回滚接口保持同一组命名。

### 5.1 获取发布状态

```http
GET /admin/deploy/release/status
```

返回示例：

```json
{
  "success": true,
  "data": {
    "projectRoot": "/path/to/project",
    "branch": "main",
    "dirty": false,
    "dirtyFiles": [],
    "current": {
      "hash": "当前 HEAD",
      "shortHash": "abc1234",
      "message": "当前提交 message",
      "author": "xxx",
      "relativeTime": "2 hours ago"
    },
    "remote": {
      "hash": "origin/main HEAD",
      "shortHash": "def5678",
      "message": "远程最新提交 message",
      "author": "xxx",
      "relativeTime": "10 minutes ago"
    },
    "aheadCommits": [],
    "pendingCommits": [
      {
        "hash": "def5678...",
        "shortHash": "def5678",
        "message": "fix: 修复 xxx",
        "author": "xxx",
        "relativeTime": "10 minutes ago"
      }
    ],
    "restartTarget": "all",
    "hasUpdate": true
  }
}
```

说明：

- `pendingCommits` = `git log HEAD..origin/main`
- `aheadCommits` = `git log origin/main..HEAD`
- 如果 `aheadCommits` 不为空，说明线上本地代码比远程还新，需要红色警告。

### 5.2 刷新远程信息

```http
POST /admin/deploy/release/fetch
```

动作：

```bash
git fetch origin --tags
```

用途：手动刷新远程状态。

### 5.3 执行发布

```http
POST /admin/deploy/release
```

请求体：

```json
{
  "confirmText": "DEPLOY",
  "rebuildAdminWeb": true,
  "restartAfterDeploy": true
}
```

返回：

```json
{
  "success": true,
  "data": {
    "before": "旧 HEAD",
    "after": "新 HEAD",
    "commitCount": 3,
    "releasedCommits": [],
    "outputs": [
      { "step": "fetch", "stdout": "", "stderr": "" },
      { "step": "reset", "stdout": "HEAD is now at ...", "stderr": "" },
      { "step": "admin-web:build", "stdout": "...", "stderr": "" }
    ],
    "restartScheduled": true,
    "restartTarget": "all"
  }
}
```

---

## 6. 前端页面方案

新增文件建议：

```txt
admin-web/src/pages/ReleaseDeployPage.tsx
admin-web/src/services/deploy.ts   // 复用并扩展现有 deploy service
```

路由：

```txt
#/release-deploy
```

菜单：

```txt
系统 -> 发布上线
```

### 6.1 页面模块

#### A. 当前版本卡片

展示：

- 当前分支
- 当前 HEAD
- 当前提交说明
- 工作区状态
- PM2 重启目标

#### B. 远程版本卡片

展示：

- `origin/main` HEAD
- 最新提交说明
- 是否有可发布更新
- 和当前版本相差几个 commit

#### C. 待发布提交列表

表格展示：

- short hash
- commit message
- author
- relative time

如果为空：

```txt
当前线上代码已经是 origin/main 最新版本
```

#### D. 风险提示区

根据状态展示不同提示：

| 状态 | 提示 |
|---|---|
| dirty = true | 有未提交改动，发布前会自动 stash |
| aheadCommits > 0 | 当前线上存在远程没有的提交，发布可能覆盖本地提交 |
| pendingCommits = 0 | 没有可发布更新 |
| build 开启 | 会重新构建 admin-web，耗时更长 |

#### E. 发布确认区

点击「发布上线」后弹窗：

- 展示发布目标 commit
- 展示将发布的提交数量
- 选项：是否构建 admin-web
- 输入 `DEPLOY` 才能确认

---

## 7. 权限与安全

### 7.1 权限

新增权限：

```txt
deploy:release
```

但是和紧急回滚一样，建议后端强制：

```js
adminAuth, requireRole("super")
```

也就是说：

- 普通 admin 即使有权限也不能发布
- 只有 super 可以发布

### 7.2 输入校验

发布接口不接受任意 target。

默认只允许发布到：

```txt
origin/main
```

如果未来需要支持分支，可以白名单：

```txt
origin/main
origin/staging
```

不建议第一版支持用户手填分支。

### 7.3 命令白名单

只允许固定命令和固定参数，不做动态 shell。

```js
execFile("git", ["fetch", "origin", "--tags"])
execFile("git", ["reset", "--hard", "origin/main"])
execFile("npm", ["run", "admin-web:build"])
execFile("pm2", ["restart", restartTarget])
```

---

## 8. 和紧急回滚页面的关系

建议两个页面互相提供入口：

- 发布页面顶部放一个按钮：`去紧急回滚`
- 紧急回滚页面顶部放一个按钮：`去发布上线`

发布完成后页面提示：

```txt
如果发布后异常，请立即进入「紧急回滚」选择上一版本回退。
```

---

## 9. 第一版建议范围

第一版只做这些：

- 只发布 `origin/main`
- 只支持 super
- 展示当前版本、远程版本、待发布提交
- 支持 fetch 刷新
- 支持一键发布
- 支持可选构建 admin-web
- 默认发布后重启 `pm2 restart all`
- 写审计日志

第一版不做：

- 多分支发布
- 多环境发布
- CI/CD 队列
- 灰度发布
- 自动健康检查
- 自动回滚

这些可以放到后续版本。

---

## 10. 后续增强建议

### 10.1 发布后健康检查

发布后自动请求：

```txt
GET /admin/auth-check
GET /api/xhunt/stats
```

如果失败，页面提示：

```txt
服务重启后健康检查失败，请考虑紧急回滚。
```

### 10.2 自动生成发布记录

可以把发布记录单独保存成表，而不仅是 audit log：

```txt
XhuntDeployReleaseLog
```

字段：

- id
- adminId
- email
- beforeCommit
- afterCommit
- commitMessages
- buildAdminWeb
- restartTarget
- status
- errorMessage
- createdAt

### 10.3 支持 tag 发布

如果后面希望更稳，可以改成「只允许发布 tag」：

1. 本地或 GitHub 打 tag
2. 后台选择 tag
3. 后端 reset 到 tag
4. build + restart

这会比直接发布 `origin/main` 更有仪式感，也更适合生产版本管理。

---

## 11. 实施文件清单

预计需要改动：

```txt
src/admin/api/admin.js
admin-web/src/services/deploy.ts
admin-web/src/pages/ReleaseDeployPage.tsx
admin-web/src/app/router.tsx
admin-web/src/config/admin-navigation.tsx
admin-web/src/pages/AdminUsersPage.tsx
```

可选：

```txt
admin-web/src/pages/EmergencyRollbackPage.tsx
```

用于增加「去发布上线」入口。

---

## 12. 验证建议

代码完成后至少执行：

```bash
node -c src/admin/api/admin.js
npx --prefix admin-web tsc -p admin-web/tsconfig.app.json --noEmit
```

上线前人工检查：

```bash
git status
git log --oneline -5
git log HEAD..origin/main --oneline
```

上线后检查：

```bash
pm2 status
pm2 logs --lines 100
```

---

## 13. 结论

建议新增「发布上线」页面，但第一版要保持克制：

- 只发布 `origin/main`
- 只给 super 用
- 只做固定命令白名单
- 发布前必须预览 commit 差异
- 发布时必须输入 `DEPLOY`
- 发布后保留紧急回滚兜底

这样可以把日常上线从纯终端操作变成可视化流程，同时不会引入过多复杂度。
