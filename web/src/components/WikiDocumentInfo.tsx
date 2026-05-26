import { FileText } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import type { Document } from "@/types"

interface WikiDocumentInfoProps {
  doc: Document
}

export function WikiDocumentInfoBar({ doc }: WikiDocumentInfoProps) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-3 text-sm">
      <div className="flex min-w-0 items-center gap-2">
        <div className="rounded-md bg-muted p-1.5">
          <FileText className="h-3.5 w-3.5 text-muted-foreground" />
        </div>
        <span className="truncate font-semibold text-foreground">
          {doc.title || doc.filename}
        </span>
        <span className="hidden truncate font-mono text-xs text-foreground/80 lg:inline">
          {doc.path || "/"}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span className="font-mono lg:hidden">{doc.path || "/"}</span>
        <Separator orientation="vertical" className="hidden h-3 lg:block" />
        <span>{doc.file_type}</span>
        {doc.page_count > 0 && (
          <>
            <Separator orientation="vertical" className="h-3" />
            <span>{doc.page_count} pages</span>
          </>
        )}
        {doc.updated_at && (
          <>
            <Separator orientation="vertical" className="h-3" />
            <span>{new Date(doc.updated_at).toLocaleDateString()}</span>
          </>
        )}
      </div>
      {doc.tags && doc.tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {doc.tags.map((tag) => (
            <Badge key={tag} variant="secondary" className="text-xs">
              {tag}
            </Badge>
          ))}
        </div>
      )}
    </div>
  )
}
