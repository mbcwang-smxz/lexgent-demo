# LexGent Engine API Reference

LexGent Engine 是配置驱动的 AI Agent 执行引擎。支持 Session 模式（SSE 实时推送）和直接执行模式。

**默认端口**: `3001`（可通过配置修改）

---

## 1. 基础端点

### 1.1 健康检查

**GET** `/health`

- **响应**: `200 OK`，纯文本 `"OK"`

### 1.2 API 信息

**GET** `/info`

- **响应**: `200 OK`，返回 API 参考信息

---

## 2. 能力发现

以下端点用于查询指定 Agent 可用的技能、函数和任务。

### 2.1 技能列表

**GET** `/agent/:agentId/skills`

**查询参数**

| 参数 | 类型 | 必填 | 说明 |
| :--- | :--- | :--- | :--- |
| `yamlServerUrl` | string | 否 | YAML Server 地址，缺省使用环境变量/默认值 |

**响应**: `200`
```json
{
  "Skill_当事人提取": {
    "query": "请执行 Skill_当事人提取",
    "desc": "当事人信息提取",
    "alias": "s01",
    "params": {}
  }
}
```

> 当 Agent 配置加载出错时（manifest 不存在、Skill 校验失败等），响应中会包含 `_errors` 字段（`string[]`），列出所有加载错误。此时结果**不会被缓存**，修正配置后重新请求即可。

### 2.2 函数列表

**GET** `/agent/:agentId/functions`

**查询参数**

| 参数 | 类型 | 必填 | 说明 |
| :--- | :--- | :--- | :--- |
| `yamlServerUrl` | string | 否 | YAML Server 地址，缺省使用环境变量/默认值 |

**响应**: `200`
```json
{
  "Func_法条检索": {
    "desc": "法条检索",
    "alias": "f02",
    "params": {}
  }
}
```

> 当加载出错时，响应中会包含 `_errors` 字段（`string[]`）。详见 [技能列表](#21-技能列表) 说明。

### 2.3 任务列表

**GET** `/agent/:agentId/tasks`

**查询参数**

| 参数 | 类型 | 必填 | 说明 |
| :--- | :--- | :--- | :--- |
| `yamlServerUrl` | string | 否 | YAML Server 地址，缺省使用环境变量/默认值 |

**响应**: `200`
```json
{
  "Task_法条检索": {
    "desc": "法条检索任务",
    "alias": "t01",
    "params": {}
  }
}
```

> 当加载出错时，响应中会包含 `_errors` 字段（`string[]`）。详见 [技能列表](#21-技能列表) 说明。

---

## 3. 直接执行

### 3.1 运行 Agent

**POST** `/agent/:agentId/run`

通过 Analyser 分析用户意图后异步执行（非 Session 模式）。

**请求体**

| 字段 | 类型 | 必填 | 说明 |
| :--- | :--- | :--- | :--- |
| `caseId` | string | 是 | 案件 ID |
| `query` | string | 是 | 用户指令 |
| `verbose` | boolean | 否 | 是否输出详细日志 |
| `reuseSandbox` | boolean | 否 | 是否复用沙箱 |
| `sessionBase` | number | 否 | 会话起始时间戳，用于过滤聊天历史 |
| `sessionId` | string | 否 | 绑定 SSE 会话，用于接收事件推送 |

**响应**: `202 Accepted`
```json
{
  "status": "started",
  "caseId": "string",
  "taskId": "task-1707400000000"
}
```

> 异步执行，立即返回。执行结果通过 SSE 事件推送（如果提供了 `sessionId`）。

### 3.2 清除 LLM 缓存

**POST** `/agent/:agentId/clear-cache`

**响应**: `200`
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
1. POST /session                          → 创建会话，获得 sessionId
2. GET  /session/:sessionId/events        → 建立 SSE 连接，接收实时事件
3. POST /session/:sessionId/task          → 提交任务（Analyser 路由）
   POST /agent/:agentId/execute_command   → 或：直接执行指定 Skill/Function/Task
4. POST /session/:sessionId/reply         → 响应交互式提问（如有）
5. DELETE /session/:sessionId             → 关闭会话
```

### 4.1 创建会话

**POST** `/session`

**请求体**

| 字段 | 类型 | 必填 | 说明 |
| :--- | :--- | :--- | :--- |
| `caseNumber` | string | 是 | 案件编号 |
| `caseId` | string | 是 | 案件 ID |
| `agentId` | string | 否 | Agent ID，缺省使用默认 Agent |
| `configId` | string | 否 | 运行时配置 ID（来自 Agent configs） |
| `yamlServerUrl` | string | 否 | YAML Server 地址，缺省使用环境变量/默认值 |
| `dataServerUrl` | string | 否 | Data Server 地址，缺省使用 Agent 配置/环境变量/默认值 |
| `verbose` | boolean | 否 | 是否输出详细日志 |
| `reuseSandbox` | boolean | 否 | 是否复用沙箱 |

**响应**: `200`
```json
{
  "sessionId": "sess-1707400000000-abc123",
  "caseId": "string",
  "agentId": "string",
  "status": "ready"
}
```

> 当 Agent 运行时配置加载失败但有 `DATA_SERVER_URL` 兜底时，响应中会包含 `_warnings` 字段（`string[]`），说明回退原因。

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
| `log` | 状态/日志消息 |
| `error` | 错误消息 |
| `ask` | 需要用户输入（配合 `/reply` 端点） |
| `progress` | 进度更新 |
| `complete` | 任务完成（`status: "success"` 或 `"failed"`） |
| `action` | 客户端操作通知 |

### 4.3 提交任务

**POST** `/session/:sessionId/task`

将用户指令提交给 Analyser 进行意图分析和执行。

**请求体**

| 字段 | 类型 | 必填 | 说明 |
| :--- | :--- | :--- | :--- |
| `query` | string | 是 | 用户指令 |

**响应**: `200`
```json
{
  "taskId": "task-1707400000000",
  "status": "started"
}
```

### 4.4 回复交互提问

**POST** `/session/:sessionId/reply`

当收到 `ask` 事件时，用此端点提交用户回答。

**请求体**

| 字段 | 类型 | 必填 | 说明 |
| :--- | :--- | :--- | :--- |
| `askId` | string | 是 | 对应 ask 事件中的 ID |
| `input` | string | 是 | 用户回答内容 |

**响应**: `200`
```json
{ "ok": true }
```

**错误**: `400` `{"error": "No pending ask or ID mismatch"}`

### 4.5 关闭会话

**DELETE** `/session/:sessionId`

关闭 SSE 连接，清理会话资源。

**响应**: `200`
```json
{ "ok": true }
```

---

## 5. 直接命令执行

**POST** `/agent/:agentId/execute_command`

绕过 Analyser，直接执行指定的 Skill、Function 或 Task。由 Client 的 `/skill`、`/function`、`/task` 斜杠命令触发。

**请求体**

| 字段 | 类型 | 必填 | 说明 |
| :--- | :--- | :--- | :--- |
| `sessionId` | string | 是 | 绑定 SSE 会话，用于事件推送 |
| `command` | string | 否 | 意图提示：`"skill"` \| `"function"` |
| `targetId` | string | 是 | 目标 ID / 别名 / 名称 |
| `args` | string | 否 | 参数字符串 |

**响应**: `200`
```json
{
  "status": "started",
  "taskId": "task-1707400000000"
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
