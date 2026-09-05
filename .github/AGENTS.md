# AGENTS.md — web-toolbox 多 Agent 协作规约

> 本文件是**所有在本仓库工作的 AI agent（含云端各平台 agent 与本地 agent）的接入必读**。
> 多 agent 共用一个 GitHub 账号且互不认识 → 一切协调以本文件 + GitHub PR 为准。开工前请完整读完。

## 1. 仓库是什么

- `delux2557/web-toolbox`：个人工具集聚合仓库，GitHub Pages 部署，**根目录直接发布**（https://delux2557.github.io/web-toolbox/）。
- 结构：`tools/<project>/` 下是 8 个互相独立的子项目；根 `index.html` + `README.md` 是总入口。
- 无 CI、无测试链；main 有分支保护（禁止直推，须走 PR）。

## 2. 你的边界（最重要）

- **你只负责本次被指派的 `tools/<你的项目>/` 目录。**
- **绝对不要改**：根 `README.md`、根 `index.html`、`assets/`、其他任何 `tools/*` 目录、`.github/`（本文件除外，若派活方明确要求）。
- 需要更新总入口/README 时：不做，改在 PR 描述里写一句「请 ops 更新 README」。
- 提交时只 `git add` 自己目录内的文件（可用 `git status` 复核）。

## 3. 接入（云端 agent 用）

```bash
# 1) clone（只拉自己目录，省同步量；也可整仓 clone）
git clone git@github.com:delux2557/web-toolbox.git   # 或 https:// + PAT
cd web-toolbox
git sparse-checkout init --cone
git sparse-checkout set tools/<你的项目>

# 2) 开工前基于最新 main 开分支（严禁在他人分支/旧分支上续作）
git fetch origin
git checkout -b agent/<你的代号>/<项目>-<主题> origin/main
```

## 4. 分支与提交规范

- 分支名：`agent/<你的代号>/<项目>-<一句话主题>`，例如 `agent/alice/ppt-player-darkmode`。
- commit message 首行格式：`[<代号>] <项目>: <中文说明>`，例如 `[alice] ppt-player: 新增暗色主题`。
- 一次 PR 只做一件事；改动控制在你的目录内。

## 5. 完成后（PR 模板）

```bash
git add tools/<你的项目>/
git commit -m "[<代号>] <项目>: <说明>"
git push -u origin agent/<你的代号>/<项目>-<主题>
# 然后在 GitHub 网页开 PR → main，标题与 commit 一致
```

PR 描述必须包含：

```markdown
## 改动
（一句话 + 关键点）
## 影响范围
（仅 tools/<你的项目>/？有没有动共享文件？）
## 验证
（本地怎么验证的：打开页面？构建命令？纯静态改动写明"已本地打开 index.html 目测"）
## 需要 ops
（如需更新根 README / 发布 / 特别说明，写这里）
```

## 6. 规则

- main 不能直推；合并由 ops 执行（squash）。若 PR 落后 main（conflict/behind），用 `git fetch && git rebase origin/main` 后 force-push 自己的分支。
- 与别的 agent 撞车：你只改自己目录，理论上零冲突；万一共享文件冲突，**停手**，在 PR 里说明，由 ops 裁决。
- prompt-helper 是唯一有 npm 构建链的项目：改完跑 `npm run build`，产物同步规则遵循 `tools/prompt-helper/README.md` 的 Plan A 流程（本地构建 → 同步 → 提交），不要把 node_modules/dist 提交（已在 .gitignore）。
- 纯静态项目（其余 7 个）：改完本地浏览器打开 `tools/<你的项目>/index.html` 目测通过即可，无需构建。

## 7. 不知道就问

派活方（zz / ops agent）会在任务里注明你的代号与范围；没注明就先问，不要猜。GitHub API 与仓库操作问题在 PR 评论里提出。
