/* ============================================================
 * state.js — 应用可变状态（集中管理，避免模块间散落的全局变量）
 * ============================================================ */

import { FALLBACK_SCENARIO, DEFAULT_PROMPT_INTRO } from "./constants.js";

export const state = {
  fullMarkdown: "",           // 完整可导出 Markdown（含 System Prompt）
  markdownBody: "",           // 不含 System Prompt 的主体（场景切换局部刷新复用）
  fileCount: 0,
  totalChars: 0,
  tokenEst: 0,
  skipCount: 0,
  logLine: "",
  promptIntro: DEFAULT_PROMPT_INTRO,   // 场景引导文案（scenarios.json 顶层 promptIntro 覆盖）
  scenarios: [],
  currentScenario: FALLBACK_SCENARIO,
  currentFiles: [],
  currentRootName: "",
  currentWarnings: [],
  locatePath: null,           // 当前定位的文件路径（null = 默认首尾折叠）
  dirFirstFile: new Map(),    // 目录路径 → 该目录下第一个文件路径
  sourceName: "",             // 本次扫描来源名（重聚合沿用）
  rawEntries: [],             // 完整原始文件条目（含被规则排除者，支撑就地面调整）
  readCache: new Map(),       // path → 读取结果（重聚合复用，避免重复读盘）
  skippedRule: [],            // 本次被规则排除的文件 [{path,name,reason}]
  hasResult: false            // 是否已有扫描结果（决定规则面板能否「应用并重聚合」）
};