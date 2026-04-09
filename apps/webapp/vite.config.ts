import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'trailing-slash-redirect',
      configureServer(server) {
        server.middlewares.use((req, _res, next) => {
          if (req.url === '/public/webapp') {
            _res.writeHead(301, { Location: '/public/webapp/' });
            _res.end();
            return;
          }
          next();
        });
      },
    },
  ],
  resolve: {
    tsconfigPaths: true,
  },
  base: '/public/webapp/',
  build: {
    outDir: '../server/public/webapp',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
  },
});
