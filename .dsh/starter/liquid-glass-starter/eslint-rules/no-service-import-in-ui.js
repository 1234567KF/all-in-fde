/**
 * Custom ESLint Rule: no-service-import-in-ui
 *
 * Disallows runtime (value) imports from the services layer inside UI layers
 * (pages/ and components/). Type-only imports are allowed.
 *
 * Detects alias imports ("@/services/foo"), shared-kernel imports
 * ("@workspace/web-core/services/foo") and relative imports
 * ("../../services/foo") that resolve into src/services/.
 *
 * Rationale: server state must flow through TanStack Query hooks
 * (hooks/queries/*) so that caching, invalidation and error handling stay
 * centralized. Components calling services directly bypass the cache and
 * re-introduce ad-hoc fetch effects.
 *
 * Correct alternatives:
 *   - lists/details: useCustomers(), useOpportunities(), useChannels(), …
 *   - mutations:     useCreateXxx()/useUpdateXxx() with mutateAsync
 *   - types only:    import type { Foo } from "@/services/foo"  (allowed)
 */
import path from 'node:path'

export default {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Disallow value imports from the services layer in pages/components — server state must go through hooks/queries (TanStack Query).',
    },
    messages: {
      noServiceImport:
        'Do not import "{{source}}" directly in UI layer. Server state must go through TanStack Query hooks (hooks/queries/*). Type-only imports are allowed.',
    },
    schema: [],
  },
  create(context) {
    const filename = context.filename ?? context.getFilename()

    function isServiceImport(source) {
      // Alias form: @/services/...
      if (source.startsWith('@/services/')) return true
      // Shared kernel form: @workspace/web-core/services/...
      if (source.startsWith('@workspace/web-core/services/')) return true
      // Relative form: resolve against current file and check if it lands in src/services/
      if (source.startsWith('.')) {
        const resolved = path.resolve(path.dirname(filename), source)
        // Normalize separators for Windows compatibility
        const normalized = resolved.replace(/\\/g, '/')
        return /\/src\/services\//.test(normalized)
      }
      return false
    }

    return {
      ImportDeclaration(node) {
        const source = node.source.value
        if (typeof source !== 'string' || !isServiceImport(source)) {
          return
        }
        // import type { X } from "@/services/x" — allowed
        if (node.importKind === 'type') return
        // import { type A, type B } from … with only type specifiers — allowed
        const hasValueSpecifier = node.specifiers.some(
          (s) => s.importKind !== 'type',
        )
        if (!hasValueSpecifier) return

        context.report({
          node,
          messageId: 'noServiceImport',
          data: { source },
        })
      },
    }
  },
}
