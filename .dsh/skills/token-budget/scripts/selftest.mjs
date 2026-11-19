#!/usr/bin/env node
/** 自检：不依赖网络和真实会话，验证分类、峰谷、brief、压缩与安全边界。 */
import assert from 'node:assert/strict';
import { buildPlan } from './plan.mjs';
import { buildBrief } from './brief.mjs';
import { assertSafe, compressJson, compressLog, detectType } from './squeeze.mjs';
import { classifyTask } from './lib/common.mjs';

let failures = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`PASS  ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL  ${name}\n      ${error.message}`);
  }
}

async function asyncTest(name, fn) {
  try {
    await fn();
    console.log(`PASS  ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL  ${name}\n      ${error.message}`);
  }
}

test('任务分类：doc / ppt / code / research', () => {
  assert.equal(classifyTask('审阅这份标书'), 'doc');
  assert.equal(classifyTask('做个 12 页 PPT'), 'ppt');
  assert.equal(classifyTask('Unity 游戏开发'), 'code');
  assert.equal(classifyTask('调研三家厂商'), 'research');
});

test('压缩安全：拒绝 .md 与 .js', () => {
  assert.throws(() => assertSafe({ file: 'README.md' }), /文档正文/);
  assert.throws(() => assertSafe({ file: 'main.js' }), /源代码/);
  assert.doesNotThrow(() => assertSafe({ file: 'app.log' }));
});

test('类型识别：json / log', () => {
  assert.equal(detectType({ file: 'a.json', text: '{}' }), 'json');
  assert.equal(detectType({ file: 'a.log', text: 'ERROR boom' }), 'log');
  assert.equal(detectType({ file: '', text: '{"a":1}' }), 'json');
});

test('日志压缩：保留错误行并变短', () => {
  const lines = [];
  for (let i = 0; i < 300; i += 1) lines.push(i % 10 === 0 ? `ERROR request ${i} failed` : `info line ${i}`);
  lines.push('    at foo (a.js:1:1)', '    at bar (b.js:2:2)', '    at baz (c.js:3:3)', '    at qux (d.js:4:4)');
  const result = compressLog(lines.join('\n'), 'medium');
  assert.ok(result.stats.outLines < result.stats.origLines);
  assert.ok(result.text.includes('ERROR request 0'));
  assert.ok(result.text.includes('帧省略'));
  assert.ok(result.stats.outBytes < result.stats.origBytes);
});

test('JSON 压缩：仍是合法 JSON，且标出省略', () => {
  const data = {
    code: 0,
    message: 'ok',
    data: {
      total: 50,
      items: Array.from({ length: 50 }, (_, index) => ({ id: index, name: `item-${index}`, note: 'x'.repeat(200) })),
    },
  };
  const result = compressJson(JSON.stringify(data), 'medium');
  const parsed = JSON.parse(result.text);
  assert.equal(parsed.code, 0);
  assert.ok(result.text.includes('more'));
  assert.ok(result.stats.outBytes < result.stats.origBytes);
});

test('JSON 压缩：非法 JSON 报错', () => {
  assert.throws(() => compressJson('{bad', 'medium'), /JSON 解析失败/);
});

test('brief：包含返回上限与目标', () => {
  const text = buildBrief({ goal: '审阅第 5 章', inputs: ['a.md'], maxReturn: 1200 });
  assert.ok(text.includes('审阅第 5 章'));
  assert.ok(text.includes('≤ 1200 tokens'));
  assert.ok(text.includes('返回上限'));
});

await asyncTest('plan：高峰与低谷判断', async () => {
  const peak = await buildPlan({ task: '审阅标书', type: 'doc', now: Date.parse('2026-11-18T02:30:00Z') });
  assert.equal(peak.peak, true);
  assert.equal(peak.type, 'doc');
  assert.ok(peak.playbook.includes('playbook-doc'));
  const idle = await buildPlan({ task: '审阅标书', type: 'doc', now: Date.parse('2026-11-18T12:30:00Z') });
  assert.equal(idle.peak, false);
});

if (failures > 0) {
  console.error(`\n${failures} 项失败`);
  process.exit(1);
}
console.log('\n全部通过');
