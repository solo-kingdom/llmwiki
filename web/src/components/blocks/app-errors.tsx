/** Route-level error element and 404 page. Wire RouteError as the router's errorElement. */
import { FileQuestionIcon, TriangleAlertIcon } from "lucide-react"
import { isRouteErrorResponse, useRouteError } from "react-router"
import { Button } from "@/components/ui/button"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { AppLink } from "@/components/blocks/router"
import { errorMessage } from "@/components/blocks/state-boundary"
import { ScrollRegion } from "@/components/blocks/surfaces"
import { vocab } from "@/lib/vocab"

export function NotFound({ homeTo = "/" }: { homeTo?: string | undefined }) {
  return (
    <ScrollRegion>
    <Empty data-state="not-found" className="m-auto border-0">
      <EmptyHeader>
        <EmptyMedia variant="icon"><FileQuestionIcon /></EmptyMedia>
        <EmptyTitle><h1>{vocab.copy.notFoundTitle}</h1></EmptyTitle>
        <EmptyDescription>{vocab.copy.notFoundBody}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent><Button asChild variant="outline" size="sm"><AppLink to={homeTo}>{vocab.copy.backHome}</AppLink></Button></EmptyContent>
    </Empty>
    </ScrollRegion>
  )
}

export function RouteError() {
  const error = useRouteError()
  if (isRouteErrorResponse(error) && error.status === 404) return <NotFound />
  return (
    <ScrollRegion>
    <Empty className="m-auto border-0" role="alert">
      <EmptyHeader>
        <EmptyMedia variant="icon" className="text-destructive"><TriangleAlertIcon /></EmptyMedia>
        <EmptyTitle><h1>{vocab.copy.crashTitle}</h1></EmptyTitle>
        <EmptyDescription className="break-words">{isRouteErrorResponse(error) ? `${error.status} ${error.statusText}` : errorMessage(error)}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent><Button variant="outline" size="sm" onClick={() => window.location.reload()}>{vocab.copy.retry}</Button></EmptyContent>
    </Empty>
    </ScrollRegion>
  )
}
