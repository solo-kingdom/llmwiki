import "@/styles/wiki-tree-icons.css"
import type * as React from "react"
import {
  BookTextIcon,
  ChevronDownIcon,
  ChevronRightIcon,
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
  PresentationIcon,
} from "lucide-react"
import { FILE_KIND_CLASS, resolveFileKind, type FileKind, type FileKindInput } from "@/lib/file-kind"

type IconComponent = React.ComponentType<React.SVGProps<SVGSVGElement>>

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

export function WikiFolderIcon({ open }: { open: boolean }) {
  return (
    <span className="wiki-tree-folder-lead" data-state={open ? "open" : "closed"}>
      {open ? (
        <ChevronDownIcon className="wiki-tree-chevron" aria-hidden="true" />
      ) : (
        <ChevronRightIcon className="wiki-tree-chevron" aria-hidden="true" />
      )}
      {open ? (
        <FolderOpenIcon className="wiki-icon-folder-open" aria-hidden="true" />
      ) : (
        <FolderClosedIcon className="wiki-icon-folder" aria-hidden="true" />
      )}
    </span>
  )
}

export function WikiFileIcon({
  doc,
  treeAligned = false,
}: {
  doc: FileKindInput
  treeAligned?: boolean | undefined
}) {
  const kind = resolveFileKind(doc)
  const Icon = FILE_KIND_ICON[kind]
  const className = FILE_KIND_CLASS[kind]

  if (treeAligned) {
    return (
      <span className="wiki-tree-file-lead" data-file-kind={kind}>
        <Icon className={className} aria-hidden="true" />
      </span>
    )
  }

  return <Icon className={className} data-file-kind={kind} aria-hidden="true" />
}
