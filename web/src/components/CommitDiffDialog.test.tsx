import { describe, expect, it } from "vitest"
import { screen } from "@testing-library/react"
import { CommitDiffDialog } from "@/components/CommitDiffDialog"
import { renderWithI18n } from "@/test/i18n"

const sampleDiff = `diff --git a/wiki/intro.md b/wiki/intro.md
--- /dev/null
+++ b/wiki/intro.md
@@ -0,0 +1,2 @@
+# Hi
+line
`

describe("CommitDiffDialog", () => {
  it("renders file list and diff table when parsed", () => {
    const { container } = renderWithI18n(
      <CommitDiffDialog
        open
        sha="abc1234"
        diff={sampleDiff}
        loading={false}
        onClose={() => {}}
      />,
      { lang: "en" },
    )

    expect(screen.getByText("1 file(s)")).toBeInTheDocument()
    expect(screen.getByText("wiki/intro.md")).toBeInTheDocument()
    expect(container.querySelector(".diff")).toBeInTheDocument()
  })

  it("shows raw diff fallback when parse has no hunks", () => {
    renderWithI18n(
      <CommitDiffDialog
        open
        sha="abc1234"
        diff="not a valid unified diff"
        loading={false}
        onClose={() => {}}
      />,
      { lang: "en" },
    )

    expect(
      screen.getByText(/Unable to parse diff format/i),
    ).toBeInTheDocument()
    expect(screen.getByText("not a valid unified diff")).toBeInTheDocument()
  })

  it("shows empty diff message when diff text is blank", () => {
    renderWithI18n(
      <CommitDiffDialog
        open
        sha="empty01"
        diff=""
        loading={false}
        onClose={() => {}}
      />,
      { lang: "en" },
    )

    expect(screen.getByText("(empty diff)")).toBeInTheDocument()
    expect(screen.queryByText("1 file(s)")).not.toBeInTheDocument()
  })

  it("shows loading state", () => {
    renderWithI18n(
      <CommitDiffDialog
        open
        sha="abc1234"
        diff=""
        loading
        onClose={() => {}}
      />,
      { lang: "en" },
    )

    expect(screen.getByText("Loading diff...")).toBeInTheDocument()
  })
})
