/* ============================================================
 * dialog.js — 通用弹窗（输入 / 确认 / 选择 / 提示 / 一览表 / 高危二次确认）
 * ------------------------------------------------------------
 * 六个出口：
 *   promptDialog()  —— 单行输入，带回车提交与同步校验
 *   confirmDialog() —— 普通确认
 *   selectDialog()  —— 下拉选择（「移动到…」选目标目录）
 *   alertDialog()   —— 单按钮提示（只需用户知情）
 *   sheetDialog()   —— 只读一览表（「快捷键一览」），支持分栏 + 滚动
 *   dangerConfirm() —— 高危操作：要求输入磁盘上真实存在的名称才能继续
 *                      （比 yes/no 更难误触，且强迫用户核对目标）
 * 所有用户可控文本一律走 textContent，不做 innerHTML 拼接
 *   （build() 里的 innerHTML 只用于**静态骨架**，不含任何变量）。
 * ============================================================ */

import { els } from "./dom.js";

function build(html) {
  const layer = document.createElement("div");
  layer.className = "dlg-layer";
  layer.innerHTML = html;
  els.dialogHost.appendChild(layer);
  return layer;
}

function close(layer) {
  layer.classList.remove("show");
  setTimeout(() => layer.remove(), 140);
}

function mount(layer) {
  requestAnimationFrame(() => layer.classList.add("show"));
}

/* 绑定：点遮罩关闭、Esc 关闭 */
function bindDismiss(layer, onCancel) {
  layer.addEventListener("mousedown", (e) => { if (e.target === layer) onCancel(); });
  const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); onCancel(); } };
  layer.addEventListener("keydown", onKey);
  return () => layer.removeEventListener("keydown", onKey);
}

/**
 * 单行输入弹窗。
 * @param {object} opt {title, label, value, placeholder, hint, okText, validate}
 * @returns {Promise<string|null>} 取消返回 null
 */
export function promptDialog(opt) {
  return new Promise((resolve) => {
    const layer = build(
      '<div class="dlg" role="dialog" aria-modal="true">' +
        '<div class="dlg-title"></div>' +
        '<div class="dlg-label"></div>' +
        '<input class="dlg-input" type="text" autocomplete="off" spellcheck="false" />' +
        '<div class="dlg-hint"></div>' +
        '<div class="dlg-actions">' +
          '<button class="btn btn-ghost btn-sm dlg-cancel" type="button">取消</button>' +
          '<button class="btn btn-primary btn-sm dlg-ok" type="button">确定</button>' +
        '</div>' +
      "</div>"
    );
    layer.querySelector(".dlg-title").textContent = opt.title || "输入";
    layer.querySelector(".dlg-label").textContent = opt.label || "";
    layer.querySelector(".dlg-hint").textContent = opt.hint || "";
    layer.querySelector(".dlg-ok").textContent = opt.okText || "确定";

    const input = layer.querySelector(".dlg-input");
    input.value = opt.value || "";
    input.placeholder = opt.placeholder || "";

    const hintEl = layer.querySelector(".dlg-hint");
    const okBtn = layer.querySelector(".dlg-ok");

    let done = false;
    const finish = (val) => {
      if (done) return;
      done = true;
      unbind();
      close(layer);
      resolve(val);
    };

    const submit = () => {
      const v = input.value;
      const err = opt.validate ? opt.validate(v) : "";
      if (err) {
        hintEl.textContent = err;
        hintEl.classList.add("is-error");
        input.focus();
        input.select();
        return;
      }
      finish(v.trim());
    };

    const unbind = bindDismiss(layer, () => finish(null));
    layer.querySelector(".dlg-cancel").addEventListener("click", () => finish(null));
    okBtn.addEventListener("click", submit);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); submit(); }
    });
    input.addEventListener("input", () => {
      hintEl.classList.remove("is-error");
      hintEl.textContent = opt.hint || "";
    });

    mount(layer);
    input.focus();
    input.select();
  });
}

/**
 * 普通确认。
 * @returns {Promise<boolean>}
 */
export function confirmDialog(opt) {
  return new Promise((resolve) => {
    const layer = build(
      '<div class="dlg" role="dialog" aria-modal="true">' +
        '<div class="dlg-title"></div>' +
        '<div class="dlg-msg"></div>' +
        '<div class="dlg-actions">' +
          '<button class="btn btn-ghost btn-sm dlg-cancel" type="button">取消</button>' +
          '<button class="btn btn-primary btn-sm dlg-ok" type="button">确定</button>' +
        '</div>' +
      "</div>"
    );
    layer.querySelector(".dlg-title").textContent = opt.title || "确认";
    layer.querySelector(".dlg-msg").textContent = opt.message || "";
    layer.querySelector(".dlg-ok").textContent = opt.okText || "确定";

    let done = false;
    const finish = (val) => {
      if (done) return;
      done = true;
      unbind();
      close(layer);
      resolve(val);
    };
    const unbind = bindDismiss(layer, () => finish(false));
    layer.querySelector(".dlg-cancel").addEventListener("click", () => finish(false));
    layer.querySelector(".dlg-ok").addEventListener("click", () => finish(true));
    layer.querySelector(".dlg-ok").addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); finish(true); }
    });

    mount(layer);
    layer.querySelector(".dlg-ok").focus();
  });
}

/**
 * 下拉选择弹窗（用于「移动到…」选目标目录）。
 * @param {object} opt {title, label, options:[{value,label}], value, okText}
 * @returns {Promise<string|null>}
 */
export function selectDialog(opt) {
  return new Promise((resolve) => {
    const layer = build(
      '<div class="dlg" role="dialog" aria-modal="true">' +
        '<div class="dlg-title"></div>' +
        '<div class="dlg-label"></div>' +
        '<select class="dlg-select"></select>' +
        '<div class="dlg-hint"></div>' +
        '<div class="dlg-actions">' +
          '<button class="btn btn-ghost btn-sm dlg-cancel" type="button">取消</button>' +
          '<button class="btn btn-primary btn-sm dlg-ok" type="button">确定</button>' +
        '</div>' +
      "</div>"
    );
    layer.querySelector(".dlg-title").textContent = opt.title || "选择";
    layer.querySelector(".dlg-label").textContent = opt.label || "";
    layer.querySelector(".dlg-hint").textContent = opt.hint || "";
    layer.querySelector(".dlg-ok").textContent = opt.okText || "确定";

    const sel = layer.querySelector(".dlg-select");
    for (const o of (opt.options || [])) {
      const op = document.createElement("option");
      op.value = o.value;
      op.textContent = o.label;          // textContent：目录名里的 <> 不会被解析
      sel.appendChild(op);
    }
    if (opt.value != null) sel.value = opt.value;

    let done = false;
    const finish = (val) => {
      if (done) return;
      done = true;
      unbind();
      close(layer);
      resolve(val);
    };
    const unbind = bindDismiss(layer, () => finish(null));
    layer.querySelector(".dlg-cancel").addEventListener("click", () => finish(null));
    layer.querySelector(".dlg-ok").addEventListener("click", () => finish(sel.value));

    mount(layer);
    sel.focus();
  });
}

/**
 * 单按钮提示框（只需用户知情，不需要选择）。
 * 用于「保存失败」这类必须被看见、但用户也只能确认一下的场合。
 * @returns {Promise<void>}
 */
export function alertDialog(opt) {
  return new Promise((resolve) => {
    const layer = build(
      '<div class="dlg" role="alertdialog" aria-modal="true">' +
        '<div class="dlg-title"></div>' +
        '<div class="dlg-msg"></div>' +
        '<div class="dlg-hint"></div>' +
        '<div class="dlg-actions">' +
          '<button class="btn btn-primary btn-sm dlg-ok" type="button">知道了</button>' +
        '</div>' +
      "</div>"
    );
    layer.querySelector(".dlg-title").textContent = opt.title || "提示";
    layer.querySelector(".dlg-msg").textContent = opt.message || "";
    layer.querySelector(".dlg-hint").textContent = opt.hint || "";
    layer.querySelector(".dlg-ok").textContent = opt.okText || "知道了";

    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      unbind();
      close(layer);
      resolve();
    };
    const unbind = bindDismiss(layer, finish);
    layer.querySelector(".dlg-ok").addEventListener("click", finish);

    mount(layer);
    layer.querySelector(".dlg-ok").focus();
  });
}

/**
 * 把「和弦数组」渲染成可视键位（每个键一个 <kbd>）。
 * 例：[[ "Alt", "↑" ], [ "Alt", "↓" ]] → `Alt + ↑` / `Alt + ↓`
 * @param {string[][]} chords
 */
function keysNode(chords) {
  const wrap = document.createElement("span");
  wrap.className = "sc-chords";
  (chords || []).forEach((tokens, ci) => {
    if (ci) {
      const sep = document.createElement("span");
      sep.className = "sc-or";
      sep.textContent = "/";
      wrap.appendChild(sep);
    }
    (tokens || []).forEach((t, ti) => {
      if (ti) {
        const plus = document.createElement("span");
        plus.className = "sc-plus";
        plus.textContent = "+";
        wrap.appendChild(plus);
      }
      const k = document.createElement("kbd");
      k.textContent = t;
      wrap.appendChild(k);
    });
  });
  return wrap;
}

/**
 * 只读信息弹层：用于「快捷键一览」这类纯展示内容（内容较长，需要滚动与分栏）。
 * 内容全部走 DOM API + textContent —— 与其它弹窗同一条原则，不做 HTML 拼串。
 * @param {object} opt {title, message, note, groups:[{label, rows:[{keys, desc}]}]}
 *        rows[].keys 是「和弦数组」，形如 [[ "Ctrl", "S" ]]
 * @returns {Promise<void>}
 */
export function sheetDialog(opt) {
  return new Promise((resolve) => {
    const layer = build(
      '<div class="dlg dlg-sheet" role="dialog" aria-modal="true">' +
        '<div class="dlg-title"></div>' +
        '<div class="dlg-msg"></div>' +
        '<div class="sc-body"></div>' +
        '<div class="dlg-hint"></div>' +
        '<div class="dlg-actions">' +
          '<button class="btn btn-primary btn-sm dlg-ok" type="button">知道了</button>' +
        '</div>' +
      "</div>"
    );
    layer.querySelector(".dlg-title").textContent = opt.title || "快捷键";
    layer.querySelector(".dlg-msg").textContent = opt.message || "";
    layer.querySelector(".dlg-hint").textContent = opt.note || "";

    const body = layer.querySelector(".sc-body");
    for (const g of (opt.groups || [])) {
      const box = document.createElement("div");
      box.className = "sc-group";

      const head = document.createElement("div");
      head.className = "sc-group-title";
      head.textContent = g.label || "";
      box.appendChild(head);

      const grid = document.createElement("div");
      grid.className = "sc-group-body";
      for (const row of (g.rows || [])) {
        const k = document.createElement("span");
        k.className = "sc-keys";
        k.appendChild(keysNode(row.keys));

        const d = document.createElement("span");
        d.className = "sc-desc";
        d.textContent = row.desc || "";

        grid.appendChild(k);
        grid.appendChild(d);
      }
      box.appendChild(grid);
      body.appendChild(box);
    }

    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      unbind();
      close(layer);
      resolve();
    };
    const unbind = bindDismiss(layer, finish);
    layer.querySelector(".dlg-ok").addEventListener("click", finish);

    mount(layer);
    layer.querySelector(".dlg-ok").focus();
  });
}

/**
 * 高危二次确认：必须原样输入 confirmWord 才能提交。
 * @param {object} opt {title, message, confirmWord, okText, hint}
 * @returns {Promise<boolean>}
 */
export function dangerConfirm(opt) {
  return new Promise((resolve) => {
    const layer = build(
      '<div class="dlg dlg-danger" role="dialog" aria-modal="true">' +
        '<div class="dlg-title"></div>' +
        '<div class="dlg-msg"></div>' +
        '<div class="dlg-word">请输入 <code class="dlg-word-val"></code> 以确认</div>' +
        '<input class="dlg-input" type="text" autocomplete="off" spellcheck="false" placeholder="原样输入上述名称" />' +
        '<div class="dlg-hint"></div>' +
        '<div class="dlg-actions">' +
          '<button class="btn btn-ghost btn-sm dlg-cancel" type="button">取消</button>' +
          '<button class="btn btn-danger btn-sm dlg-ok" type="button" disabled></button>' +
        '</div>' +
      "</div>"
    );
    const word = String(opt.confirmWord || "");
    layer.querySelector(".dlg-title").textContent = opt.title || "高危操作确认";
    layer.querySelector(".dlg-msg").textContent = opt.message || "";
    layer.querySelector(".dlg-word-val").textContent = word;
    layer.querySelector(".dlg-hint").textContent = opt.hint || "";
    layer.querySelector(".dlg-ok").textContent = opt.okText || "确认执行";

    const input = layer.querySelector(".dlg-input");
    const okBtn = layer.querySelector(".dlg-ok");

    const sync = () => { okBtn.disabled = input.value.trim() !== word; };
    input.addEventListener("input", sync);
    sync();

    let done = false;
    const finish = (val) => {
      if (done) return;
      done = true;
      unbind();
      close(layer);
      resolve(val);
    };
    const unbind = bindDismiss(layer, () => finish(false));
    layer.querySelector(".dlg-cancel").addEventListener("click", () => finish(false));
    okBtn.addEventListener("click", () => { if (!okBtn.disabled) finish(true); });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !okBtn.disabled) { e.preventDefault(); finish(true); }
    });

    mount(layer);
    input.focus();
  });
}
