// ============================================================
// 平台服务接口（ApiProvider）—— 插件的"供电标准"
// ------------------------------------------------------------
// 插件只面向这个接口编程，不感知当前是"本地模式"还是"云端模式"：
//   - 现在：LocalApiProvider（localStorage / 用户自备 Key / webhook）
//   - 未来：HttpApiProvider（fetch 到自建服务端）
// 演进时只需在 services/index.ts 切换实现，所有插件零改动。
// 这就是为"后期有服务端"预留的架构位。
// ============================================================

/** 插件级持久化数据（区别于 usePersistence 的应用级数据） */
export interface ApiProvider {
  /** 保存插件自己的数据（按插件隔离命名空间） */
  persist(pluginId: string, key: string, data: unknown): Promise<void>
  /** 读取插件数据（没有则返回 null） */
  load(pluginId: string, key: string): Promise<unknown | null>
  /** AI 生成：模型 + 提示词 → 文本（AI 代理类插件的支撑） */
  aiGenerate(model: string, prompt: string): Promise<string>
  /** 推送结果到外部系统（连接器类插件的支撑，如飞书 webhook） */
  pushConnector(connectorId: string, payload: unknown): Promise<void>
}

/** 当前是否处于"云端模式"（服务端部署后置为 true，或由构建环境变量注入） */
/**
 * 当前是否处于"云端模式"（有服务端后通过构建注入：
 *   .env 文件写 VITE_SERVER_MODE=true，或构建命令注入）
 * 切换后 services/index.ts 改为实例化 HttpApiProvider，插件零改动。
 */
export const IS_SERVER_MODE = import.meta.env.VITE_SERVER_MODE === 'true'
