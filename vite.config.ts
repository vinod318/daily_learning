import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// GitHub Pages project site: https://<user>.github.io/daily_learning/
export default defineConfig({
  base: '/daily_learning/',
  plugins: [react(), tailwindcss()],
})
