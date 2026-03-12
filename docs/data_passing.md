# 数据传递机制参考

本文档面向 Agent 编写者，说明在 Skill/Task 配置中如何实现数据传递。

---

## 1. Task 间数据传递（Skill 内部）

在一个 Skill 的 `tasks: []` 多步骤流程中，前一个 task 的输出可以作为后续 task 的输入。

### 1.1 核心概念

每个 task 执行完毕后，其输出会自动存入 **TaskContext**：

```
context.tasks[<task_id>][<output_id>] = <输出值>
```

后续 task 通过 `inputs[].ref` 引用前序输出。

### 1.2 输出定义（outputs）

```yaml
tasks:
  - id: t_extract
    type: llm
    prompt_ref: law_agent/prompts/p_extract
    outputs:
      - id: entities        # 输出标识符
        description: 提取的实体信息
      - id: confidence
        description: 置信度
```

**输出捕获规则**：
- 如果 LLM/函数返回 JSON 对象，且对象中有与 `output.id` 同名的字段 → 提取该字段
- 否则 → 整个返回值存入该 output
- 如果 task 没有定义 `outputs`，整个返回值存入 `result`

### 1.3 输入引用（inputs[].ref）

```yaml
tasks:
  - id: t_extract
    # ...
    outputs:
      - id: entities

  - id: t_classify
    type: llm
    prompt_ref: law_agent/prompts/p_classify
    inputs:
      - name: extracted_data          # 模板变量名
        ref: tasks.t_extract.entities # 引用前序 task 输出
      - name: original_docs
        ref: inputs.documents         # 引用 skill 级输入
```

### 1.4 支持的 ref 路径

| 路径格式 | 含义 | 示例 |
|:---|:---|:---|
| `inputs.<name>` | Skill 级输入（文件或参数） | `inputs.documents` |
| `tasks.<task_id>.<output_id>` | 前序 task 的指定输出 | `tasks.t_extract.entities` |
| `tasks.<task_id>.result` | 前序 task 的默认输出（无 outputs 定义时） | `tasks.t_get_data.result` |
| `ctx.skills.<skill_id>.<output_id>` | 其他 Skill 的输出（跨 Skill） | `ctx.skills.Skill_提取.当事人` |
| `ctx.steps.<step_id>.<output_id>` | 步骤输出 | `ctx.steps.t_extract.entities` |
| `ctx.shared.<key>` | 共享变量 | `ctx.shared.响应内容` |

### 1.5 Prompt 模板中使用传递的数据

通过 `inputs[].ref` 解析后的值，以 `name` 为键合并到模板上下文：

```handlebars
# p_classify.hbs

以下是提取的实体信息：
{{json extracted_data}}

请对以下文档进行分类：
{{#each original_docs}}
文件: {{this.filename}}
内容: {{this.content}}
{{/each}}
```

**模板变量优先级**：task 级 inputs > skill 级 inputs

---

## 2. API Request Task（新增）

`api_request` 类型的 task 可以直接调用 HTTP 端点，并将响应作为输出传递给后续 task。

### 2.1 基本语法

```yaml
- id: t_get_metadata
  type: api_request
  method: GET                                    # GET | POST | PUT | PATCH | DELETE
  endpoint: "/cases/{caseId}/metadata"           # 相对于 data_server 的路径
  outputs:
    - id: metadata
```

### 2.2 字段说明

| 字段 | 类型 | 必填 | 说明 |
|:---|:---|:---|:---|
| `id` | string | 是 | task 唯一标识 |
| `type` | `"api_request"` | 是 | 固定值 |
| `method` | string | 否 | HTTP 方法，默认 `GET` |
| `endpoint` | string | 是 | URL 路径，相对于 data_server。支持 `{caseId}` 占位符 |
| `inputs` | array | 否 | 输入绑定。名为 `body` 的 input 用作 POST/PUT/PATCH 的请求体 |
| `outputs` | array | 否 | 输出定义 |

### 2.3 endpoint 占位符

目前支持：

| 占位符 | 替换为 |
|:---|:---|
| `{caseId}` | 当前案件 ID |

### 2.4 发送请求体

对于 POST/PUT/PATCH 方法，使用名为 `body` 的 input：

```yaml
- id: t_update_metadata
  type: api_request
  method: PUT
  endpoint: "/cases/{caseId}/metadata"
  inputs:
    - name: body
      ref: tasks.t_build_metadata.result   # 将前序 task 的输出作为请求体
```

### 2.5 完整示例

```yaml
type: skill
id: Skill_初始化
name: 案件初始化
execution_type: tasks

tasks:
  # Step 1: 获取当前 metadata
  - id: t_get_metadata
    type: api_request
    method: GET
    endpoint: "/cases/{caseId}/metadata"
    outputs:
      - id: metadata

  # Step 2: 扫描物理文件
  - id: t_scan_files
    type: api_request
    method: GET
    endpoint: "/cases/{caseId}/files/scan"
    outputs:
      - id: scan_result

  # Step 3: LLM 分类
  - id: t_classify
    type: llm
    prompt_ref: law_agent/prompts/p_文档分类
    inputs:
      - name: metadata
        ref: tasks.t_get_metadata.metadata
      - name: scan_result
        ref: tasks.t_scan_files.scan_result
    outputs:
      - id: updated_metadata

  # Step 4: 写回 metadata
  - id: t_save_metadata
    type: api_request
    method: PUT
    endpoint: "/cases/{caseId}/metadata"
    inputs:
      - name: body
        ref: tasks.t_classify.updated_metadata
```

---

## 3. Skill 间数据传递

### 3.1 通过 ctx 引用

当 Analyser 生成多步骤 Plan 时，后执行的 Skill 可以通过 `ctx` 引用先执行的 Skill 的输出：

```yaml
# skill A: Skill_当事人提取
outputs:
  - id: 当事人
    target: "ctx.skills.Skill_当事人提取.当事人"

# skill B 的某个 task
inputs:
  - name: party_info
    ref: ctx.skills.Skill_当事人提取.当事人
```

### 3.2 通过 skill_ref 嵌套

在 tasks 流程中可以引用另一个 Skill 作为子步骤：

```yaml
tasks:
  - skill_ref: law_agent/skills/s_当事人提取
    inputs:
      - name: documents
        ref: inputs.source_docs
    outputs:
      - id: party_data

  - id: t_use_party_data
    type: llm
    prompt_ref: law_agent/prompts/p_analysis
    inputs:
      - name: parties
        ref: tasks.s_当事人提取.party_data    # 引用 skill_ref 的输出
```

> `skill_ref` 作为黑盒执行，其 `on_result` 处理也会被执行。

---

## 4. Task 类型速查

| type | 用途 | 需要 prompt | 需要 function_ref | 需要 endpoint |
|:---|:---|:---|:---|:---|
| `llm`（默认） | LLM 调用 | 是 | — | — |
| `function` | 调用已注册的 Function | — | 是 | — |
| `api_request` | HTTP 请求 | — | — | 是 |
| `client` | 客户端动作 | — | — | — |

---

## 5. 常见模式

### 获取数据 → LLM 处理 → 保存结果

```yaml
tasks:
  - id: t_fetch
    type: api_request
    method: GET
    endpoint: "/cases/{caseId}/metadata"
    outputs:
      - id: data

  - id: t_process
    type: llm
    prompt_ref: law_agent/prompts/p_process
    inputs:
      - name: input_data
        ref: tasks.t_fetch.data
    outputs:
      - id: result

  - id: t_save
    type: api_request
    method: PUT
    endpoint: "/cases/{caseId}/metadata"
    inputs:
      - name: body
        ref: tasks.t_process.result
```

### 函数调用 → LLM 分析

```yaml
tasks:
  - id: t_convert
    type: function
    function_ref: Func_文件转换
    inputs:
      - name: sourceFilename
        ref: inputs.filename
    outputs:
      - id: conversion_result

  - id: t_analyze
    type: llm
    prompt_ref: law_agent/prompts/p_analyze
    inputs:
      - name: converted
        ref: tasks.t_convert.conversion_result
```
