## Context

当前系统的 Provider 配置分为三层：
1. **Catalog 层**（`provider_info_cache` + `provider_models_cache`）：从 models.dev 同步的只读 provider 目录，包含 18+ 个 provider 及其模型元数据
2. **Key 层**（`provider_keys` 表）：每 provider 最多一条记录，存 API key 和可选 base URL 覆盖
3. **引用层**（`ingest_sessions.llm_provider`、`app_config.last_provider`）：存 provider_id 字符串

问题：
- Settings 页面平铺所有 18+ provider 的 key 配置表单，认知负担大
- 每个 provider 只能存一个 key，无法支持多账号场景（如工作 OpenAI + 个人 OpenAI）
- Chat 模型选择器列出所有 provider，大量未配置的带 ⚠ 干扰选择

## Goals / Non-Goals

**Goals:**
- 引入"Provider 实例"概念：用户主动添加、可命名的 provider 配置单元
- 同一 provider 类型可添加多个实例（不同 key/URL/名称）
- Settings 从"平铺全部"改为"我的列表 + 添加"模式
- Chat 选择器只展示已添加的实例
- 编辑实例时允许更改 provider 类型，保留 API key

**Non-Goals:**
- 不做数据迁移（clean break）
- 不做实例排序/拖拽
- 不做实例分组或标签
- 不做 provider catalog 的自定义管理（仍从 models.dev 同步）
- 不做 onboarding 引导流程（后续可迭代）

## Decisions

### D1: 实例 ID 格式为 `inst_` + UUID 前 8 位

**选择**: `inst_` + `uuid.New().String()[:8]`，例：`inst_550e8400`

**理由**:
- 项目已依赖 `github.com/google/uuid`，无需引入新依赖
- 8 位十六进制在用户量级下碰撞概率可忽略
- 前缀 `inst_` 保证 URL 路径可读性和类型区分

**备选**:
- 纯 UUID（`550e8400-...`）：与现有 session ID 风格一致，但缺少类型前缀
- nanoid（`inst_k3Fm9xPq`）：需新依赖，收益不大

### D2: 数据模型 — 新表替代旧表

新增 `provider_instances` 表，完全替代 `provider_keys` 表：

```sql
CREATE TABLE provider_instances (
    id TEXT PRIMARY KEY,           -- inst_xxxxxxxx
    name TEXT NOT NULL,            -- 用户自定义名称
    catalog_id TEXT NOT NULL,      -- → provider_info_cache.id
    api_key TEXT NOT NULL DEFAULT '',
    base_url TEXT NOT NULL DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);
```

引用方变更：
- `ingest_sessions.llm_provider` → `llm_instance_id`
- `app_config.last_provider` → `last_instance_id`

**理由**: 干净的三层分离 — catalog（只读目录）、instances（用户配置）、references（使用方）

### D3: 编辑实例时允许改类型，key 不动，模型失效懒处理

**选择**: 编辑时 `catalog_id` 可改，`api_key` 保留不变。已有 session 的 `llm_model` 不批量更新，UI 层检测 model 不在当前 provider 的模型列表中时提示重选。

**理由**:
- key 不动：避免用户误操作丢失 key，且 key 可能恰好通用（如代理场景）
- 懒处理模型失效：避免复杂的批量更新逻辑和级联影响，UI 层自然解决
- 简单可靠，无数据不一致风险

### D4: API 设计 — 新增 instance CRUD，废弃 provider-keys endpoint

```
新增:
POST   /api/v1/provider-instances        创建实例
GET    /api/v1/provider-instances        列出所有实例
GET    /api/v1/provider-instances/{id}    获取单个实例
PUT    /api/v1/provider-instances/{id}    更新实例
DELETE /api/v1/provider-instances/{id}    删除实例

不变:
GET    /api/v1/providers                  catalog 列表（给添加表单的下拉用）
GET    /api/v1/providers/{id}/models      catalog 里某 provider 的模型列表

废弃:
PUT    /api/v1/settings/provider-keys/{id}
```

**理由**: 实例是独立资源，应有自己的 RESTful endpoint，而不是挂在 settings 下面。

### D5: Settings UI — 列表 + inline 添加/编辑表单

**选择**: 方案 B — 顶部有 `[+ 添加]` 按钮，点击展开 inline 表单（类型下拉 + 名称输入 + key 输入 + URL 输入）。已有实例以卡片列表展示，每项有编辑和删除按钮。

**理由**: 
- 单页面完成所有操作，无需弹窗或新路由
- 表单收起时不占空间，列表紧凑
- 与 Processing 设置卡片视觉风格一致

**命名默认值**: 添加时名称字段预填选中 provider 的 display name，用户可修改。

### D6: Chat 选择器 — 实例下拉 + 模型下拉

**选择**: 方案 C — 两个下拉框，第一个是已添加的实例列表（不是 catalog provider），第二个是该实例对应 provider 的模型列表。

**理由**: 与现有 UX 一致（两个下拉），只是数据源从 catalog provider 变为用户实例。

### D7: LLM 客户端创建逻辑变更

现有 `providerLLMClient(provider, model)` 改为 `instanceLLMClient(instanceID, model)`：

```
1. 从 provider_instances 表查 instance (key, base_url, catalog_id)
2. 从 provider_info_cache 表查 catalog (api_format, api_base)
3. 组装 llm.Config:
   - Provider: catalog.api_format (openai/anthropic/ollama)
   - BaseURL: instance.base_url 优先，否则 catalog.api_base
   - APIKey: instance.api_key（不再有 env fallback）
   - Model: model 参数
```

**注意**: 去掉 env fallback。用户必须通过 UI 显式添加实例并填 key。

## Risks / Trade-offs

- **[Breaking change]** `provider_keys` 表废弃，`llm_provider` 字段语义变化 → 不做迁移，接受全新开始
- **[模型失效]** 改类型后 session 的 model 可能无效 → 懒处理，UI 层检测并提示重选
- **[无 env fallback]** 去掉环境变量回退路径 → 用户必须通过 UI 配置，降低隐式行为的复杂性
- **[删除实例]** 正在使用的实例被删除 → 不限制删除，session 保留但无法对话，用户下次打开时需重新选择
