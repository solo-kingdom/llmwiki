import React from "react"

export function highlightText(text: string, query: string): React.ReactNode {
  if (!query.trim()) return text
  const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const regex = new RegExp(`(${escapedQuery})`, "gi")
  const parts = text.split(regex)
  if (parts.length === 1) return text
  return parts.map((part, index) =>
    part.toLowerCase() === query.toLowerCase() ? (
      <mark
        key={index}
        className="search-highlight rounded-sm bg-yellow-200/80 px-0.5 dark:bg-yellow-500/30"
      >
        {part}
      </mark>
    ) : (
      part
    ),
  )
}
