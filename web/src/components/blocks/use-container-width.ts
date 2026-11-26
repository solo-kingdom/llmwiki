import * as React from "react"

/**
 * Width of an element, kept current with ResizeObserver. Layout decisions follow the container, not the viewport.
 * The returned value is a callback ref, not a RefObject: a layout that mounts after data arrives (behind a loading
 * branch) must be measured on its first commit. Reading `ref.current` during render would see `null` on that commit
 * and the effect keyed on it would never run again, leaving `width` at 0.
 */
export function useContainerWidth<T extends HTMLElement>(): [(node: T | null) => void, number] {
  const [node, setNode] = React.useState<T | null>(null)
  const [width, setWidth] = React.useState(0)
  React.useLayoutEffect(() => {
    if (node === null) return
    const observer = new ResizeObserver(([entry]) => { if (entry !== undefined) setWidth(entry.contentRect.width) })
    observer.observe(node)
    setWidth(node.getBoundingClientRect().width)
    return () => observer.disconnect()
  }, [node])
  return [setNode, width]
}
