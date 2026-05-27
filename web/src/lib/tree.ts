import type { DocumentListItem, TreeNode } from "@/types"

/**
 * Strips the leading "wiki/" segment from a doc path so the tree root
 * starts at the typed subdirectory level (entities/, concepts/, …)
 * instead of the redundant wiki/ wrapper.
 */
function stripWikiPrefix(path: string): string {
  const stripped = path.replace(/^\/?wiki\//, "")
  // If the entire path was just "wiki" or "/wiki", return empty
  return stripped === path && !path.includes("/") ? "" : stripped
}

export function buildTree(docs: DocumentListItem[]): TreeNode[] {
  const root: TreeNode[] = []

  for (const doc of docs) {
    const normalizedPath = stripWikiPrefix(doc.path || "")
    const parts = normalizedPath ? normalizedPath.split("/").filter(Boolean) : []
    let nodes = root

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]
      let existing = nodes.find((n) => n.name === part && n.isFolder)
      if (!existing) {
        existing = {
          name: part,
          path: parts.slice(0, i + 1).join("/"),
          isFolder: true,
          children: [],
        }
        nodes.push(existing)
      }
      nodes = existing.children
    }

    nodes.push({
      name: doc.filename,
      path: normalizedPath ? `${normalizedPath}/${doc.filename}` : doc.filename,
      isFolder: false,
      children: [],
      doc,
    })
  }

  sortNodes(root)
  return root
}

function sortNodes(nodes: TreeNode[]): void {
  nodes.sort((a, b) => {
    if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1
    return a.name.localeCompare(b.name)
  })
  for (const node of nodes) {
    if (node.children.length > 0) sortNodes(node.children)
  }
}
