import type { DocumentListItem, TreeNode } from "@/types"

export function buildTree(docs: DocumentListItem[]): TreeNode[] {
  const root: TreeNode[] = []

  for (const doc of docs) {
    const parts = doc.path ? doc.path.split("/").filter(Boolean) : []
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
      path: doc.path ? `${doc.path}/${doc.filename}` : doc.filename,
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
