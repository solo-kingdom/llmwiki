export interface PasteInfo {
  lines: number
  chars: number
  formats: string[]
  speakers: string[]
}

function detectFormats(text: string): { formats: string[]; speakers: string[] } {
  const formats: string[] = []
  const speakers: string[] = []

  // Markdown detection: lines starting with #
  if (/^#{1,6}\s+/m.test(text)) {
    formats.push("Markdown")
  }

  // SRT subtitle detection: number line followed by timestamp
  if (/^\d+\s*\n\d{2}:\d{2}[:-]\d{2}[,\.]\d{3}\s*-->\s*\d{2}:\d{2}/m.test(text)) {
    formats.push("SRT subtitles")
  }

  // Conversation format: "Name: ..." patterns
  const speakerRegex = /^([A-Za-z\u4e00-\u9fff][\w\u4e00-\u9fff\s]{0,20}?):\s+/gm
  const speakerSet = new Set<string>()
  let match: RegExpExecArray | null
  while ((match = speakerRegex.exec(text)) !== null) {
    const name = match[1].trim()
    if (name.length > 0 && name.length <= 20) {
      speakerSet.add(name)
    }
  }
  if (speakerSet.size >= 2) {
    speakers.push(...Array.from(speakerSet))
    formats.push(`${speakerSet.size} speakers`)
  }

  return { formats, speakers }
}

export function PastePreview({ info }: { info: PasteInfo | null }) {
  if (!info) return null

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg bg-muted px-3 py-1.5 text-xs text-muted-foreground">
      <span className="inline-flex items-center gap-1">
        <svg className="size-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect width="14" height="14" x="8" y="8" rx="2" ry="2"/>
          <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>
        </svg>
        Pasted
      </span>
      <span>· {info.lines} lines</span>
      <span>· {info.chars.toLocaleString()} chars</span>
      {info.formats.map((f) => (
        <span key={f} className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
          {f}
        </span>
      ))}
    </div>
  )
}

export function analyzePaste(text: string): PasteInfo {
  const lines = text.split("\n").length
  const chars = text.length
  const { formats, speakers } = detectFormats(text)
  return { lines, chars, formats, speakers }
}
