import { useState, useMemo } from "react"
import { useWikiReader } from "@/context/WikiReaderContext"
import { WikiEntityList } from "@/components/WikiEntityList"
import { WikiTypeFilter } from "@/components/WikiTypeFilter"
import { buildTree } from "@/lib/tree"
import { ScrollArea } from "@/components/ui/scroll-area"
import type { TreeNode } from "@/types"

function FolderIcon({ open }: { open: boolean }) {
  return open ? (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5 19a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v1" />
      <path d="M20 12H8a2 2 0 0 0-2 2v5a2 2 0 0 0 2 2h12l2-9z" />
    </svg>
  ) : (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
    </svg>
  )
}

function FileIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
    </svg>
  )
}

function TreeNodeItem({
  node,
  depth,
  activeId,
  onSelect,
}: {
  node: TreeNode
  depth: number
  activeId: string | null
  onSelect: (id: string) => void
}) {
  const [open, setOpen] = useState(true)

  if (node.isFolder) {
    return (
      <div>
        <button
          onClick={() => setOpen(!open)}
          className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-sm hover:bg-muted cursor-pointer"
          style={{ paddingLeft: `${depth * 12 + 8}px` }}
        >
          <ChevronIcon open={open} />
          <FolderIcon open={open} />
          <span className="truncate">{node.name}</span>
        </button>
        {open && (
          <div>
            {node.children.map((child) => (
              <TreeNodeItem
                key={child.path}
                node={child}
                depth={depth + 1}
                activeId={activeId}
                onSelect={onSelect}
              />
            ))}
          </div>
        )}
      </div>
    )
  }

  const isActive = node.doc?.id === activeId

  return (
    <button
      onClick={() => node.doc && onSelect(node.doc.id)}
      className={`flex w-full items-center gap-1.5 rounded px-2 py-1 text-sm cursor-pointer ${
        isActive
          ? "bg-primary text-primary-foreground"
          : "hover:bg-muted"
      }`}
      style={{ paddingLeft: `${depth * 12 + 8}px` }}
    >
      <span className="w-4 shrink-0" />
      <FileIcon />
      <span className="truncate">{node.name}</span>
    </button>
  )
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 transition-transform ${open ? "" : "-rotate-90"}`}
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  )
}

interface SidebarProps {
  variant?: "classic" | "reader"
  onSelect?: () => void
}

export function Sidebar({ variant = "classic", onSelect }: SidebarProps) {
  const { filteredDocuments, currentDocId, selectDocument } = useWikiReader()
  const tree = useMemo(() => buildTree(filteredDocuments), [filteredDocuments])
  const isReader = variant === "reader"

  const handleSelect = (id: string) => {
    selectDocument(id)
    onSelect?.()
  }

  return (
    <div
      className={
        isReader
          ? "flex h-full w-full flex-col"
          : "flex h-full w-64 flex-col border-r bg-card"
      }
    >
      <WikiTypeFilter />
      <WikiEntityList onSelect={onSelect} />
      <div className="border-b px-3 py-2">
        <p className="text-xs text-muted-foreground">
          {filteredDocuments.length} pages
        </p>
      </div>
      <ScrollArea className="flex-1">
        <div className="py-1">
          {tree.map((node) => (
            <TreeNodeItem
              key={node.path}
              node={node}
              depth={0}
              activeId={currentDocId}
              onSelect={handleSelect}
            />
          ))}
          {tree.length === 0 && (
            <p className="px-3 py-4 text-xs text-muted-foreground text-center">
              No documents found
            </p>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
