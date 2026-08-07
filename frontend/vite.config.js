import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Served from the domain root on Vercel — no `base` path.
// (The old GitHub Pages build needed base: "/FAST-Dash".)
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          // SheetJS is only needed on /admin. Keeping it in its own chunk
          // means students never download the parser.
          xlsx: ['xlsx'],
        },
      },
    },
  },
})
