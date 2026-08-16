# design-system（设计系统）

本目录是项目的**视觉基底**（Design Tokens + 通用组件样式），从 Context 项目 V5 提取。

## ⚠️ 维护注意（v1.5 起）

- **v1.5 之前**：本目录是"上游资产，不可修改"。
- **v1.5 起**（项目决策）：铁律解除，为支持"多维主题系统"（`data-color` × `data-style`），`components.css` 中的硬编码圆角/阴影/模糊已收敛为 CSS 变量（`--radius-*`、`--shadow-1/2`、`--blur`），与项目层 `src/styles/themes/` 联动。
- **升级代价**：若未来替换为新的 design-system 版本，需重新执行硬编码收敛（`grep -rn "border-radius: [0-9]"` 清零），并确保新版本变量名兼容（`--radius-s/m/l/xs/pill`、`--shadow-1/2`、`--blur`、`--surface-alpha`）。
- **变量权威层**：`src/styles/themes/`（最后加载覆盖本目录默认值）。
