import { defineConfig } from 'vite'
import path from 'path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { app as honoApp } from './supabase/functions/server/index.tsx'

function figmaAssetResolver() {
  return {
    name: 'figma-asset-resolver',
    resolveId(id: string) {
      if (id.startsWith('figma:asset/')) {
        const filename = id.replace('figma:asset/', '')
        return path.resolve(__dirname, 'src/assets', filename)
      }
    },
  }
}

function localApiMiddleware() {
  const handle = async (req: any, res: any, next: any) => {
    const urlPath = req.url || ''
    if (!urlPath.startsWith('/make-server-a2e7e82a')) {
      return next()
    }
    try {
      const protocol = req.headers['x-forwarded-proto'] || 'http'
      const host = req.headers.host || 'localhost:3000'
      const fullUrl = `${protocol}://${host}${urlPath}`

      const headers = new Headers()
      for (const [k, v] of Object.entries(req.headers)) {
        if (v === undefined) continue
        if (Array.isArray(v)) {
          for (const item of v) headers.append(k, String(item))
        } else {
          headers.set(k, String(v))
        }
      }

      const method = (req.method || 'GET').toUpperCase()
      let body: Buffer | undefined
      if (method !== 'GET' && method !== 'HEAD') {
        const chunks: Buffer[] = []
        for await (const chunk of req) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
        }
        body = Buffer.concat(chunks)
      }

      const webReq = new Request(fullUrl, {
        method,
        headers,
        body: body && body.length > 0 ? new Uint8Array(body) : undefined,
      })

      const webRes = await honoApp.fetch(webReq)
      res.statusCode = webRes.status
      webRes.headers.forEach((value, key) => {
        res.setHeader(key, value)
      })
      const arrayBuf = await webRes.arrayBuffer()
      res.end(Buffer.from(arrayBuf))
    } catch (err) {
      console.error('Local API middleware error:', err)
      if (!res.headersSent) {
        res.statusCode = 500
        res.setHeader('Content-Type', 'application/json')
      }
      res.end(JSON.stringify({ error: String((err as any)?.message || err) }))
    }
  }

  return {
    name: 'local-hono-api-middleware',
    configureServer(server: any) {
      server.middlewares.use(handle)
    },
    configurePreviewServer(server: any) {
      server.middlewares.use(handle)
    },
  }
}

export default defineConfig({
  plugins: [
    figmaAssetResolver(),
    localApiMiddleware(),
    // The React and Tailwind plugins are both required for Make, even if
    // Tailwind is not being actively used – do not remove them
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      // Alias @ to the src directory
      '@': path.resolve(__dirname, './src'),
    },
  },

  server: {
    host: '0.0.0.0',
    port: 3000,
    allowedHosts: true,
  },
  preview: {
    host: '0.0.0.0',
    port: 3000,
    allowedHosts: true,
  },

  // File types to support raw imports. Never add .css, .tsx, or .ts files to this.
  assetsInclude: ['**/*.svg', '**/*.csv'],
})

