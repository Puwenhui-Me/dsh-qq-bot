# @puwenhui/dsh-qq-bot

把 **QQ 单聊（C2C）** 接入 DeepSeek Harness：在手机 QQ 上给机器人发 **文本 / 图片 / 文件**，DSH 的 agent 处理后，把结果以 **Markdown** 推回 QQ。每个 QQ 用户对应一个持久化的 agent 会话，**多轮记忆跨重启保留**。

## 工作原理

```
┌── deepseek-harness (Node) ────────────────────────────────┐
│  qq-bot 插件  spawn  Python(botpy) 子进程                 │
│   └─ 每个 QQ 用户 = 一个 Agent（多轮记忆 / 重启 resume）     │
│        ▲ NDJSON stdin/stdout 双向桥                        │
└────────┼──────────────────────────────────────────────────┘
         │
┌────────▼──────────────────────────────────────────────────┐
│  Python bot.py（botpy，持有 QQ WebSocket 长连接）           │
│   on_c2c_message_create → 转发给 DSH；send 指令 → 回发 QQ   │
└───────────────────────────────────────────────────────────┘
```

- **入站**：文本作为 user message 进 agent；图片下载后经 attachments 服务转成 `image` content block；文件下载后复制到该会话的 workspace `uploads/` 并以文本告知路径（agent 用文件工具读取）。
- **出站**：`assistant/message` 的文本块按顺序回发为 QQ Markdown（`msg_type=2`，可用 `markdown: false` 降级纯文本）。
- **记忆**：`$DSH_HOME/qq-bot/sessions.json` 持久化 `openid → sessionId` 映射；重启后用 `agents.resume()` 接回同一会话。

## 前置条件

1. 一个 QQ 开放平台的机器人，拿到 **AppID** 与 **AppSecret**，并开通「单聊（C2C）消息」能力。
2. 一个支持**视觉理解（图片输入）**的 LLM（推荐阿里云百炼 `qwen3.8-max`），拿到 **百炼 API Key**。
3. Python ≥ 3.8。

## 安装与部署（任意机器，从零到可用）

> `$DSH_HOME` 默认是 `~/.dsh`（Windows 为 `C:\Users\<你>\.dsh`）。以下以 `dsh web`（web profile）为例。

**① 安装插件（一条命令，从 npm）**

```sh
dsh plugin --profile web add @puwenhui/dsh-qq-bot
```

（若 `dsh` 不在 PATH，用仓库内调用 `pnpm dsh plugin --profile web add @puwenhui/dsh-qq-bot`。）

**② 安装 Python 依赖**

```sh
pip install -r <npm包内>/python/requirements.txt
# 等价于：
pip install qq-botpy aiohttp
```

**③ 配置凭据：编辑 `$DSH_HOME/.env`**

```ini
# QQ 机器人 AppSecret
QQBOT_SECRET=你的QQ机器人AppSecret

# 阿里云百炼 API Key（视觉模型 qwen3.8-max 用）
BAILIAN_API_KEY=你的百炼API-Key
```

（`$DSH_HOME/.env` 会在 DSH 启动时自动加载进 `process.env`。）

**④ 配置 LLM 路由：编辑 `$DSH_HOME/settings.yaml`**（或直接在 DSH Web「模型」页添加，等效）

```yaml
llm-pi-ai:
  providers:
    bailian:
      displayName: 百炼API
      apiKeyEnv: BAILIAN_API_KEY
      api: openai-completions
      baseURL: https://dashscope.aliyuncs.com/compatible-mode/v1
      models:
        - id: qwen3.8-max
          name: qwen3.8-max
          input: [text, image]
```

> 关键：`input: [text, image]` 声明该模型支持图片输入（视觉理解）。若用的是百炼**专属部署**网关，把 `baseURL` 换成你自己的专属地址（如 `https://llm-xxx.cn-beijing.maas.aliyuncs.com/compatible-mode/v1`）。

**⑤ 挂载插件：编辑 `$DSH_HOME/profiles/web/cordis.patch.yml`**

```yaml
- insert:
    - id: qq-bot
      name: "@puwenhui/dsh-qq-bot"
      config:
        appid: '你的QQ机器人AppID'
        secretEnv: 'QQBOT_SECRET'
        markdown: true
        provider: 'bailian'
        model: 'qwen3.8-max'
```

**⑥ 重启并验证**

```sh
dsh web
```

控制台出现 `qq-bot: python bridge ready` 即桥接成功；用手机 QQ 私聊机器人即可对话。插件未配置（appid 或 secret 为空）时静默禁用，不影响 DSH 其余功能。

## 完整配置项（`cordis.patch.yml` 的 `config`）

| 字段 | 默认 | 说明 |
|---|---|---|
| `appid` | `''` | QQ 开放平台 AppID（必填） |
| `secret` / `secretEnv` | `''` | AppSecret；`secret` 优先于 `secretEnv` |
| `pythonPath` | `python` | Python 解释器 |
| `botScript` | 包内 `python/bot.py` | 桥接脚本绝对路径 |
| `stateDir` | `$DSH_HOME/qq-bot` | 会话映射持久化目录 |
| `mediaDir` | `<stateDir>/media` | 附件字节共享目录 |
| `cwdRoot` | `<stateDir>/workspaces` | QQ 会话共享工作区目录（也注册为侧边栏「QQ bot」分组） |
| `workspaceTitle` | `QQ bot` | 侧边栏分组标题 |
| `provider` / `model` | 部署默认 | 传给 agent 的 provider/model（建议直接填视觉模型，如 `bailian`/`qwen3.8-max`） |
| `visionProvider` / `visionModel` | `''` | 可选：按消息分流，含图时切到该视觉模型（因 DSH 历史含图后无法回退文本模型，一般建议直接全用视觉模型） |
| `maxTokens` | `0`（不设） | 每次请求最大输出 token |
| `markdown` | `true` | 助手文本以 Markdown 回发 |
| `ack` | `''` | 非空时收到消息先回一句确认 |

## 能力矩阵与已知限制

| 方向 | 能力 | 状态 |
|---|---|---|
| 入站 | 文本 | ✅ |
| 入站 | 图片（下载→attachments） | ✅（需视觉模型） |
| 入站 | 文件（下载→workspace） | ✅ |
| 出站 | Markdown / 文本 | ✅ |
| 出站 | 图片 | ⚠️ `post_c2c_file` 需公网 URL；本地图暂以路径文本回传 |
| 出站 | 文件 | ⚠️ QQ 开放平台 `file_type=4`（文件）**暂未开放**，暂以路径文本回传 |

> 频道（Guild）不支持文件发送、且 Markdown 发送需内邀，本插件当前只实现单聊（C2C）。**群聊支持已完成设计评估、尚未实施**，方案见 [docs/group-chat-plan.md](docs/group-chat-plan.md)；频道、图片/文件出站增强属于后续迭代。

## 安全说明

npm 包内**只含代码与文档**，不含任何凭据。你的 `QQBOT_SECRET`、`BAILIAN_API_KEY`、AppID 都配置在各自机器的 `$DSH_HOME`（`.env` / `settings.yaml` / `cordis.patch.yml`），运行时才读取，不会随包发布。

## 开发

- 构建：`tsc -b tsconfig.host.json && tsdown --env.DSH_BUILD_FACE host`。
- 更新发布：改代码 → 重建 → `npm pack` → `npm publish`（bump version）。
- 联调可手动跑 Python 桥验证 QQ 连接（stdin 输入 NDJSON、stdout 观察事件）：

  ```sh
  QQBOT_APPID=xxx QQBOT_SECRET=yyy QQBOT_MEDIA_DIR=/tmp/qqbot-media \
    python <插件目录>/python/bot.py
  ```
