import * as React from "react"

/**
 * Width of an element, kept current with ResizeObserver. Layout decisions follow the container, not the viewport.
 * Re-attaches when the observed node changes: a ref mounted only after data arrives (behind a loading branch)
 * must be measured too — an empty-deps effect would observe `null` on mount and never fire again.
 */
export function useContainerWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = React.useRef<T | null>(null)
  const [width, setWidth] = React.useState(0)
  const node = ref.current
  React.useLayoutEffect(() => {
    if (node === null) return
    const observer = new ResizeObserver(([entry]) => { if (entry !== undefined) setWidth(entry.contentRect.width) })
    observer.observe(node)
    setWidth(node.getBoundingClientRect().width)
    return () => observer.disconnect()
  }, [node])
  return [ref, width]
}
