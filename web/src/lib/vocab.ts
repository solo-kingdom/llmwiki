/**
 * Vocabulary: the single place for user-visible status words, tones and shared copy.
 * Project-owned after install — add your domain statuses here; pages never pick a tone themselves.
 */
export type Tone = "neutral" | "info" | "success" | "warning" | "danger"
export type StatusEntry = { label: string; tone: Tone; pulse?: boolean | undefined }

export const vocab = {
  locale: "zh-CN",
  timeZone: undefined as string | undefined, // undefined = the browser's zone
  statuses: {
    active: { label: "启用", tone: "success" },
    archived: { label: "已归档", tone: "neutral" },
    system: { label: "系统", tone: "neutral" },
    inactive: { label: "停用", tone: "neutral" },
    disabled: { label: "已禁用", tone: "neutral" },
    pending: { label: "等待中", tone: "neutral" },
    ready: { label: "就绪", tone: "success" },
    processing: { label: "处理中", tone: "info", pulse: true },
    queued: { label: "排队中", tone: "neutral" },
    running: { label: "运行中", tone: "info", pulse: true },
    succeeded: { label: "成功", tone: "success" },
    ok: { label: "正常", tone: "success" },
    failed: { label: "失败", tone: "danger" },
    error: { label: "错误", tone: "danger" },
    canceled: { label: "已取消", tone: "neutral" },
    cancelled: { label: "已取消", tone: "neutral" },
    planning: { label: "规划中", tone: "info", pulse: true },
    ready_for_review: { label: "待评审", tone: "warning" },
    revising: { label: "修订中", tone: "info", pulse: true },
    approved: { label: "已批准", tone: "success" },
    applying: { label: "应用中", tone: "info", pulse: true },
    create: { label: "新建", tone: "neutral" },
    update: { label: "更新", tone: "info" },
    delete: { label: "删除", tone: "danger" },
    restore: { label: "恢复", tone: "warning" },
    entity: { label: "实体", tone: "info" },
    concept: { label: "概念", tone: "info" },
    source: { label: "来源", tone: "neutral" },
    synthesis: { label: "综合", tone: "info" },
    comparison: { label: "对比", tone: "info" },
    query: { label: "问题", tone: "neutral" },
    experience: { label: "经验", tone: "success" },
    ledger: { label: "台账", tone: "info" },
    page: { label: "页面", tone: "neutral" },
    template: { label: "模板", tone: "neutral" },
    draft: { label: "草稿", tone: "neutral" },
    validated: { label: "已验证", tone: "success" },
    deprecated: { label: "已废弃", tone: "warning" },
    high: { label: "高置信", tone: "success" },
    medium: { label: "中置信", tone: "info" },
    low: { label: "低置信", tone: "warning" },
    practice: { label: "最佳实践", tone: "success" },
    pitfall: { label: "踩坑", tone: "warning" },
    pattern: { label: "模式", tone: "info" },
    overdue: { label: "复审逾期", tone: "warning" },
    warning: { label: "需关注", tone: "warning" },
    unknown: { label: "未知", tone: "neutral" },
  } satisfies Record<string, StatusEntry> as Record<string, StatusEntry>,
  copy: {
    /** Never presents the loaded count as the total. */
    count: (loaded: number, { total, more = false, capped = false }: { total?: number | undefined; more?: boolean; capped?: boolean } = {}) =>
      total !== undefined && total > loaded ? `已加载 ${loaded} / 共 ${total} 项`
      : total !== undefined ? `共 ${total} 项`
      : more ? `已加载 ${loaded} 项，还有更多`
      : capped ? `已加载 ${loaded} 项（已达接口上限，请筛选）`
      : `共 ${loaded} 项`,
    loadMore: "加载更多",
    loadingMore: "加载中…",
    /** Page-number paging (DataTable `{ mode: "pages" }`). */
    previousPage: "上一页",
    nextPage: "下一页",
    pageOf: (page: number, pageCount: number) => `第 ${page} / 共 ${pageCount} 页`,
    pageSize: "每页",
    totalItems: (total: number) => `共 ${total} 项`,
    retry: "重试",
    errorTitle: "加载失败",
    emptyTitle: "暂无数据",
    noResults: (query: string) => `没有匹配“${query}”的结果`,
    clearFilters: "清除筛选",
    confirm: "确认",
    cancel: "取消",
    delete: "删除",
    copy: "复制",
    copied: "已复制",
    more: "更多操作",
    saved: "已保存",
    undo: "撤销",
    notFoundTitle: "页面不存在",
    notFoundBody: "链接可能已失效，或该内容已被删除。",
    backHome: "返回首页",
    crashTitle: "页面出错了",
    typeToConfirm: (name: string) => `输入“${name}”以确认`,
  },
}

export function statusEntry(status: string): StatusEntry {
  return vocab.statuses[status] ?? { label: status, tone: "neutral" }
}
