## 数据与逻辑结构

PostgreSQL 是知识库内容、目录树、变更历史（`change_sets` / `page_revisions`）与原始档案（`archives`）的唯一真源：

```text
PostgreSQL SSOT
├── 知识库规则（app_config）
│   ├── 研究目标（Purpose）
│   └── 全局规则（Rules）
├── wiki/                     # 结构化知识页（逻辑路径）
│   ├── overview.md           # 全局金字塔总览
│   ├── <domain>/             # 英文小写 kebab-case 主题域
│   │   ├── _overview.md      # 主题域总览
│   │   └── <group>/          # 主题组
│   │       ├── _overview.md  # 主题组总览
│   │       └── <page>.md     # 知识页
└── archives/                 # 原始档案库（DB inline / local / S3）
```

- **`archives/`**：原始 PDF、笔记、会话附件等，由档案库统一承载。
- **`wiki/`**：按「主题域 → 主题组 → 页面」组织的知识页，`page_type` 只描述页面职责。
- **知识库规则**：在「设置 → 知识库规则」中直接编辑与保存，实时参与摄入、对话与整理提示词。
