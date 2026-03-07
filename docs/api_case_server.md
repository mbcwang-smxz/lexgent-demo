# Data Server (Case Server) API Reference

Data Server 是整个系统的**数据持久层**，负责案件工作空间的文件存储、元数据注册表管理、事件/回复的持久化，以及内置工具 API。

**核心职责**：所有案件数据（原始证据、AI 生成文件、执行日志）都通过 Data Server 统一管理。Agent Framework 通过 `ICaseStore` 接口与之交互，不直接操作文件系统。

**默认端口**: `3000`（可通过 `DATA_SERVER_PORT` 环境变量配置）

---

## 1. 健康检查

**GET** `/health`

- **响应**: `200 OK`，纯文本 `"OK"`

---

## 2. 案件管理

### 2.1 初始化案件

**POST** `/cases/init`

**功能**：创建或恢复案件工作空间。这是所有案件操作的起点——Client 在建立 Session 时首先调用此 API，确保案件目录、初始文件和 `metadata.json` 注册表就绪。

**重要性**：没有初始化的案件目录，后续所有文件操作、Context 查询都会返回空结果。初始化还负责从模板目录（`data/case-data/{caseId}/`）复制原始证据文件，为 Agent 分析提供输入材料。

```json
// 请求
{
  "caseNumber": "string (可选，用于生成 caseId)",
  "reset": "boolean (可选，强制创建新案件)"
}

// 响应 200
{
  "status": "initialized",
  "caseId": "string",
  "dataRoot": "string (绝对路径)"
}
```

**逻辑**:
- 提供 `caseNumber`: 以此生成 caseId（特殊字符替换为 `_`）
- `reset=true`: 删除已有目录，从模板重新复制（保留 LLM 缓存）
- 均未提供: 恢复最近的案件（按修改时间排序）或默认 `case-101`
- 模板目录不存在时创建空案件（空 `metadata.json`）

### 2.2 获取案件上下文

**GET** `/cases/:caseId/context`

**功能**：返回案件的**完整文件注册表**——包括每个文件的 ID、类型、文件名、路径和修改时间。调用时自动执行物理文件与注册表的**双向同步**。

**重要性**：这是整个框架中**最关键的 API**，贯穿 Agent 执行的每个环节：

| 使用场景 | 调用方 | 作用 |
| :--- | :--- | :--- |
| **Analyser 规划** | `BaseOrchestrator.run()` | 将文件列表生成 `contextSummary`，供 LLM 理解案件现状并规划执行步骤 |
| **输入解析** | `resolveTaskInputs()` | 将 Analyser 返回的文件 ID（如 `R01`）解析为实际的 `FileRegistryItem` |
| **跳过判断** | `preCheckPlan()` | 检查输出文件是否已存在（如 `D01`），决定是否跳过已完成的步骤 |
| **系统元数据** | `inject_system_metadata()` | 生成 `file_list` 供 LLM 了解所有可用文件 |
| **按类型查询** | `CaseStore.getDocumentsByType()` | 获取指定类型的文件列表（如所有「民事起诉状」） |
| **按 ID 查询** | `CaseStore.getDocumentById()` | 根据文件 ID 查找文件元数据 |

**自动同步逻辑**（每次调用时执行）：
1. **清理已删除文件**：注册表中的文件如果物理上不存在，自动移除条目
2. **清理过期文件**：`expiresAt` 已过期的临时文件，同时删除物理文件和注册表条目
3. **发现新文件**：物理目录中存在但注册表中没有的文件，自动注册并分配 ID
   - `D` 开头的文件：从文件名提取 ID（如 `D01_xxx.json` → ID `D01`）
   - 其他文件：自动分配 `R##` ID（递增编号），类型标记为 `未分类文档`

```json
// 响应 200
{
  "caseId": "string",
  "files": [
    {
      "id": "R01",
      "type": "民事起诉状",
      "filename": "complaint.txt",
      "path": "/absolute/path/complaint.txt",
      "lastModified": "2026-02-09T10:00:00.000Z",
      "expiresAt": null
    },
    {
      "id": "D01",
      "type": "当事人信息",
      "filename": "D01_当事人信息.json",
      "path": "/absolute/path/D01_当事人信息.json",
      "lastModified": "2026-02-09T10:05:00.000Z"
    }
  ],
  "metadata": {}
}
```

> 注意：`metadata` 字段存储案件级别的元信息（如 `caseNumber`、`created` 时间），不同于文件级别的元数据。

---

## 3. 文件操作

文件操作是 Skill 执行的 I/O 基础。Skill 执行前通过 `readFile` 读取输入文件内容注入 Prompt，执行后通过 `writeFile` + `updateFileMetadata` 持久化结果。

### 3.1 读取文件

**GET** `/cases/:caseId/files/:filename`

**功能**：读取案件目录中指定文件的原始内容，以纯文本返回。

**重要性**：框架的 `SkillExecutor` 在执行 Skill 前，通过此 API 加载所有输入文件的内容，将其注入 Handlebars 模板的 `{{inputs.source_docs}}` 等变量中。没有此 API，LLM 就无法"看到"案件文件。

- **响应**: `200 OK` 文件内容（纯文本），或 `404` `{"error": "File not found"}`

### 3.2 写入文件

**POST** `/cases/:caseId/files/:filename`

**功能**：将内容写入案件目录中的指定文件。如果文件已存在则覆盖。

**重要性**：每个 Skill 的输出最终都通过此 API 持久化。`on_result: save_file` 的执行路径：LLM 输出 → `OnResultExecutor` → `CaseStore.saveDerived()` → 调用此 API 写入文件内容。系统元数据（`skill_list`、`file_list`）也通过此 API 写入临时文件供 LLM 读取。

```json
// 请求
{ "content": "string" }

// 响应 200
{ "status": "ok" }
```

### 3.3 更新文件元数据

**PATCH** `/cases/:caseId/files/:filename/metadata`

**功能**：更新 `metadata.json` 注册表中指定文件的元数据。采用 **Upsert 模式**——文件条目不存在时自动创建。

**重要性**：写入文件（3.2）只是物理存储，不会自动出现在注册表中。此 API 将文件**注册**到 Context 中——赋予它 ID（如 `D01`）、类型（如 `当事人信息`）等属性，使其可被后续 Skill 通过 ID 引用。`CaseStore.saveDerived()` 会在 `writeFile` 之后立即调用此 API。

```json
// 请求（部分字段即可）
{
  "id": "D01",
  "type": "当事人信息",
  "path": "/remote/case-101/D01_当事人信息.json",
  "lastModified": "2026-02-09T10:05:00.000Z"
}

// 响应 200
{ "status": "ok" }
```

### 3.4 删除文件

**DELETE** `/cases/:caseId/files?pattern={pattern}`

**功能**：按模式匹配删除案件目录中的文件，同时更新注册表（通过内部调用 `getCaseContext` 同步）。

**重要性**：用于 `on_result: deletion` 场景——在重新执行 Skill 前清理旧的衍生文件，避免过期数据干扰。例如重新执行「当事人提取」时，先 `deleteFiles("D01*")` 清理旧结果。

**查询参数**
- `pattern`: 匹配模式
  - `*` 或 `all` — 删除所有可删文件
  - `prefix*` — 前缀匹配（如 `D*` 删除所有衍生文件）
  - `*suffix` — 后缀匹配
  - `exact_name` — 精确文件名

**安全规则**：以下文件永远不会被删除（即使 pattern 匹配）：
- `metadata.json`、`llm_cache.json`、`events.jsonl`、`replies.jsonl` — 系统文件
- 以 `R` 开头的文件 — 原始证据不可删除，保证案件数据完整性

```json
// 响应 200
{ "deleted": ["D01_当事人信息.json", "D02_诉辩主张.json"] }
```

---

## 4. 文档分类（批量类型更新）

**POST** `/cases/:caseId/classification`

**功能**：批量更新案件文件的文档类型（`type` 字段）。根据传入的分类结果，逐一匹配注册表中的文件并更新类型。

**重要性**：案件初始化时，文件的类型默认为 `未分类文档`。`Skill_案件初始化` 使用 LLM 分析所有原始文件并识别其类型（如「民事起诉状」「证据清单」），然后通过 `on_result: api_call` 调用此 API 批量设置类型。文件类型正确后，后续 Skill 才能通过 `getDocumentsByType("民事起诉状")` 精准获取所需输入。

```json
// 请求
{
  "result": {
    "classifications": [
      { "filename": "file1.txt", "type": "民事起诉状" },
      { "filename": "file2.txt", "type": "民事答辩状" }
    ]
  }
}

// 响应 200
{ "status": "ok", "updated": 2 }
```

> `result` 包装层是因为 `on_result: api_call` 会将 Skill 的 LLM 输出作为 `result` 字段传递。

---

## 5. 事件与交互

事件系统是 Agent 执行过程中的**通信通道**。Agent Server 将执行日志、错误、交互请求写入 Data Server，Client 通过 SSE（或轮询）获取事件，实现实时展示和交互。

### 5.1 发送事件

**POST** `/cases/:caseId/events`

**功能**：记录一条事件到 `events.jsonl`（追加写入）。服务器自动添加 `timestamp`。

**重要性**：Agent 执行中的每一步日志、错误报告、需要用户确认的交互请求都通过此 API 持久化。这些事件也构成了 `buildChatHistory()` 的数据源——Analyser 需要通过历史事件理解对话上下文。

```json
// 请求
{
  "id": "string",
  "type": "LOG | CONFIRM_REQ | TASK_COMPLETE | ERROR",
  "payload": {}
}

// 响应 200（自动添加 timestamp）
{
  "id": "string",
  "type": "LOG",
  "timestamp": 1707400000000,
  "payload": {}
}
```

**事件类型**：
- `LOG`：普通日志（执行进度、LLM 输出等）
- `CONFIRM_REQ`：需要用户确认（如「输出文件已存在，是否重新生成？」）
- `TASK_COMPLETE`：任务执行完成
- `ERROR`：执行错误

### 5.2 获取事件

**GET** `/cases/:caseId/events?after={timestamp}`

**功能**：获取指定时间戳之后的所有事件。`after` 默认为 0（返回全部）。

**重要性**：Client 和 Agent Server 的 Session SSE 桥接器使用此 API 轮询新事件并推送给前端。`buildChatHistory()` 也通过此 API 获取历史对话记录。

### 5.3 发送回复

**POST** `/cases/:caseId/reply`

**功能**：存储用户的回复到 `replies.jsonl`。服务器自动生成 `id` 和 `timestamp`。

**重要性**：当 Agent 发出 `CONFIRM_REQ` 事件等待用户确认时，用户的回答通过此 API 持久化。Agent 通过轮询 `getReplies` 获取用户的最新回复以继续执行。

```json
// 请求
{ "payload": { "confirmed": true } }

// 响应 200
{
  "id": "reply-1707400000000",
  "timestamp": 1707400000000,
  "payload": { "confirmed": true }
}
```

### 5.4 获取回复

**GET** `/cases/:caseId/reply?after={timestamp}`

**功能**：获取指定时间戳之后的所有用户回复。Agent 轮询此 API 以获取用户交互输入。

---

## 6. 内置工具 API

内置工具 API 为 LLM Function Calling 提供后端实现。当 LLM 在 agentic 循环中选择调用工具时，框架将请求转发到这些 API。

### 6.1 法条检索

**POST** `/api/tools/law_lookup`

**功能**：根据法律名称、条文号或关键词检索法律条文。支持精确匹配和全文搜索。

**重要性**：这是 `Func_法条检索` 的后端实现。在 Skill 配置中声明 `tools: [Func_法条检索]` 后，LLM 可以在 agentic 循环中自主调用此工具获取相关法条，增强法律分析的准确性。

```json
// 请求
{
  "law_name": "中华人民共和国民法典 (可选)",
  "article_number": "第一百八十八条 (可选)",
  "keywords": "诉讼时效 (可选)"
}

// 响应 200
{
  "query": { "law_name": "...", "article_number": "...", "keywords": "..." },
  "count": 1,
  "results": [
    {
      "law_name": "中华人民共和国民法典",
      "article": "第一百八十八条",
      "chapter": "第九章 诉讼时效",
      "content": "向人民法院请求保护民事权利的诉讼时效期间为三年..."
    }
  ]
}
```

**检索逻辑**（按参数组合选择策略）:
1. `law_name` + `article_number`: 精确条文匹配
2. `law_name` + `keywords`: 指定法律内关键词搜索
3. 仅 `law_name`: 返回该法律所有条文
4. 仅 `keywords`: 跨法律全文搜索

---

## 文件存储结构

```
.runs/{caseId}/
├── metadata.json        # 文件注册表（受保护，核心数据）
├── llm_cache.json       # LLM 响应缓存（受保护，跨重置保留）
├── events.jsonl         # 事件日志（追加写入，受保护）
├── replies.jsonl        # 用户回复（追加写入，受保护）
├── R01_起诉状.txt        # 原始文件（R 前缀，受删除保护）
├── D01_当事人信息.json   # 衍生文件（D 前缀，可删除可重建）
└── tmp_response.md      # 临时文件（tmp_ 前缀，有过期时间）
```

**文件 ID 规则**:
- `R##` — 原始证据文件（自动分配递增编号，受删除保护）
- `D##` — AI 生成的衍生文件（由 `on_result: save_file` 的 `id` 字段指定）
- `tmp_` 前缀 — 临时文件（有 `expiresAt`，Context 同步时自动清理）

**受保护文件**（不可通过 DELETE API 删除）:
- `metadata.json` — 文件注册表，所有 Context 查询的数据源
- `llm_cache.json` — LLM 响应缓存，避免重复调用
- `events.jsonl` / `replies.jsonl` — 持久化的事件和回复日志
- `R##` 开头的原始证据 — 保证案件原始数据不被误删

---

## CaseStore 客户端映射

`CaseStore` TypeScript 类（`shared/utils/case_store.ts`）封装了以上 HTTP API，实现 `ICaseStore` 接口。所有框架组件通过构造函数注入 `ICaseStore`，不直接调用 HTTP。

| CaseStore 方法 | HTTP 请求 | 说明 |
| :--- | :--- | :--- |
| `readFile(filename)` | `GET /cases/:caseId/files/:filename` | 读取文件内容 |
| `writeFile(filename, content)` | `POST /cases/:caseId/files/:filename` | 写入文件内容 |
| `updateFileMetadata(filename, meta)` | `PATCH /cases/:caseId/files/:filename/metadata` | 更新注册表元数据 |
| `deleteFiles(pattern)` | `DELETE /cases/:caseId/files?pattern=...` | 按模式删除文件 |
| `getCaseContext()` | `GET /cases/:caseId/context` | 获取完整文件注册表 |
| `postEvent(event)` | `POST /cases/:caseId/events` | 记录事件 |
| `getEvents(after)` | `GET /cases/:caseId/events?after=...` | 获取事件列表 |
| `postReply(payload)` | `POST /cases/:caseId/reply` | 存储用户回复 |
| `getReplies(after)` | `GET /cases/:caseId/reply?after=...` | 获取回复列表 |
| `saveDerived(doc)` | `writeFile` + `updateFileMetadata` | 组合操作：写入文件 + 注册元数据 |
| `getDocumentsByType(type)` | `getCaseContext` + 按 type 过滤 | 客户端过滤，非独立 API |
| `getDocumentById(id)` | `getCaseContext` + 按 id 查找 | 客户端过滤，非独立 API |

---

## 错误响应

| 状态码 | 场景 |
| :--- | :--- |
| 400 | 缺少必填参数（如 DELETE 缺少 pattern） |
| 404 | 文件未找到 |
| 500 | 服务器内部错误 |

所有错误返回: `{"error": "描述信息"}`

---

## CORS

所有响应包含:
```
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET, POST, PATCH, OPTIONS
Access-Control-Allow-Headers: Content-Type, X-Data-Root
```
