# 群聊（Group）支持设计方案

> 状态：**已评估、未实施**（2026-08 评审通过的设计稿）。当前插件仅实现单聊（C2C）。
> 本文档记录 QQ 开放平台群聊能力调研结论 + 完整改动评估，供后续实现时直接照做。

## 1. QQ 开放平台群聊能力（官方调研结论）

来源：[消息类型总览](https://bot.q.qq.com/wiki/develop/api-v2/server-inter/message/type/overview.html) ·
[发送群聊消息 API](https://bot.qq.com/wiki/develop/api-v2/autogen/api/v2_groups_group_openid_messages.post.html)

| 类型 | 群聊支持 | 说明 |
|---|---|---|
| 文本（`msg_type=0`） | 收 ✅ 发 ✅ | `content` 字段 |
| Markdown（`msg_type=2`） | 收 ✅ 发 ✅ | **群聊是唯一 MD 收发双向的场景**（单聊/频道只能发不能收） |
| 富媒体（`msg_type=7`） | 收 ✅ 发 ✅ | 图片/视频/语音/文件，先调 `/v2/groups/{group_openid}/files` 上传拿 `file_info` |
| 富文本卡片 ark（`msg_type=3`） | 收 ✅ 发 ❌ | 群聊不能主动发 |
| 内嵌键盘 keyboard | 发 ✅ | 可与 MD 同发 |
| Embed / 表情表态 | ❌ | 仅频道 |

### 群聊特有规则（与单聊不同，必须处理）

1. **只响应被 @ 的消息**：机器人只收到 `GROUP_AT_MESSAGE_CREATE` 事件，群里必须 @机器人 才触发。
2. **不支持流式输出**（官方明确）。长回答只能整段/分段发。
3. **被动回复窗口**：收到事件后 **5 分钟内**可被动回复（带 `msg_id`），每条消息最多回 **5 次**（`msg_seq` 1–5）。
4. **主动消息频控**（不带 `msg_id` 直接推送）：
   - Bot 维度：已认证 60 qpm / 未认证 30 qpm；
   - 单群维度：**20 qpm**，每群每天最多 **1000 条**。
5. 出站富媒体上传接口（`/v2/groups/{group_openid}/files`）**同样只收公网 URL**（`file_type`：1 图片 / 2 视频 / 3 语音 / 4 文件），与单聊一致 —— 本地路径降级文本提示的策略原样复用。
6. 入站群消息出于隐私只带 `author.member_openid`（**无昵称**）。

## 2. 设计决策（已定稿）

1. **一个群 = 一个 DSH 会话**：所有群成员共享同一个 agent（共享多轮记忆）。session key 为
   `group:{group_openid}`，持久化 / workspace 分组 / resume 逻辑零改动（`PeerRegistry` 本就按
   `key(scene, peerId)` 参数化）。
2. **发言人署名**：群消息进 agent 前加 `[成员:xxxxxx]:` 前缀（openid 后 4–6 位），让模型能区分
   不同成员；拿不到昵称是平台限制。
3. **被动→主动自动降级**（Python 侧维护）：每群记录 `(最近 msg_id, 收到时间, 已用 seq)`；
   发送时窗口内且 seq ≤ 5 → 被动回复（`msg_id` + `msg_seq`）；过期或超次 → 自动切主动消息。
   TS 侧无感知，不需要改发送调用逻辑。
4. **@前缀剥离**：入站 content 剥离可能的 `<@!BOT_ID>` 前缀及多余空白再转发。
5. **群开关 + 白名单**：`enableGroups`（默认 `false`，不影响现有单聊）、`groupWhitelist`
   （`string[]`，空 = 所有群）。上线初期建议先全放开，需要时再收紧。

## 3. 逐文件改动评估（约 +250 行 / 6 文件）

| 文件 | 改动 | 量 | 说明 |
|---|---|---|---|
| `python/bot.py` | **大头** | ~120 行 | 新增 `on_group_at_message_create`（`public_messages` intent 已覆盖群聊，**intents 不用改**）；发送侧 `post_group_message` / `post_group_file` 分支；被动回复窗口跟踪器（见决策 3）；@前缀剥离 |
| `src/protocol.ts` | 类型放宽 | ~10 行 | `scene: 'c2c' \| 'group'`；`InboundMessage` 加 `senderId` |
| `src/registry.ts` | 类型放宽 | ~5 行 | `PeerRoute.scene` 放宽；key 逻辑不变 |
| `src/index.ts` | 中等 | ~40 行 | 群消息入口；`enableGroups`/白名单过滤；最近 msgId 缓存（作为 `replyTo` 锚点传给 Python）；发言人署名注入 |
| `src/config.ts` | 新配置 | ~15 行 | `enableGroups`、`groupWhitelist` |
| 测试 + README | 补充 | ~40 行 | protocol spec 补群场景；README 能力矩阵更新 |

工作量的其余部分：版本 bump `0.2.0` → `npm pack/publish` → push GitHub → 本机 profile 加
`enableGroups: true`，流程与 0.1.1 完全相同。预计代码+测试 1–2 小时。

## 4. 平台侧前置步骤（需要人工，代码管不了）

1. [q.qq.com](https://q.qq.com) 机器人管理后台确认**群聊场景已开启**（群 MD 等能力若需单独申请，
   后台会提示；个人认证机器人一般有原生 MD 权限，实机一测便知）。
2. 把机器人**拉进一个测试群**，@它 即触发。

## 5. 验收清单（实现完成的标准）

- [ ] 群里 @机器人 发文本 → agent 回复落群（Markdown）；
- [ ] 群里 @机器人 发图片 → 走视觉模型（qwen3.8-max）；
- [ ] 群里 @机器人 发文件 → 落 workspace `uploads/` 并回路径说明；
- [ ] 同一群多成员连续发言 → 会话记忆连续、署名可区分；
- [ ] DSH 长任务（>5 分钟）→ 首条被动回复，后续自动降级主动消息，不丢回复；
- [ ] 侧边栏「QQ bot」分组下出现群会话，与单聊会话并列；
- [ ] 单聊（C2C）行为与 0.1.x 完全一致（回归）；
- [ ] `enableGroups: false`（默认）时群消息完全静默。
