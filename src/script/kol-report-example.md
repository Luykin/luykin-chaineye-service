# KOL 报告私信发送脚本使用说明

## 功能说明

这个脚本用于给指定的 KOL 用户发送包含专属报告链接的私信。每个用户会收到内容基本相同但链接不同的私信。

## 使用方法

```bash
node src/script/send-kol-reports.js <campaignId> <senderId> <usernames>
```

### 参数说明

- `campaignId`: 活动标识，用于避免重复发送（如：`kol_report_20250127`）
- `senderId`: 发信人 ID（UUID 格式）
- `usernames`: 推特用户名，用逗号分隔

### 示例

<!-- 6666666d-cc11-8888-8888-034d3e9a8888 这是Xhunt 官方机器人 -->

```bash
# 给两个用户发送KOL报告私信
node src/script/send-kol-reports.js kol_report_20250127 6666666d-cc11-8888-8888-034d3e9a8888 "FloriaT96249,luoyukun4"

# 给更多用户发送
node src/script/send-kol-reports.js kol_report_20250127 your-sender-uuid "user1,user2,user3,user4,user5"
```

## 私信内容

每个用户会收到包含以下内容的私信：

- **标题**: "🎉 您的专属 KOL 分析报告已生成！"
- **内容**:
  - 个性化问候（包含用户名）
  - 报告功能介绍（粉丝增长、影响力评估、互动率等）
  - 专属报告链接按钮
  - 感谢信息

## 报告链接格式

每个用户的专属报告链接格式为：

```
https://xhunt.ai/kolreport/{username}-{randomString}
```

例如：

- `https://xhunt.ai/kolreport/FloriaT96249-a1b2c3d4`
- `https://xhunt.ai/kolreport/luoyukun4-e5f6g7h8`

## 防重复机制

脚本会检查用户是否已经收到过相同活动标识的消息，避免重复发送。

## 输出示例

```
开始执行KOL报告活动 kol_report_20250127 的私信发送...
目标用户: FloriaT96249, luoyukun4

处理用户: FloriaT96249
✅ 成功发送报告给用户 FloriaT96249 (ID: 123e4567-e89b-12d3-a456-426614174000)
   报告链接: https://xhunt.ai/kolreport/FloriaT96249-a1b2c3d4

处理用户: luoyukun4
✅ 成功发送报告给用户 luoyukun4 (ID: 123e4567-e89b-12d3-a456-426614174001)
   报告链接: https://xhunt.ai/kolreport/luoyukun4-e5f6g7h8

=== 发送结果统计 ===
✅ 成功发送: 2 条
❓ 用户未找到: 0 个
🔄 已发送过: 0 个
❌ 发送失败: 0 个

📋 成功发送的用户及报告链接:
   FloriaT96249: https://xhunt.ai/kolreport/FloriaT96249-a1b2c3d4
   luoyukun4: https://xhunt.ai/kolreport/luoyukun4-e5f6g7h8

🎉 脚本执行完成！
```
