// 让 TypeScript 认识 .vue 文件和 Vite 的特性（import.meta.env 等）
/// <reference types="vite/client" />

// 自定义环境变量类型（构建时可注入，如 .env 文件或构建命令）
interface ImportMetaEnv {
  /** 服务端模式开关：VITE_SERVER_MODE=true 时使用 HttpApiProvider（预留） */
  readonly VITE_SERVER_MODE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
