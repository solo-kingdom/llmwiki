import type { OutlineItem } from "@/types"

export function slugifyHeading(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fff]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

/** Assign unique slugs; duplicates get `-1`, `-2`, … suffixes. */
export function assignUniqueHeadingSlugs(
  headings: { level: number; text: string }[],
): OutlineItem[] {
  const counts = new Map<string, number>()
  return headings.map(({ level, text }) => {
    const base = slugifyHeading(text)
    const seen = counts.get(base) ?? 0
    counts.set(base, seen + 1)
    const slug = seen === 0 ? base : `${base}-${seen}`
    return { level, text, slug }
  })
}

export function extractHeadings(content: string): OutlineItem[] {
  const headings: { level: number; text: string }[] = []
  for (const line of content.split("\n")) {
    const match = /^(#{1,6})\s+(.+)$/.exec(line)
    if (!match) continue
    headings.push({ level: match[1].length, text: match[2].trim() })
  }
  return assignUniqueHeadingSlugs(headings)
}

/** Slugs in document order, aligned with rendered heading elements. */
export function uniqueHeadingSlugSequence(content: string): string[] {
  return extractHeadings(content).map((item) => item.slug)
}
