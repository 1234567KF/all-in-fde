#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""scan_flavor.py — ai-flavor-guard 确定性词汇剂量扫描器

只做可用正则/计数判定的检查，不依赖模型自觉。与 all-in-md 的 validate_doc.py
共用约定：代码围栏内不检查；行内含 <!-- nocheck --> 跳过全部规则。

用法:
  python scan_flavor.py <文本.md> --profile <档ID> [--gate warn|error]
                        [--report findings.md] [--json findings.json]
  python scan_flavor.py --list-profiles

档 ID 与预算数值的唯一真相源是 references/contexts.md 第 3 节；
词库唯一真相源是 references/lexicon.md。改这两处时 MUST 同步本文件的
PROFILES / LEXICON，否则扫描结果与规则不一致。

退出码: 0=无 ERROR（WARN 不阻断）; 1=存在 ERROR; 2=参数/文件错误

规则清单:
  AF-01 A1 纯黑话密度超预算 / 单段堆叠      gate 控制
  AF-02 A2 语境词密度超预算 / 单段堆叠      专业档恒 WARN，其余 gate 控制
  AF-03 B  工程/数据腔密度超预算            恒 WARN（误伤术语代价高于漏检）
  AF-04 C  公文套话密度超预算               official 档恒 WARN，其余 gate 控制
  AF-05 D  空转形容词密度超预算             恒 WARN（脚本判不了背后有无事实）
  AF-06 E  连接词密度 > 8/千字              恒 WARN
  AF-07 连续 ≥3 个四字格且含 C 级词         gate 控制
  AF-08 无来源空引用（数据显示/研究表明…）  gate 控制
  AF-09 F 级元话语与自我表演                gate 控制
  AF-10 结尾升华/口号/金句                  gate 控制

设计取舍（两处刻意收窄，避免误伤正式文档）:
  1. AF-07 不查"任意连续四字格"，只查"含至少一个 AF-C 级词的连用"。
     否则"国家标准、行业标准、团体标准"这类并列规范术语会被误判。
     不含 C 级词的排比（如"创新驱动、质量为先"）交 LLM 语义层判定。
  2. AF-03 / AF-05 恒为 WARN：B 级在技术/标书/标准中是正当术语，
     D 级形容词有无事实支撑无法正则判定。二者由审查者定是否构成 C 级发现。
"""

import argparse
import json
import re
import sys
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):  # Windows GBK 控制台下保证 UTF-8 输出
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ERROR, WARN = "ERROR", "WARN"

# ── 词库（同源：references/lexicon.md）──────────────────────────────
LEXICON = {
    "A1": [
        "赋能", "抓手", "颗粒度", "打法", "组合拳", "心智", "势能", "飞轮",
        "护城河", "底层逻辑", "第一性原理", "降本增效", "精细化运营",
        "生态位", "壁垒", "水位线", "水位", "卡点", "堵点", "痛点", "痒点",
        "爆点", "基本盘", "工具箱", "路线图", "责任田", "落脚点", "着力点",
        "切入点", "突破口", "场域", "锚点", "对焦", "反哺", "穿透", "动能", "杠杆",
    ],
    "A2": [
        "闭环", "对齐", "拉通", "拉齐", "沉淀", "复用", "链路", "全链路",
        "端到端", "范式", "方法论", "体系化", "常态化", "长效化", "落盘",
        "口径", "打磨", "拆解", "收敛", "透传", "打通", "复盘", "迭代", "落地", "生态",
        # 生造的管理腔（lexicon.md 3.3）：借用别的行业的词指代文档流程
        "门控", "门禁", "台账", "核销", "漂移",
    ],
    "B": [
        "埋点", "灰度", "降级", "兜底", "熔断", "限流", "幂等", "解耦", "耦合",
        "编排", "调度", "吞吐", "时延", "可观测性", "鲁棒性", "健壮性",
        "可扩展性", "基线", "基准", "回归", "冒烟", "全量", "增量", "快照",
        "回滚", "容灾", "双活", "多活", "灾备", "数据治理", "数据资产",
        "数据血缘", "元数据", "主数据", "标签体系", "画像", "漏斗", "留存",
        "转化", "触达", "投放", "拉新", "促活", "召回",
    ],
    "C": [
        "高度重视", "深刻认识", "准确把握", "全面落实", "统筹推进", "协同发力",
        "多点发力", "精准发力", "持续发力", "久久为功", "驰而不息", "抓铁有痕",
        "踏石留印", "钉钉子精神", "下好先手棋", "打好主动仗", "守正创新",
        "问题导向", "目标导向", "结果导向", "底线思维", "系统观念", "全局视野",
        "战略高度", "政治站位", "对标对表", "压实责任", "狠抓落实", "闭环管理",
        "形成合力", "凝聚共识", "营造氛围", "树立标杆", "打造样板",
    ],
    "D": [
        "深刻", "全面", "系统", "深入", "持续", "有效", "显著", "大幅", "精准",
        "高效", "便捷", "智能", "强大", "丰富", "多元", "立体", "多维",
        "全方位", "多层次", "宽领域", "深层次", "高水平", "高质量", "高标准",
        "严要求", "新高度", "新境界", "新格局", "新篇章", "新动能", "新引擎",
        "新抓手", "新载体", "新局面",
    ],
    "E": [
        "首先", "其次", "再次", "最后", "此外", "同时", "与此同时",
        "值得注意的是", "值得一提的是", "需要指出的是", "不可否认的是",
        "毋庸置疑", "显而易见", "综上所述", "总而言之", "归根结底", "说到底",
        "换言之", "简而言之", "换句话说", "从某种意义上说", "从这个角度看",
        "由此可见", "不难看出", "某种程度上", "一定程度上", "总体而言", "概而言之",
    ],
}

# F 级元话语（同源：references/lexicon.md 第 10 节）
META_PATTERNS = [
    (r"按照?(?:你|您)提供的规则", "规则汇报"),
    (r"我(?:已严格|严格)遵循", "规则汇报"),
    (r"这次我(?:没有|没用|避免了|特意)", "规则汇报"),
    (r"以下是符合要求的版本", "规则汇报"),
    (r"我(?:做了如下|进行了如下)调整", "规则汇报"),
    # 自证清白：罗列"我没做什么"给自己背书（lexicon.md 10.1 第二类）
    (r"本次(?:全部|均|都)(?:是|为)", "自证清白"),
    (r"没有(?:调用|使用|修改|新增|删除|引入|执行)任何", "自证清白"),
    (r"未(?:做|进行|发生|引入)任何(?:多余|额外|无关|其他)", "自证清白"),
    (r"不包含任何", "自证清白"),
    (r"我(?:没有|未)(?:多想|擅自|额外|私自)", "自证清白"),
    (r"(?:没有|未)(?:任何)?(?:副作用|额外改动|无关改动)", "自证清白"),
    (r"全程(?:仅|只)(?:涉及|使用|操作)", "自证清白"),
    (r"让我先(?:分析|判断|来看|梳理)", "过程外显"),
    (r"我先(?:判断|分析|确定)", "过程外显"),
    (r"我核对了", "过程外显"),
    (r"我的(?:改写|写作|优化)思路", "过程外显"),
    (r"写作(?:的)?第一原则", "原则声明"),
    (r"好的文案应该", "原则声明"),
    (r"真正重要的是", "原则声明"),
    (r"其实(?:你|您)真正想要", "自作聪明"),
    (r"这背后的本质是", "自作聪明"),
    (r"很多人没(?:有)?意识到", "自作聪明"),
    (r"(?:你|您)可能没(?:有)?注意到", "自作聪明"),
    (r"让我帮(?:你|您)(?:翻译|理解)", "自作聪明"),
    (r"简单来说", "降维/助手腔"),
    (r"说人话", "降维/助手腔"),
    (r"小白也能", "降维/助手腔"),
    (r"(?:你|您)可以理解为", "降维/助手腔"),
    (r"希望(?:这|以上)?(?:对你|对您)?有帮助", "降维/助手腔"),
    (r"随时告诉我", "降维/助手腔"),
    (r"需要我继续(?:优化|改进)", "降维/助手腔"),
    (r"以上是我的回答", "降维/助手腔"),
]

# 无来源空引用
CITE_PATTERN = re.compile(
    r"(数据显示|研究表明|专家指出|据统计|调查显示|有关数据|实践证明|众所周知)")
# 同段出现任一来源标记即豁免
SOURCE_MARKER = re.compile(
    r"(\d{4}\s*年|\d{1,2}\s*月|《[^》]+》|https?://|来源[:：]|编号|样本|问卷|"
    r"文献|GB[/\s]?T|ISO|IEC|第\s*\d+\s*[期卷版]|报告编号|检测编号)")

# 结尾升华
ENDING_PATTERN = re.compile(
    r"(未来可期|值得期待|拭目以待|书写新篇章|开启新征程|行稳致远|必将|势必将|"
    r"让我们|再上新台阶|迈上新台阶|注入强劲动力|奠定坚实基础)")

CJK = r"[\u4e00-\u9fff]"
FOUR_CHAR_RUN = re.compile(
    rf"(?:{CJK}{{4}}\s*[、，,]\s*){{2,}}{CJK}{{4}}")
FENCE = re.compile(r"^\s*(```|~~~)")
URL = re.compile(r"https?://\S+")
MD_SYNTAX = re.compile(r"[#>*`_|\-\[\]()!~]")
TABLE_SEP = re.compile(r"^\s*\|[\s:\-|]+\|$")

# 专业档：A2 有定义即保留，恒 WARN
PROFESSIONAL = {"tech", "compliance", "standard", "patent", "kb", "bid"}

# ── 预算表（同源：references/contexts.md 第 3 节）───────────────────
# None = 术语不限（不做密度阻断）；数值 = 每千字上限
PROFILES = {
    "personal":    {"A1": 0, "A2": 1,    "B": 0,    "C": 0, "D": 1},
    "social":      {"A1": 0, "A2": 1,    "B": 0,    "C": 0, "D": 2},
    "marketing":   {"A1": 0, "A2": 2,    "B": 1,    "C": 0, "D": 3},
    "report":      {"A1": 1, "A2": 3,    "B": 2,    "C": 1, "D": 4},
    "bid":         {"A1": 0, "A2": 2,    "B": None, "C": 0, "D": 3},
    "application": {"A1": 0, "A2": 2,    "B": None, "C": 1, "D": 4},
    "patent":      {"A1": 0, "A2": 1,    "B": None, "C": 0, "D": 2},
    "standard":    {"A1": 0, "A2": 1,    "B": None, "C": 0, "D": 2},
    "kb":          {"A1": 0, "A2": 2,    "B": None, "C": 0, "D": 3},
    "tech":        {"A1": 0, "A2": None, "B": None, "C": 0, "D": 3},
    "compliance":  {"A1": 0, "A2": None, "B": None, "C": 0, "D": 2},
    "academic":    {"A1": 0, "A2": 0,    "B": None, "C": 1, "D": 4},
    "official":    {"A1": 0, "A2": 1,    "B": 1,    "C": None, "D": 5},
    "translation": None,  # 跟随源文：不做密度阻断，只查 AF-09
}

# 恒 WARN 的规则（不受 --gate 影响）
ALWAYS_WARN = {"AF-03", "AF-05", "AF-06"}


def count_words(text):
    """字数近似：CJK 逐字计 1，ASCII 字母数字串每串计 1。不计空白与 Markdown 记号。"""
    t = URL.sub("", text)
    cjk = len(re.findall(CJK, t))
    ascii_words = len(re.findall(r"[A-Za-z0-9]+", t))
    return cjk + ascii_words


class Doc:
    """加载行并标记代码围栏区域（围栏内一律跳过，避免示例误报）。"""

    def __init__(self, path):
        self.path = str(path)
        self.lines = Path(path).read_text(encoding="utf-8").splitlines()
        self.in_fence = []
        fence = False
        for line in self.lines:
            if FENCE.match(line):
                fence = not fence
                self.in_fence.append(True)
            else:
                self.in_fence.append(fence)

    def checked_lines(self):
        for i, line in enumerate(self.lines):
            if self.in_fence[i]:
                continue
            if "<!-- nocheck -->" in line:
                continue
            yield i + 1, line

    def paragraphs(self):
        """返回 [(起始行号, 段落文本)]，按空行分段，跳过围栏与 nocheck 行。"""
        out, buf, start = [], [], None
        for line_no, line in self.checked_lines():
            if line.strip():
                if start is None:
                    start = line_no
                buf.append(line)
            elif buf:
                out.append((start, "\n".join(buf)))
                buf, start = [], None
        if buf:
            out.append((start, "\n".join(buf)))
        return out


class Findings:
    def __init__(self):
        self.items = []

    def add(self, rule, severity, line, message, quote=""):
        self.items.append({
            "rule": rule, "severity": severity, "line": line,
            "message": message, "quote": quote.strip()[:120],
        })

    def count(self, severity):
        return sum(1 for f in self.items if f["severity"] == severity)


def hit_words(text, words):
    """返回 [(词, 出现次数)]。长词优先匹配并从文本中挖掉，避免"全链路"被"链路"重复计数。"""
    hits = []
    remaining = text
    for w in sorted(words, key=len, reverse=True):
        n = remaining.count(w)
        if n:
            hits.append((w, n))
            remaining = remaining.replace(w, "\u0000" * len(w))
    return hits


def check_density(doc, profile, gate, f):
    budget = PROFILES[profile]
    paras = doc.paragraphs()
    full = "\n".join(t for _, t in paras)
    total = count_words(full)
    if total == 0:
        return total
    short = total < 300  # 短文按整篇计数，不折算

    for level, rule in (("A1", "AF-01"), ("A2", "AF-02"), ("B", "AF-03"),
                        ("C", "AF-04"), ("D", "AF-05")):
        cap = budget[level]
        if cap is None:
            continue  # 术语不限
        hits = hit_words(full, LEXICON[level])
        n = sum(c for _, c in hits)
        density = n if short else n * 1000.0 / total
        if density > cap:
            sev = WARN if rule in ALWAYS_WARN else gate
            if rule == "AF-02" and profile in PROFESSIONAL:
                sev = WARN
            if rule == "AF-04" and profile == "official":
                sev = WARN
            detail = "、".join(f"{w}×{c}" for w, c in hits[:8])
            scope = "整篇" if short else f"{density:.1f}/千字"
            f.add(rule, sev, paras[0][0],
                  f"{level} 级超预算（{scope}，上限 {cap}）：{detail}", full[:120])

    # 单段堆叠：A1+A2 单段 ≥3 个，即使全篇未超也判超标。只报一次（首个堆叠段）。
    # 纯 A2 堆叠在专业档降为 WARN：这些词在该语境可能有定义，脚本判不了，交审查者。
    if budget["A1"] is not None or budget["A2"] is not None:
        for start, text in paras:
            a1n = sum(c for _, c in hit_words(text, LEXICON["A1"]))
            a2n = sum(c for _, c in hit_words(text, LEXICON["A2"]))
            if a1n + a2n >= 3:
                rule = "AF-01" if a1n else "AF-02"
                sev = WARN if (rule == "AF-02" and profile in PROFESSIONAL) else gate
                f.add(rule, sev, start,
                      f"单段堆叠 {a1n + a2n} 个 A1/A2 词（≥3 即超标，不论全篇密度）", text)
                break

    # AF-06 连接词密度
    e_hits = hit_words(full, LEXICON["E"])
    e_n = sum(c for _, c in e_hits)
    e_density = e_n if short else e_n * 1000.0 / total
    if e_density > 8:
        f.add("AF-06", WARN, paras[0][0],
              f"连接词 {e_density:.1f}/千字（>8）：" +
              "、".join(f"{w}×{c}" for w, c in e_hits[:8]), full[:120])
    return total


def check_four_char(doc, gate, f):
    c_set = set(LEXICON["C"])
    for start, text in doc.paragraphs():
        for m in FOUR_CHAR_RUN.finditer(text):
            run = m.group(0)
            members = re.split(r"\s*[、，,]\s*", run)
            if any(x in c_set for x in members):
                f.add("AF-07", gate, start,
                      f"连续 {len(members)} 个四字格且含公文套话", run)


def check_citation(doc, gate, f):
    for start, text in doc.paragraphs():
        m = CITE_PATTERN.search(text)
        if m and not SOURCE_MARKER.search(text):
            f.add("AF-08", gate, start,
                  f"无来源空引用「{m.group(1)}」：同段未见年月/文献号/标准号/样本等来源标记",
                  text)


def check_meta(doc, gate, f):
    for line_no, line in doc.checked_lines():
        for pattern, kind in META_PATTERNS:
            m = re.search(pattern, line)
            if m:
                f.add("AF-09", gate, line_no,
                      f"F 级元话语（{kind}）「{m.group(0)}」：交付正文不得谈论 AI 自己", line)


def check_ending(doc, gate, f):
    paras = doc.paragraphs()
    for start, text in paras[-2:]:  # 只查结尾两段
        m = ENDING_PATTERN.search(text)
        if m:
            f.add("AF-10", gate, start,
                  f"结尾升华/口号「{m.group(1)}」：结尾应收在动作、事实或朴素判断", text)


def run_scan(path, profile, gate, report_paths, json_path):
    doc = Doc(path)
    f = Findings()
    total = 0
    if PROFILES[profile] is not None:
        total = check_density(doc, profile, gate, f)
        check_four_char(doc, gate, f)
        check_citation(doc, gate, f)
        check_ending(doc, gate, f)
    check_meta(doc, gate, f)  # translation 档也查元话语

    errors, warns = f.count(ERROR), f.count(WARN)
    verdict = "FAIL" if errors else "PASS"
    out = [f"# 词汇剂量扫描报告 — {path}",
           f"- 预算档: {profile} | 校验级别: {gate} | 正文字数: {total} | "
           f"结论: **{verdict}**（ERROR {errors} / WARN {warns}）", ""]
    if PROFILES[profile] is None:
        out.append("（translation 档：密度跟随源文，只检查 AF-09 元话语）")
        out.append("")
    by_rule = {}
    for item in f.items:
        by_rule.setdefault(item["rule"], []).append(item)
    if not f.items:
        out.append("（无发现项，全部规则通过）")
    for rule in sorted(by_rule):
        out.append(f"## {rule}")
        for item in by_rule[rule]:
            out.append(f"- [{item['severity']}] L{item['line']}: {item['message']}"
                       + (f"「{item['quote']}」" if item["quote"] else ""))
    out.append("")
    out.append("注：形容词有无事实支撑、抽象词有无具体指代、术语是否误伤、是否过度口语化，")
    out.append("    属语义判断，须由审查者按 SKILL.md 自检清单判定，脚本不覆盖。")
    text = "\n".join(out)
    print(text)
    for p in report_paths:
        Path(p).parent.mkdir(parents=True, exist_ok=True)
        Path(p).write_text(text, encoding="utf-8")
    if json_path:
        Path(json_path).parent.mkdir(parents=True, exist_ok=True)
        Path(json_path).write_text(json.dumps(
            {"file": str(path), "profile": profile, "gate": gate,
             "word_count": total, "verdict": verdict,
             "errors": errors, "warnings": warns, "findings": f.items},
            ensure_ascii=False, indent=2), encoding="utf-8")
    return 1 if errors else 0


def main():
    ap = argparse.ArgumentParser(description="ai-flavor-guard deterministic vocabulary scanner")
    ap.add_argument("file", nargs="?", help="待扫描 Markdown 文件")
    ap.add_argument("--profile", default="report", choices=sorted(PROFILES),
                    help="词汇预算档（见 references/contexts.md 第 3 节）")
    ap.add_argument("--gate", default="error", choices=["warn", "error"],
                    help="阻断强度：fast 档用 warn，standard/deep 用 error")
    ap.add_argument("--report", help="将 Markdown 报告写入该文件")
    ap.add_argument("--json", help="将 JSON findings 写入该文件")
    ap.add_argument("--list-profiles", action="store_true", help="列出全部预算档后退出")
    args = ap.parse_args()

    if args.list_profiles:
        for name, b in PROFILES.items():
            if b is None:
                print(f"{name:14s} 跟随源文（只查 AF-09）")
            else:
                cells = " ".join(
                    f"{k}={'不限' if v is None else v}" for k, v in b.items())
                print(f"{name:14s} {cells}")
        return 0
    if not args.file:
        print("需要指定待扫描文件（或用 --list-profiles）", file=sys.stderr)
        return 2
    gate = WARN if args.gate == "warn" else ERROR
    try:
        return run_scan(args.file, args.profile, gate,
                        [args.report] if args.report else [], args.json)
    except FileNotFoundError as e:
        print(f"文件不存在: {e}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())