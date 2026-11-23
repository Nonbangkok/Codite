import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Forward API calls to the bridge server started by `npm run dev`.
    proxy: {
      '/api': `http://localhost:${process.env.BRIDGE_PORT || 3002}`,
    },
  },
})
