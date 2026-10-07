        
                function downloadFile(name, content, mime) {
                    const blob = new Blob([content], { type: mime });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = name;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                }
        
                function downloadCSVTemplate() {
                    const csv = [
                        'id,type,content,options,answer,explain',
                        'Q1,single,JavaScript 中声明变量的关键字是？,int;let;float;string,1,let 是 ES6 起推荐的块级声明变量关键字',
                        'Q2,multi,属于前端框架的有？,React;Vue;Django;Angular,0;1;3,Django 是后端框架',
                        'Q3,judge,CSS 的 display:flex 用于弹性布局。,正确;错误,0,'
                    ].join('\n');
                    downloadFile('试卷模板.csv', csv, 'text/csv;charset=utf-8');
                }
        
                function downloadJSONTemplate() {
                    const json = {
                        title: '试卷模板',
                        questions: [
                            { id: 'Q1', type: 'single', content: '示例单选题', options: ['选项A', '选项B', '选项C'], answer: [0], explain: '这是解析：选 A 的正确原因。' },
                            { id: 'Q2', type: 'multi', content: '示例多选题', options: ['选项A', '选项B', '选项C'], answer: [0, 1] },
                            { id: 'Q3', type: 'judge', content: '示例判断题', options: ['正确', '错误'], answer: [0] }
                        ]
                    };
                    downloadFile('试卷模板.json', JSON.stringify(json, null, 2), 'application/json;charset=utf-8');
                }
        
                // 8. 导出自包含 HTML
                // ================================================================
                // 在 <head> 之后注入代码片段 (用 indexOf 定位，避免题目内容里的 "<head>" 字符串误伤)
                function injectAfterHead(html, code) {
                    const marker = '<head>';
                    const pos = html.indexOf(marker);
                    if (pos === -1) return code + html;
                    const insertAt = pos + marker.length;
                    return html.slice(0, insertAt) + '\n    ' + code + html.slice(insertAt);
                }
        
                // 导出自包含 HTML：克隆「运行时 DOM」并剥离管理端元素，注入试卷数据，得到纯净考生端单文件。
                // 关键前提：考生的 CSS/JS 必须「已内联进文档」才会随 clone 带走 ——
                // 故 dist(构建产物)天然自包含；src 则在此处用 fetch 把外部引用内联(见下述 EXPORT_SKIP_SRC)。
                // 导出时「智能内联」的资源来源：以当前文档声明的本地 <link>/<script src> 为准，
                // 而非在代码里硬编码一份文件清单 —— 新增样式/脚本自动被带上，且保持文档出现顺序 = 脚本依赖顺序。
                // 少数不希望内联的外部地址(如 CDN)可加入此数组跳过 (默认空)。
                const EXPORT_SKIP_SRC = [];
        
                async function exportSelfContained() {
                    if (!examData) { if (typeof showToast === 'function') showToast('请先载入试卷数据'); return; }
                    // V3.5: 导出前先把「外部引用的 css/js」内联进克隆 DOM。
                    // build(dist) 模式样式/脚本本就内联，无需 fetch；源码(本地 HTTP)模式才需内联。
                    const clone = document.documentElement.cloneNode(true);
                    const externals = [];
                    clone.querySelectorAll('link[rel="stylesheet"][href], script[src]').forEach(el => {
                        const ref = el.getAttribute('href') || el.getAttribute('src');
                        if (ref && !EXPORT_SKIP_SRC.includes(ref)) externals.push(el);
                    });
                    if (externals.length > 0) {
                        const failed = [];
                        for (const el of externals) {
                            const ref = el.getAttribute('href') || el.getAttribute('src');
                            try {
                                // 相对路径基于当前页面 base 解析(本地 HTTP 下有效)
                                const res = await fetch(new URL(ref, document.baseURI).href);
                                if (!res.ok) throw new Error('HTTP ' + res.status);
                                const text = await res.text();
                                if (el.tagName === 'LINK') {
                                    const style = clone.ownerDocument.createElement('style');
                                    // 与 build.mjs 的 inlineSafe 保持一致：CSS 内容里若出现字面 style 结束标签
                                    // ( "<\\/style>" )，会提前闭合内联 <style> 块、截断后续样式 → 同样需要转义
                                    style.textContent = text.replace(/<\/style/gi, '<\\/style');
                                    el.parentNode.replaceChild(style, el);
                                } else {
                                    el.removeAttribute('src');
                                    // 防止脚本内容里的 "<\/script>" 提前闭合内联标签
                                    el.textContent = text.replace(/<\/script/gi, '<\\/script');
                                }
                            } catch (e) {
                                failed.push(ref);
                            }
                        }
                        if (failed.length > 0) {
                            alert('导出需要以本地 HTTP 服务打开才能内联资源。\n以下资源无法读取：\n' +
                                failed.join('\n') +
                                '\n\n请用 python -m http.server 等方式启动后重试。');
                            return;
                        }
                    }
                    const doctype = '<!DOCTYPE html>\n';
                    clone.removeAttribute('data-theme'); // V3.2: 考生端主题交由对方设备偏好决定 (防 FOUC 脚本兜底)
                    clone.querySelectorAll('.toolbar, .manage-wrap, #helpBtn, #templateBtn, #helpModal').forEach(el => el.remove());
                    // 注入数据到 window 对象 (放在 <script> 顶部)
                    // 关键：将 "<" 统一替换为 "\u003c"，防止题目内容中的 "<\/script>" 提前闭合脚本标签
                    const dataStr = JSON.stringify(examData).replace(/</g, '\\u003c');
                    const scriptTag = `<script>window.__EMBEDDED_EXAM__ = ${dataStr};window.__EXAM_CLIENT_MODE__ = true;window.__EXAM_MODE__ = '${mode}';<\/script>`;
                    // 只注入「数据」这一段，不另注入加载器：
                    // 载入时机交给 app.js 的启动分支统一决定（嵌入试卷优先级最高）。
                    // 历史坑：这里曾再注入一段 loader，用 (function(){ if(window.__EMBEDDED_EXAM__){ 注册 DOMContentLoaded }})
                    // 的形式等待加载。但 injectAfterHead 两次插在同一位置 → 后插的 loader 跑到数据脚本**前面**，
                    // 外层 if 在数据还没定义时就求值 → 恒为假 → 监听器从未注册 → 嵌入试卷被静默忽略，
                    // 页面回落到「本地进度 / 内置题库」，表现为「导出的客户端打开还是别的卷子」。
                    // 教训：**判据不要在脚本刚执行时求值，除非能保证它已定义**；顺序敏感的注入本来就该避免。
                    const finalHtml = injectAfterHead(clone.outerHTML, scriptTag);
        
                    // 下载
                    const blob = new Blob([doctype + finalHtml], { type: 'text/html;charset=utf-8' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = '考试客户端.html';
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                    return finalHtml;
                }
        
                // 暴露 loadEmbedded 给导出的 HTML 使用（由 app.js 的启动分支调用）
                window.loadEmbedded = function(data) {
                    if (data && data.questions) {
                        // V3.3: 应用导出时固化的答题模式
                        if (window.__EXAM_MODE__ === 'exam' || window.__EXAM_MODE__ === 'practice') {
                            setMode(window.__EXAM_MODE__, false);
                        }
                        // ★ 不要传 data.bankVersion：在 storage.js 的语义里，「备份带不带 bankVersion」
                        // 是「这份备份来自内置题库 还是 来自导入/导出的卷子」的标记 ——
                        // 带 bankVersion 的备份会被拿去和 DEFAULT_EXAM.bankVersion（内置英语题库）比对，
                        // 导出卷子的版本几乎必然不等 → 备份被误判为"过期进度"丢弃 → 刷新丢作答。
                        // 导出/导入的卷子一律 loadExamData(data)（activeBankVersion=null），
                        // 它是否该被恢复改由 storage.js 的 isBackupOfExam() 按卷子身份判定。
                        loadExamData(data);
                    }
                };
