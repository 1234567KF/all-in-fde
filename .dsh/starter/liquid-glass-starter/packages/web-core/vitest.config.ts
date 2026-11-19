import react from "@vitejs/plugin-react"
import { defineConfig } from "vitest/config"

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: "happy-dom",
    setupFiles: ["./src/test/setup.ts"],
    passWithNoTests: true,
    coverage: {
      // istanbul 而非 v8：CI 镜像 bun:1-alpine 不含 Node.js，v8 provider 不可用
      provider: "istanbul",
      reporter: ["text", "html"],
      include: [
        "src/lib/**/*.{ts,tsx}",
        "src/hooks/**/*.{ts,tsx}",
        "src/services/**/*.{ts,tsx}",
        "src/stores/**/*.{ts,tsx}",
      ],
      exclude: [
        "**/*.test.{ts,tsx}",
        "src/test/**",
        // 胶水层（axios 拦截器 / sonner 包装）不适合 unit test
        "src/lib/api.ts",
        "src/lib/toast.ts",
      ],
      thresholds: { lines: 0, statements: 0, functions: 0, branches: 0 },
    },
  },
  ssr: {
    noExternal: ["zod"],
    resolve: {
      conditions: ["import", "module", "default"],
    },
  },
})