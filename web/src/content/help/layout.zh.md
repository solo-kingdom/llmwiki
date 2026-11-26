## 工作区结构

初始化后的典型布局：

```
~/research/
├── purpose.md          # 研究目标与范围（人与 LLM 共读）
├── rules.md            # Wiki 写作与引用规则
├── wiki/               # LLM 维护的结构化 Markdown
│   ├── overview.md     # 全局总览（系统页）
│   ├── index.md        # 内容目录（系统页，apply 后自动重建）
│   ├── log.md          # 操作日志（系统页）
│   ├── entities/       # 实体（复数 typed 目录）
│   ├── concepts/       # 概念
│   ├── sources/        # 源摘要
│   ├── synthesis/      # 综合分析
│   ├── comparisons/    # 对比分析
│   ├── queries/        # 归档问答
│   └── templates/      # 系统模板（非业务内容）
├── raw/                # 不可变源文件（只读，不在 wiki/ 内）
│   └── sources/
└── .llmwiki/          # 旧版 SQLite 目录（新版不再使用）
```

完整布局与 anti-pattern 见 `docs/workspace-layout.md`（与仓库 canonical 规范一致）。

- **`raw/`**：原始 PDF、笔记、Web 归档等，LLM 只读不写。
- **`wiki/`**：LLM 生成的知识页，按类型分子目录（见下文）。
- **`purpose.md` / `rules.md`**：在 Obsidian 或编辑器中修改；Settings 页可预览并追加「补充规则」。
