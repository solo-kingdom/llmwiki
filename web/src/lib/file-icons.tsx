import "@/styles/wiki-tree-icons.css"
import type * as React from "react"
import {
  BookMarkedIcon,
  BookTextIcon,
  BoxIcon,
  CircleHelpIcon,
  FileArchiveIcon,
  FileBracesIcon,
  FileCodeIcon,
  FileIcon,
  FileImageIcon,
  FileMusicIcon,
  FileSpreadsheetIcon,
  FileTextIcon,
  FileTypeIcon,
  FileVideoCameraIcon,
  FolderClosedIcon,
  FolderOpenIcon,
  GlobeIcon,
  LayersIcon,
  LightbulbIcon,
  PresentationIcon,
  ScaleIcon,
  SparklesIcon,
  Table2Icon,
} from "lucide-react"
import { FILE_KIND_CLASS, resolveFileKind, type FileKind, type FileKindInput } from "@/lib/file-kind"

type IconComponent = React.ComponentType<React.SVGProps<SVGSVGElement>>

export type WikiPageIconType =
  | "concept"
  | "entity"
  | "experience"
  | "ledger"
  | "source"
  | "synthesis"
  | "comparison"
  | "query"

const FILE_KIND_ICON: Record<FileKind, IconComponent> = {
  markdown: FileTextIcon,
  html: GlobeIcon,
  video: FileVideoCameraIcon,
  image: FileImageIcon,
  audio: FileMusicIcon,
  pdf: BookTextIcon,
  word: FileTextIcon,
  spreadsheet: FileSpreadsheetIcon,
  presentation: PresentationIcon,
  code: FileCodeIcon,
  data: FileBracesIcon,
  archive: FileArchiveIcon,
  text: FileTypeIcon,
  other: FileIcon,
}

const PAGE_TYPE_ICON: Record<WikiPageIconType, { icon: IconComponent; className: string }> = {
  concept: { icon: LightbulbIcon, className: "wiki-type-icon-concept" },
  entity: { icon: BoxIcon, className: "wiki-type-icon-entity" },
  experience: { icon: SparklesIcon, className: "wiki-type-icon-experience" },
  ledger: { icon: Table2Icon, className: "wiki-type-icon-ledger" },
  source: { icon: BookMarkedIcon, className: "wiki-type-icon-source" },
  synthesis: { icon: LayersIcon, className: "wiki-type-icon-synthesis" },
  comparison: { icon: ScaleIcon, className: "wiki-type-icon-comparison" },
  query: { icon: CircleHelpIcon, className: "wiki-type-icon-query" },
}

const SUBDIR_TO_PAGE_TYPE: Record<string, WikiPageIconType> = {
  concepts: "concept",
  entities: "entity",
  experiences: "experience",
  ledgers: "ledger",
  sources: "source",
  synthesis: "synthesis",
  comparisons: "comparison",
  queries: "query",
}

export type WikiFileIconDoc = FileKindInput & {
  page_type?: string | undefined
  path?: string | undefined
}

function resolvePageIconType(doc: WikiFileIconDoc): WikiPageIconType | null {
  const raw = doc.page_type?.trim().toLowerCase()
  if (raw && raw in PAGE_TYPE_ICON) return raw as WikiPageIconType
  const rel = (doc.relative_path ?? doc.path ?? "").replace(/^\/+/, "")
  const parts = rel.split("/")
  const subdir = (parts[0] === "wiki" ? parts[1] : parts[0])?.toLowerCase() ?? ""
  return SUBDIR_TO_PAGE_TYPE[subdir] ?? null
}

export function WikiPageTypeIcon({ pageType }: { pageType: string }) {
  const entry = PAGE_TYPE_ICON[pageType as WikiPageIconType]
  if (entry === undefined) {
    return <FileTextIcon className="wiki-icon-markdown" aria-hidden="true" />
  }
  const Icon = entry.icon
  return <Icon className={entry.className} aria-hidden="true" />
}

export function WikiFolderIcon({ open }: { open: boolean }) {
  const Icon = open ? FolderOpenIcon : FolderClosedIcon
  return (
    <Icon
      className={open ? "wiki-icon-folder-open" : "wiki-icon-folder"}
      data-state={open ? "open" : "closed"}
      aria-hidden="true"
    />
  )
}

export function WikiFileIcon({
  doc,
  treeAligned = false,
}: {
  doc: WikiFileIconDoc
  treeAligned?: boolean | undefined
}) {
  const kind = resolveFileKind(doc)
  const pageIconType = kind === "markdown" ? resolvePageIconType(doc) : null
  const pageEntry = pageIconType !== null ? PAGE_TYPE_ICON[pageIconType] : undefined
  const Icon = pageEntry?.icon ?? FILE_KIND_ICON[kind]
  const className = pageEntry?.className ?? FILE_KIND_CLASS[kind]

  if (treeAligned) {
    return (
      <span
        className="wiki-tree-file-lead"
        data-file-kind={kind}
        data-page-type={pageIconType ?? undefined}
      >
        <Icon className={className} aria-hidden="true" />
      </span>
    )
  }

  return (
    <Icon
      className={className}
      data-file-kind={kind}
      data-page-type={pageIconType ?? undefined}
      aria-hidden="true"
    />
  )
}
