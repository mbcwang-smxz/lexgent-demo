# Agent 编写指南 (配置与开发)

本文档面向领域专家和内容创作者，介绍如何通过配置文件构建 LawAgent 智能体。
只要理解 Agent、Skill、Task 等核心概念，您无需编写代码即可定义强大的 AI 助手。

我们以 **LawAgent (民事诉讼智能体)** 为例，介绍如何通过修改配置文件来教会 AI 处理特定任务。

## 1. 核心概念 (Core Concepts)

理解以下五个概念是配置 Agent 的基础：

| 概念 | 对应文件 | 说明 |
| :--- | :--- | :--- |
| **Agent (智能体)** | `agent.yaml` | 系统的核心入口。定义了智能体的名称、角色设定以及它所拥有的技能列表。 |
| **Skill (技能)** | `skills/*.yaml` | 智能体的具体能力单元（如“案件分析”、“文书生成”）。<br>每个技能定义了**输入数据**、**执行逻辑**和**输出结果**。 |
| **Task (任务)** | `tasks/*.yaml` | 技能内部的具体执行步骤。可内联定义在 Skill 中，也可作为独立文件放在 `tasks/` 目录下供多个技能复用。支持 LLM 调用、工具调用、客户端操作等类型。 |
| **Function (函数)** | `functions/*.yaml` | 外部工具定义（LLM function calling），如"法条检索"、"案件查询"。LLM 可在执行过程中主动调用。 |
| **Prompt (提示词)** | `prompts/*.hbs` | 发送给 AI 的具体指令模板。使用 Handlebars 语法 (`{{ }}`) 动态填入变量。 |
| **Document (文档类型)** | `types.yaml` | 定义系统中流通的数据格式（如"民事起诉状"、"判决书草稿"），用于规范技能间的输入输出对接。 |

---

## 2. 目录结构

所有的配置都存放在 `data/yaml/` 目录下。以 `law_agent` 为例：

```text
data/yaml/law_agent/
├── agent.yaml               # [入口] Agent 定义：名称、模型配置、技能清单
├── skills/                  # [技能] 技能定义文件
│   ├── s_当事人提取.yaml     # 技能: 提取当事人信息
│   ├── s_裁判说理.yaml       # 技能: 生成裁判说理
│   └── ...
├── tasks/                   # [任务] 独立可复用的 Task 定义
│   └── t_法条检索.yaml       # 任务: 法条检索（带工具调用）
├── prompts/                 # [指令] 提示词模板（p_ 前缀）
│   ├── p_当事人提取.hbs      # 对应技能的 Prompt
│   ├── p_裁判起草.hbs        # 对应技能的 Prompt
│   └── ...
├── types.yaml               # [文档] 文档类型注册表
├── functions/               # [函数] 外部函数定义（LLM function calling）
│   ├── f_案件查询.yaml
│   ├── f_法条检索.yaml
│   ├── f_赔偿计算.yaml
│   ├── w_test.js            # JS 代码函数（w_ 前缀区分 YAML 配置）
│   └── w_赔偿计算.js
└── configs/                 # [配置] 运行时配置（LLM、服务地址等）
    └── dev.yaml
```

---

## 3. 第一步：配置 Agent (`agent.yaml`)

这是智能体的顶层配置文件。

**文件路径**: `data/yaml/law_agent/agent.yaml`

```yaml
type: "agent"
name: "民事诉讼 Agent"        # Agent 名称
version: "2.0.0"
description: "辅助处理民事案件分析与文书起草。" # 描述

# 模型名（格式: "{提供者}/{模型}"，详见「运行时配置」章节）
model_name: "deepseek/deepseek-chat"

# 核心：技能清单（支持通配符）
skills:
  - "law_agent/skills/s*.yaml"   # 匹配所有 s_ 开头的技能

# 独立任务列表（可选，支持通配符）
tasks:
  - "law_agent/tasks/t*.yaml"

# 引用文档类型定义（需包含 .yaml 扩展名）
document_types: "law_agent/types.yaml"

# 函数列表（可选，支持通配符）
functions:
  - "law_agent/functions/f*.yaml"

# Agent 级分析器提示词（可选，覆盖框架默认 system_prompt）
analyser_prompt: "law_agent/prompts/p_analyser.hbs"

# 默认运行时配置 ID（对应 configs/dev.yaml）
default_config: "dev"

# 上下文属性（可选，定义范围键和 API 路径）
context_prop:
  key: "caseId"
  path: "/cases/{caseId}/context"

# 元数据（可选）
metadata:
  domain: "法律"
  sub_domain: "民事诉讼"

# 设置（可选）
settings:
  timeout: 60000
  context_refresh_strategy: "per_turn"
```

---

## 4. 第二步：定义 Skill (`skills/*.yaml`)

Skill 是工作流的核心单元。一个 Skill 包含三个要素：**输入 (Inputs)** -> **任务 (Task)** -> **结果处理 (On Result)**。

**文件路径**: `data/yaml/law_agent/skills/s_当事人提取.yaml`

**命名规范**：
- 文件名：`s_<中文名>.yaml`（`s_` 前缀表示 Skill）
- ID：`Skill_<中文名>`（如 `Skill_当事人提取`）
- alias：短字符串（如 `s01`），用于 CLI 快捷调用

```yaml
type: "skill"
id: "Skill_当事人提取"              # 技能唯一 ID
alias: "s01"                        # 短别名，用于 CLI 快捷调用（如 /s01）
name: "当事人信息提取"               # 技能名称，显示在菜单中
version: "2.0.0"
description: "从起诉状等初始文件中提取原告与被告详细信息。"

# ======= 1. 输入定义 (Inputs) =======
# 定义该技能执行所需的数据
inputs:
  - name: "source_docs"     # 变量名，将在 Prompt 中通过 {{inputs.source_docs}} 引用
    required: true          # 是否必须
    description: "起诉状或初始立案材料。"

# --- 系统自动注入输入（System Inputs）---
# 通过 system 字段标记后，框架在执行前自动填充，Analyser 无需在 inputs 中指定文件 ID。
# 支持以下 system 类型：
#
# system: "file_list"        — 注入所有案件文件清单（含内容预览）
# system: "files_by_type"    — 按 type 过滤注入，需配合 filter 字段
#   filter: "待转换文档"      → 仅注入 P## 系列文件
#   filter: "未分类文档"      → 仅注入 U## 系列文件
# system: "skill_list"       — 注入当前 Agent 所有技能信息
#
# 示例（自动注入待转换文档，Analyser 无需指定 inputs）：
# inputs:
#   - name: "pending_files"
#     system: "files_by_type"
#     filter: "待转换文档"
#     required: false

# ======= 2. 任务定义 (Task) =======
# 定义具体的执行逻辑
task:
  # 引用提示词模板
  # 指向 data/yaml/law_agent/prompts/p_当事人提取.hbs
  prompt_ref: "law_agent/prompts/p_当事人提取"

  # LLM 参数配置 (可选)
  llm_config:
    temperature: 0.1        # 0.0 最严谨(适合提取信息), 1.0 最发散(适合创意写作)

# ======= 3. 结果处理 (On Result) =======
# 定义执行完成后如何处理输出
on_result:
  - type: "save_file"                   # 操作类型：保存为文件
    id: "D01"                           # 结果文件的 ID (供后续技能引用)
    filename: "D01_当事人信息.json"       # 保存的文件名
    type_ref: "当事人信息"                # 文件类型(在 types.yaml 中定义)
```

---

## 5. 第三步：编写 Prompt (`prompts/p_*.hbs`)

Prompt 是指导 LLM 工作的指令。文件使用 Handlebars (`.hbs`) 模板语法，允许动态插入数据。

**文件路径**: `data/yaml/law_agent/prompts/p_当事人提取.hbs`

```handlebars
# Role (角色设定)
你是一名专业的法院书记员。
你的任务是从案件材料中提取准确的当事人信息。

# Input Data (输入数据)
请阅读以下文件内容：
{{#each inputs.source_docs}}    <-- 循环遍历所有输入文件
## 文件名: {{filename}}
内容:
{{content}}
{{/each}}                       <-- 循环结束

# Task (具体任务)
请从上述材料中提取原告和被告的基本信息。
必须包含以下字段：姓名/名称、类型(自然人/法人)、证件号码、住所地。

# Output Format (输出格式要求)
请直接输出 JSON 格式的数据，不要包含任何 Markdown 格式标记。
示例格式：
{
  "plaintiffs": [ ... ],
  "defendants": [ ... ]
}
```

---

## 6. 模板变量 (Template Variables)

Prompt 模板（`.hbs` 文件）和 Task 内联 `prompt` 都使用 [Handlebars](https://handlebarsjs.com/) 语法。
框架在渲染模板时会注入一组**上下文变量**，可通过 `{{变量路径}}` 在模板中引用。

### 6.1 变量一览

| 变量路径 | 类型 | 来源 | 说明 |
| :--- | :--- | :--- | :--- |
| `{{instruction}}` | string | Analyser / 用户输入 | 当前执行的自然语言指令 |
| `{{inputs.<名称>}}` | FileContent[] | Skill 的 `inputs` 定义 | 输入文件数组（详见 6.2） |
| `{{params.<名称>}}` | any | Skill 的参数型 input | 非文件类型的输入参数（详见 6.3） |
| `{{case.case_id}}` | string | 运行时 | 当前案件 ID |
| `{{case.case_number}}` | string | 案件元数据 | 案号 |
| `{{case.cause_of_action}}` | string | 案件元数据 | 案由 |
| `{{agent.name}}` | string | agent.yaml | Agent 名称 |
| `{{agent.skills}}` | array | agent.yaml | 已加载的技能列表 |

### 6.2 `inputs` — 文件输入（最常用）

**这是模板中最核心的变量。** 它的值来自技能 `inputs` 中定义的文件型输入。

**完整链路**：Skill YAML 的 `inputs[].name` → 框架加载文件内容 → 模板中 `{{inputs.<name>}}`

```yaml
# ① 在 Skill YAML 中定义输入名称
inputs:
  - name: "source_docs"          # ← 定义变量名
    required: true
    description: "起诉状或初始立案材料。"
```

```handlebars
{{!-- ② 在 Prompt 模板中通过 inputs.<name> 引用 --}}
{{#each inputs.source_docs}}    {{!-- source_docs 对应 Skill 中的 name --}}
## {{filename}} ({{type}})
{{content}}
{{/each}}
```

每个 `inputs.<name>` 是一个**文件数组**，数组中的每个元素包含以下字段：

| 字段 | 类型 | 说明 |
| :--- | :--- | :--- |
| `filename` | string | 文件名，如 `"D01_当事人信息.json"` |
| `type` | string | 文档类型，如 `"当事人信息"` |
| `content` | string | 文件的完整文本内容 |
| `id` | string | 文件 ID，如 `"D01"` |

**常用模板模式**：

```handlebars
{{!-- 模式 1: 循环遍历多个文件（最常用） --}}
{{#each inputs.source_docs}}
## 文档: {{filename}} ({{type}})
{{content}}
{{/each}}

{{!-- 模式 2: 使用内置 Helper 格式化文件列表 --}}
{{formatFiles inputs.source_docs}}
```

### 6.3 `params` — 参数输入

当 Skill 的 `inputs` 定义了带 `type` 字段的输入时，它是**参数**而非文件。参数值由用户直接提供（如用户输入的问题文本），不需要关联文件。

```yaml
# Skill 定义中：type 字段标记此输入为参数
inputs:
  - name: "question"
    type: "string"               # ← 有 type = 参数输入（非文件）
    required: true
    description: "用户的法律问题"
```

在模板中，参数同样通过 `inputs.<name>` 访问（框架会将 params 合并到 inputs 命名空间）：

```handlebars
问题：{{inputs.question}}
```

### 6.4 `instruction` — 执行指令

`{{instruction}}` 是 Analyser（任务分析器）传递给技能的自然语言指令，通常包含用户的原始意图。

```handlebars
# Task
{{instruction}}

# Documents
{{#each inputs.source_docs}}
...
{{/each}}
```

### 6.5 `agent` — Agent 信息

访问当前 Agent 的元数据，常用于"帮助"类技能：

```handlebars
{{!-- 列出所有可用技能 --}}
{{#each agent.skills}}
- **{{name}}** ({{id}}): {{description}}
{{/each}}
```

### 6.6 多任务 (Tasks) 中的变量差异

在多任务模式下，每个 Task 的 `inputs` 通过 **`ref` 绑定**显式指定，模板中同样使用 `{{inputs.<name>}}` 访问，但 `<name>` 来自 Task 的 `inputs[].name`（而非 Skill 的）：

```yaml
# Task 内联定义
- id: "逻辑分析"
  prompt: |
    事实：{{inputs.facts}}          # ← facts 来自下面的 inputs 绑定
    法条：{{inputs.laws}}           # ← laws 来自下面的 inputs 绑定
  inputs:
    - name: "facts"                 # ← 定义模板变量名 facts
      ref: "inputs.source_docs"     # ← 数据来源：技能级别的输入
    - name: "laws"                  # ← 定义模板变量名 laws
      ref: "tasks.Task_法条检索.law_result"  # ← 数据来源：前序任务输出
```

### 6.7 Handlebars 语法速查

| 语法 | 说明 | 示例 |
| :--- | :--- | :--- |
| `{{变量}}` | 输出变量值 | `{{instruction}}` |
| `{{#each 数组}}...{{/each}}` | 循环遍历 | `{{#each inputs.source_docs}}` |
| `{{#if 变量}}...{{/if}}` | 条件判断 | `{{#if inputs.evidence}}` |
| `{{#ifExists 变量}}...{{/ifExists}}` | 存在性检查（自定义 Helper） | `{{#ifExists params.note}}` |
| `{{json 对象}}` | 输出 JSON 字符串（自定义 Helper） | `{{json inputs.source_docs}}` |
| `{{formatFiles 数组}}` | 格式化文件列表（自定义 Helper） | `{{formatFiles inputs.source_docs}}` |

---

## 7. 第四步：注册文档类型 (`types.yaml`)

### 7.1 为什么需要文档类型？

在一个案件的处理流程中，有大量不同性质的文件在技能之间流转：用户上传的起诉状、庭审笔录，以及 AI 生成的当事人信息、争议焦点分析等。**文档类型**就是这些文件的"身份证"，它为框架提供三个关键能力：

1. **文件分类与管理**：每个文件通过 `type_ref` 关联到一个文档类型。系统可以按类型检索文件（如"找出所有证据分析结果"），而不必依赖文件名猜测。
2. **区分来源**：`category` 字段区分 **`raw`**（用户上传的原始材料）和 **`derived`**（AI 技能生成的结果）。框架据此决定文件的存储方式和生命周期。
3. **文件清单展示**：当技能需要查看案件中有哪些文件时，每个文件会以 `[D01] D01_当事人信息.json (当事人信息)` 的格式展示——括号中的就是文档类型名。

简而言之：**技能通过 `on_result` 的 `type_ref` 写入类型标签，后续流程通过类型标签检索和理解文件。**

### 7.2 文件格式

**文件路径**: `data/yaml/law_agent/types.yaml`

```yaml
type: "document_type"
name: "法律文书类型注册表"
version: "2.0.0"

types:
  # ===== 原始文档 (Raw) — R## 前缀，经分类后的案件文书 =====
  - id: "民事起诉状"
    name: "民事起诉状"
    category: "raw"           # 原始文件（无 format 限制，支持 .txt/.md 等）
    description: "原告提交的起诉状文书。"

  - id: "庭审笔录"
    name: "庭审笔录"
    category: "raw"

  # ===== 衍生文档 (Derived) — D## 前缀，AI 技能生成的结果 =====
  - id: "当事人信息"
    name: "当事人信息"
    category: "derived"       # AI 生成
    format: "json"
    description: "从起诉状等材料提取的结构化当事人画像。"

  - id: "裁判文书草稿"
    name: "裁判文书草稿"
    category: "derived"
    format: "markdown"

  # ===== 系统状态类型 (System) — 文件处理生命周期状态 =====
  - id: "待转换文档"
    name: "待转换文档"
    category: "system"        # P## 前缀，PDF/Office 原件，需先转换
    description: "PDF或Office格式文档，需执行文件转换后才能处理。"

  - id: "未分类文档"
    name: "未分类文档"
    category: "system"        # U## 前缀，转换后尚未分类
    description: "已转换完成、但尚未完成内容分类的文档。"

  - id: "无关文档"
    name: "无关文档"
    category: "system"        # X## 前缀，经确认与案件无关
    description: "经分类确认与案件无关的文档。"
```

### 7.3 字段说明

| 字段 | 必填 | 说明 |
| :--- | :--- | :--- |
| `id` | 是 | 类型唯一标识符。技能在 `on_result` 中通过 `type_ref` 引用此 ID |
| `name` | 是 | 显示名称 |
| `category` | 是 | `"raw"`（已分类原始文书，R## 前缀）、`"derived"`（AI 生成，D## 前缀）、`"system"`（处理状态，P##/U##/X## 前缀） |
| `format` | 否 | 文件格式：`text`、`json`、`markdown`、`pdf`（可选，不限制实际格式） |
| `description` | 否 | 类型描述 |

### 7.4 与 `on_result` 的关系

技能通过 `on_result` 中的 `type_ref` 将输出文件关联到文档类型：

```yaml
# 在技能 s_当事人提取.yaml 中：
on_result:
  - type: "save_file"
    id: "D01"
    filename: "D01_当事人信息.json"
    type_ref: "当事人信息"          # ← 引用 types.yaml 中的 id

# 在 types.yaml 中：
types:
  - id: "当事人信息"                # ← 被引用的类型定义
    category: "derived"
    format: "json"
```

保存文件时，框架会将 `type_ref` 写入文件元数据。之后任何需要查询"当事人信息"类型文件的操作都可以通过类型检索到它。

---

## 8. 结果处理 (`on_result`)

`on_result` 定义技能执行完成后如何处理 LLM 的输出。它是一个数组，可以包含多个处理器。
**当 `on_result` 未定义时，默认行为是将结果直接显示给用户。**

### 8.1 `save_file` — 保存到文件

最常用的类型。将 LLM 输出保存为案件文件，供后续技能使用。

```yaml
on_result:
  - type: "save_file"
    id: "D01"                       # 文件 ID（供其他技能引用）
    filename: "D01_当事人信息.json"   # 保存的文件名
    type_ref: "当事人信息"            # 关联的文档类型（在 types.yaml 中定义）
```

| 字段 | 必填 | 说明 |
| :--- | :--- | :--- |
| `type` | 是 | 固定为 `"save_file"` |
| `id` | 是 | 文件 ID，如 `"D01"`。其他技能可通过此 ID 引用该输出 |
| `filename` | 是 | 保存的文件名，如 `"D01_当事人信息.json"` |
| `type_ref` | 否 | 关联 `types.yaml` 中的文档类型 ID |
| `source` | 否 | 当 LLM 返回包含多个部分的 JSON 时，用此字段指定提取哪个字段 |

**多输出示例**：一个技能产出两个文件，通过 `source` 从 LLM 返回的 JSON 中分别提取：

```yaml
# s_事实筛选.yaml — LLM 返回 {"D05": {...}, "D10": {...}}
on_result:
  - type: "save_file"
    id: "D05"
    filename: "D05_无争议事实.json"
    type_ref: "无争议事实"
    source: "D05"                   # ← 提取 JSON 中的 "D05" 字段
  - type: "save_file"
    id: "D10"
    filename: "D10_有争议事实.json"
    type_ref: "有争议事实"
    source: "D10"                   # ← 提取 JSON 中的 "D10" 字段
```

### 8.2 `api_call` — 调用数据服务接口

将 LLM 的完整输出通过 POST 请求转发给 Data Server 的指定端点。

```yaml
# s_案件初始化.yaml — 分类结果发送给数据服务
on_result:
  - type: "api_call"
    endpoint: "classification"      # → POST /cases/:caseId/classification
    fields:                         # 文档说明（仅供参考，框架不读取）
      filename: "文件名"
      type: "分类类型"
```

| 字段 | 必填 | 说明 |
| :--- | :--- | :--- |
| `type` | 是 | 固定为 `"api_call"` |
| `endpoint` | 是 | Data Server 端点后缀，实际调用 `POST /cases/:caseId/<endpoint>` |
| `fields` | 否 | 接口期望的字段说明（纯文档用途，框架不读取） |

### 8.3 `deletion` — 文件删除

根据 LLM 返回的内容执行文件删除操作。

```yaml
# s_文件维护.yaml
on_result:
  - type: "deletion"
```

| 字段 | 必填 | 说明 |
| :--- | :--- | :--- |
| `type` | 是 | 固定为 `"deletion"` |

### 8.4 默认行为

当技能不定义 `on_result` 时（如 `s_打招呼`、`s_测试`），框架会将 LLM 输出直接显示给用户，不做持久化。适用于问答类、交互类技能。

---

## 9. Task 参数详解

`task`（单任务）和 `tasks` 中的每个内联任务都支持以下参数。

### 9.1 Prompt 定义（二选一）

| 字段 | 说明 |
| :--- | :--- |
| `prompt_ref` | 引用外部 `.hbs` 模板文件路径，如 `"law_agent/prompts/p_当事人提取"` |
| `prompt` | 内联编写 Prompt 模板（支持 Handlebars 语法） |

两者只需提供一个。简单场景可用 `prompt` 内联；复杂/可复用的模板建议用 `prompt_ref` 引用外部文件。

```yaml
# 方式 1: 引用外部模板
task:
  prompt_ref: "law_agent/prompts/p_当事人提取"

# 方式 2: 内联模板
task:
  prompt: |
    请分析以下内容：
    {{inputs.source_docs}}
```

### 9.2 LLM 配置 (`llm_config`)

控制大模型的调用行为。所有字段均为可选。

```yaml
llm_config:
  temperature: 0.1
  max_tokens: 4096
  max_turns: 5
  tool_choice: "auto"
```

| 字段 | 类型 | 默认值 | 说明 |
| :--- | :--- | :--- | :--- |
| `temperature` | number | — | 生成随机性。`0.0` = 最严谨（适合提取、分析），`1.0` = 最发散（适合创意写作） |
| `max_tokens` | number | — | LLM 单次回复的最大 token 数 |
| `max_turns` | number | — | **函数调用最大轮数**。仅在配置了 `functions` 时有意义。每轮 = LLM 调用一次函数并获得结果 |
| `tool_choice` | string | — | 函数选择策略：`"auto"` 自动判断 / `"required"` 强制使用函数 / `"none"` 禁用函数 |

### 9.3 函数调用 (`functions`)

为任务配置可用的外部函数（定义在 `functions/*.yaml` 中），LLM 可以在执行过程中通过 **function calling** 主动调用这些函数。

```yaml
task:
  prompt: |
    请回答以下法律问题：{{inputs.question}}
    如需查询具体法条，使用 Func_法条检索 函数。
  functions:
    - "Func_法条检索"            # 函数 ID（定义在 functions/f_法条检索.yaml）
  llm_config:
    temperature: 0.3
    max_turns: 5                   # 允许最多 5 轮函数调用
```

当 `functions` 非空时，框架会进入 **Agentic Loop**（智能循环）模式：LLM 可以反复调用函数、获取结果、继续推理，直到给出最终答案或达到 `max_turns` 上限。

#### 函数定义文件 (`functions/*.yaml`)

每个函数对应一个 YAML 文件，定义其 ID、参数和实现方式。

**文件路径**: `data/yaml/law_agent/functions/f_法条检索.yaml`

```yaml
type: "function"
id: "Func_法条检索"                    # 函数唯一 ID（在 task 的 functions 数组中引用）
alias: "f02"                           # 短别名，用于 CLI 快捷调用（如 /f02）
calling_name: "law_lookup"             # LLM function calling 使用的函数名（必须为 ASCII）
name: "法条检索"                        # 显示名称
description: "检索指定法律法规的具体条文内容。"  # LLM 据此判断何时调用

# 实现方式（二选一）
endpoint: "/api/tools/law_lookup"      # REST API 路径（相对于函数自身的 base_url）
method: "POST"                         # HTTP 方法（默认 POST）
# source: "law_agent/functions/w_xxx"  # 或：JS 代码函数路径

# LLM function calling 参数定义
parameters:
  law_name:
    type: "string"
    required: true
    description: "法律法规名称，如'中华人民共和国民法典'"
  article_number:
    type: "string"
    description: "条款号，如'第一百八十八条'"
  keywords:
    type: "string"
    description: "条文内容关键词"
```

**函数字段说明**：

| 字段 | 必填 | 说明 |
| :--- | :--- | :--- |
| `id` | 是 | 函数唯一 ID，在 Task 的 `functions` 数组中引用。前缀 `Func_` |
| `alias` | 否 | CLI 短别名（如 `"f02"`），支持 `/f02` 快捷调用 |
| `calling_name` | 否 | LLM function calling 使用的函数名。**必须为 ASCII**（Gemini API 要求）。未设置时回退到 `id` |
| `name` | 是 | 显示名称 |
| `description` | 是 | 函数描述，LLM 据此判断何时调用该函数 |
| `endpoint` | 否* | REST API 端点路径 |
| `method` | 否 | HTTP 方法，默认 `POST` |
| `base_url` | 否 | 覆盖默认的 REST 基础 URL |
| `timeout` | 否 | 请求超时（毫秒） |
| `source` | 否* | JS 代码函数路径（如 `"law_agent/functions/w_xxx"`，与 `endpoint` 二选一） |
| `source_code` | 否 | 内联 JS 源代码（无需单独 `.js` 文件，与 `source` / `endpoint` 三选一） |
| `parameters` | 否 | 函数参数定义，每个参数包含 `type`、`description`、`required`、`enum` 等字段 |

> \* `endpoint`、`source`、`source_code` 至少提供一个。REST 函数调用外部 API，`source` / `source_code` 在进程内执行 JS 代码。
> JS 代码函数必须导出 `execute(args)` 函数（参数为对象，字段对应 `parameters` 定义）。

### 9.4 输入绑定 (`inputs`)

在多任务（`tasks`）中，每个任务通过 `inputs` 绑定数据来源：

```yaml
inputs:
  - name: "facts"                  # 变量名（在 Prompt 中用 {{inputs.facts}} 引用）
    ref: "inputs.source_docs"      # 数据来源路径
```

| `ref` 格式 | 说明 |
| :--- | :--- |
| `inputs.<变量名>` | 来自技能级别的输入 |
| `tasks.<任务ID>.<输出ID>` | 来自前序任务的输出 |

> **注意**：单任务（`task`）模式下通常不需要 `inputs` 绑定，技能级别的 inputs 会自动注入到 Prompt 上下文中。

### 9.5 输出声明 (`outputs`)

声明任务的输出标识符，供后续任务引用：

```yaml
outputs:
  - id: "分析结果"                  # 输出 ID
    description: "逻辑分析的 JSON 结果"  # 描述（可选）
```

执行完成后，LLM 的完整输出会存储在 `tasks.<任务ID>.<输出ID>` 路径下。

### 9.6 完整单任务示例

```yaml
# s_法律问答.yaml — 带工具调用的单任务技能
type: "skill"
id: "Skill_法律问答"
alias: "s10"
name: "法律问答"

inputs:
  - name: "question"
    type: "string"
    required: true
    description: "用户的法律问题"

on_result:
  - type: "save_file"
    id: "answer"
    filename: "qa_answer.json"

task:
  prompt: |
    你是一位专业的法律顾问。请回答以下法律问题：
    问题：{{inputs.question}}
    如需查询具体法条，使用 Func_法条检索 函数。
  functions:
    - "Func_法条检索"
  llm_config:
    temperature: 0.3
    max_turns: 5
```

### 9.7 函数任务 (`function_ref`)

函数任务是一种**跳过 LLM、直接执行代码**的任务类型。适用于确定性计算、数据转换等不需要 AI 推理的场景。
函数任务通过 `function_ref` 引用已定义的 Function（`functions/*.yaml`），复用同一套函数定义。

**JS 代码函数**放在 `functions/` 目录下（`w_` 前缀），必须导出 `execute` 函数：

**文件路径**: `data/yaml/law_agent/functions/w_test.js`

```javascript
/**
 * JS 代码函数必须导出 execute 函数
 * @param args - 参数对象，字段对应函数 parameters 定义
 * @returns 任务输出（可以是任意类型）
 */
async function execute(args) {
  return "Hello, this is a function.";
}

module.exports = { execute };
```

**在 Skill 中使用函数任务**（单任务模式）：

```yaml
type: "skill"
id: "Skill_函数测试"
name: "函数测试"

inputs: []

task:
  function_ref: "Func_测试"   # ← 引用函数 ID（定义在 functions/f_测试.yaml）
```

**在多任务中内联使用**：

```yaml
tasks:
  - id: "计算赔偿"
    type: "function"                        # ← 必须显式声明 type
    function_ref: "Func_赔偿计算"            # ← 引用函数 ID
    inputs:
      - name: "damage_info"
        ref: "tasks.事实分析.损害事实"
    outputs:
      - id: "计算结果"
```

**内联 JS 代码**：也可以在函数 YAML 中直接嵌入代码，无需单独 `.js` 文件：

```yaml
# functions/f_简单计算.yaml
type: "function"
id: "Func_简单计算"
name: "简单计算"
description: "内联 JS 示例"
source_code: |
  async function execute(args) {
    return args.a + args.b;
  }
  module.exports = { execute };
parameters:
  a:
    type: "number"
    required: true
  b:
    type: "number"
    required: true
```

> **注意**：函数任务由框架直接调用，LLM 不参与。与 Task 中的 `functions`（LLM function calling，LLM 主动调用）不同，`function_ref` 是框架直接执行。

---

## 10. 进阶：多步骤任务 (Tasks)

当一个技能需要多个步骤才能完成时，可以使用 **Tasks** 结构将多个任务串联起来。
每个任务的输出可以作为下一个任务的输入，形成数据链。

### 10.1 单任务 vs 多任务

前面第 4 节展示的是**单任务**技能，使用 `task`（单数）字段：

```yaml
# 单任务：一次 LLM 调用即可完成
task:
  prompt_ref: "law_agent/prompts/p_当事人提取"
  llm_config:
    temperature: 0.1
```

当需要多个步骤时，使用 `tasks`（复数）字段，并设置 `execution_type: "tasks"`：

```yaml
execution_type: "tasks"
tasks:
  - id: "步骤一"
    prompt: "..."
  - id: "步骤二"
    prompt: "..."
```

### 10.2 任务间数据传递

任务通过 **`inputs` 绑定 + `ref` 引用** 实现数据传递。引用路径有两种：

| 引用格式 | 说明 | 示例 |
| :--- | :--- | :--- |
| `inputs.<变量名>` | 引用技能级别的输入 | `ref: "inputs.source_docs"` |
| `tasks.<任务ID>.<输出ID>` | 引用前序任务的输出 | `ref: "tasks.逻辑分析.分析结果"` |

### 10.3 完整示例：裁判说理（三步串联）

以 `s_裁判说理.yaml` 为例，该技能包含三个串联任务：

```yaml
type: "skill"
id: "Skill_裁判说理"
name: "裁判说理生成"
execution_type: "tasks"

inputs:
  - name: "source_docs"
    required: true
    description: "事实认定结果(D07)。"

on_result:
  - type: "save_file"
    id: "D08"
    filename: "D08_争议焦点说理.json"
    type_ref: "裁判说理"

tasks:
  # 步骤 1: 引用外部 Task 文件进行法条检索
  - task_ref: "law_agent/tasks/t_法条检索"
    inputs:
      - name: "query"
        ref: "inputs.source_docs"       # ← 来自技能输入

  # 步骤 2: 内联 LLM 任务，使用步骤 1 的输出
  - id: "逻辑分析"
    prompt: |
      请基于以下事实和法条进行逻辑分析：
      事实认定：{{inputs.facts}}
      相关法条：{{inputs.laws}}
    inputs:
      - name: "facts"
        ref: "inputs.source_docs"       # ← 来自技能输入
      - name: "laws"
        ref: "tasks.Task_法条检索.law_result"  # ← 来自步骤 1 输出
    outputs:
      - id: "分析结果"
    llm_config:
      temperature: 0.1

  # 步骤 3: 引用外部 Prompt 文件，使用步骤 2 的输出
  - id: "文书撰写"
    prompt_ref: "law_agent/prompts/p_裁判起草"
    inputs:
      - name: "analysis"
        ref: "tasks.逻辑分析.分析结果"   # ← 来自步骤 2 输出
    outputs:
      - id: "D08"
    functions:
      - "Func_案件查询"               # 可调用函数
    llm_config:
      temperature: 0.2
```

数据流向：`技能输入 → 步骤1(法条检索) → 步骤2(逻辑分析) → 步骤3(文书撰写) → 保存D08`

### 10.4 外部 Task 文件

可复用的任务可以定义为独立文件，放在 `tasks/` 目录下，通过 `task_ref` 引用：

**文件路径**: `data/yaml/law_agent/tasks/t_法条检索.yaml`

```yaml
type: "task"
id: "Task_法条检索"
alias: "t01"                          # 短别名，支持 /t01 快捷调用
name: "法条检索任务"
description: "根据查询内容检索相关法律条文，支持工具调用。"

prompt: |
  请根据以下查询检索相关法律条文：
  查询内容：{{inputs.query}}

inputs:
  - name: "query"
    description: "检索关键词或问题"
    required: true

outputs:
  - id: "law_result"
    description: "检索结果"

functions:
  - "Func_法条检索"

llm_config:
  temperature: 0.1
  max_turns: 3          # 函数调用最大轮数
```

引用时通过 `inputs` 绑定将技能数据传入：

```yaml
tasks:
  - task_ref: "law_agent/tasks/t_法条检索"
    inputs:
      - name: "query"              # 对应 Task 定义中的 input name
        ref: "inputs.source_docs"  # 绑定到技能输入
```

### 10.5 任务类型一览

| 类型 | 标志字段 | 说明 |
| :--- | :--- | :--- |
| **LLM** | `prompt` 或 `prompt_ref` | 调用大模型处理（默认类型） |
| **Client** | `type: "client"` | 客户端操作（如显示内容） |
| **Function** | `type: "function"` | 执行 JS 代码函数（通过 `function_ref` 引用） |
| **外部 Task 引用** | `task_ref` | 引用独立 Task 文件 |
| **外部 Skill 引用** | `skill_ref` | 引用 Skill 作为黑盒子步骤（含 on_result） |

### 10.6 引用外部 Skill (`skill_ref`)

除了引用外部 Task，还可以在 `tasks` 数组中引用外部 **Skill** 作为子步骤。`skill_ref` 会将整个 Skill 作为黑盒执行，包括其 `on_result` 处理器。

```yaml
tasks:
  # 步骤 1: 引用外部 Skill 作为子步骤
  - skill_ref: "law_agent/skills/s_当事人提取"
    inputs:
      - name: "source_docs"                      # 对应目标 Skill 的 input name
        ref: "inputs.raw_files"                   # 绑定到当前工作流的数据
    outputs:
      - id: "party_info"                          # 声明输出 ID（供后续步骤引用）

  # 步骤 2: 使用 Skill 输出
  - id: "文书撰写"
    prompt: |
      基于以下当事人信息撰写文书：{{inputs.parties}}
    inputs:
      - name: "parties"
        ref: "tasks.s_当事人提取.party_info"      # 引用 skill_ref 的输出
    outputs:
      - id: "D09"
```

**`skill_ref` vs `task_ref` 的区别**：

| | `task_ref` | `skill_ref` |
| :--- | :--- | :--- |
| 引用对象 | Task 文件 (`tasks/*.yaml`) | Skill 文件 (`skills/*.yaml`) |
| `on_result` | 不执行（Task 无 on_result） | **执行**（保持 Skill 契约） |
| 适用场景 | 复用可组合的 LLM 步骤 | 将完整 Skill 嵌入为子步骤 |
| 输入传递 | 通过 `inputs` 绑定 | 通过 `inputs` 绑定（直接注入，跳过文件加载） |

### 10.7 agent.yaml 中的内联 Skill

`agent.yaml` 的 `skills` 列表同时支持路径引用和内联对象：

```yaml
skills:
  - "law_agent/skills/s_当事人提取"        # 路径引用
  - type: "skill"                          # 内联定义
    id: "Skill_快速测试"
    name: "快速测试"
    description: "内联定义的简单技能"
    version: "1.0.0"
    inputs: []
    task:
      prompt: "请回复：Hello World"
```

---

## 11. 运行时配置 (`configs/*.yaml`)

运行时配置定义了 Agent 运行所需的环境参数（如数据服务地址、LLM 提供者）。
每个 Agent 可以有多个配置文件对应不同环境（如 `dev.yaml`、`prod.yaml`），通过 `agent.yaml` 的 `default_config` 指定默认使用哪个。

**文件路径**: `data/yaml/law_agent/configs/dev.yaml`

```yaml
type: "config"
id: "dev"
name: "本地开发环境"

data_server:
  url: "http://localhost:3000"

llm:
  - name: "gemini"
    sdk: "gemini"                    # 原生 Gemini SDK
    models:
      - "gemini/gemini-3-flash-preview"
      - "gemini/gemini-3-pro-preview"

  - name: "gemini_comp"
    sdk: "openai_compatible"         # OpenAI 兼容端点
    url: "https://generativelanguage.googleapis.com/v1beta/openai/"
    api_key_env: "GEMINI_API_KEY"    # 共享同一个 API Key
    models:
      - "gemini_comp/gemini-3-flash-preview"
      - "gemini_comp/gemini-3-pro-preview"
```

### 11.1 模型命名规范

模型名采用 **`{提供者名}/{实际模型名}`** 格式，前缀决定调用哪种 SDK：

| 模型名 | SDK | 说明 |
| :--- | :--- | :--- |
| `gemini/gemini-3-flash-preview` | `gemini` (原生) | 使用 `@google/generative-ai` SDK |
| `gemini_comp/gemini-3-flash-preview` | `openai_compatible` | 使用 OpenAI Chat Completions API 格式 |

在 `agent.yaml` 中通过 `model_name` 选择不同的模型名即可切换调用方式：

```yaml
# 使用 OpenAI 兼容端点
model_name: "gemini_comp/gemini-3-flash-preview"

# 使用原生 Gemini SDK
model_name: "gemini/gemini-3-pro-preview"
```

### 11.2 LLM 提供者字段

| 字段 | 必填 | 说明 |
| :--- | :--- | :--- |
| `name` | 是 | 提供者名称，也是模型前缀（如 `"gemini_comp"`） |
| `sdk` | 是 | SDK 类型：`"gemini"`（原生）、`"openai"`（原生）、`"openai_compatible"`（兼容端点） |
| `url` | 否* | 基础 URL（`openai_compatible` 必填） |
| `models` | 是 | 该提供者下可用的模型列表（含前缀） |
| `api_key_env` | 否 | 指定 API Key 环境变量名。默认为 `{NAME}_API_KEY`（`NAME` = 提供者名大写） |

> \* 使用 `openai_compatible` 时必须提供 `url`。

### 11.3 配置加载流程

1. 框架从 `agent.yaml` 读取 `default_config: "dev"`
2. 加载 `configs/dev.yaml`，获取 `data_server.url` 和 `llm` 提供者列表
3. 构建 `LLMFactory`，根据 `agent.yaml` 的 `model_name` 前缀匹配提供者
4. 创建对应的 LLM 实例（GeminiLLM 或 OpenAICompatibleLLM）

---

## 12. 实战示例：PDF 文件处理流水线

本节展示完整的 PDF 处理流程：**文件转换 → 文档分类**，以及这两个技能使用的 `system: "files_by_type"` 输入注入模式。

### 12.1 文件 ID 生命周期

案件文件按处理阶段自动分配 ID 前缀：

| 阶段 | ID 前缀 | 类型 | 说明 |
| :--- | :--- | :--- | :--- |
| 初始扫描 | `P##` | 待转换文档 | PDF/Office 原始文件 |
| 转换后（原件） | `X##` | 无关文档 | 已转换的原件，自动标记为无关 |
| 转换后（结果） | `U##` | 未分类文档 | 生成的 .md 文件，待分类 |
| 分类后（相关） | `R##` | 民事起诉状等 | 已确认与案件相关的文书 |
| 分类后（无关） | `X##` | 无关文档 | 分类确认无关的文档 |
| AI 生成 | `D##` | 当事人信息等 | 技能产出的衍生文件 |

完整流程：
```
初始化案件 → P01~P05（待转换）
     ↓ Skill_文件转换
P01→X01，生成 U01（1.md 未分类）
     ↓ Skill_文档分类
U01→R01（民事起诉状）
```

### 12.2 `system: "files_by_type"` 输入注入

这两个技能都使用 `system: "files_by_type"` 模式——框架在执行前自动从 metadata.json 中过滤指定类型的文件，注入为模板变量。Analyser 在规划时 **inputs 留空**，不需要指定具体文件 ID。

```yaml
# 工作原理：
# 1. Analyser 生成计划：{"skill_id": "Skill_文件转换", "inputs": []}
# 2. 框架执行前：过滤 metadata.json 中 type="待转换文档" 的文件
# 3. 写入临时文件 sys_pending_files.txt，注入为 inputs.pending_files
# 4. Prompt 通过 {{inputs.pending_files.[0].content}} 访问文件列表
```

### 12.3 文件转换技能

#### 函数定义

**文件路径**: `data/yaml/law_agent/functions/f_文件转换.yaml`

```yaml
type: "function"
id: "Func_文件转换"
alias: "f04"
calling_name: "file_to_markdown"
name: "文件转换"
description: "将PDF或Word文件转换为Markdown格式。支持 .pdf、.doc、.docx 文件。"

endpoint: "/cases/{caseId}/file2md"   # {caseId} 由框架自动替换
method: "POST"

parameters:
  sourceFilename:
    type: "string"
    required: true
    description: "源文件名，如 '1.pdf' 或 '起诉状.docx'"
# targetFilename 由 Data Server 自动推导（去掉扩展名加 .md），无需 LLM 指定
```

#### 技能定义

**文件路径**: `data/yaml/law_agent/skills/s_文件转换.yaml`

```yaml
type: "skill"
id: "Skill_文件转换"
alias: "s11"
name: "文件格式转换"
version: "3.0.0"
description: |
  将PDF或Word文件（P## 系列）转换为Markdown格式。
  转换后的文件注册为 U## 未分类文档，等待后续分类。
  此技能自动注入所有待转换文档，无需指定 inputs。

inputs:
  - name: "pending_files"
    system: "files_by_type"     # 框架自动注入，Analyser inputs 留空
    filter: "待转换文档"         # 只注入 P## 系列文件
    required: false

on_result:
  - type: "api_call"
    endpoint: "classification"  # 转换完成后通知 Data Server 更新 metadata

task:
  prompt_ref: "law_agent/prompts/p_文件转换.hbs"
  functions:
    - "Func_文件转换"
  llm_config:
    temperature: 0.1
    max_turns: 10
```

#### 提示词模板

**文件路径**: `data/yaml/law_agent/prompts/p_文件转换.hbs`

```handlebars
# Role
你是一名文件格式转换助手。

# 待转换文件列表
{{inputs.pending_files.[0].content}}

# Task
对上述列表中的每个文件，调用 file_to_markdown 函数进行转换（每个文件单独调用一次）。

# Output Format
所有文件转换完成后，输出 JSON 结果：
```json
{
  "conversions": [
    {"sourceFilename": "1.pdf", "targetFilename": "1.md"}
  ]
}
```
其中 targetFilename 为 API 返回的 targetFilename 字段值。如果没有文件需要转换，输出空数组。
```

**要点**：
- `on_result: api_call: classification` 将 `{"conversions": [...]}` 发送给 Data Server，后者负责更新 metadata（P##→X##，注册新 U##）
- `targetFilename` 由 Data Server 自动推导，LLM 只需传 `sourceFilename`

### 12.4 文档分类技能

**文件路径**: `data/yaml/law_agent/skills/s_文档分类.yaml`

```yaml
type: "skill"
id: "Skill_文档分类"
alias: "s00"
name: "案卷智能分类"
version: "5.0.0"
description: |
  对案件中类型为"未分类文档"（U## 前缀）的文件进行智能分类。
  将 U## 升级为 R##（相关）或 X##（无关）。
  此技能自动注入所有未分类文档，无需指定 inputs。

inputs:
  - name: "unclassified_files"
    system: "files_by_type"
    filter: "未分类文档"         # 只注入 U## 系列文件（含内容预览）
    required: false

on_result:
  - type: "api_call"
    endpoint: "classification"  # 分类完成后通知 Data Server 重命名 ID

task:
  prompt_ref: "law_agent/prompts/p_案件初始化.hbs"
  llm_config:
    temperature: 0.1
    max_tokens: 1024
```

**提示词模板**（`p_案件初始化.hbs`）读取 `{{inputs.unclassified_files.[0].content}}`，内容包含文件名、类型和内容预览，输出：

```json
{
  "classifications": [
    { "filename": "1.md", "type": "民事起诉状" }
  ]
}
```

### 12.5 Analyser 规划规则

`p_analyser.hbs` 中定义了前置处理规则，Analyser 会自动识别文件状态并规划执行顺序：

```
存在 P##（待转换文档）→ 先执行 Skill_文件转换(inputs:[])
存在 U##（未分类文档）→ 先执行 Skill_文档分类(inputs:[])
两者都有时的典型顺序：
  Skill_文件转换(inputs:[]) → Skill_文档分类(inputs:[]) → [后续分析技能]
```

> **注意**：使用 `system: "files_by_type"` 的技能，Analyser 在生成计划时 **inputs 必须留空 `[]`**，框架会自动注入数据。

---

## 13. 常见问题 (FAQ)

**Q: YAML 格式注意事项？**
A: YAML 严禁使用 Tab 键缩进，**必须使用空格**。建议使用 VS Code 等编辑器，它会自动处理缩进和语法高亮。

**Q: Prompt 调试建议？**
A: 
1. **角色明确**：在 Prompt 开头明确定义 AI 的角色（如“由资深法官”、“专业书记员”）。
2. **示例引导 (Few-Shot)**：给出一两个“输入 -> 输出”的示例，能显著提高效果。
3. **结构清晰**：使用 Markdown 标题 (#) 分隔不同部分的指令。

**Q: `alias` 有什么用？**
A: `alias` 是短别名，支持 CLI 快捷调用。例如技能 `alias: "s01"` 可通过 `/s01` 触发，任务 `alias: "t01"` 可通过 `/t01` 触发。框架通过 ID、alias、name、文件路径四种方式匹配命令目标。

**Q: `calling_name` 是什么？**
A: `calling_name` 是函数在 LLM function calling 中使用的名称。Gemini 等 LLM API 要求函数名为纯 ASCII（字母、数字、下划线等），而函数 `id` 可以包含中文（如 `Func_法条检索`）。因此需要通过 `calling_name` 指定一个英文名（如 `law_lookup`）。未设置时回退到 `id`。

**Q: 如何测试新技能？**
A:
1. 保存所有配置文件。
2. 运行 Client (`./scripts/run_client.sh`)。
3. 在交互菜单中选择新添加的技能，按提示操作即可。
