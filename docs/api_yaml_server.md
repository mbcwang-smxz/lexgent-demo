# YAML Configuration Server API

YAML Server 提供只读 REST API，从 `data/yaml/` 目录加载并提供 Agent 配置、Skill、Prompt 等资源。Agent Framework 通过此服务动态加载行为定义。

**默认端口**: `3003`（可通过 `YAML_SERVER_PORT` 环境变量配置）

**特性**:
- 所有配置在首次请求时加载到内存缓存
- 只读服务，仅支持 GET 请求
- CORS 已开启（`Access-Control-Allow-Origin: *`）

---

## 1. 健康检查

**GET** `/health`

```json
{
  "status": "ok",
  "agents": ["law_agent"],
  "timestamp": "2026-02-09T10:00:00.000Z"
}
```

---

## 2. Agent 列表

**GET** `/agents`

列出 `data/yaml/` 下所有可用的 Agent。

```json
[
  {
    "id": "law_agent",
    "name": "民事诉讼 Agent",
    "version": "2.0.0",
    "description": "辅助处理民事案件分析与文书起草。",
    "skillCount": 19
  }
]
```

---

## 3. Agent 配置

**GET** `/agents/:agentId`

获取完整的 `agent.yaml` 配置清单。

**参数**
- `agentId`: Agent 目录名（如 `law_agent`）

**响应**
```json
{
  "type": "agent",
  "name": "民事诉讼 Agent",
  "version": "2.0.0",
  "description": "辅助处理民事案件分析与文书起草。",
  "model_name": "deepseek/deepseek-chat",
  "skills": [
    "law_agent/skills/s*.yaml"
  ],
  "tasks": [
    "law_agent/tasks/t*.yaml"
  ],
  "document_types": "law_agent/types.yaml",
  "functions": [
    "law_agent/functions/f*.yaml"
  ],
  "analyser_prompt": "law_agent/prompts/p_analyser.hbs",
  "default_config": "dev",
  "context_prop": {
    "key": "caseId",
    "path": "/cases/{caseId}/context"
  }
}
```

> `skills` 数组同时支持通配符路径字符串和内联 Skill 对象。`model_name` 格式为 `{provider}/{model}`。

**错误**: `404` `{"error": "Agent 'xxx' not found"}`

---

## 4. Skill 列表

**GET** `/agents/:agentId/skills`

```json
[
  {
    "id": "Skill_当事人提取",
    "name": "当事人信息提取",
    "execution_type": "task",
    "description": "从起诉状等初始文件中提取原告与被告详细信息。"
  }
]
```

---

## 5. Skill 配置

**GET** `/agents/:agentId/skills/:skillId`

**参数**
- `skillId`: 支持两种查找方式：
  1. Skill ID（如 `Skill_当事人提取`）
  2. 文件名（如 `s_当事人提取`，不含 `.yaml`）

**响应**
```json
{
  "type": "skill",
  "id": "Skill_当事人提取",
  "alias": "s01",
  "name": "当事人信息提取",
  "version": "2.0.0",
  "inputs": [
    { "name": "source_docs", "required": true, "description": "..." }
  ],
  "on_result": [
    { "type": "save_file", "id": "D01", "filename": "D01_当事人信息.json", "type_ref": "当事人信息" }
  ],
  "task": {
    "prompt_ref": "law_agent/prompts/p_当事人提取",
    "llm_config": { "temperature": 0.1, "max_tokens": 4096 }
  }
}
```

**错误**: `404` `{"error": "Skill 'xxx' not found in agent 'law_agent'"}`

---

## 6. 文档类型

**GET** `/agents/:agentId/types`

```json
{
  "type": "document_type",
  "name": "法律文书类型注册表",
  "version": "2.0.0",
  "types": [
    { "id": "民事起诉状", "name": "民事起诉状", "category": "raw" },
    { "id": "当事人信息", "name": "当事人信息", "category": "derived", "format": "json" },
    { "id": "待转换文档", "name": "待转换文档", "category": "system" },
    { "id": "未分类文档", "name": "未分类文档", "category": "system" },
    { "id": "无关文档", "name": "无关文档", "category": "system" }
  ]
}
```

> `category` 支持 `"raw"`（已分类原始文书，R##）、`"derived"`（AI 生成，D##）、`"system"`（处理状态，P##/U##/X##）。

---

## 7. Prompt 模板

**GET** `/agents/:agentId/prompts/:name`

获取 Handlebars 模板原始内容。

**参数**
- `name`: Prompt 文件名（不含 `.hbs` 扩展名，如 `p_当事人提取`）

**响应**: `text/plain`
```handlebars
# Role
你是一个智能案件信息提取专家。

# Documents
{{#each inputs.source_docs}}
## 文档: {{filename}} ({{type}})
{{content}}
{{/each}}
```

---

## 资源服务范围

| 资源类型 | 目录 | 文件格式 | API 端点 | 状态 |
| :--- | :--- | :--- | :--- | :--- |
| Agent | `{agent}/` | `agent.yaml` | `/agents/{agentId}` | 已实现 |
| Skill | `{agent}/skills/` | `.yaml` | `/agents/{agentId}/skills/{id}` | 已实现 |
| Prompt | `{agent}/prompts/` | `.hbs` | `/agents/{agentId}/prompts/{name}` | 已实现 |
| Document Type | `{agent}/` | `types.yaml` | `/agents/{agentId}/types` | 已实现 |
| Function | `{agent}/functions/` | `.yaml` | `/agents/{agentId}/functions/{id}` | 已实现 |
| Task | `{agent}/tasks/` | `.yaml` | `/agents/{agentId}/tasks/{id}` | 已实现 |
| Worker | `{agent}/functions/` | `.js` | `/agents/{agentId}/source/{name}` | 已实现（JS 源码） |

---

## 错误响应

| 状态码 | 场景 | 响应 |
| :--- | :--- | :--- |
| 404 | 资源未找到 | `{"error": "描述信息"}` |
| 405 | 非 GET 方法 | `{"error": "Method not allowed"}` |
