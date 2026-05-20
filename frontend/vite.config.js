import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: process.env.VITE_BASE_PATH || '/',
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:7080',
        changeOrigin: true
      },
      '/socket.io': {
        target: 'http://localhost:7080',
        changeOrigin: true,
        ws: true
      }
    }
  }
})
