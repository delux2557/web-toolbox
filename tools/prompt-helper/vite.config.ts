// Vite + Vitest 共用配置
// - Vite：本地开发服务器 / 打包
// - Vitest：单元测试（复用同一份 alias 配置）
//
// 打包架构（版本化发布）：
//   vite build 只负责把产物构建到 dist/.tmp-build/index.html（单文件），
//   然后由 scripts/build.mjs 布置到正式位置：
//     npm run build            → dist/latest/index.html
//     npm run release -- --version v1.2.0 --message "xxx"
//                              → dist/v1.2.0/index.html + RELEASE.md + 更新 latest
//   为什么多绕一步？vite build 默认会清空整个 outDir，
//   如果直接输出 dist/，历史版本文件夹（v1.0.0/…）会被全部删掉。
import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import { viteSingleFile } from 'vite-plugin-singlefile'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [vue(), viteSingleFile()],
  resolve: {
    // 路径别名：代码里写 @/xxx 就指向 src/xxx，避免写一长串相对路径
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    // 临时构建目录（scripts/build.mjs 会清掉它）
    outDir: 'dist/.tmp-build',
    // 让 vite 自己清空目录在某些沙箱环境会失败（Windows safe-delete 兼容问题），
    // 改由 npm scripts 在构建前手动清理（见 package.json）
    emptyOutDir: false,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
