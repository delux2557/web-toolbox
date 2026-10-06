        
                // parser.js · 职责：把 CSV / JSON 试卷解析为标准结构 { title, questions:[{id,type,content,options,answer}] }。
                // 纯函数、无全局状态；由 core.js 在导入/示例加载时调用。
                function parseCSV(text) {
                    // 兼容 UTF-8 BOM 与 \r\n 换行
                    const lines = text.replace(/^\uFEFF/, '').trim().split(/\r?\n/);
                    if (lines.length < 2) throw new Error('CSV 至少需要标题行和一行数据');
                    const headers = lines[0].split(',').map(h => h.trim());
                    const idxMap = {};
                    headers.forEach((h, i) => idxMap[h] = i);
                    const required = ['id', 'type', 'content', 'options', 'answer'];
                    for (const r of required) {
                        if (!(r in idxMap)) {
                            throw new Error(`CSV 缺少必需列: ${r}（题目/选项若含逗号、分号或换行，请改用 JSON 格式导入）`);
                        }
                    }
                    // 可选列：explain(答案解析)。有该列且非空时透传到题目，回顾/错题本中展示
                    const hasExplain = 'explain' in idxMap;
        
                    const questions = [];
                    for (let i = 1; i < lines.length; i++) {
                        const parts = lines[i].split(',').map(s => s.trim());
                        if (parts.length < 5) continue;
                        const id = parts[idxMap['id']] || `Q${i}`;
                        const type = parts[idxMap['type']];
                        const content = parts[idxMap['content']];
                        const optionsStr = parts[idxMap['options']];
                        const answerStr = parts[idxMap['answer']];
                        const options = optionsStr.split(';').map(s => s.trim()).filter(s => s);
                        let answer = answerStr.split(';').map(s => parseInt(s.trim())).filter(n => !isNaN(n));
                        if (answer.length === 0 && type !== 'judge') {
                            // 尝试单个数字
                            const single = parseInt(answerStr);
                            if (!isNaN(single)) answer = [single];
                        }
                        // 判断题型默认 answer [0] 表示对
                        if (type === 'judge' && answer.length === 0) answer = [0];
                        const q = { id, type, content, options, answer };
                        // 可选 explain 列：仅当有该列且值非空时写入
                        if (hasExplain && parts[idxMap['explain']]) q.explain = parts[idxMap['explain']];
                        questions.push(q);
                    }
                    if (questions.length === 0) throw new Error('CSV 解析后无有效题目（请确认每行包含 5 列，且题目/选项不含未转义的逗号；必要时改用 JSON 导入）');
                    return { title: 'CSV导入试卷', questions };
                }
        
                function parseJSON(text) {
                    const data = JSON.parse(text);
                    if (!data.questions || !Array.isArray(data.questions) || data.questions.length === 0) {
                        throw new Error('JSON 必须包含 questions 数组');
                    }
                    return data;
                }
