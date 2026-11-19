/**
 * Custom ESLint Rule: no-raw-viewport-check
 *
 * Disallows direct `window.innerWidth` usage in UI code (pages/components).
 *
 * Rationale: viewport-width branching must go through the single source of
 * truth — `useIsMobile()` (@workspace/ui/hooks/use-mobile, md/768px) — or pure CSS
 * breakpoint classes. Ad-hoc `window.innerWidth` checks create inconsistent
 * breakpoints (640 vs 768 vs 1024), don't react to resize, and bypass the
 * responsive conventions in DESIGN.md.
 *
 * Correct alternatives:
 *   - Structural fork (table/cards, Dialog/Sheet): useIsMobile()
 *   - Style-only difference (show/hide, layout):   Tailwind breakpoint classes
 *   - Touch capability:                            pointer-coarse: / (pointer: coarse)
 */
export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow window.innerWidth in UI code — use useIsMobile() or CSS breakpoint classes instead.",
    },
    messages: {
      noRawViewport:
        "Do not read window.innerWidth directly. Use useIsMobile() (@workspace/ui/hooks/use-mobile) for structural forks, Tailwind breakpoint classes for style-only differences, or pointer-coarse for touch detection.",
    },
    schema: [],
  },
  create(context) {
    return {
      // Catches: window.innerWidth / window?.innerWidth / window["innerWidth"]
      MemberExpression(node) {
        if (
          node.object &&
          node.object.type === "Identifier" &&
          node.object.name === "window" &&
          node.property &&
          ((node.property.type === "Identifier" &&
            node.property.name === "innerWidth") ||
            (node.property.type === "Literal" &&
              node.property.value === "innerWidth"))
        ) {
          context.report({ node, messageId: "noRawViewport" })
        }
      },
      // Catches destructuring: const { innerWidth } = window
      VariableDeclarator(node) {
        if (
          node.init &&
          node.init.type === "Identifier" &&
          node.init.name === "window" &&
          node.id.type === "ObjectPattern"
        ) {
          for (const prop of node.id.properties) {
            if (
              prop.type === "Property" &&
              ((prop.key.type === "Identifier" &&
                prop.key.name === "innerWidth") ||
                (prop.key.type === "Literal" &&
                  prop.key.value === "innerWidth"))
            ) {
              context.report({ node: prop, messageId: "noRawViewport" })
            }
          }
        }
      },
    }
  },
}
