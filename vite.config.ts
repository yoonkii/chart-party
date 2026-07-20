import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: { port: 5199 },
  // GitHub Pages 프로젝트 페이지(https://<user>.github.io/chart-party/) 배포용
  base: process.env.GH_PAGES ? '/chart-party/' : '/',
})
