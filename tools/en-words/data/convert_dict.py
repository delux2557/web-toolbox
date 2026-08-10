"""
convert_dict.py — 将 ECDICT CSV 转换为 dict.js
输入: ecdict.csv (word,phonetic,definition,translation,pos,collins,oxford,tag,bnc,frq,exchange,detail,audio)
输出: dict.js — window.EWDICT = { "word": ["音标","释义≤60字","标签",词频], ... }
筛选: tag 含 cet4/cet6，或 frq 位于前列；目标 12000~20000 条；体积 ≤5MB
"""

import csv
import os
import sys
import re

CSV_PATH = os.path.join(os.path.dirname(__file__), "ecdict.csv")
OUT_PATH = os.path.join(os.path.dirname(__file__), "dict.js")
MAX_DEF_LEN = 60  # 释义截取最大长度
TARGET_MIN = 12000
TARGET_MAX = 20000
MAX_FILE_MB = 5

def truncate_def(text, max_len=MAX_DEF_LEN):
    """截取中文释义，保证 ≤ max_len 字"""
    if not text:
        return ""
    # 去换行、去多余空白
    text = re.sub(r'\s+', ' ', text).strip()
    # 取第一句或截断
    if len(text) <= max_len:
        return text
    # 尝试在标点处截断
    cutoff = text[:max_len]
    for sep in ['；', ';', '，', ',', '。', '.']:
        idx = cutoff.rfind(sep)
        if idx > max_len // 2:
            return cutoff[:idx]
    return cutoff[:max_len]

def get_tag_list(tag_str):
    """解析标签字符串"""
    if not tag_str:
        return set()
    return set(tag_str.strip().split())

def main():
    if not os.path.exists(CSV_PATH):
        print(f"错误：找不到 {CSV_PATH}，请先下载 ECDICT CSV 文件")
        sys.exit(1)

    # 第一遍：统计兼容
    collected = []  # (word, phonetic, definition, tags, frq)
    cet4_count = 0
    cet6_count = 0
    frq_high_count = 0

    with open(CSV_PATH, 'r', encoding='utf-8') as f:
        reader = csv.reader(f)
        header = next(reader, None)
        # 自动检测列索引
        col_map = {}
        for i, h in enumerate(header):
            col_map[h.strip().lower()] = i

        widx = col_map.get('word', 0)
        pidx = col_map.get('phonetic', 1)
        didx = col_map.get('definition', 2)
        tidx = col_map.get('translation', 3)
        tag_idx = col_map.get('tag', 7)
        frq_idx = col_map.get('frq', 9)

        for row in reader:
            try:
                word = row[widx].strip() if widx < len(row) else ""
                if not word or not word.isascii() or not word.replace("'", "").replace("-", "").isalpha():
                    continue
                phonetic = row[pidx].strip() if pidx < len(row) else ""
                # 释义优先用 translation（中文），其次 definition（英文）
                trans = row[tidx].strip() if tidx < len(row) else ""
                defn = row[didx].strip() if didx < len(row) else ""
                raw_def = trans if trans else defn
                definition = truncate_def(raw_def)

                tag_str = row[tag_idx].strip() if tag_idx < len(row) else ""
                tags = get_tag_list(tag_str)
                try:
                    frq = float(row[frq_idx]) if frq_idx < len(row) and row[frq_idx].strip() else 0
                except:
                    frq = 0

                is_cet4 = 'cet4' in tags
                is_cet6 = 'cet6' in tags

                if is_cet4:
                    cet4_count += 1
                if is_cet6:
                    cet6_count += 1

                # 收集：cet4/cet6 或 frq > 0
                if is_cet4 or is_cet6 or frq > 0:
                    collected.append((word, phonetic, definition, ','.join(sorted(tags)), frq))
                    if frq > 0 and not is_cet4 and not is_cet6:
                        frq_high_count += 1
            except:
                continue

    print(f"原始收集: {len(collected)} 条 (cet4: {cet4_count}, cet6: {cet6_count}, 高频: {frq_high_count})")

    # 去重（保留第一条）
    seen = set()
    unique = []
    for item in collected:
        if item[0] not in seen:
            seen.add(item[0])
            unique.append(item)
    collected = unique

    # 按优先级排序：cet4 + cet6 优先，再按 frq 排序
    def sort_key(item):
        word, phonetic, definition, tags_str, frq = item
        tags = set(tags_str.split(','))
        priority = 0
        if 'cet4' in tags: priority += 10000
        if 'cet6' in tags: priority += 5000
        return (-priority, frq)  # 高优先级在前，低词频（更生僻）在前

    collected.sort(key=sort_key)

    # 控制数量
    if len(collected) > TARGET_MAX:
        collected = collected[:TARGET_MAX]
    elif len(collected) < TARGET_MIN:
        print(f"警告：仅收集到 {len(collected)} 条，不足 {TARGET_MIN} 目标")

    # 输出 dict.js
    lines = ["// ECDICT 离线词典子集 — CET4/CET6 + 高频词"]
    lines.append("// 自动生成，请勿手动编辑")
    lines.append("window.EWDICT = {")
    for word, phonetic, definition, tags_str, frq in collected:
        # 转义 JSON 特殊字符
        esc_phonetic = phonetic.replace('\\', '\\\\').replace('"', '\\"')
        esc_def = definition.replace('\\', '\\\\').replace('"', '\\"')
        esc_tags = tags_str.replace('\\', '\\\\').replace('"', '\\"')
        lines.append(f'  "{word}": ["{esc_phonetic}","{esc_def}","{esc_tags}",{frq}],')

    # 去掉最后一个逗号
    if lines[-1].endswith(','):
        lines[-1] = lines[-1][:-1]

    lines.append("};")

    content = '\n'.join(lines)
    file_size_mb = len(content.encode('utf-8')) / (1024 * 1024)

    with open(OUT_PATH, 'w', encoding='utf-8') as f:
        f.write(content)

    # 重新统计
    final_cet4 = sum(1 for item in collected if 'cet4' in item[3].split(','))
    final_cet6 = sum(1 for item in collected if 'cet6' in item[3].split(','))

    print(f"\n===== 转换完成 =====")
    print(f"输出文件: {OUT_PATH}")
    print(f"条目数: {len(collected)}")
    print(f"其中 CET4: {final_cet4}, CET6: {final_cet6}")
    print(f"文件大小: {file_size_mb:.2f} MB")
    if file_size_mb > MAX_FILE_MB:
        print(f"⚠️ 超过 {MAX_FILE_MB}MB 限制！")

    # 打印 3 条样例
    print("\n前 3 条样例:")
    for i, (word, phonetic, definition, tags_str, frq) in enumerate(collected[:3]):
        print(f"  {word}: [{phonetic}] {definition} ({tags_str}, frq={frq})")

if __name__ == '__main__':
    main()
