import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    fs: {
      // The example fixture lives in ../examples so the backend tests can
      // read the same file. Let the dev server serve it.
      allow: ['..'],
    },
  },
})
