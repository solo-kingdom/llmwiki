/**
 * useConfirm — promise-based confirmation on alert-dialog. Replaces window.confirm.
 * Strength: plain confirm | typeToConfirm (irreversible + affects others). Reversible actions
 * should not confirm at all: do them and offer notify.undo instead.
 */
import * as React from "react"
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Input } from "@/components/ui/input"
import { buttonVariants } from "@/components/ui/button"
import { vocab } from "@/lib/vocab"

export type ConfirmOptions = {
  title: string
  description?: React.ReactNode | undefined
  confirmLabel?: string | undefined
  destructive?: boolean | undefined
  /** Require typing this exact text (e.g. the resource name) before confirming. */
  typeToConfirm?: string | undefined
}

type Pending = ConfirmOptions & { resolve: (ok: boolean) => void }
const ConfirmContext = React.createContext<((options: ConfirmOptions) => Promise<boolean>) | null>(null)

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = React.useState<Pending | null>(null)
  const [typed, setTyped] = React.useState("")
  const confirm = React.useCallback((options: ConfirmOptions) => new Promise<boolean>((resolve) => { setTyped(""); setPending({ ...options, resolve }) }), [])
  const close = (ok: boolean) => { pending?.resolve(ok); setPending(null) }
  const blocked = pending?.typeToConfirm !== undefined && typed !== pending.typeToConfirm
  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <AlertDialog open={pending !== null} onOpenChange={(open) => { if (!open) close(false) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{pending?.title}</AlertDialogTitle>
            {pending?.description !== undefined ? <AlertDialogDescription>{pending.description}</AlertDialogDescription> : null}
          </AlertDialogHeader>
          {pending?.typeToConfirm !== undefined ? (
            <label className="grid gap-1.5 text-sm">
              <span className="text-muted-foreground">{vocab.copy.typeToConfirm(pending.typeToConfirm)}</span>
              <Input autoFocus value={typed} onChange={(event) => setTyped(event.target.value)} />
            </label>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel>{vocab.copy.cancel}</AlertDialogCancel>
            <AlertDialogAction disabled={blocked} onClick={(event) => { if (blocked) { event.preventDefault(); return } close(true) }}
              className={pending?.destructive ? buttonVariants({ variant: "destructive" }) : undefined}>
              {pending?.confirmLabel ?? (pending?.destructive ? vocab.copy.delete : vocab.copy.confirm)}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ConfirmContext.Provider>
  )
}

export function useConfirm(): (options: ConfirmOptions) => Promise<boolean> {
  const confirm = React.useContext(ConfirmContext)
  if (confirm === null) throw new Error("useConfirm must be used inside <ConfirmProvider>")
  return confirm
}
