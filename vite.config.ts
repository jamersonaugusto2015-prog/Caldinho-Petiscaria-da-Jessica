import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    build: {
      rollupOptions: {
        output: {
          /**
           * As bibliotecas pesadas saem em pedaços próprios, separadas do nosso
           * código. O motivo é o cache do celular: sem isto, corrigir uma linha
           * de texto no cardápio muda o hash do arquivo único e o aparelho
           * baixa o Leaflet e o GSAP de novo, a cada deploy.
           *
           * O agrupamento segue quem sempre anda junto — react com react-dom,
           * leaflet com react-leaflet — porque separá-los só multiplicaria as
           * requisições sem soltar nada do cache.
           */
          manualChunks(id: string) {
            // A forma de objeto (`{ react: ['react-dom'] }`) não serve aqui: o
            // app importa `react-dom/client` e `react/jsx-runtime`, que são
            // OUTROS módulos — o pedaço saía vazio e o React continuava colado
            // no bundle principal. Casar pelo caminho pega o pacote inteiro.
            const vendor = /[\\/]node_modules[\\/]((?:@[^\\/]+[\\/])?[^\\/]+)[\\/]/.exec(id);
            if (!vendor) return undefined;
            const pkg = vendor[1];

            if (pkg === 'react' || pkg === 'react-dom' || pkg === 'scheduler') return 'react';
            if (pkg === 'react-router' || pkg === 'react-router-dom') return 'react';
            if (pkg === 'leaflet' || pkg === 'react-leaflet' || pkg === '@react-leaflet') return 'map';
            if (pkg === 'gsap' || pkg === 'motion' || pkg === 'motion-dom' || pkg === 'motion-utils')
              return 'motion';
            if (pkg === 'framer-motion') return 'motion';
            if (pkg === 'socket.io-client' || pkg === 'engine.io-client' || pkg === 'engine.io-parser')
              return 'realtime';
            if (pkg === 'socket.io-parser') return 'realtime';
            // QR do Pix e o confete da entrega: os dois só aparecem no fim da
            // compra, e juntos custam mais que a tela inteira do cardápio.
            if (pkg === 'qrcode' || pkg === 'canvas-confetti') return 'checkout';
            return undefined;
          },
        },
      },
    },
    server: {
      proxy: {
        '/api': {
          target: 'http://localhost:3001',
          changeOrigin: true,
        },
        '/socket.io': {
          target: 'http://localhost:3001',
          ws: true,
        },
      },
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
