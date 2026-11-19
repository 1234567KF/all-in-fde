import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import path from "path"
import { defineConfig } from "vite"

import { readWebApp } from "../../scripts/lib/web-apps.js"

// 端配置唯一来源是根 web-apps.json：base / devPort / VITE_APP_ID / 准入码都从这里
// 注入，新增端只改注册表与下面的 APP_ID 常量，其余端内代码零改动。
const APP_ID = "web"
const app = readWebApp(path.resolve(__dirname, "../.."), APP_ID)

export default defineConfig({
  base: app.base,
  define: {
    "import.meta.env.VITE_APP_ID": JSON.stringify(app.id),
    "import.meta.env.VITE_APP_ACCESS_PERMISSION": JSON.stringify(
      app.accessPermission ?? ""
    ),
  },
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules")) {
            if (/[/]react[/]|[/]react-dom[/]|[/]react-router-dom[/]/.test(id)) {
              return "vendor-react"
            }
            if (/[/]lucide-react[/]|[/]sonner[/]|[/]cmdk[/]/.test(id)) {
              return "vendor-ui"
            }
            if (
              /[/]recharts[/]|[/]date-fns[/]|[/]react-day-picker[/]/.test(id)
            ) {
              return "vendor-data"
            }
            if (/[/]react-hook-form[/]|[/]zod[/]|[/]axios[/]/.test(id)) {
              return "vendor-form"
            }
            if (/[/]@tanstack[/]react-query[/]/.test(id)) {
              return "vendor-query"
            }
            if (/[/]@dnd-kit[/]/.test(id)) {
              return "vendor-dnd"
            }
          }
        },
        entryFileNames: "js/[name].[hash].js",
        chunkFileNames: "js/[name].[hash].js",
        assetFileNames: (assetInfo) => {
          const name = assetInfo.name ?? ""
          if (/\.(gif|jpe?g|png|svg|webp)$/.test(name))
            return "images/[name].[hash][extname]"
          if (/\.css$/.test(name)) return "css/[name].[hash][extname]"
          return "assets/[name].[hash][extname]"
        },
      },
    },
  },
  server: {
    port: app.devPort,
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
})
