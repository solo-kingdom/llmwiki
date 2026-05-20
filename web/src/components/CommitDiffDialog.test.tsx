import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import { CommitDiffDialog } from "@/components/CommitDiffDialog"

const sampleDiff = `diff --git a/wiki/intro.md b/wiki/intro.md
--- /dev/null
+++ b/wiki/intro.md
@@ -0,0 +1,2 @@
+# Hi
+line
`

describe("CommitDiffDialog", () => {
  it("renders file list and diff table when parsed", () => {
    const { container } = render(
      <CommitDiffDialog
        open
        sha="abc1234"
        diff={sampleDiff}
        loading={false}
        onClose={() => {}}
      />,
    )

    expect(screen.getByText("1 file")).toBeInTheDocument()
    expect(screen.getByText("wiki/intro.md")).toBeInTheDocument()
    expect(container.querySelector(".diff")).toBeInTheDocument()
  })

  it("shows raw diff fallback when parse has no hunks", () => {
    render(
      <CommitDiffDialog
        open
        sha="abc1234"
        diff="not a valid unified diff"
        loading={false}
        onClose={() => {}}
      />,
    )

    expect(
      screen.getByText(/Unable to parse diff format/i),
    ).toBeInTheDocument()
    expect(screen.getByText("not a valid unified diff")).toBeInTheDocument()
  })

  it("shows empty diff message when diff text is blank", () => {
    render(
      <CommitDiffDialog
        open
        sha="empty01"
        diff=""
        loading={false}
        onClose={() => {}}
      />,
    )

    expect(screen.getByText("(empty diff)")).toBeInTheDocument()
    expect(screen.queryByText("1 file")).not.toBeInTheDocument()
  })

  it("shows loading state", () => {
    render(
      <CommitDiffDialog
        open
        sha="abc1234"
        diff=""
        loading
        onClose={() => {}}
      />,
    )

    expect(screen.getByText("Loading diff...")).toBeInTheDocument()
  })
})
