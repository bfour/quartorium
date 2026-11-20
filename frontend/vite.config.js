import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api/local': {
        target: 'http://127.0.0.1:8001',
        changeOrigin: true,
        bypass(req) {
          const loopback = ['127.0.0.1', '::1', '::ffff:127.0.0.1'];
          const localHost = /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i;
          if (!loopback.includes(req.socket.remoteAddress) || !localHost.test(req.headers.host)) return false;
          if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) return false;
        },
      },
      // Proxying API requests to the backend
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
})
