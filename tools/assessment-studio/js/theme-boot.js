                // theme.js · 职责：首帧应用主题，防 FOUC(白屏闪烁)。
                // 必须在任何依赖 data-theme 的渲染之前执行，故置于 <head> 最先加载(见 index.html)。
                // V3.1: 首帧应用主题，防 FOUC (默认亮色，偏好存 localStorage)
                (function () {
                    try {
                        var t = localStorage.getItem('exam_theme');
                        document.documentElement.setAttribute('data-theme', t === 'dark' ? 'dark' : 'light');
                    } catch (e) {
                        document.documentElement.setAttribute('data-theme', 'light');
                    }
                })();
