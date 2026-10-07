        
                // storage.js · 职责：localStorage 进度备份/恢复(题目、作答、判定、计时、模式)。
                // 通过全局 examData / userAnswers / timerSeconds / isSubmitted 等与 core.js 共享，
                // 必须在本文件(依赖方)于 core.js 之后加载，且依赖 core.js 暴露的 beginTimer/stopTimer。
                // 从 localStorage 恢复
                function loadFromStorage() {
                    try {
                        const raw = localStorage.getItem('exam_backup');
                        if (!raw) return null;
                        const data = JSON.parse(raw);
                        // 内置题库版本校验，三种情况：
                        // ① 备份带 bankVersion 但与当前内置题库不一致 → 过期进度，丢弃重来（换题库后不会串题）。
                        // ② 备份没带 bankVersion、标题又是历史内置示例卷 → 同样是内置题，一并丢弃，
                        //    否则旧示例题会在页面打开时顶掉新的内置题库。
                        // ③ 其余没有 bankVersion 的备份 = 用户自己导入的试卷 → 照常恢复，不影响其历史进度。
                        const LEGACY_BUILTIN_TITLES = ['示例试卷 · 综合练习'];
                        if (data) {
                            const bv = data.bankVersion;
                            const title = data.examData && data.examData.title;
                            if ((bv && bv !== DEFAULT_EXAM.bankVersion) ||
                                (!bv && LEGACY_BUILTIN_TITLES.indexOf(title) !== -1)) {
                                return null;
                            }
                        }
                        // 结构校验：questions 必须是数组、userAnswers 必须是对象、timerSeconds 必须是数字
                        if (data.examData && Array.isArray(data.examData.questions) &&
                            data.examData.questions.length > 0 &&
                            data.userAnswers && typeof data.userAnswers === 'object' &&
                            typeof data.timerSeconds === 'number') {
                            return data;
                        }
                        return null;
                    } catch { return null; }
                }
        
                let saveTimer = null;        // 防抖计时器
                let savePending = false;     // 是否有未写入的备份
        
                function saveToStorage() {
                    if (!examData) return;
                    try {
                        const backup = {
                            examData,
                            userAnswers,
                            feedbackMap,
                            currentIndex,
                            timerSeconds,
                            timerStarted,
                            timerStartTs,
                            isSubmitted,
                            mode,
                            // 记录备份来自哪一版内置题库；导入的试卷为 null。题库版本变了 → 该备份作废
                            bankVersion: activeBankVersion,
                            // V3.7: 持久化「只练错题」重练会话 —— 否则刷新后 retryActive=null、原卷快照丢失，
                            // examData 仍是错题子集，会被误当成"原卷"，导致再进入只练错题后「返回原卷」回不到初始试卷。
                            retryActive: !!retryActive,
                            retrySnapshot: retrySnapshot && retrySnapshot.exam ? retrySnapshot : null
                        };
                        localStorage.setItem('exam_backup', JSON.stringify(backup));
                        savePending = false;
                    } catch (e) {
                        // QuotaExceededError 等：不中断主流程，仅告警
                        console.warn('[考试系统] 本地备份失败:', e && e.message ? e.message : e);
                    }
                }
        
                // 防抖写入：计时器每秒、答题点击等高频调用合并为一次
                function scheduleSave() {
                    if (!examData) return;
                    savePending = true;
                    clearTimeout(saveTimer);
                    saveTimer = setTimeout(() => { saveTimer = null; saveToStorage(); }, 500);
                }
        
                function clearStorage() {
                    localStorage.removeItem('exam_backup');
                }
        
                // 「这份备份是不是这份卷子的？」—— 只有「候选卷子明确」时才用得上（导出的考生端）。
                // 比 title + 题数 + 首尾各 3 题的「id+题干」指纹。
                // ★ 为什么必须比：file:// 下所有考生端文件共享同一个 localStorage origin，
                //   同一个 origin 里可能躺着另一份卷子的备份；不比对就会串卷
                //   —— 打开 B 卷却显示 A 卷的作答，而且 B 卷首次保存就会把 A 卷的备份覆盖掉。
                function isBackupOfExam(backup, candidateExam) {
                    const be = backup && backup.examData;
                    if (!be || !candidateExam) return false;
                    if (!Array.isArray(be.questions) || !Array.isArray(candidateExam.questions)) return false;
                    // title 与题数是最便宜的强判据；指纹再兜住「同名同题数但换了内容」
                    if ((be.title || '') !== (candidateExam.title || '')) return false;
                    if (be.questions.length !== candidateExam.questions.length) return false;
                    // ★ 指纹必须带上 options：作答按「选项下标」存（userAnswers[qIdx] = [optIdx]），
                    //   而「把选项打散」这种改版只动选项顺序、不动题干 ——
                    //   不带 options 就会把打散前后的两份卷子认成同一份，恢复后答案整体错位。
                    const fp = (qs) => qs.slice(0, 3).concat(qs.slice(-3))
                        .map((q) => [
                            String((q && q.id) || ''),
                            String((q && q.content) || '').slice(0, 40),
                            Array.isArray(q && q.options) ? q.options.join('\u0003') : ''
                        ].join('\u0001'))
                        .join('\u0002');
                    return fp(be.questions) === fp(candidateExam.questions);
                }

                // 检查是否有存储恢复。
                // candidateExam 仅在「导出的考生端」传入：那里候选卷子唯一且明确（来自嵌入数据），
                // 必须先确认备份属于这份卷子才恢复，否则用嵌入卷子开新一场。
                // 普通页面不传该参数 —— 内置题库与「用户此前导入的试卷」仍按 loadFromStorage 的原有守卫处理，
                // 行为与改动前完全一致（导入的卷子备份不带 bankVersion，照常恢复）。
                function tryRestoreFromStorage(candidateExam) {
                    const backup = loadFromStorage();
                    if (backup && backup.examData && Array.isArray(backup.examData.questions)) {
                        if (candidateExam && !isBackupOfExam(backup, candidateExam)) return false;
                        examData = backup.examData;
                        // 恢复题库版本标记：否则再次备份时该字段会丢，题库版本校验将失效（刷新后旧题库进度会永久留存）
                        activeBankVersion = backup.bankVersion || null;
                        userAnswers = backup.userAnswers || {};
                        feedbackMap = backup.feedbackMap || {};
                        currentIndex = backup.currentIndex || 0;
                        // 计时起点语义 V3.4：按「是否已开始」恢复；未开始则停在 00:00 等待首次作答。
                        // 精度修复 V3.6：仅当会话「真的已开始」才还原绝对时间戳；未开始(或旧备份)一律
                        // 复位 timerStartTs=0/timerSeconds=0。若此时错误地锚定成 Date.now()，
                        // 会让 beginTimer 里 `if(!timerStartTs)` 判定失败而不重置起点，导致计时基准
                        // 回溯到历史刷新时刻 —— 表现为空答也显示累积的大秒数。修复后在首次作答时才真正计时。
                        timerStarted = !!backup.timerStarted;
                        if (timerStarted) {
                            if (typeof backup.timerStartTs === 'number' && backup.timerStartTs > 0) {
                                timerStartTs = backup.timerStartTs;
                            } else {
                                // 旧备份仅存 timerSeconds 时反推起点时间，保持兼容
                                timerStartTs = Date.now() - (backup.timerSeconds || 0) * 1000;
                            }
                            timerSeconds = Math.max(0, Math.floor((Date.now() - timerStartTs) / 1000));
                        } else {
                            // 未开始：不锚定时间戳，复位为 0，首次作答时才真正计时
                            timerStartTs = 0;
                            timerSeconds = 0;
                        }
                        isSubmitted = backup.isSubmitted || false;
                        // V3.3: 恢复答题模式 (随进度备份)
                        if (backup.mode === 'exam' || backup.mode === 'practice') setMode(backup.mode, false);
                        // V3.7: 恢复「只练错题」重练会话，刷新后仍在错题子卷并保留可返回的原始试卷快照，
                        // 避免子卷被误当成"原卷"、再次只练错题后「返回原卷」回不到初始试卷。
                        retryActive = !!backup.retryActive;
                        retrySnapshot = (backup.retrySnapshot && backup.retrySnapshot.exam &&
                            Array.isArray(backup.retrySnapshot.exam.questions))
                            ? backup.retrySnapshot
                            : null;
                        timerDisplay.textContent = formatTime(timerSeconds);
                        // renderAll 内部已处理 isSubmitted 分支：显示成绩 + 批改样式
                        renderAll();
                        if (isSubmitted) {
                            submitBtn.disabled = true;
                        }
                        // 已开始的会话继续计时；未开始则等首次作答再启动
                        if (timerStarted && !isSubmitted) beginTimer();
                        return true;
                    }
                    return false;
                }
