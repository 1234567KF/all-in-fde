import "./index.css"

import { QueryClientProvider } from "@tanstack/react-query"
import { ThemeProvider } from "@workspace/ui/components/providers/theme-provider"
import { queryClient } from "@workspace/web-core/lib/query"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { BrowserRouter } from "react-router-dom"

import { APP_TITLE } from "@/lib/app-config"

import App from "./App"

// 用 APP_TITLE 覆盖 index.html 的静态 title（生成项目由 scaffold 重写 APP_TITLE）
document.title = APP_TITLE

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter basename={import.meta.env.BASE_URL}>
        <ThemeProvider defaultTheme="system">
          <App />
        </ThemeProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>
)
