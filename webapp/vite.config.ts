import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { bookAssets } from './plugins/bookAssets'

export default defineConfig({
  // 用相对路径，产物可以直接双击 index.html 或丢到任意子路径下托管
  base: './',
  plugins: [react(), bookAssets()],
  build: {
    chunkSizeWarningLimit: 900,
  },
})
