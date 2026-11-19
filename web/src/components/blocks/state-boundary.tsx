/**
 * StateBoundary — one component for loading / error / empty / unconfigured around any query.
 * The skeleton should have the shape of the real content (pass `skeleton`), so nothing jumps.
 */
import * as React from "react"
import { AlertCircleIcon, InboxIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import { vocab } from "@/lib/vocab"

export type QueryLike<T> = {
  isPending: boolean
  isError: boolean
  error: unknown
  data: T | undefined
  refetch?: (() => unknown) | undefined
}

export type EmptySpec = { title?: string | undefined; description?: React.ReactNode | undefined; icon?: React.ReactNode | undefined; action?: React.ReactNode | undefined }

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === "string") return error
  return vocab.copy.errorTitle
}

export function EmptyState({ title = vocab.copy.emptyTitle, description, icon, action }: EmptySpec) {
  return (
    <Empty className="border-0 py-12">
      <EmptyHeader>
        <EmptyMedia variant="icon">{icon ?? <InboxIcon />}</EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        {description !== undefined ? <EmptyDescription>{description}</EmptyDescription> : null}
      </EmptyHeader>
      {action !== undefined ? <EmptyContent>{action}</EmptyContent> : null}
    </Empty>
  )
}

export function ErrorState({ error, onRetry, title = vocab.copy.errorTitle }: { error: unknown; onRetry?: (() => unknown) | undefined; title?: string | undefined }) {
  return (
    <Empty className="border-0 py-12" role="alert">
      <EmptyHeader>
        <EmptyMedia variant="icon" className="text-destructive"><AlertCircleIcon /></EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription className="break-words">{errorMessage(error)}</EmptyDescription>
      </EmptyHeader>
      {onRetry !== undefined ? <EmptyContent><Button variant="outline" size="sm" onClick={() => void onRetry()}>{vocab.copy.retry}</Button></EmptyContent> : null}
    </Empty>
  )
}

export function RowsSkeleton({ rows = 5 }: { rows?: number | undefined }) {
  return (
    <div aria-busy="true" aria-label="loading" className="divide-y">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex h-10 items-center gap-4 px-2">
          <Skeleton className="h-4 flex-1" /><Skeleton className="h-4 w-20" /><Skeleton className="h-4 w-16" />
        </div>
      ))}
    </div>
  )
}

export function StateBoundary<T>({
  query, isEmpty, empty, unconfigured, skeleton, children,
}: {
  query: QueryLike<T>
  /** Defaults to: arrays with length 0. */
  isEmpty?: ((data: T) => boolean) | undefined
  empty?: EmptySpec | undefined
  /** Shown instead of everything else when the feature cannot work yet (missing setup/permission). */
  unconfigured?: React.ReactNode | undefined
  skeleton?: React.ReactNode | undefined
  children: (data: T) => React.ReactNode
}) {
  if (unconfigured !== undefined && unconfigured !== null && unconfigured !== false) return <>{unconfigured}</>
  if (query.isPending) return <>{skeleton ?? <RowsSkeleton />}</>
  if (query.isError) return <ErrorState error={query.error} onRetry={query.refetch} />
  const data = query.data as T
  const emptyCheck = isEmpty ?? ((value: T) => Array.isArray(value) && value.length === 0)
  if (emptyCheck(data)) return <EmptyState {...empty} />
  return <>{children(data)}</>
}
