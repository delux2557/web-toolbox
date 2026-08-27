/* ============================================================
 * markdown.js — 生成待导出的 Markdown（目录树 + 文件聚合 + System Prompt 块）
 * ============================================================ */

import { langFor, humanSize, num } from "./utils.js";
import { treeASCII, buildTreeObject } from "./tree.js";
import { DEFAULT_PROMPT_INTRO, FALLBACK_SCENARIO } from "./constants.js";
import { state } from "./state.js";

export function fence(content, lang) {
  let ticks = "```";
  while (content.includes(ticks)) ticks += "`";
  const open = ticks + (lang ? lang : "");
  return open + "\n" + content + (content.endsWith("\n") ? "" : "\n") + ticks;
}

export function buildMarkdown(rootName, files, warnings) {
  const chars = files.reduce((s, f) => s + f.content.length, 0);
  const tokens = Math.round(chars / 4);
  const treeObj = buildTreeObject(files.map((f) => f.path));
  const treeLines = [];
  treeASCII(treeObj, "", treeLines);

  const lines = [];
  lines.push("# 📊 Codebase Context");
  lines.push("");
  lines.push("**项目**: `" + rootName + "`");
  lines.push("");
  lines.push("- **总文件数**: " + files.length);
  lines.push("- **总字符数**: " + humanSize(chars) + " (" + num(chars) + ")");
  lines.push("- **预估 Token**: ~" + num(tokens));
  if (warnings.length) lines.push("- **跳过文件**: " + warnings.length);
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("## 🌳 目录结构");
  lines.push("");
  lines.push(fence(treeLines.join("\n"), "text"));
  lines.push("");
  lines.push("## 📁 文件内容聚合");
  lines.push("");

  for (const f of files) {
    lines.push("### `" + f.path + "`");
    lines.push("");
    lines.push(fence(f.content, langFor(f.path)));
    lines.push("");
  }
  return lines.join("\n");
}

/* 场景 System Prompt 注入块：人类可读强引导（引用块） */
/* 引导文案三级回退：场景级 promptIntro → 全局 promptIntro → 内置兜底 */
export function getPromptIntro(scenario) {
  if (scenario && scenario.promptIntro) return scenario.promptIntro;
  return state.promptIntro || DEFAULT_PROMPT_INTRO;
}

export function buildSystemPromptBlock(scenario) {
  const s = scenario || FALLBACK_SCENARIO;
  const prompt = s.systemPrompt || "";
  const parts = [];
  parts.push("> " + getPromptIntro(s));
  prompt.split("\n").forEach((l) => parts.push("> " + l));
  parts.push("");
  return parts.join("\n") + "\n";
}

/* 重建待导出 Markdown（首次扫描 / 重新扫描时调用）；主体部分缓存到 state.markdownBody */
export function updateExportData() {
  state.markdownBody = buildMarkdown(state.currentRootName, state.currentFiles, state.currentWarnings);
  state.fullMarkdown = buildSystemPromptBlock(state.currentScenario) + state.markdownBody;
}