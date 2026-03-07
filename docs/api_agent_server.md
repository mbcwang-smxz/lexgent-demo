# Agent Server API Reference

Agent Server 负责托管和执行 Agent 逻辑。支持 Session 模式（SSE 实时推送）和直接执行模式。

**默认端口**: `3001`（可通过配置修改）

---

## 1. 健康检查

**GET** `/health`

- **响应**: `200 OK`，纯文本 `"OK"`

---

## 2. 能力发现

### 2.1 技能列表

**GET** `/agent/skills`

```json
{
  "Skill_当事人提取": {
    "query": "请执行 Skill_当事人提取",
    "desc": "当事人信息提取",
    "alias": "s01"
  },
  "Skill_法律问答": {
    "query": "请执行 Skill_法律问答",
    "desc": "法律问答",
    "alias": "s10"
  }
}
```

### 2.2 函数列表

**GET** `/agent/functions`

```json
{
  "Func_法条检索": {
    "desc": "法条检索",
    "alias": "f02"
  }
}
```

### 2.3 任务列表

**GET** `/agent/tasks`

```json
{
  "Task_法条检索": {
    "desc": "法条检索任务",
    "alias": "t01"
  }
}
```

---

## 3. 直接执行

### 3.1 运行 Agent

**POST** `/agent/run`

通过 Analyser 分析用户意图后异步执行。

**请求体**
```json
{
  "caseId": "string (必填)",
  "query": "string (必填，用户指令)",
  "verbose": "boolean (可选)",
  "reuseSandbox": "boolean (可选，默认 false)",
  "sessionId": "string (可选，绑定 SSE 会话)",
  "sessionBase": "number (可选，会话起始时间戳)",
  "dataServerUrl": "string (可选，覆盖 Data Server 地址)"
}
```

**响应**: `202 Accepted`
```json
{
  "status": "started",
  "caseId": "string",
  "taskId": "task-1707400000000"
}
```

> 异步执行，立即返回。执行结果通过 SSE 事件推送（如果提供了 `sessionId`）。

---

### 3.2 清除 LLM 缓存

**POST** `/agent/clear-cache`

```json
{
  "status": "success",
  "message": "Cache cleared"
}
```

---

## 4. Session API（实时交互）

Session 模式通过 SSE（Server-Sent Events）实现实时事件推送，是 Client 与 Agent 交互的主要方式。

### 典型流程

```
1. POST /session              → 创建会话，获得 sessionId
2. GET  /session/:id/events   → 建立 SSE 连接，接收实时事件
3. POST /session/:id/task     → 提交任务（Analyser 路由）
   POST /agent/execute_command → 或：直接执行指定 Skill/Function/Task
4. POST /session/:id/reply    → 响应交互式提问（如有）
5. DELETE /session/:id         → 关闭会话
```

### 4.1 创建会话

**POST** `/session`

```json
// 请求
{
  "caseNumber": "string (必填)",
  "caseId": "string (必填)",
  "verbose": "boolean (可选)",
  "reuseSandbox": "boolean (可选)"
}
```

```json
// 响应 200
{
  "sessionId": "sess-1707400000000-abc123",
  "caseId": "string",
  "status": "ready"
}
```

### 4.2 SSE 事件流

**GET** `/session/:sessionId/events`

建立持久 SSE 连接，接收 Agent 执行过程中的所有事件。

**响应头**
```
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
```

**事件格式**
```
event: connected
data: {"sessionId":"sess-xxx"}

event: log
data: {"message":"正在分析..."}

event: ask
data: {"askId":"ask-123","prompt":"请确认是否继续？"}

event: complete
data: {"status":"success"}
```

**事件类型**

| 事件 | 说明 |
| :--- | :--- |
| `connected` | 连接建立 |
| `log` | 状态/日志消息 |
| `error` | 错误消息 |
| `ask` | 需要用户输入（配合 `/reply` 端点） |
| `progress` | 进度更新 |
| `action` | 客户端操作通知 |
| `complete` | 任务完成（`status: "success"` 或 `"failed"`） |

### 4.3 提交任务

**POST** `/session/:sessionId/task`

将用户指令提交给 Analyser 进行意图分析和执行。

```json
// 请求
{ "query": "分析案件当事人" }

// 响应 200
{ "taskId": "task-1707400000000", "status": "started" }
```

### 4.4 回复交互提问

**POST** `/session/:sessionId/reply`

当收到 `ask` 事件时，用此端点提交用户回答。

```json
// 请求
{
  "askId": "ask-123",
  "input": "是"
}

// 响应 200
{ "ok": true }
```

**错误**: `400` `{"error": "No pending ask or ID mismatch"}`

### 4.5 关闭会话

**DELETE** `/session/:sessionId`

关闭 SSE 连接，清理会话资源。

```json
{ "ok": true }
```

---

## 5. 直接命令执行（Slash Command）

**POST** `/agent/execute_command`

绕过 Analyser，直接执行指定的 Skill、Function 或 Task。由 Client 的 `/skill`、`/function`、`/task` 斜杠命令触发。

**请求体**
```json
{
  "sessionId": "string (必填，绑定事件推送)",
  "command": "skill|function|task (意图提示)",
  "targetId": "string (必填，ID/别名/名称)",
  "args": "string (可选，参数字符串)"
}
```

**响应**: `200`
```json
{
  "status": "started",
  "target": "Skill_法律问答",
  "inputs": { "question": "合同违约怎么办" }
}
```

### 目标解析规则

`targetId` 按以下顺序匹配：

1. Skill ID 精确匹配（如 `Skill_法律问答`）
2. Skill 别名（如 `s10`）
3. Skill 名称（如 `法律问答`）
4. Skill 路径包含（如 `s_法律问答`）
5. 以相同规则匹配 Function
6. 以相同规则匹配 Task

### 参数解析

`args` 字符串支持以下格式：

```
# 键值对
question="合同违约如何处理"

# 多参数
region='北京' damage_type='人身损害'

# 裸文本 → 映射到 primary input
合同违约如何处理
```

### 执行路由

解析完成后，根据目标类型调用对应方法：

| 类型 | 调用 |
| :--- | :--- |
| `skill` | `orchestrator.runSkill(targetId, inputs)` |
| `function` | `orchestrator.runFunction(targetId, inputs)` |
| `task` | `orchestrator.runTask(targetId, inputs)` |

---

## 错误响应

| 状态码 | 场景 |
| :--- | :--- |
| 400 | 缺少必填参数 / 命令解析失败 |
| 404 | Session 未找到 / 资源未找到 |
| 500 | 服务器内部错误 |

所有错误返回: `{"error": "描述信息"}`

---

## CORS

所有响应包含:
```
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET, POST, DELETE, OPTIONS
Access-Control-Allow-Headers: Content-Type
```
