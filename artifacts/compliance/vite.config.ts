import path from 'path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

import runtimeErrorOverlay from '@replit/vite-plugin-runtime-error-modal';

// Base path is only meaningful for asset URLs; default to root so a production
// `vite build` never fails on a missing env var. In dev/preview the platform
// injects BASE_PATH via the artifact's [services.env].
const basePath = process.env.BASE_PATH ?? '/';

// Resolve the port used by the dev/preview servers. PORT is ONLY needed when
// actually serving (`vite` / `vite preview`) — a static production build
// (`vite build`) has no server to bind, so requiring it there would break the
// deploy build. Enforce it strictly for `serve`, fall back otherwise.
function resolvePort(command: string): number {
  const rawPort = process.env.PORT;
  if (command !== 'serve') {
    return rawPort ? Number(rawPort) || 5173 : 5173;
  }
  if (!rawPort) {
    throw new Error('PORT environment variable is required but was not provided.');
  }
  const parsed = Number(rawPort);
  if (Number.isNaN(parsed) || parsed <= 0) {
    throw new Error(`Invalid PORT value: "${rawPort}"`);
  }
  return parsed;
}

export default defineConfig(async ({ command }) => {
  const port = resolvePort(command);

  return {
    base: basePath,
    plugins: [
      react(),
      tailwindcss({ optimize: false }),
      runtimeErrorOverlay(),
      ...(process.env.NODE_ENV !== 'production' &&
      process.env.REPL_ID !== undefined
        ? [
            await import('@replit/vite-plugin-cartographer').then((m) =>
              m.cartographer({
                root: path.resolve(import.meta.dirname, '..'),
              }),
            ),
            await import('@replit/vite-plugin-dev-banner').then((m) =>
              m.devBanner(),
            ),
          ]
        : []),
    ],
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, 'src'),
        '@assets': path.resolve(
          import.meta.dirname,
          '..',
          '..',
          'attached_assets',
        ),
      },
      dedupe: ['react', 'react-dom'],
    },
    root: path.resolve(import.meta.dirname),
    build: {
      outDir: path.resolve(import.meta.dirname, 'dist/public'),
      emptyOutDir: true,
    },
    server: {
      port,
      strictPort: true,
      host: '0.0.0.0',
      allowedHosts: true,
      fs: {
        strict: true,
      },
    },
    preview: {
      port,
      host: '0.0.0.0',
      allowedHosts: true,
    },
  };
});
