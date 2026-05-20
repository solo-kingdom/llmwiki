import { useEffect } from "react"

type ToastProps = {
  message: string | null
  onClose: () => void
  duration?: number
}

export function Toast({ message, onClose, duration = 3000 }: ToastProps) {
  useEffect(() => {
    if (!message) return
    const timer = setTimeout(onClose, duration)
    return () => clearTimeout(timer)
  }, [message, onClose, duration])

  if (!message) return null

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed top-20 left-1/2 z-[70] max-w-[min(24rem,90vw)] -translate-x-1/2 rounded-lg border border-border/80 bg-card px-4 py-2.5 text-sm text-foreground shadow-lg animate-in fade-in slide-in-from-top-2 duration-200"
    >
      {message}
    </div>
  )
}
