# Data Server API Reference

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

**初始化时会立即扫描物理文件并注册到 metadata.json**：
- PDF/Office 文件 → `P##`（待转换文档）
- 其他文本文件 → `U##`（未分类文档）
- `D` 开头的文件 → 从文件名提取类型（如 `D01_当事人信息.json` → type=`当事人信息`）

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
- **创建完成后立即调用 `getCaseContext()` 扫描文件并生成 metadata.json**

### 2.2 获取案件上下文

**GET** `/cases/:caseId/context`

**功能**：返回案件的**完整文件注册表**——包括每个文件的 ID、类型、文件名、路径和修改时间。调用时自动执行物理文件与注册表的**双向同步**。

**重要性**：这是整个框架中**最关键的 API**，贯穿 Agent 执行的每个环节：

| 使用场景 | 调用方 | 作用 |
| :--- | :--- | :--- |
| **Analyser 规划** | `BaseOrchestrator.run()` | 将文件列表生成 `contextSummary`，供 LLM 理解案件现状并规划执行步骤 |
| **输入解析** | `resolveTaskInputs()` | 将 Analyser 返回的文件 ID（如 `R01`）解析为实际的 `FileRegistryItem` |
| **跳过判断** | `preCheckPlan()` | 检查输出文件是否已存在（如 `D01`），决定是否跳过已完成的步骤 |
| **系统元数据** | `inject_system_metadata()` | 生成 `file_list` / `files_by_type` 供 LLM 了解可用文件 |

**自动同步逻辑**（每次调用时执行）：
1. **清理已删除文件**：注册表中的文件如果物理上不存在，自动移除条目
2. **清理过期文件**：`expiresAt` 已过期的临时文件，同时删除物理文件和注册表条目
3. **发现新文件**：物理目录中存在但注册表中没有的文件，自动注册并分配 ID
   - PDF/Office 文件（`.pdf`、`.doc`、`.docx`）→ 分配 `P##` ID，类型 `待转换文档`
   - `D` 开头的文件 → 从文件名提取 ID 和类型（如 `D01_当事人信息.json` → ID `D01`，类型 `当事人信息`）
   - 其他文件 → 分配 `U##` ID，类型 `未分类文档`
4. **排除系统文件**：`metadata.json`、`llm_cache.json`、`*.jsonl`、`sys_*.txt` 不会被注册

```json
// 响应 200
{
  "caseId": "case-104-pdf",
  "files": [
    {
      "id": "P01",
      "type": "待转换文档",
      "filename": "1.pdf",
      "path": "case-104-pdf/1.pdf",
      "lastModified": "2026-03-11T10:00:00.000Z"
    },
    {
      "id": "R01",
      "type": "民事起诉状",
      "filename": "1.md",
      "path": "case-104-pdf/1.md",
      "lastModified": "2026-03-11T10:05:00.000Z"
    },
    {
      "id": "D01",
      "type": "当事人信息",
      "filename": "D01_当事人信息.json",
      "path": "case-104-pdf/D01_当事人信息.json",
      "lastModified": "2026-03-11T10:10:00.000Z"
    }
  ],
  "metadata": { "caseNumber": "case-104-pdf" }
}
```

> **注意**：`path` 为相对路径（`caseId/filename`），不包含文件系统绝对路径。`metadata` 字段存储案件级别的元信息，不同于文件级别的元数据。

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

**功能**：将内容写入案件目录中的指定文件。如果文件已存在则覆盖。可选传入 `id` 和 `type_ref` 来同时注册/更新 metadata.json 中的文件元数据。

**重要性**：每个 Skill 的输出最终都通过此 API 持久化。在 tasks 管道模式中，LLM 步骤完成后由显式的 `api_request` 步骤调用此 API，同时传入 `content`、`id`、`type_ref` 完成写入+注册的原子操作。系统元数据（`skill_list`、`file_list`、`files_by_type`）也通过此 API 写入临时文件供 LLM 读取。

```json
// 请求
{
  "content": "string | object",
  "id": "D01 (可选，传入时 upsert metadata)",
  "type_ref": "当事人信息 (可选，传入时 upsert metadata)"
}

// 响应 200
{ "status": "ok" }
```

**行为说明**：
- `content` 为对象时自动序列化为 JSON 字符串（`JSON.stringify(content, null, 2)`）
- 仅传 `{ content }` 时行为与旧版完全一致（向后兼容）
- 传入 `id` 或 `type_ref` 时，自动在 metadata.json 中 upsert 一条文件记录（id、type、filename、path、lastModified），无需再单独调用 PATCH metadata API

### 3.3 更新文件元数据

**PATCH** `/cases/:caseId/files/:filename/metadata`

**功能**：更新 `metadata.json` 注册表中指定文件的元数据。采用 **Upsert 模式**——文件条目不存在时自动创建。

**重要性**：写入文件（3.2）只是物理存储，不会自动出现在注册表中。此 API 将文件**注册**到 Context 中——赋予它 ID（如 `D01`）、类型（如 `当事人信息`）等属性，使其可被后续 Skill 通过 ID 引用。`CaseStore.saveDerived()` 会在 `writeFile` 之后立即调用此 API。

```json
// 请求（部分字段即可）
{
  "id": "D01",
  "type": "当事人信息",
  "path": "case-104-pdf/D01_当事人信息.json",
  "lastModified": "2026-03-11T10:10:00.000Z"
}

// 响应 200
{ "status": "ok" }
```

> **注意**：`path` 使用相对路径格式（`caseId/filename`）。

### 3.4 文件操作（统一端点）

**POST** `/cases/:caseId/files/ops`

**功能**：统一文件操作端点，接受 LLM 输出的结构化 JSON，支持创建、复制、删除、修改四种操作。由 `Skill_文件操作` 的 tasks 管道中的 `api_request` 步骤调用。

```json
// 请求
{
  "action": "create | copy | remove | modify",
  "filename": "目标文件名",
  "source": "源文件名（copy 时必需）",
  "content": "文件内容（create/modify 时必需，copy 时可选）"
}
```

**各 action 处理逻辑**：

| action | 必填字段 | 逻辑 | 返回 |
| :--- | :--- | :--- | :--- |
| `create` | filename, content | 写入新文件 | `{ status: "ok", action: "create", filename }` |
| `copy` | filename, source | 读取源文件内容，写入目标文件。如提供 content 则使用 content（支持格式转换） | `{ status: "ok", action: "copy", filename }` |
| `remove` | filename | 复用 `deleteFiles` 安全逻辑删除文件 | `{ status: "ok", action: "remove", deleted: [...] }` |
| `modify` | filename, content | 以完整新内容覆盖文件 | `{ status: "ok", action: "modify", filename }` |

**安全规则**：
- `remove` 操作复用 `deleteFiles` 的保护逻辑——不删除 `metadata.json`、`llm_cache.json`、`events.jsonl`、`replies.jsonl`、以 `R` 开头的原始证据文件
- `create`/`copy`/`modify` 禁止写入 `metadata.json` 和 `llm_cache.json`
- `content` 为对象时自动序列化为 JSON 字符串

**错误响应**：
- `400`：缺少必填参数或 action 无效
- `404`：copy 操作的源文件不存在

### 3.5 删除文件（按模式）

**DELETE** `/cases/:caseId/files?pattern={pattern}`

**功能**：按单个模式匹配删除案件目录中的文件，同时更新注册表（通过内部调用 `getCaseContext` 同步）。

**查询参数**
- `pattern`: 匹配模式
  - `*` 或 `all` — 删除所有可删文件
  - `prefix*` — 前缀匹配（如 `D*` 删除所有衍生文件）
  - `*suffix` — 后缀匹配
  - `exact_name` — 精确文件名

**安全规则**：以下文件永远不会被删除（即使 pattern 匹配）：
- `metadata.json`、`llm_cache.json`、`events.jsonl`、`replies.jsonl` — 系统文件
- 以 `R` 开头的文件 — 已分类原始文书不可删除，保证案件数据完整性

```json
// 响应 200
{ "deleted": ["D01_当事人信息.json", "D02_诉辩主张.json"] }
```

### 3.6 批量删除文件

**POST** `/cases/:caseId/files/batch-delete`

**功能**：按多个模式批量删除文件。由 Skill 的 tasks 管道中的 `api_request` 步骤调用，替代原有的 `on_result: deletion` 隐式处理。

**重要性**：`Skill_文件维护` 的 LLM 返回 `{ action: "delete", patterns: ["D*", "..."] }`，tasks 管道中的 `api_request` 步骤将 `patterns` 数组直接 POST 到此端点。当 LLM 返回 `action: "no_action"` 时，`patterns` 为 undefined → 请求体为 `{}`，此 API 返回 `{ deleted: [] }`（no-op），无需额外判断。

**安全规则**：与 DELETE API 相同——保护系统文件和 `R` 开头的原始文书。

```json
// 请求
{ "patterns": ["D*", "sys_*.txt"] }

// 响应 200
{ "deleted": ["D01_当事人信息.json", "D02_诉辩主张.json", "sys_file_list.txt"] }

// 空/缺失 patterns → no-op
// 请求: {} 或 { "patterns": [] }
// 响应 200
{ "deleted": [] }
```

---

## 4. 文档分类与转换注册

**POST** `/cases/:caseId/classification`

**功能**：统一的元数据更新入口，支持两种操作：
- **分类**（`classifications`）：批量更新文件类型，自动重命名 ID（U##→R##/X##）
- **转换注册**（`conversions`）：注册文件转换结果，标记原件为无关（P##→X##），注册新文件为未分类（U##）

**重要性**：metadata.json 是文件元数据的**单一数据源**。文档分类通过此 API 确保 metadata 状态与实际文件一致。

> **注意**：`Skill_文件转换` 已不再通过 `on_result: api_call` 调用此端点——转换后的元数据注册由 `ContextInitializer` 自动完成。此端点目前仅供 `Skill_文档分类` 使用。

### 请求格式

```json
{
  "result": {
    "conversions": [
      { "sourceFilename": "1.pdf", "targetFilename": "1.md" }
    ],
    "classifications": [
      { "filename": "1.md", "type": "民事起诉状" }
    ]
  }
}
```

> `result` 包装层是因为 `on_result: api_call` 将 Skill 的 LLM 输出作为 `result` 字段传递。`conversions` 和 `classifications` 可单独或同时出现。

### 处理逻辑

**1. conversions 处理（先执行）**：
- 查找 `sourceFilename` 对应的文件记录（通常为 P##）
- 将其 ID 改为 `X##`，type 改为 `无关文档`
- 检查 `targetFilename` 是否已在注册表中（可能被 `getCaseContext` 自动扫描注册）
  - 已存在：更新 type 为 `未分类文档`
  - 不存在：创建新记录，分配 `U##` ID，type 为 `未分类文档`

**2. classifications 处理（后执行）**：
- 按 `filename` 查找文件记录
- 更新 `type` 为指定类型
- 自动重命名 ID：
  - `U##` + type=`无关文档` → 改为 `X##`
  - `U##` + type=其他有意义类型 → 升级为 `R##`
  - `U##` + type=`未分类文档` → 保持 `U##` 不变

### 响应

```json
// 响应 200
{ "status": "ok", "conversions": 5, "classified": 5 }
```

### ID 变化示例

```
初始: P01(待转换) P02(待转换) ...
  ↓ conversions
X01(无关/1.pdf) X02(无关/2.pdf) U01(未分类/1.md) U02(未分类/2.md) ...
  ↓ classifications
X01(无关/1.pdf) X02(无关/2.pdf) R01(民事起诉状/1.md) R02(民事答辩状/2.md) ...
```

---

## 5. 文件格式转换

**POST** `/cases/:caseId/file2md`

**功能**：将 PDF 或 Word 文件转换为 Markdown 格式。`targetFilename` 由服务器自动推导（源文件名扩展名替换为 `.md`）。

**重要性**：此 API **仅负责文件转换**，不更新 metadata.json。转换结果的元数据注册由 `ContextInitializer` 在下次 `getCaseContext()` 调用时自动完成（物理文件同步逻辑）。

```json
// 请求
{ "sourceFilename": "1.pdf" }

// 响应 200
{
  "status": "ok",
  "sourceFilename": "1.pdf",
  "targetFilename": "1.md",
  "size": 12345,
  "message": "成功将 1.pdf 转换为 1.md"
}
```

> 当前为 Mock 实现：从 `data/case-data/case-102/{baseName}.txt` 读取预置内容作为转换结果。

---

## 6. 事件与交互

事件系统是 Agent 执行过程中的**通信通道**。Agent Server 将执行日志、错误、交互请求写入 Data Server，Client 通过 SSE（或轮询）获取事件，实现实时展示和交互。

### 6.1 发送事件

**POST** `/cases/:caseId/events`

**功能**：记录一条事件到 `events.jsonl`（追加写入）。服务器自动添加 `timestamp`。

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

### 6.2 获取事件

**GET** `/cases/:caseId/events?after={timestamp}`

**功能**：获取指定时间戳之后的所有事件。`after` 默认为 0（返回全部）。

### 6.3 发送回复

**POST** `/cases/:caseId/reply`

**功能**：存储用户的回复到 `replies.jsonl`。服务器自动生成 `id` 和 `timestamp`。

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

### 6.4 获取回复

**GET** `/cases/:caseId/reply?after={timestamp}`

**功能**：获取指定时间戳之后的所有用户回复。Agent 轮询此 API 以获取用户交互输入。

---

## 7. 内置工具 API

内置工具 API 为 LLM Function Calling 提供后端实现。当 LLM 在 agentic 循环中选择调用工具时，框架将请求转发到这些 API。

### 7.1 法条检索

**POST** `/api/tools/law_lookup`

**功能**：根据法律名称、条文号或关键词检索法律条文。支持精确匹配和全文搜索。

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
├── metadata.json          # 文件注册表（核心，单一数据源）
├── llm_cache.json         # LLM 响应缓存（受保护，跨重置保留）
├── events.jsonl           # 事件日志（追加写入，受保护）
├── replies.jsonl          # 用户回复（追加写入，受保护）
├── 1.pdf                  # X01 — 原始 PDF（转换后标记为无关）
├── 1.md                   # R01 — 转换后已分类的文书
├── D01_当事人信息.json     # D01 — AI 生成的衍生文件
├── sys_pending_files.txt  # 系统临时文件（files_by_type 注入，不注册）
└── sys_unclassified_files.txt
```

**文件 ID 前缀规则**：

| 前缀 | 类型 | 说明 | 可删除 |
| :--- | :--- | :--- | :--- |
| `P##` | 待转换文档 | PDF/Office 原始文件，需先转换 | 否 |
| `U##` | 未分类文档 | 转换后或新上传的文件，待分类 | 否 |
| `R##` | 已分类原始文书 | 经分类确认的有意义文书（民事起诉状等） | 否 |
| `X##` | 无关文档 | 转换后的原件或分类确认无关 | 否 |
| `D##` | AI 衍生文件 | 由技能生成的结构化结果 | 是 |
| `tmp_` | 临时文件 | 有 `expiresAt`，Context 同步时自动清理 | 是 |

**系统文件**（不注册到 metadata，不可删除）：
- `metadata.json` — 文件注册表
- `llm_cache.json` — LLM 响应缓存
- `events.jsonl` / `replies.jsonl` — 持久化的事件和回复日志
- `sys_*.txt` — 框架注入的系统临时文件

---

## CaseStore 客户端映射

`CaseStore` TypeScript 类（`shared/utils/case_store.ts`）封装了以上 HTTP API，实现 `ICaseStore` 接口。所有框架组件通过构造函数注入 `ICaseStore`，不直接调用 HTTP。

| CaseStore 方法 | HTTP 请求 | 说明 |
| :--- | :--- | :--- |
| `readFile(filename)` | `GET /cases/:caseId/files/:filename` | 读取文件内容 |
| `writeFile(filename, content)` | `POST /cases/:caseId/files/:filename` | 写入文件内容（可选 id/type_ref 同时注册元数据） |
| `updateFileMetadata(filename, meta)` | `PATCH /cases/:caseId/files/:filename/metadata` | 更新注册表元数据 |
| `deleteFiles(pattern)` | `DELETE /cases/:caseId/files?pattern=...` | 按单模式删除文件 |
| *(tasks 管道直接调用)* | `POST /cases/:caseId/files/batch-delete` | 按多模式批量删除文件 |
| `getCaseContext()` | `GET /cases/:caseId/context` | 获取完整文件注册表 |
| `postEvent(event)` | `POST /cases/:caseId/events` | 记录事件 |
| `getEvents(after)` | `GET /cases/:caseId/events?after=...` | 获取事件列表 |
| `postReply(payload)` | `POST /cases/:caseId/reply` | 存储用户回复 |
| `getReplies(after)` | `GET /cases/:caseId/reply?after=...` | 获取回复列表 |
| `saveDerived(doc)` | `writeFile` + `updateFileMetadata` | 组合操作：写入文件 + 注册元数据（旧模式，tasks 管道中由 api_request 步骤直接调用 POST files 替代） |
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
Access-Control-Allow-Methods: GET, POST, PATCH, DELETE, OPTIONS
Access-Control-Allow-Headers: Content-Type, X-Data-Root
```
