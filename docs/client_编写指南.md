# Client 编写指南

本文档定义了 LexGent Client 必须实现的功能和协议，供 Client 开发者参考。

## 1. 架构概述

```
Client <--HTTP/SSE--> Agent Engine (:3001) <--> Data Server (:3000)
                                           <--> YAML Server (:3003)
```

Client 通过 HTTP API 与 Agent Engine 交互，通过 SSE (Server-Sent Events) 接收实时事件流。

## 2. 本地持久化存储

Client 需要在本地维护以下用户数据文件。不同 Client 形态使用不同的存储方式：

| 数据 | CLI (文件系统) | Web (浏览器) | 说明 |
|------|---------------|-------------|------|
| 用户 ID | `~/.lexgent/uid` | `localStorage: lexgent_uid` | 唯一标识用户，首次使用时自动生成 (UUID v4) |
| 用户档案 | `~/.lexgent/user.md` | `localStorage: lexgent_user_profile` | Agent 记录的用户信息（姓名、角色、偏好等） |
| 对话历史 | `~/.lexgent/chat_history.md` | `localStorage: lexgent_chat_history` | 最近对话记录，供 Agent 上下文参考 |

### 2.1 用户 ID (uid)

- 格式：UUID v4 字符串
- 首次启动时生成，之后复用
- 用于标识用户身份，不同用户不共享数据

### 2.2 用户档案 (user_profile)

- 格式：Markdown 列表
- 内容示例：
  ```markdown
  - 姓名: 李明
  - 角色: 原告律师
  - 偏好: 简洁回复
  ```
- **由 Engine 维护**：Client 只负责存储和传输，不自行修改内容
- Engine 通过 `profile_update` SSE 事件推送更新内容

### 2.3 对话历史 (chat_history)

- 格式：每行一条，`User:` 和 `Assistant:` 交替
  ```
  User: 你好，我是李明
  Assistant: 您好，李明！有什么可以帮您的吗？
  User: 请分析诉讼时效
  Assistant: [已执行: 诉讼时效分析]
  ```
- **由 Engine 维护**：Engine 自动追加每轮对话并保留最近 10 轮
- Engine 通过 `history_update` SSE 事件推送更新内容
- Client 只负责存储和传输，不自行修改内容

## 3. API 协议

### 3.1 创建 Session

```
POST /session
Content-Type: application/json

{
  "caseNumber": "case-101",
  "caseId": "case-101",
  "agentId": "law_agent",
  "dataServerUrl": "http://localhost:3000",
  "yamlServerUrl": "http://localhost:3003",
  "uid": "<用户ID>",
  "user_profile": "<用户档案内容>",
  "chat_history": "<对话历史内容>",
  "verbose": false,
  "reuseSandbox": true
}
```

**重要**：`uid`、`user_profile`、`chat_history` 必须在创建 Session 时传入。Engine 会在 Session 中保存这些数据，后续每次 task 执行时自动使用。

响应：
```json
{
  "sessionId": "sess-xxx",
  "caseId": "case-101",
  "agentId": "law_agent",
  "status": "ready",
  "_warnings": ["可选的警告信息"]
}
```

### 3.2 连接 SSE 事件流

```
GET /session/:sessionId/events
```

返回 `text/event-stream`，Client 必须在提交 Task 前建立 SSE 连接。

### 3.3 提交 Task

```
POST /session/:sessionId/task
Content-Type: application/json

{
  "query": "用户输入的自然语言指令"
}
```

提交后，Engine 通过 SSE 推送执行过程和结果。

### 3.4 回复交互请求

```
POST /session/:sessionId/reply
Content-Type: application/json

{
  "askId": "<来自ask事件的ID>",
  "input": "用户输入的回答"
}
```

## 4. SSE 事件类型

Client 必须处理以下 SSE 事件：

### 4.1 `log` — 日志消息

```json
{ "type": "init|request|analyser|plan|step|result|skip|error|reply|verbose", "text": "消息内容" }
```

`type` 字段用于区分日志类别，Client 可据此添加图标或样式：

| type | 含义 | 建议图标 |
|------|------|---------|
| `init` | 初始化信息（模型、配置加载等） | ⚙ |
| `request` | 用户请求已接收 | 📨 |
| `analyser` | 分析器状态 | 🔍 |
| `plan` | 执行计划 | 📋 |
| `step` | 步骤执行 | ▶ |
| `result` | 步骤结果 | ✔ |
| `skip` | 步骤跳过 | ⏭ |
| `error` | 错误信息 | ❌ |
| `reply` | Agent 直接回复 | 💬 |
| `verbose` | 调试信息（verbose 模式） | — |

**规范**：`init` 类型的消息仅在第一轮对话时显示，后续轮次必须隐藏（在收到首个 `complete` 事件后设置标志位）。

### 4.2 `error` — 错误

```json
{ "text": "错误描述", "error": "详细错误信息（可选）" }
```

### 4.3 `ask` — 交互请求

```json
{ "askId": "ask-xxx", "question": "问题内容", "timeout": 30000, "default": true }
```

收到后需要：
1. 向用户展示问题
2. 收集用户回答
3. POST 到 `/session/:id/reply`

如果超时未回复，Engine 会使用 `default` 值（true → "y"，false → "n"）。

### 4.4 `action` — 客户端动作

```json
{ "action": "display_content|display_document", "inputs": [...], "instruction": "..." }
```

Client 需要根据 `action` 类型执行相应操作（如显示文档内容）。

### 4.5 `complete` — 任务完成

```json
{ "status": "success|failed", "summary": "可选摘要" }
```

收到后应解除 busy 状态，允许用户输入下一条指令。

### 4.6 `profile_update` — 用户档案更新

```json
{ "content": "- 姓名: 李明\n- 角色: 原告律师" }
```

**必须处理**：收到后立即写入本地存储。该数据会在下次创建 Session 时通过 `user_profile` 字段回传给 Engine。

### 4.7 `history_update` — 对话历史更新

```json
{ "content": "User: 你好\nAssistant: 您好！\nUser: ...\nAssistant: ..." }
```

**必须处理**：收到后立即写入本地存储。该数据会在下次创建 Session 时通过 `chat_history` 字段回传给 Engine。

## 5. 交互模式 vs 单次模式

### 5.1 单次模式 (One-shot)

1. 读取本地存储 (uid, user_profile, chat_history)
2. POST /session 创建会话
3. GET /session/:id/events 连接 SSE
4. POST /session/:id/task 提交查询
5. 监听 SSE 直到 `complete` 事件
6. 写入更新后的 user_profile 和 chat_history
7. 退出

### 5.2 交互模式 (Interactive)

1. 读取本地存储
2. POST /session 创建**一个**会话（整个交互周期复用同一 Session）
3. GET /session/:id/events 连接 SSE（持续连接）
4. 循环：
   a. 等待用户输入
   b. POST /session/:id/task 提交查询
   c. 等待 `complete` 事件
   d. SSE handler 自动处理 profile_update / history_update 写入
5. 用户退出时关闭 SSE 连接

**关键**：交互模式下必须复用同一 Session，不要每次输入都创建新 Session。

## 6. 数据流图

```
启动 → 读取本地存储 (uid, user_profile, chat_history)
  ↓
POST /session { uid, user_profile, chat_history }
  ↓
GET /session/:id/events (SSE 连接)
  ↓
POST /session/:id/task { query }
  ↓
←── SSE log 事件 (展示给用户)
←── SSE ask 事件 → POST /session/:id/reply
←── SSE action 事件 (客户端动作)
←── SSE profile_update → 写入本地 user_profile
←── SSE history_update → 写入本地 chat_history
←── SSE complete (本轮结束)
  ↓
下一轮输入...
```

## 7. Web Client 注意事项

Web Client 通常通过 Web Server 代理访问 Engine API：

```
Browser → Web Server (/api/*) → Agent Engine (:3001/*)
```

Web Server 需要正确代理以下路径：
- `POST /api/session` → `POST /session`
- `GET /api/session/:id/events` → `GET /session/:id/events` (SSE 流式代理)
- `POST /api/session/:id/task` → `POST /session/:id/task`
- `POST /api/session/:id/reply` → `POST /session/:id/reply`

SSE 代理需要特别注意：设置正确的 headers (`Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`) 并确保流式转发。
