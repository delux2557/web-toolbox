// ============================================================
// 平台服务出口（services/index.ts）
// ------------------------------------------------------------
// 插件通过 `api` 访问平台能力，不感知具体实现。
// 未来演进为服务端时，只需把实现换成 HttpApiProvider：
//
//   import { HttpApiProvider } from './http'
//   export const api: ApiProvider = IS_SERVER_MODE
//     ? new HttpApiProvider()
//     : new LocalApiProvider()
//
// 插件代码零改动。这就是"单文件 → 有服务端"的平滑切换点。
// ============================================================
import type { ApiProvider } from './types'
import { LocalApiProvider } from './local'

export type { ApiProvider } from './types'
export { IS_SERVER_MODE } from './types'

/** 当前平台实例（所有插件共用） */
export const api: ApiProvider = new LocalApiProvider()
