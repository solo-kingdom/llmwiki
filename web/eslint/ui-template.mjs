/**
 * ESLint plugin: the ui-template implementation rules that a linter can see.
 * Each rule names the block or pattern to use instead, so the fix is obvious at write time.
 *
 *   import uiTemplate from "./eslint/ui-template.mjs"
 *   export default [{ files: ["src/**\/*.tsx"], plugins: { "ui-template": uiTemplate }, rules: uiTemplate.configs.recommended.rules }]
 *
 * src/components/ui/** (vendored shadcn) and src/components/blocks/** are exempt by default via `ignores`.
 */

const STATUS_COLOR = /\b(?:bg|text|border|ring|fill|stroke)-(?:red|green|emerald|lime|amber|yellow|orange|rose|sky|blue|indigo|violet|purple|pink|slate|gray|zinc|neutral|stone)-\d{2,3}\b/
const RAW_COLOR = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(|\boklch\(/
const ARBITRARY_SIZE = /\b(?:text|leading)-\[\d+(?:\.\d+)?(?:px|rem)\]|\b(?:h|min-h|py|p)-\[\d+px\]/

function strings(expr) {
  if (!expr) return []
  if (expr.type === "Literal" && typeof expr.value === "string") return [expr.value]
  if (expr.type === "TemplateLiteral") return expr.quasis.map((q) => q.value.cooked ?? "")
  if (expr.type === "CallExpression") return expr.arguments.flatMap(strings)
  if (expr.type === "LogicalExpression") return strings(expr.right)
  if (expr.type === "ConditionalExpression") return [...strings(expr.consequent), ...strings(expr.alternate)]
  if (expr.type === "ArrayExpression") return expr.elements.flatMap(strings)
  return []
}

function classStrings(node) {
  if (node.value?.type === "Literal" && typeof node.value.value === "string") return [node.value.value]
  return strings(node.value?.expression)
}

// Geometry owned by surfaces (blocks/surfaces): borders, radius, padding, margin, gaps, dividers, shadows.
const LAYOUT = /^(?:border|rounded|p[xytrbse]?-|m[xytrbse]?-|gap-|gap[xy]-|space-[xy]-|divide|shadow|inset-ring)/
const layoutTokens = (s) => s.split(/\s+/).map((t) => t.split(":").pop().replace(/^!?-?/, "")).filter((t) => LAYOUT.test(t) && !/^m[lrse]?-auto$/.test(t))

function classRule(test, message) {
  return {
    meta: { type: "suggestion", messages: { m: message }, schema: [] },
    create(context) {
      return {
        JSXAttribute(node) {
          if (node.name.name !== "className") return
          if (classStrings(node).some((s) => test.test(s))) context.report({ node, messageId: "m" })
        },
      }
    },
  }
}

const rules = {
  "no-layout-classes": {
    meta: { type: "suggestion", messages: { m: "Layout class `{{token}}` in page code: borders, radius, padding, margins, gaps, dividers and shadows belong to surfaces (Page, Split, Panel, Section, Stack, Toolbar, Properties, DataTable frame). Compose surfaces or use their props." }, schema: [] },
    create(context) {
      return {
        JSXAttribute(node) {
          if (node.name.name !== "className") return
          const token = classStrings(node).flatMap(layoutTokens)[0]
          if (token !== undefined) context.report({ node, messageId: "m", data: { token } })
        },
      }
    },
  },
  "no-palette-colors": classRule(STATUS_COLOR, "Use theme roles (text-muted-foreground, bg-accent, text-destructive…) or <StatusBadge tone>; palette colors bypass dark mode and the package."),
  "no-raw-colors": {
    meta: { type: "suggestion", messages: { m: "Raw color literal in UI code; add a role to theme.css instead." }, schema: [] },
    create(context) {
      const check = (node, value) => { if (typeof value === "string" && RAW_COLOR.test(value)) context.report({ node, messageId: "m" }) }
      return {
        JSXAttribute(node) { if (node.name.name === "className") classStrings(node).forEach((s) => check(node, s)) },
        "JSXAttribute[name.name='style'] Property > Literal"(node) { check(node, node.value) },
      }
    },
  },
  "no-arbitrary-size": classRule(ARBITRARY_SIZE, "Arbitrary type size / control height; density comes from theme.css (text-xs/sm/base, h-7/8/9)."),
  "no-window-dialogs": {
    meta: { type: "problem", messages: { m: "window.{{name}} — use useConfirm() (blocks/confirm) or notify." }, schema: [] },
    create(context) {
      return {
        CallExpression(node) {
          const c = node.callee
          let name = null
          if (c.type === "MemberExpression" && c.object.name === "window") name = c.property.name
          else if (c.type === "Identifier") {
            // a bare call is the global only when nothing in scope declares that name (e.g. const confirm = useConfirm())
            let scope = context.sourceCode.getScope(node)
            let declared = false
            for (; scope && !declared; scope = scope.upper) declared = scope.variables.some((v) => v.name === c.name && v.defs.length > 0)
            if (!declared) name = c.name
          }
          if (name === "confirm" || name === "alert" || name === "prompt") context.report({ node, messageId: "m", data: { name } })
        },
      }
    },
  },
  "no-adhoc-format": {
    meta: { type: "suggestion", messages: { m: "Format through blocks/format (<Time>, <Num>, formatBytes…) so locale and time zone stay consistent." }, schema: [] },
    create(context) {
      return {
        CallExpression(node) {
          const p = node.callee.type === "MemberExpression" ? node.callee.property.name : null
          if (p === "toLocaleString" || p === "toLocaleDateString" || p === "toLocaleTimeString" || p === "toISOString" && node.parent.type === "JSXExpressionContainer") context.report({ node, messageId: "m" })
        },
        NewExpression(node) {
          if (node.callee.type === "MemberExpression" && node.callee.object.name === "Intl") context.report({ node, messageId: "m" })
        },
      }
    },
  },
  "no-raw-internal-links": {
    meta: { type: "problem", messages: { m: "Internal navigation through <AppLink> / <RowLink> (blocks/router) so the router owns it." }, schema: [] },
    create(context) {
      return {
        JSXOpeningElement(node) {
          if (node.name.name !== "a") return
          const href = node.attributes.find((a) => a.name?.name === "href")
          const v = href?.value?.type === "Literal" ? href.value.value : null
          if (typeof v === "string" && v.startsWith("/")) context.report({ node, messageId: "m" })
        },
      }
    },
  },
  "no-direct-toast": {
    meta: { type: "suggestion", messages: { m: "Import notify from blocks/notify instead of sonner directly." }, schema: [] },
    create(context) {
      return { ImportDeclaration(node) { if (node.source.value === "sonner") context.report({ node, messageId: "m" }) } }
    },
  },
  "no-raw-table": {
    meta: { type: "suggestion", messages: { m: "Collections use <DataTable> (blocks/data-table): column priority, stacked narrow layout, row links and states come with it." }, schema: [] },
    create(context) {
      return { JSXOpeningElement(node) { if (node.name.name === "table" || node.name.name === "Table") context.report({ node, messageId: "m" }) } }
    },
  },
  "no-viewport-heights": {
    meta: { type: "suggestion", messages: { m: "Fixed heights/viewport units on page content cause nested scroll; let the shell scroll (patterns/page)." }, schema: [] },
    create(context) {
      const bad = /\b(?:h|max-h)-(?:screen|dvh|svh|\[calc\(100vh)/
      return { JSXAttribute(node) { if (node.name.name === "className" && classStrings(node).some((s) => bad.test(s))) context.report({ node, messageId: "m" }) } }
    },
  },
}

const plugin = {
  meta: { name: "ui-template", version: "5.3.2" },
  rules,
  configs: { recommended: { rules: Object.fromEntries(Object.keys(rules).map((name) => [`ui-template/${name}`, "error"])) } },
}
plugin.configs.recommended.plugins = { "ui-template": plugin }
export default plugin
