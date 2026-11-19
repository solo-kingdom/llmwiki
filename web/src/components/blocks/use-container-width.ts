import * as React from "react"

/** Width of an element, kept current with ResizeObserver. Layout decisions follow the container, not the viewport. */
export function useContainerWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = React.useRef<T | null>(null)
  const [width, setWidth] = React.useState(0)
  React.useLayoutEffect(() => {
    const node = ref.current
    if (node === null) return
    const observer = new ResizeObserver(([entry]) => { if (entry !== undefined) setWidth(entry.contentRect.width) })
    observer.observe(node)
    setWidth(node.getBoundingClientRect().width)
    return () => observer.disconnect()
  }, [])
  return [ref, width]
}
