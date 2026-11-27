export interface SeedTopicFolder {
  path: string;
  display_name: string;
  description: string;
  sort_order: number;
}

export const SEED_TOPIC_FOLDERS: SeedTopicFolder[] = [
  { path: "system-network", display_name: "系统与网络", description: "收系统、网络与存储主题；不收应用发布流程；后者归工程与交付。", sort_order: 10 },
  { path: "system-network/proxy-dns", display_name: "代理与 DNS", description: "收代理、DNS 解析与故障；不收广义网络配置；相邻组为网络配置。", sort_order: 10 },
  { path: "system-network/network-config", display_name: "网络配置", description: "收网络接口、路由与连通性配置；不收代理规则；后者归代理与 DNS。", sort_order: 20 },
  { path: "system-network/storage-sync", display_name: "存储与同步", description: "收文件存储、备份与同步；不收数据库结构迁移；后者归工程与交付。", sort_order: 30 },
  { path: "system-network/auth-credentials", display_name: "权限与凭据", description: "收权限模型与凭据使用原则；不存真实密钥；认证产品实现归对应产品组。", sort_order: 40 },
  { path: "engineering-delivery", display_name: "工程与交付", description: "收构建、发布与工作区方法；不收业务产品事实；后者归产品与项目。", sort_order: 20 },
  { path: "engineering-delivery/build-deps", display_name: "构建与依赖", description: "收构建工具、编译与依赖问题；不收发布流程；后者归发布与部署。", sort_order: 10 },
  { path: "engineering-delivery/release-deploy", display_name: "发布与部署", description: "收发布、部署与回滚方法；不收本地依赖安装；后者归构建与依赖。", sort_order: 20 },
  { path: "engineering-delivery/git-workspace", display_name: "Git 与工作区", description: "收 Git、worktree 与分支工作流；不收通用项目管理；后者归产品与项目。", sort_order: 30 },
  { path: "engineering-delivery/config-changes", display_name: "配置与变更", description: "收配置契约与变更治理；不收网络参数细节；后者归系统与网络。", sort_order: 40 },
  { path: "ai-agent", display_name: "AI 与 Agent", description: "收模型、上下文与 Agent 通用机制；不收单个产品状态；后者归产品与项目。", sort_order: 30 },
  { path: "ai-agent/models-providers", display_name: "模型与 Provider", description: "收模型、供应商与协议适配；不收具体产品发布；后者归对应产品组。", sort_order: 10 },
  { path: "ai-agent/context-compaction", display_name: "上下文与压缩", description: "收上下文、记忆与压缩机制；不收模型端点配置；后者归模型与 Provider。", sort_order: 20 },
  { path: "ai-agent/agent-runtime", display_name: "Agent 运行时", description: "收 Agent 执行、状态与会话运行时；不收 skill 写作规范；后者归 Skills 与工具。", sort_order: 30 },
  { path: "ai-agent/skills-tools", display_name: "Skills 与工具", description: "收 skill、工具调用与 MCP；不收模型推理机制；后者归模型与 Provider。", sort_order: 40 },
  { path: "products", display_name: "产品与项目", description: "收具体产品、项目及其实体事实；通用可复用机制归对应能力域并保留双向链接。", sort_order: 40 },
  { path: "products/llmwiki", display_name: "llmwiki", description: "收 llmwiki 的产品事实与专属经验；不收通用 Agent 机制；后者归 AI 与 Agent。", sort_order: 10 },
  { path: "data-ads", display_name: "数据与广告", description: "收广告交易、数据管道与接口映射；不收通用软件交付；后者归工程与交付。", sort_order: 50 },
  { path: "data-ads/ad-exchange", display_name: "广告交易", description: "收广告交易业务与机制；不收通用数据管道；后者归数据管道。", sort_order: 10 },
  { path: "data-ads/data-pipelines", display_name: "数据管道", description: "收数据采集、处理与同步管道；不收广告交易规则；后者归广告交易。", sort_order: 20 },
  { path: "data-ads/api-mapping", display_name: "接口与映射", description: "收业务接口、字段与通道映射；不收通用 Provider 协议；后者归模型与 Provider。", sort_order: 30 },
  { path: "knowledge-collab", display_name: "知识与协作", description: "收知识管理、协作与表达方法；不收具体产品档案；后者归产品与项目。", sort_order: 60 },
  { path: "knowledge-collab/knowledge-mgmt", display_name: "知识管理", description: "收知识结构、检索与维护方法；不收 Agent 运行时实现；后者归 AI 与 Agent。", sort_order: 10 },
  { path: "knowledge-collab/collab-interviews", display_name: "协作与面试", description: "收协作流程与面试知识；不收组织商业事实；后者归商业与组织。", sort_order: 20 },
  { path: "knowledge-collab/writing-presentation", display_name: "写作与呈现", description: "收写作、可视化与呈现方法；不收知识存储结构；后者归知识管理。", sort_order: 30 },
  { path: "business-org", display_name: "商业与组织", description: "收公司、人物、组织与商业规则；不收项目技术实现；后者归产品与项目。", sort_order: 70 },
  { path: "business-org/companies-people", display_name: "公司与人物", description: "收可唯一指代的公司与人物；不收抽象组织方法；后者归组织方法。", sort_order: 10 },
  { path: "business-org/org-methods", display_name: "组织方法", description: "收可复用组织与管理方法；不收具体公司档案；后者归公司与人物。", sort_order: 20 },
  { path: "business-org/business-rules", display_name: "商业规则", description: "收商业、法务与财务规则；不收广告技术机制；后者归数据与广告。", sort_order: 30 },
];
