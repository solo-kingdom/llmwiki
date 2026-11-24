import { describe, expect, it } from "vitest"
import { FILE_KIND_CLASS, FILE_KIND_LABEL, resolveFileKind, type FileKind } from "./file-kind"

const ALL_KINDS: FileKind[] = [
  "markdown",
  "html",
  "video",
  "image",
  "audio",
  "pdf",
  "word",
  "spreadsheet",
  "presentation",
  "code",
  "data",
  "archive",
  "text",
  "other",
]

describe("resolveFileKind", () => {
  it("classifies markdown files and wiki fallback", () => {
    expect(resolveFileKind({ filename: "notes.md" })).toBe("markdown")
    expect(resolveFileKind({ filename: "README.MARKDOWN" })).toBe("markdown")
    expect(resolveFileKind({ filename: "guide.mdx" })).toBe("markdown")
    expect(resolveFileKind({ file_type: "md" })).toBe("markdown")
    expect(resolveFileKind({ file_type: ".md" })).toBe("markdown")
    expect(resolveFileKind({ file_type: "text/markdown" })).toBe("markdown")
    expect(resolveFileKind({ source_kind: "wiki" })).toBe("markdown")
  })

  it("classifies html files", () => {
    expect(resolveFileKind({ filename: "index.html" })).toBe("html")
    expect(resolveFileKind({ filename: "page.HTM" })).toBe("html")
    expect(resolveFileKind({ filename: "doc.xhtml" })).toBe("html")
    expect(resolveFileKind({ file_type: "text/html" })).toBe("html")
  })

  it("classifies video files", () => {
    expect(resolveFileKind({ filename: "demo.mp4" })).toBe("video")
    expect(resolveFileKind({ filename: "clip.MOV" })).toBe("video")
    expect(resolveFileKind({ filename: "talk.mkv" })).toBe("video")
    expect(resolveFileKind({ filename: "stream.webm" })).toBe("video")
    expect(resolveFileKind({ filename: "old.avi" })).toBe("video")
    expect(resolveFileKind({ file_type: "video/mp4" })).toBe("video")
    expect(resolveFileKind({ file_type: "video" })).toBe("video")
  })

  it("classifies image files", () => {
    expect(resolveFileKind({ filename: "shot.png" })).toBe("image")
    expect(resolveFileKind({ filename: "photo.jpg" })).toBe("image")
    expect(resolveFileKind({ filename: "photo.JPEG" })).toBe("image")
    expect(resolveFileKind({ filename: "anim.gif" })).toBe("image")
    expect(resolveFileKind({ filename: "hero.webp" })).toBe("image")
    expect(resolveFileKind({ filename: "logo.svg" })).toBe("image")
    expect(resolveFileKind({ filename: "pic.avif" })).toBe("image")
    expect(resolveFileKind({ file_type: "image/png" })).toBe("image")
    expect(resolveFileKind({ file_type: "image" })).toBe("image")
  })

  it("classifies audio files", () => {
    expect(resolveFileKind({ filename: "track.mp3" })).toBe("audio")
    expect(resolveFileKind({ filename: "voice.wav" })).toBe("audio")
    expect(resolveFileKind({ filename: "lossless.flac" })).toBe("audio")
    expect(resolveFileKind({ filename: "podcast.m4a" })).toBe("audio")
    expect(resolveFileKind({ file_type: "audio/mpeg" })).toBe("audio")
  })

  it("classifies office and pdf documents", () => {
    expect(resolveFileKind({ filename: "paper.pdf" })).toBe("pdf")
    expect(resolveFileKind({ file_type: "application/pdf" })).toBe("pdf")

    expect(resolveFileKind({ filename: "spec.docx" })).toBe("word")
    expect(resolveFileKind({ filename: "legacy.doc" })).toBe("word")
    expect(
      resolveFileKind({
        file_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      }),
    ).toBe("word")

    expect(resolveFileKind({ filename: "budget.xlsx" })).toBe("spreadsheet")
    expect(resolveFileKind({ filename: "metrics.csv" })).toBe("spreadsheet")

    expect(resolveFileKind({ filename: "deck.pptx" })).toBe("presentation")
    expect(resolveFileKind({ filename: "slides.key" })).toBe("presentation")
  })

  it("classifies code files including .ts as code rather than video", () => {
    expect(resolveFileKind({ filename: "index.ts" })).toBe("code")
    expect(resolveFileKind({ filename: "App.tsx" })).toBe("code")
    expect(resolveFileKind({ filename: "script.py" })).toBe("code")
    expect(resolveFileKind({ filename: "main.go" })).toBe("code")
    expect(resolveFileKind({ filename: "run.sh" })).toBe("code")
    expect(resolveFileKind({ filename: "Dockerfile" })).toBe("code")
    expect(resolveFileKind({ filename: "Makefile" })).toBe("code")
  })

  it("classifies structured data, archives, and plain text", () => {
    expect(resolveFileKind({ filename: "config.json" })).toBe("data")
    expect(resolveFileKind({ filename: "compose.yaml" })).toBe("data")
    expect(resolveFileKind({ filename: "settings.yml" })).toBe("data")
    expect(resolveFileKind({ filename: "Cargo.toml" })).toBe("data")
    expect(resolveFileKind({ filename: "feed.xml" })).toBe("data")
    expect(resolveFileKind({ file_type: "application/json" })).toBe("data")

    expect(resolveFileKind({ filename: "bundle.zip" })).toBe("archive")
    expect(resolveFileKind({ filename: "release.tar.gz" })).toBe("archive")
    expect(resolveFileKind({ filename: "backup.7z" })).toBe("archive")

    expect(resolveFileKind({ filename: "readme.txt" })).toBe("text")
    expect(resolveFileKind({ filename: "server.log" })).toBe("text")
    expect(resolveFileKind({ file_type: "text/plain" })).toBe("text")
  })

  it("returns other for unknown extensions even on wiki docs and respects precedence", () => {
    expect(resolveFileKind({ filename: "blob.bin", source_kind: "wiki" })).toBe("other")
    expect(resolveFileKind({ filename: "unknown.xyz", source_kind: "wiki" })).toBe("other")
    expect(resolveFileKind({})).toBe("other")

    // Precedence: filename > relative_path > file_type
    expect(
      resolveFileKind({
        filename: "diagram.png",
        relative_path: "wiki/notes/fallback.md",
        file_type: "text/plain",
      }),
    ).toBe("image")
    expect(
      resolveFileKind({
        relative_path: "wiki/media/intro.mp4",
        file_type: "text/plain",
      }),
    ).toBe("video")
  })

  it("provides CSS class and label mappings for every FileKind", () => {
    for (const kind of ALL_KINDS) {
      expect(FILE_KIND_CLASS[kind]).toBe(`wiki-icon-${kind}`)
      expect(FILE_KIND_LABEL[kind].length).toBeGreaterThan(0)
    }
  })
})
