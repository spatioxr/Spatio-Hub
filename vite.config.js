import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { policyPdfAssets } from './scripts/pdf-assets.mjs'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), policyPdfAssets()],
})
