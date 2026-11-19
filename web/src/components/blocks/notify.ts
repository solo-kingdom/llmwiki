/**
 * notify — the only feedback channel for completed actions (sonner underneath).
 * Success: short past tense ("已保存"). Error: what failed + why. Reversible: offer undo.
 * Inline errors next to the control stay inline (forms); notify is for action results.
 */
import { toast } from "sonner"
import { errorMessage } from "@/components/blocks/state-boundary"
import { vocab } from "@/lib/vocab"

export const notify = {
  success: (message: string = vocab.copy.saved) => toast.success(message),
  info: (message: string) => toast(message),
  error: (error: unknown, title?: string) => toast.error(title ?? errorMessage(error), title !== undefined ? { description: errorMessage(error) } : undefined),
  undo: (message: string, onUndo: () => void, durationMs = 6000) => toast(message, { duration: durationMs, action: { label: vocab.copy.undo, onClick: onUndo } }),
  /** Tie a toast to a promise: pending → success/error. */
  promise: <T,>(promise: Promise<T>, messages: { loading: string; success: string; error?: string }) =>
    toast.promise(promise, { loading: messages.loading, success: messages.success, error: (error: unknown) => messages.error ?? errorMessage(error) }),
}
