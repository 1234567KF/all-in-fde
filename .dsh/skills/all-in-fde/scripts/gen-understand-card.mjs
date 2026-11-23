#!/usr/bin/env node
/**
 * 生成理解卡 HTML：liquid-glass-starter 设计系统风格，单文件、零外部依赖。
 *
 * 用法：
 *   node scripts/gen-understand-card.mjs --data <understand.json> [--out <output.html>]
 *
 * understand.json 结构见 references/understand.md「理解卡的内容结构」。
 * 输出默认 .fde-tmp/understand-card.html。
 *
 * 退出码：0 成功；1 参数/数据错误。
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};

const dataPath = arg('data');
if (!dataPath) {
  console.error('用法：node scripts/gen-understand-card.mjs --data <understand.json> [--out <output.html>]');
  process.exit(1);
}

let data;
try {
  data = JSON.parse(readFileSync(dataPath, 'utf8').replace(/^\uFEFF/, ''));
} catch (e) {
  console.error(`ERROR 无法解析 ${dataPath}：${e.message}`);
  process.exit(1);
}

const required = ['goal', 'tags', 'summary', 'questions', 'solution', 'scope', 'stakeholders'];
for (const k of required) {
  if (!data[k]) {
    console.error(`ERROR 缺少必填字段：${k}`);
    process.exit(1);
  }
}

const outPath = resolve(arg('out', '.fde-tmp/understand-card.html'));
mkdirSync(dirname(outPath), { recursive: true });

// ── HTML 转义 ────────────────────────────────────────────────────────────────
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ── 渲染器 ───────────────────────────────────────────────────────────────────
const renderTags = (tags) =>
  (tags || []).map((t) => `<span class="tag">${esc(t)}</span>`).join('');

const renderQuestions = (qs) =>
  (qs || [])
    .map(
      (q, i) => `
    <div class="q-item glass-row">
      <div class="q-head"><span class="q-num">${i + 1}</span><span class="q-text">${esc(q.question)}</span></div>
      ${q.assumption ? `<div class="q-assumption">💭 AI 临时假设：<em>${esc(q.assumption)}</em></div>` : ''}
      ${
        q.options && q.options.length
          ? `<div class="q-options">${q.options.map((o, j) => `<label class="q-opt${o.recommended ? ' recommended' : ''}"><input type="radio" name="q${i}" value="${j}" ${o.recommended ? 'checked' : ''}><span>${esc(o.label)}</span>${o.recommended ? '<span class="rec-badge">推荐</span>' : ''}</label>`).join('')}</div>`
          : ''
      }
    </div>`
    )
    .join('');

const renderScope = (scope) => `
  <div class="scope-grid">
    <div class="scope-col do">
      <h4>✅ 做什么</h4>
      <ul>${(scope.do || []).map((d) => `<li>${esc(d.text)}${d.source ? ` <span class="src">${esc(d.source)}</span>` : ''}</li>`).join('')}</ul>
    </div>
    <div class="scope-col dont">
      <h4>🚫 不做什么</h4>
      <ul>${(scope.dont || []).map((d) => `<li>${esc(d.text)}${d.source ? ` <span class="src">${esc(d.source)}</span>` : ''}</li>`).join('')}</ul>
    </div>
  </div>`;

const renderStakeholders = (sh) => `
  <div class="sh-roles">${(sh.roles || []).map((r) => `<span class="role-tag">${esc(r)}</span>`).join('')}</div>
  ${(sh.scenarios || []).map((s) => `<div class="scenario"><strong>${esc(s.name)}</strong>：${esc(s.desc)} <span class="freq">${esc(s.freq || '')}</span></div>`).join('')}
  ${(sh.nfr || []).map((n) => `<div class="nfr">⚠️ ${esc(n)} <span class="src">待确认</span></div>`).join('')}`;

// ── Liquid Glass HTML 模板 ───────────────────────────────────────────────────
const html = `<!DOCTYPE html>
<html lang="zh-CN" class="dark">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>需求理解卡 · ${esc(data.goal)}</title>
<style>
  /* ===========================
     Liquid Glass Design System
     Extracted from liquid-glass-starter theme-tokens.css + design-utils.css
     =========================== */
  :root {
    /* Fonts */
    --font-heading: "Manrope", "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    --font-body: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    --font-mono: "JetBrains Mono", "Fira Code", monospace;

    /* Background & Surface */
    --lg-background: #0e0e11;
    --lg-surface: #131316;
    --lg-surface-glass: rgba(27, 27, 30, 0.7);
    --lg-surface-elevated: rgba(19, 19, 22, 0.8);
    --lg-surface-bright: #39393c;
    --lg-surface-low: #1b1b1e;
    --lg-surface-container: #1f1f22;
    --lg-surface-high: #2a2a2d;

    /* Primary (翡翠绿) */
    --lg-primary: #22c55e;
    --lg-primary-light: #4be277;
    --lg-primary-text: #4be277;
    --lg-primary-dim: rgba(34, 197, 94, 0.15);
    --lg-primary-glow: rgba(34, 197, 94, 0.4);
    --lg-primary-border: rgba(34, 197, 94, 0.3);

    /* Semantic Colors */
    --lg-success: #22c55e;
    --lg-success-light: #4be277;
    --lg-success-text: #4be277;
    --lg-success-dim: rgba(34, 197, 94, 0.15);
    --lg-success-border: rgba(34, 197, 94, 0.3);

    --lg-warning: #facc15;
    --lg-warning-text: #facc15;
    --lg-warning-dim: rgba(234, 179, 8, 0.15);
    --lg-warning-border: rgba(234, 179, 8, 0.3);

    --lg-error-accent: #ffb4ab;
    --lg-error-dim: rgba(255, 180, 171, 0.15);
    --lg-error-border: rgba(255, 180, 171, 0.3);

    --lg-info: #8bcfff;
    --lg-info-dim: rgba(139, 207, 255, 0.15);
    --lg-info-border: rgba(139, 207, 255, 0.3);

    --lg-accent-purple: #a855f7;
    --lg-accent-purple-light: #d0bcff;
    --lg-accent-purple-dim: rgba(168, 85, 247, 0.15);
    --lg-accent-purple-border: rgba(168, 85, 247, 0.3);

    /* Text */
    --lg-text-primary: #e4e1e6;
    --lg-text-secondary: #bccbb9;
    --lg-text-muted: #869585;

    /* Border */
    --lg-border: rgba(61, 74, 61, 0.4);
    --lg-border-subtle: rgba(255, 255, 255, 0.06);
    --lg-outline-variant: #3d4a3d;

    /* Glass */
    --glass-blur: 12px;
    --radius-glass-sm: 8px;
    --radius-glass-md: 12px;
    --radius-glass-lg: 16px;
    --glass-gradient-top: rgba(255, 255, 255, 0.03);
    --glass-row-bg: rgba(27, 27, 30, 0.4);
    --glass-row-hover-bg: rgba(42, 42, 45, 0.7);
  }

  * { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    background: var(--lg-background);
    color: var(--lg-text-primary);
    font-family: var(--font-body);
    line-height: 1.6;
    padding: 24px 16px 60px;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
    background-image: radial-gradient(circle at 50% -20%, var(--lg-primary-dim) 0%, transparent 50%);
    background-attachment: fixed;
  }

  .wrap { max-width: 900px; margin: 0 auto; }

  h1 {
    font-family: var(--font-heading);
    font-size: 24px;
    font-weight: 700;
    margin-bottom: 4px;
    color: var(--lg-text-primary);
  }
  .h1-sub {
    color: var(--lg-text-muted);
    font-size: 13px;
    margin-bottom: 24px;
  }

  /* ── Glass Card ── */
  .glass-card {
    background: var(--lg-surface-glass);
    backdrop-filter: blur(var(--glass-blur));
    -webkit-backdrop-filter: blur(var(--glass-blur));
    border: 1px solid var(--lg-border);
    border-radius: var(--radius-glass-md);
    padding: 20px;
    margin-bottom: 16px;
    background-image: linear-gradient(180deg, var(--glass-gradient-top) 0%, transparent 40%);
  }

  .glass-card h2 {
    font-family: var(--font-heading);
    font-size: 16px;
    font-weight: 600;
    margin-bottom: 12px;
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--lg-text-primary);
  }
  .glass-card h2 .icon { font-size: 20px; }

  /* ── Glass Row (子项) ── */
  .glass-row {
    background: var(--glass-row-bg);
    border-radius: var(--radius-glass-sm);
    padding: 12px 14px;
    margin-bottom: 8px;
    transition: background 0.15s ease;
  }
  .glass-row:last-child { margin-bottom: 0; }
  .glass-row:hover { background: var(--glass-row-hover-bg); }

  /* ── 核心区 ── */
  .goal {
    font-family: var(--font-heading);
    font-size: 22px;
    font-weight: 700;
    color: var(--lg-primary-text);
    margin-bottom: 10px;
    text-shadow: 0 0 20px var(--lg-primary-glow);
  }
  .tags { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 12px; }
  .tag {
    background: var(--lg-primary-dim);
    color: var(--lg-primary-text);
    padding: 3px 12px;
    border-radius: 20px;
    font-size: 12px;
    font-weight: 500;
    border: 1px solid var(--lg-primary-border);
    letter-spacing: 0.3px;
  }
  .summary {
    color: var(--lg-text-secondary);
    font-size: 14px;
    line-height: 1.7;
  }

  /* ── 疑问区 ── */
  .q-section {
    border-color: var(--lg-warning-border);
    background: linear-gradient(160deg, var(--lg-warning-dim), transparent 70%), var(--lg-surface-glass);
  }
  .q-item { margin-bottom: 10px; }
  .q-head {
    font-size: 14px;
    font-weight: 600;
    display: flex;
    align-items: flex-start;
    gap: 10px;
    color: var(--lg-text-primary);
  }
  .q-num {
    background: var(--lg-warning);
    color: #000;
    width: 24px;
    height: 24px;
    border-radius: 50%;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 12px;
    font-weight: 700;
    flex-shrink: 0;
    margin-top: 1px;
  }
  .q-assumption {
    color: var(--lg-text-muted);
    font-size: 13px;
    margin: 6px 0 8px 34px;
    font-style: italic;
  }
  .q-options {
    margin-left: 34px;
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .q-opt {
    display: flex;
    align-items: center;
    gap: 6px;
    background: var(--glass-row-bg);
    border: 1px solid var(--lg-border);
    border-radius: var(--radius-glass-sm);
    padding: 5px 12px;
    font-size: 12.5px;
    cursor: pointer;
    transition: all 0.15s ease;
    color: var(--lg-text-secondary);
  }
  .q-opt:hover {
    background: var(--glass-row-hover-bg);
    border-color: var(--lg-warning-border);
  }
  .q-opt.recommended {
    border-color: var(--lg-primary-border);
    background: var(--lg-primary-dim);
    color: var(--lg-primary-text);
  }
  .q-opt input { margin: 0; accent-color: var(--lg-primary); }
  .rec-badge {
    font-size: 10px;
    font-weight: 700;
    background: var(--lg-primary);
    color: #000;
    padding: 1px 6px;
    border-radius: 8px;
    margin-left: 4px;
    letter-spacing: 0.5px;
  }

  /* ── 方案区 ── */
  .sol-section {
    border-color: var(--lg-info-border);
    background: linear-gradient(160deg, var(--lg-info-dim), transparent 70%), var(--lg-surface-glass);
  }
  .sol-block { margin-bottom: 12px; }
  .sol-block:last-child { margin-bottom: 0; }
  .sol-block h4 {
    font-family: var(--font-heading);
    font-size: 13px;
    font-weight: 600;
    color: var(--lg-info);
    margin-bottom: 4px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .sol-block p, .sol-block li {
    font-size: 13.5px;
    color: var(--lg-text-secondary);
    line-height: 1.6;
  }
  .sol-block ul { padding-left: 18px; }
  .sol-block li { margin: 3px 0; }
  .risk { color: var(--lg-error-accent); font-weight: 600; }

  /* ── 范围区 ── */
  .scope-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 14px;
  }
  @media (max-width: 600px) { .scope-grid { grid-template-columns: 1fr; } }
  .scope-col h4 {
    font-family: var(--font-heading);
    font-size: 14px;
    font-weight: 600;
    margin-bottom: 8px;
  }
  .scope-col.do h4 { color: var(--lg-success-text); }
  .scope-col.dont h4 { color: var(--lg-error-accent); }
  .scope-col ul { padding-left: 18px; font-size: 13px; color: var(--lg-text-secondary); }
  .scope-col li { margin: 4px 0; }
  .src {
    color: var(--lg-text-muted);
    font-size: 11px;
    margin-left: 6px;
    font-style: italic;
  }

  /* ── 利益相关者 ── */
  .sh-section {
    border-color: var(--lg-accent-purple-border);
    background: linear-gradient(160deg, var(--lg-accent-purple-dim), transparent 70%), var(--lg-surface-glass);
  }
  .sh-roles { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 10px; }
  .role-tag {
    background: var(--lg-accent-purple-dim);
    color: var(--lg-accent-purple-light);
    padding: 3px 12px;
    border-radius: 20px;
    font-size: 12px;
    font-weight: 500;
    border: 1px solid var(--lg-accent-purple-border);
  }
  .scenario {
    font-size: 13px;
    margin: 5px 0;
    color: var(--lg-text-secondary);
  }
  .scenario strong { color: var(--lg-accent-purple-light); }
  .freq {
    color: var(--lg-text-muted);
    font-size: 11px;
    margin-left: 8px;
    font-style: italic;
  }
  .nfr {
    font-size: 13px;
    color: var(--lg-warning-text);
    margin: 5px 0;
  }

  /* ── 下一步 ── */
  .next {
    border-color: var(--lg-primary-border);
    background: linear-gradient(160deg, var(--lg-primary-dim), transparent 70%), var(--lg-surface-glass);
    text-align: center;
  }
  .next p {
    font-size: 14px;
    margin: 5px 0;
    color: var(--lg-text-secondary);
  }
  .next .est {
    color: var(--lg-text-muted);
    font-size: 12px;
    margin-top: 10px;
    font-family: var(--font-mono);
  }

  /* ── Footer ── */
  .foot {
    color: var(--lg-text-muted);
    font-size: 11px;
    text-align: center;
    margin-top: 24px;
    font-family: var(--font-mono);
    letter-spacing: 0.3px;
  }
</style>
</head>
<body>
<div class="wrap">
  <h1>🧠 需求理解卡</h1>
  <div class="h1-sub">AI 对需求的结构化理解 · 请审阅后确认或反馈修改意见</div>

  <!-- 1. 核心理解 -->
  <div class="glass-card">
    <h2><span class="icon">🎯</span> 需求核心理解</h2>
    <div class="goal">${esc(data.goal)}</div>
    <div class="tags">${renderTags(data.tags)}</div>
    <div class="summary">${esc(data.summary)}</div>
  </div>

  <!-- 2. 关键疑问 -->
  <div class="glass-card q-section">
    <h2><span class="icon">❓</span> 关键疑问（${(data.questions || []).length} 项待确认）</h2>
    ${renderQuestions(data.questions)}
  </div>

  <!-- 3. 初步方案 -->
  <div class="glass-card sol-section">
    <h2><span class="icon">💡</span> 初步方案设想</h2>
    ${
      data.solution.stack
        ? `<div class="sol-block"><h4>推荐技术栈</h4><p>${esc(data.solution.stack)}</p></div>`
        : ''
    }
    ${
      data.solution.modules && data.solution.modules.length
        ? `<div class="sol-block"><h4>模块划分</h4><ul>${data.solution.modules.map((m) => `<li>${esc(m)}</li>`).join('')}</ul></div>`
        : ''
    }
    ${
      data.solution.paths && data.solution.paths.length
        ? `<div class="sol-block"><h4>关键实现路径</h4><ul>${data.solution.paths.map((p) => `<li>${esc(p)}</li>`).join('')}</ul></div>`
        : ''
    }
    ${
      data.solution.risks && data.solution.risks.length
        ? `<div class="sol-block"><h4>风险点</h4><ul>${data.solution.risks.map((r) => `<li class="risk">${esc(r)}</li>`).join('')}</ul></div>`
        : ''
    }
  </div>

  <!-- 4. 范围边界 -->
  <div class="glass-card">
    <h2><span class="icon">📋</span> 范围边界</h2>
    ${renderScope(data.scope)}
  </div>

  <!-- 5. 利益相关者 -->
  <div class="glass-card sh-section">
    <h2><span class="icon">👥</span> 利益相关者与使用场景</h2>
    ${renderStakeholders(data.stakeholders)}
  </div>

  <!-- 6. 下一步 -->
  <div class="glass-card next">
    <h2><span class="icon">✅</span> 下一步行动</h2>
    <p>请审阅以上理解，直接回复修改意见或说「确认」进入提案阶段。</p>
    <p>确认后我将生成粗提案卡供您审定。</p>
    ${data.estimate ? `<div class="est">报价参考（人工产能口径，仅供报价，非 AI 工时）：${esc(data.estimate)}</div>` : ''}
  </div>

  <div class="foot">all-in-fde v0.7.2 · liquid-glass design · ${esc(new Date().toLocaleString('zh-CN'))}</div>
</div>
</body>
</html>`;

writeFileSync(outPath, html, 'utf8');
console.log(`已生成理解卡：${outPath}`);
console.log('请用 present 工具交付此文件给用户。');
