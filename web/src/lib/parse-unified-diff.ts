import { parseDiff, isInsert, isDelete, type FileData } from "react-diff-view"

export { parseDiff }

/** Decode Git C-quoted path escapes (octal \\NNN as UTF-8 bytes, \\n, \\t, \\\\, \\"). */
export function decodeGitPath(path: string): string {
  if (!path || !path.includes("\\")) return path

  const parts: string[] = []
  const bytes: number[] = []

  const flushBytes = () => {
    if (bytes.length === 0) return
    parts.push(new TextDecoder().decode(new Uint8Array(bytes.splice(0))))
  }

  let i = 0
  while (i < path.length) {
    if (path[i] === "\\" && i + 1 < path.length) {
      const next = path[i + 1]
      if (/[0-7]/.test(next)) {
        let octal = ""
        let j = i + 1
        while (j < path.length && j < i + 4 && /[0-7]/.test(path[j])) {
          octal += path[j]
          j++
        }
        bytes.push(parseInt(octal, 8))
        i = j
        continue
      }
      flushBytes()
      if (next === "\\") parts.push("\\")
      else if (next === '"') parts.push('"')
      else if (next === "n") parts.push("\n")
      else if (next === "t") parts.push("\t")
      else parts.push(path.slice(i, i + 2))
      i += 2
      continue
    }
    flushBytes()
    parts.push(path[i])
    i++
  }
  flushBytes()
  return parts.join("")
}

/** Human-readable path for a parsed diff file entry. */
export function getFileDisplayPath(file: FileData): string {
  if (file.type === "delete") return decodeGitPath(file.oldPath)
  return decodeGitPath(file.newPath || file.oldPath)
}

export function isRenamed(file: FileData): boolean {
  const oldPath = decodeGitPath(file.oldPath)
  const newPath = decodeGitPath(file.newPath)
  return (
    file.type === "rename" ||
    (oldPath !== newPath &&
      oldPath !== "/dev/null" &&
      newPath !== "/dev/null")
  )
}

export function countFileChanges(file: FileData): {
  additions: number
  deletions: number
} {
  let additions = 0
  let deletions = 0
  for (const hunk of file.hunks) {
    for (const change of hunk.changes) {
      if (isInsert(change)) additions++
      else if (isDelete(change)) deletions++
    }
  }
  return { additions, deletions }
}

export function listDiffFiles(diffText: string): FileData[] {
  if (!diffText.trim()) return []
  return parseDiff(diffText)
}

/** True when parsed output contains at least one hunk to render. */
export function hasRenderableDiff(files: FileData[]): boolean {
  return files.some((f) => f.hunks.length > 0)
}
