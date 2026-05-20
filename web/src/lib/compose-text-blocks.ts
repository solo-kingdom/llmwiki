export interface TextBlockInput {
  title?: string
  content: string
}

export function composeTextBlocksToMarkdown(blocks: TextBlockInput[]): string {
  const nonEmpty = blocks.filter((b) => b.content.trim())
  if (nonEmpty.length === 0) return ""

  return nonEmpty
    .map((block, index) => {
      const parts: string[] = []
      const heading = block.title?.trim()
      if (heading) {
        parts.push(`## ${heading}`)
      } else if (nonEmpty.length > 1) {
        parts.push(`## 文本块 ${index + 1}`)
      }
      parts.push(block.content.trim())
      return parts.join("\n\n")
    })
    .join("\n\n---\n\n")
}
