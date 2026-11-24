export type FileKind =
  | "markdown"
  | "html"
  | "video"
  | "image"
  | "audio"
  | "pdf"
  | "word"
  | "spreadsheet"
  | "presentation"
  | "code"
  | "data"
  | "archive"
  | "text"
  | "other"

export type FileKindInput = {
  filename?: string | undefined
  relative_path?: string | undefined
  file_type?: string | undefined
  source_kind?: string | undefined
}

export const FILE_KIND_CLASS: Record<FileKind, string> = {
  markdown: "wiki-icon-markdown",
  html: "wiki-icon-html",
  video: "wiki-icon-video",
  image: "wiki-icon-image",
  audio: "wiki-icon-audio",
  pdf: "wiki-icon-pdf",
  word: "wiki-icon-word",
  spreadsheet: "wiki-icon-spreadsheet",
  presentation: "wiki-icon-presentation",
  code: "wiki-icon-code",
  data: "wiki-icon-data",
  archive: "wiki-icon-archive",
  text: "wiki-icon-text",
  other: "wiki-icon-other",
}

export const FILE_KIND_LABEL: Record<FileKind, string> = {
  markdown: "Markdown",
  html: "HTML",
  video: "Video",
  image: "Image",
  audio: "Audio",
  pdf: "PDF",
  word: "Word",
  spreadsheet: "Spreadsheet",
  presentation: "Presentation",
  code: "Code",
  data: "Data",
  archive: "Archive",
  text: "Text",
  other: "File",
}

const EXT_TO_KIND: Record<string, FileKind> = {
  // markdown
  md: "markdown",
  markdown: "markdown",
  mdx: "markdown",
  mdown: "markdown",
  mkd: "markdown",
  // html
  html: "html",
  htm: "html",
  xhtml: "html",
  mhtml: "html",
  // video (note: .ts is TypeScript code, not MPEG transport stream)
  mp4: "video",
  mov: "video",
  mkv: "video",
  webm: "video",
  avi: "video",
  m4v: "video",
  flv: "video",
  wmv: "video",
  mpeg: "video",
  mpg: "video",
  "3gp": "video",
  ogv: "video",
  // image
  png: "image",
  jpg: "image",
  jpeg: "image",
  gif: "image",
  webp: "image",
  svg: "image",
  bmp: "image",
  ico: "image",
  avif: "image",
  heic: "image",
  heif: "image",
  tif: "image",
  tiff: "image",
  // audio
  mp3: "audio",
  wav: "audio",
  flac: "audio",
  aac: "audio",
  ogg: "audio",
  m4a: "audio",
  wma: "audio",
  opus: "audio",
  aiff: "audio",
  mid: "audio",
  midi: "audio",
  // pdf
  pdf: "pdf",
  // word
  doc: "word",
  docx: "word",
  odt: "word",
  pages: "word",
  // spreadsheet
  xls: "spreadsheet",
  xlsx: "spreadsheet",
  csv: "spreadsheet",
  tsv: "spreadsheet",
  ods: "spreadsheet",
  numbers: "spreadsheet",
  // presentation
  ppt: "presentation",
  pptx: "presentation",
  odp: "presentation",
  key: "presentation",
  // code
  js: "code",
  jsx: "code",
  ts: "code",
  tsx: "code",
  mjs: "code",
  cjs: "code",
  py: "code",
  go: "code",
  rs: "code",
  java: "code",
  c: "code",
  cc: "code",
  cpp: "code",
  h: "code",
  hpp: "code",
  cs: "code",
  rb: "code",
  php: "code",
  swift: "code",
  kt: "code",
  scala: "code",
  sh: "code",
  bash: "code",
  zsh: "code",
  fish: "code",
  sql: "code",
  css: "code",
  scss: "code",
  less: "code",
  vue: "code",
  svelte: "code",
  lua: "code",
  r: "code",
  dart: "code",
  zig: "code",
  ex: "code",
  exs: "code",
  // data
  json: "data",
  jsonc: "data",
  json5: "data",
  yaml: "data",
  yml: "data",
  toml: "data",
  xml: "data",
  ini: "data",
  env: "data",
  conf: "data",
  cfg: "data",
  properties: "data",
  // archive
  zip: "archive",
  tar: "archive",
  gz: "archive",
  tgz: "archive",
  bz2: "archive",
  xz: "archive",
  "7z": "archive",
  rar: "archive",
  zst: "archive",
  // text
  txt: "text",
  log: "text",
  rtf: "text",
  rst: "text",
  org: "text",
  tex: "text",
}

const SPECIAL_BASENAME_TO_KIND: Record<string, FileKind> = {
  dockerfile: "code",
  makefile: "code",
  ".env": "data",
}

const DIRECT_ALIAS_TO_KIND: Record<string, FileKind> = {
  markdown: "markdown",
  html: "html",
  video: "video",
  image: "image",
  audio: "audio",
  text: "text",
}

function basenameOf(nameOrPath?: string): string {
  if (!nameOrPath) return ""
  const clean = nameOrPath.split(/[?#]/, 1)[0]?.trim() ?? ""
  if (!clean) return ""
  const slashIdx = Math.max(clean.lastIndexOf("/"), clean.lastIndexOf("\\"))
  return (slashIdx >= 0 ? clean.slice(slashIdx + 1) : clean).toLowerCase()
}

export function extractExtension(nameOrPath?: string): string {
  const base = basenameOf(nameOrPath)
  if (!base) return ""
  const dotIdx = base.lastIndexOf(".")
  if (dotIdx <= 0 || dotIdx === base.length - 1) return ""
  return base.slice(dotIdx + 1)
}

function kindFromPath(nameOrPath?: string): { kind: FileKind | null; hasToken: boolean } {
  const base = basenameOf(nameOrPath)
  if (!base) return { kind: null, hasToken: false }
  const special = SPECIAL_BASENAME_TO_KIND[base]
  if (special !== undefined) return { kind: special, hasToken: true }
  const ext = extractExtension(base)
  if (!ext) return { kind: null, hasToken: false }
  return { kind: EXT_TO_KIND[ext] ?? null, hasToken: true }
}

function kindFromFileType(fileType?: string): { kind: FileKind | null; hasToken: boolean } {
  const raw = fileType?.trim().toLowerCase() ?? ""
  if (!raw) return { kind: null, hasToken: false }

  const stripped = raw.replace(/^\.+/, "")
  const byExt = EXT_TO_KIND[stripped]
  if (byExt !== undefined) return { kind: byExt, hasToken: true }

  const byAlias = DIRECT_ALIAS_TO_KIND[stripped]
  if (byAlias !== undefined) return { kind: byAlias, hasToken: true }

  if (raw === "text/markdown" || raw === "text/x-markdown") return { kind: "markdown", hasToken: true }
  if (raw === "text/html" || raw === "application/xhtml+xml") return { kind: "html", hasToken: true }
  if (raw.startsWith("video/")) return { kind: "video", hasToken: true }
  if (raw.startsWith("image/")) return { kind: "image", hasToken: true }
  if (raw.startsWith("audio/")) return { kind: "audio", hasToken: true }
  if (raw === "application/pdf") return { kind: "pdf", hasToken: true }
  if (raw === "application/msword" || raw.includes("wordprocessingml")) return { kind: "word", hasToken: true }
  if (raw === "text/csv" || raw.includes("spreadsheetml") || raw === "application/vnd.ms-excel") {
    return { kind: "spreadsheet", hasToken: true }
  }
  if (raw.includes("presentationml") || raw === "application/vnd.ms-powerpoint") {
    return { kind: "presentation", hasToken: true }
  }
  if (
    raw === "application/json" ||
    raw === "application/xml" ||
    raw === "text/xml" ||
    raw === "text/yaml" ||
    raw === "application/x-yaml"
  ) {
    return { kind: "data", hasToken: true }
  }
  if (
    raw === "application/zip" ||
    raw === "application/gzip" ||
    raw === "application/x-tar" ||
    raw === "application/x-7z-compressed" ||
    raw === "application/vnd.rar"
  ) {
    return { kind: "archive", hasToken: true }
  }
  if (raw === "text/plain") return { kind: "text", hasToken: true }

  return { kind: null, hasToken: true }
}

export function resolveFileKind(doc: FileKindInput): FileKind {
  const fromFilename = kindFromPath(doc.filename)
  if (fromFilename.kind !== null) return fromFilename.kind

  const fromRelPath = kindFromPath(doc.relative_path)
  if (fromRelPath.kind !== null) return fromRelPath.kind

  const fromFileType = kindFromFileType(doc.file_type)
  if (fromFileType.kind !== null) return fromFileType.kind

  if (!fromFilename.hasToken && !fromRelPath.hasToken && !fromFileType.hasToken && doc.source_kind === "wiki") {
    return "markdown"
  }

  return "other"
}
