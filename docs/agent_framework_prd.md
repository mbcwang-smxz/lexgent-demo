# Agent Framework 产品需求文档 (PRD)

> **版本**: 1.2
> **状态**: Draft
> **日期**: 2026-01-25

## 1. 概述 (Executive Summary)

### 1.1 目标 (Goal)
将 `lawagent-js` 从一个硬编码的法律 Agent 转型为**通用 Agent 框架**。
核心目标是实现 **"非程序员定义 Agent"**：领域专家（如律师、医生）应能通过配置文件（YAML/JSON）和 Prompt 模板定义新的 Agent 和 Skill，无需修改 TypeScript 源码。

### 1.2 目标受众 (Target Audience)
*   **领域专家**: 通过编写 Prompt 和配置文档来定义业务逻辑。
*   **Agent 开发者**: 专注于框架引擎开发和复杂的 "Code Skills"（插件）。

---

## 2. 用户故事 (User Stories)

### 故事 1: 零代码技能创建者
**作为一名** 资深律师，
**我希望** 能通过编写 Prompt 并指定输入/输出文件名来添加一个新的"合同风险审查"技能，
**这样** 我就可以在不依赖工程师写代码的情况下扩展 Agent 能力。

### 故事 2: Agent 组装者
**作为一名** 解决方案架构师，
**我希望** 能通过在配置文件中列出现有技能的子集，来组装一个新的"婚姻家事 Agent"，
**这样** 我可以快速部署针对不同领域的专用 Agent。

### 故事 3: 插件开发者
**作为一名** 软件工程师，
**我希望** 能用 TypeScript 编写复杂的"文件加密技能"并在 YAML 中注册，
**这样** 框架可以在 LLM 无法胜任时利用代码执行能力。

---

## 3. 技术规格 (Technical Specifications)

框架主要包含以下配置实体：**Agent (智能体)**，**Skill (技能)**，**Prompt (提示词)**，**Document Type (文档类型)**。

### 3.1 Manifest 文件通用规范

所有 Manifest 文件必须包含 `type` 字段以声明其类型：
```yaml
type: "agent"    # 或 "skill" 或 "prompt" 或 "document_type"
```

### 3.2 资源路径解析机制

所有资源（Skills、Prompts 等）均使用**逻辑模块路径**引用，而非文件系统路径。

#### 3.2.1 本地文件加载

**配置 (`settings.yaml`):**
```yaml
framework:
  base_dir: "./data/yaml"  # 模块根目录
```

**解析规则:**
| 资源类型 | 模块路径示例 | 解析结果 |
| :--- | :--- | :--- |
| Agent | `law_agent` | `${base_dir}/law_agent/agent.yaml` |
| Skill | `law_agent/s01_party_extraction` | `${base_dir}/law_agent/s01_party_extraction/skill.yaml` |
| Prompt | `law_agent/prompts/party_extraction` | `${base_dir}/law_agent/prompts/party_extraction.hbs` |
| Document Type | `law_agent/types/legal_documents` | `${base_dir}/law_agent/types/legal_documents.yaml` |

**目录结构示例:**
```
data/yaml/
├── law_agent/                           # 法律 Agent 模块
│   ├── agent.yaml                       # Agent 清单
│   ├── s01_party_extraction/
│   │   └── skill.yaml                   # Skill 清单
│   ├── s02_claim_analysis/
│   │   └── skill.yaml
│   ├── prompts/                         # Prompt 库
│   │   ├── party_extraction.hbs
│   │   ├── evidence_analysis.hbs
│   │   └── ...
│   ├── types/                           # 文档类型定义
│   │   └── legal_documents.yaml
│   └── workers/                         # Code Skill 实现
│       └── file_cleanup.ts
├── medical_agent/                       # 医疗 Agent 模块
│   └── ...
```

#### 3.2.2 远程 REST API 加载

资源也可以通过 REST API 获取，使用 `endpoint://` 协议前缀：

```yaml
skills:
  - "law_agent/s01_party_extraction"                    # 本地加载
  - "endpoint://skills/contract_review"                 # 远程加载
```

**配置:**
```yaml
framework:
  remote_endpoint: "http://config-server.example.com/api/v1"
```

**解析规则:**
| 模块路径 | 请求 URL |
| :--- | :--- |
| `endpoint://skills/contract_review` | `GET ${remote_endpoint}/skills/contract_review` |
| `endpoint://prompts/risk_analysis` | `GET ${remote_endpoint}/prompts/risk_analysis` |

**响应格式**: 返回 JSON 格式的 Manifest 内容。

---

### 3.3 文档类型注册表 (Document Type Registry)

**问题**: Skill 中使用的各种文件类型 (如 `民事起诉状`、`当事人信息`) 定义在哪里？

**设计方案**: 集中定义在 **Document Type Manifest** 中，供 Skill 的 `inputs`/`outputs` 引用。

#### 3.3.1 Document Type 清单 (`document_type.yaml`)

| 字段 | 类型 | 必填 | 说明 |
| :--- | :--- | :---: | :--- |
| `type` | `"document_type"` | ✅ | 清单类型标识。 |
| `name` | string | ✅ | 类型注册表名称。 |
| `version` | string | ✅ | 版本号。 |
| `types` | array | ✅ | 文档类型定义列表。 |

**每个 `types` 条目:**
| 字段 | 类型 | 必填 | 说明 |
| :--- | :--- | :---: | :--- |
| `id` | string | ✅ | 类型唯一标识 (如 `complaint`, `party_info`)。 |
| `name` | string | ✅ | 显示名称 (如 `民事起诉状`)。 |
| `category` | enum | ✅ | `raw` (原始文档) 或 `derived` (衍生文档)。 |
| `format` | enum | ❌ | `text` / `json` / `markdown` / `pdf`。 |
| `description` | string | ❌ | 类型说明。 |
| `schema_path` | string | ❌ | JSON Schema 路径 (用于校验输出)。 |

**示例:**
```yaml
type: "document_type"
name: "法律文书类型注册表"
version: "1.0.0"

types:
  # ===== 原始文档 (Raw) =====
  - id: "complaint"
    name: "民事起诉状"
    category: "raw"
    format: "text"
    description: "原告提交的起诉状文书。"

  - id: "defense"
    name: "答辩状"
    category: "raw"
    format: "text"
    description: "被告提交的答辩状文书。"

  - id: "evidence_list"
    name: "证据目录"
    category: "raw"
    format: "text"

  - id: "trial_record"
    name: "庭审笔录"
    category: "raw"
    format: "text"

  # ===== 衍生文档 (Derived) =====
  - id: "party_info"
    name: "当事人信息"
    category: "derived"
    format: "json"
    description: "从起诉状等材料提取的结构化当事人画像。"
    schema_path: "law_agent/schemas/party_info.json"

  - id: "claims_analysis"
    name: "诉求与答辩信息"
    category: "derived"
    format: "json"

  - id: "evidence_analysis"
    name: "证据分析报告"
    category: "derived"
    format: "json"

  - id: "issue_framing"
    name: "争议焦点信息"
    category: "derived"
    format: "json"

  - id: "judgment_draft"
    name: "裁判文书草稿"
    category: "derived"
    format: "markdown"
```

---

### 3.4 文件注册表与 ID 机制 (File Registry & ID Mechanism)

**问题**: Analyser 输出的 `inputs: ["R01", "R02"]` 中的 ID 是如何产生和管理的？

#### 3.4.1 文件 ID 命名规则

| ID 前缀 | 说明 | 来源 |
| :--- | :--- | :--- |
| `R` + 序号 | 原始文档 (Raw) | 用户上传时自动分配 |
| `D` + 序号 | 衍生文档 (Derived) | Skill 执行后自动分配 |

**示例:**
- `R01` → 第一份上传的原始文档（如起诉状）
- `R02` → 第二份上传的原始文档（如答辩状）
- `D01` → 第一份生成的衍生文档（如当事人信息）

#### 3.4.2 文件注册表数据结构 (File Registry)

每个文件在系统中对应一个 `FileRegistryItem`：

```yaml
# 文件注册表条目结构
file_registry_item:
  id: "R01"                           # 逻辑 ID
  type: "民事起诉状"                   # 文档类型（引用 document_type 中的 name）
  filename: "张三诉李四民间借贷纠纷_起诉状.txt"
  path: "/data/.runs/case-101/张三诉李四民间借贷纠纷_起诉状.txt"
  case_id: "case-101"
  last_modified: "2026-01-25T10:00:00Z"
  metadata:                            # 扩展元数据（可选）
    page_count: 3
    ocr_processed: true
```

#### 3.4.3 ID 自动分配机制

当用户上传文件或 Skill 生成输出时，系统自动分配 ID：

1. **原始文档上传**:
   - 扫描工作目录中的物理文件
   - 对于未注册的文件，按 `R01, R02, ...` 顺序分配 ID
   - 初始 `type` 标记为 `"未分类文档"`

2. **自动分类** (Skill_案件初始化):
   - 解析文档内容，识别其属于哪种法律文书类型
   - 更新 `type` 字段为具体类型（如 `民事起诉状`）

3. **衍生文档生成**:
   - Skill 输出文件按 `D01, D02, ...` 分配 ID
   - 文件名遵循模板（如 `D01_当事人信息.json`）
   - `type` 由 Skill Manifest 的 `outputs.type_ref` 定义

#### 3.4.4 Analyser 如何获取文件列表

Orchestrator 在调用 Analyser 前，从 Data Server 获取当前案件的文件列表摘要，并注入到 Analyser 的 System Prompt 中：

**注入格式:**
```
当前已存在文档：
- R01: 张三诉李四起诉状.txt (民事起诉状)
- R02: 李四答辩状.txt (答辩状)
- R03: 证据清单.txt (证据目录)
- D01: D01_当事人信息.json (当事人信息)
```

Analyser 根据此列表规划任务，并在 `inputs` 字段中引用文件 ID。

---

### 3.5 案件上下文数据结构 (Case Context)

**问题**: Metadata 中具体有哪些内容？

基于当前系统源码分析，`CaseContextData` 包含以下结构：

```yaml
# 案件上下文数据结构
case_context:
  case_id: "case-101"                 # 案件标识（系统内部 ID）
  
  files:                               # 文件注册表
    R01:
      id: "R01"
      type: "民事起诉状"
      filename: "起诉状.txt"
      path: "/path/to/file"
      last_modified: "2026-01-25T10:00:00Z"
    R02:
      id: "R02"
      type: "答辩状"
      # ...
    D01:
      id: "D01"
      type: "当事人信息"
      # ...

  metadata:                            # 案件元数据
    case_number: "（2024）京01民初123号"   # 案号
    cause_of_action: "民间借贷纠纷"        # 案由
    stage: "庭前准备"                     # 案件阶段
    created_at: "2026-01-25T08:00:00Z"
    # 可选扩展字段
    parties:
      plaintiff: ["张三"]
      defendant: ["李四"]
    court: "北京市第一中级人民法院"
```

---

### 3.6 Agent 清单 (`agent.yaml`)

| 字段 | 类型 | 必填 | 说明 |
| :--- | :--- | :---: | :--- |
| `type` | `"agent"` | ✅ | 清单类型标识。 |
| `name` | string | ✅ | Agent 显示名称。 |
| `description` | string | ✅ | 系统提示词中使用的高层描述。 |
| `version` | string | ✅ | 语义化版本号。 |
| `model` | object | ✅ | 默认 LLM 配置。 |
| `document_types` | string | ❌ | 文档类型注册表模块路径。 |
| `skills` | string[] | ✅ | Skill 模块路径列表。 |
| `settings` | object | ❌ | 全局运行时设置。 |
| `metadata` | object | ❌ | Agent 级别元数据。 |

**示例:**
```yaml
type: "agent"
name: "民事诉讼 Agent"
version: "2.0.0"
description: "辅助处理民事案件分析与文书起草。"

model:
  provider: "gemini"
  name: "gemini-pro"

document_types: "law_agent/types/legal_documents"

skills:
  - "law_agent/s01_party_extraction"
  - "law_agent/s02_claim_analysis"
  - "law_agent/s09_doc_assembly"
  - "endpoint://skills/external_law_search"    # 远程 Skill

settings:
  timeout: 60000
  context_refresh_strategy: "per_turn"

metadata:
  domain: "法律"
  sub_domain: "民事诉讼"
```

---

### 3.7 Skill 清单 (`skill.yaml`)

| 字段 | 类型 | 必填 | 说明 |
| :--- | :--- | :---: | :--- |
| `type` | `"skill"` | ✅ | 清单类型标识。 |
| `id` | string | ✅ | 唯一标识符 (例如 `Skill_当事人提取`)。 |
| `name` | string | ✅ | 技能名称。 |
| `description` | string | ✅ | Analyser 调度指南。 |
| `version` | string | ✅ | 语义化版本号。 |
| `execution_type` | enum | ✅ | `llm` 或 `code`。 |
| `inputs` | array | ✅ | 输入定义。 |
| `outputs` | array | ✅ | 输出定义。 |
| `prompt` | object | ❌ | Prompt 引用（LLM Skill）。 |
| `execution` | object | ❌ | 执行配置（Code Skill）。 |
| `llm_config` | object | ❌ | LLM 参数覆盖。 |

**示例 (LLM Skill):**
```yaml
type: "skill"
id: "Skill_当事人提取"
name: "当事人信息提取"
version: "1.0.0"
execution_type: "llm"
description: |
  从起诉状等初始文件中提取原告与被告详细信息。
  适用场景: 案件初始化阶段。
  关键依赖: 至少一份起诉状性质的文书。

inputs:
  - name: "source_docs"
    type_ref: "complaint"
    required: true
    description: "起诉状或初始立案材料。"
    resolution:
      strategy: "pattern"
      patterns:
        - "type:民事起诉状"
        - "type:反诉状"

outputs:
  - id: "D01"
    type_ref: "party_info"
    filename_template: "D01_当事人信息.json"
    description: "结构化当事人画像。"

prompt:
  path: "law_agent/prompts/party_extraction"    # 逻辑模块路径

llm_config:
  temperature: 0.1
  max_tokens: 4096
```

**示例 (Code Skill):**
```yaml
type: "skill"
id: "Skill_文件维护"
name: "文件清理"
version: "1.0.0"
execution_type: "code"
description: "删除指定模式的文件。"

inputs:
  - name: "patterns"
    type: "string[]"
    required: true
    description: "要删除的文件匹配模式。"

outputs: []

execution:
  worker_path: "law_agent/workers/file_cleanup"  # 逻辑模块路径
```

---

### 3.8 Prompt 定义

#### 3.8.1 引用方式

Prompt 通过逻辑模块路径引用：
```yaml
prompt:
  path: "law_agent/prompts/party_extraction"
```

也支持内联定义（适用于简单 Prompt）：
```yaml
prompt:
  template: |
    # Role
    你是一个法律书记员...
```

也支持远程加载：
```yaml
prompt:
  path: "endpoint://prompts/advanced_reasoning"
```

**优先级**: 若同时定义，`path` 优先于 `template`。

#### 3.8.2 Prompt 模板变量

Prompt 使用 Handlebars 语法，可用变量：

| 变量 | 说明 |
| :--- | :--- |
| `{{instruction}}` | 来自 Analyser 的具体指令。 |
| `{{inputs.<name>}}` | 解析后的输入内容 (按 `inputs[].name`)。 |
| `{{case.metadata}}` | 案件元数据。 |
| `{{case.case_number}}` | 案号。 |
| `{{agent.name}}` | Agent 名称。 |

---

### 3.9 输入解析机制 (Input Resolution)

**设计方案**: 两阶段解析

#### 阶段 1: Analyser 规划

Analyser 收到的 System Prompt 中包含当前案件的文件列表（见 3.4.4）。

Analyser 根据用户指令和上下文，输出执行计划：
```json
{
  "status": "PLAN",
  "plan": [
    {
      "title": "提取当事人信息",
      "skill_id": "Skill_当事人提取",
      "inputs": ["R01", "R02"],
      "instruction": "提取当事人信息，注意区分第三人。"
    }
  ]
}
```

#### 阶段 2: Orchestrator 解析

Orchestrator 使用 `ContextManager` 将 File ID 解析为完整 `FileRegistryItem`：
- 输入: `["R01", "R02"]`
- 输出: 包含文件内容、路径、类型等信息的完整对象数组

**兜底机制**: 若 Analyser 未指定输入，使用 Skill Manifest 中的 `resolution.patterns` 自动查找：
```yaml
resolution:
  strategy: "pattern"       # pattern | explicit | ask_user
  patterns:
    - "type:民事起诉状"     # 按 Metadata type 匹配
    - "id:R*"               # 按 ID 前缀匹配
    - "filename:*.txt"      # 按文件名匹配
```

---

### 3.10 元数据管理 (Metadata Management)

#### 3.10.1 元数据层级

| 层级 | 存储位置 | 说明 |
| :--- | :--- | :--- |
| **System** | `settings.yaml` | 框架级配置 |
| **Agent** | `agent.yaml` | Agent 身份和能力描述 |
| **Case** | Data Server | 运行时案件上下文（见 3.5） |
| **File** | Data Server | 单文件类型、标签（见 3.4.2） |

#### 3.10.2 Metadata Provider 接口

为支持多种部署场景，框架需定义抽象的元数据访问接口，支持以下实现：

| 实现 | 场景 |
| :--- | :--- |
| REST API Provider | 生产环境，调用 Data Server |
| Local File Provider | 开发/测试，读写本地 JSON |
| In-Memory Provider | 单元测试 |

---

## 4. 迁移策略 (Migration Strategy)

### Phase 1: 基础框架
-   定义 Zod Schemas (Agent/Skill/Prompt/Document Type)
-   实现配置加载器 (Config Loader + Manifest Registry)
-   实现 Prompt 模板引擎
-   实现 Metadata Provider 接口
-   支持 REST API 资源加载

### Phase 2: 并行运行
-   创建 `data/yaml/law_agent/` 目录结构
-   将 `Skill_当事人提取` 移植为 YAML + HBS
-   编写集成测试验证输出一致性

### Phase 3: 完整移植
-   移植剩余 Skills (S02-S14)
-   移植 Analyser Prompt 到配置
-   切换默认入口点

### Phase 4: 清理
-   删除旧硬编码代码
-   更新文档

---

## 5. 附录

### 5.1 术语表

| 术语 | 定义 |
| :--- | :--- |
| Manifest | YAML 格式的配置清单文件。 |
| Skill | 原子能力单元，可由 LLM 或代码执行。 |
| Document Type | 文件类型定义，用于输入/输出校验。 |
| Prompt | 发送给 LLM 的提示词模板。 |
| Module Path | 逻辑模块路径，由框架解析到实际文件或远程 API。 |
| File Registry | 案件文件注册表，管理文件 ID 与元数据的映射。 |

### 5.2 YAML 字段命名规范

本框架中的 YAML 配置文件统一使用 **snake_case** 命名风格：

| 正确 ✅ | 错误 ❌ |
| :--- | :--- |
| `execution_type` | `executionType` |
| `filename_template` | `filenameTemplate` |
| `case_id` | `caseId` |
| `last_modified` | `lastModified` |
