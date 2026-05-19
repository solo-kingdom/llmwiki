import type { OutlineItem } from "@/types"

export function slugifyHeading(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fff]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

export function extractHeadings(content: string): OutlineItem[] {
  const items: OutlineItem[] = []
  for (const line of content.split("\n")) {
    const match = /^(#{1,6})\s+(.+)$/.exec(line)
    if (!match) continue
    const text = match[2].trim()
    items.push({
      level: match[1].length,
      text,
      slug: slugifyHeading(text),
    })
  }
  return items
}
