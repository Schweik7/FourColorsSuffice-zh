/** 校对进度导入的测试：pnpm progress-test */
import fs from 'node:fs'
import path from 'node:path'
import { parseProgress, countProgress } from '../src/review/progress'

let failures = 0
const expect = (label: string, got: unknown, want: unknown) => {
  const g = JSON.stringify(got)
  const w = JSON.stringify(want)
  if (g === w) {
    console.log(`[PASS] ${label}`)
    return
  }
  failures++
  console.log(`[FAIL] ${label}\n      得到 ${g}\n      期望 ${w}`)
}

// ── 导出格式 ──
{
  const { progress, shape, error } = parseProgress({
    approved: ['fig-001', 'fig-003'],
    needs_fix: [{ id: 'fig-002', comment: '线条太粗', reviewed_at: '2026-08-05T01:00:00' }],
    pending: ['fig-004'],
  })
  expect('导出格式 / 无错误', error, null)
  expect('导出格式 / 识别', shape, 'export')
  expect('导出格式 / 计数', countProgress(progress), { ok: 2, fix: 1 })
  expect('导出格式 / 意见保留', progress['fig-002'].comment, '线条太粗')
  expect('导出格式 / pending 不进表', progress['fig-004'], undefined)
}

// ── localStorage 原始格式 ──
{
  const { progress, shape, error } = parseProgress({
    'fig-001': { status: 'ok', comment: '', at: '2026-08-05T01:00:00' },
    'fig-002': { status: 'fix', comment: '改箭头', at: '2026-08-05T01:01:00' },
    'fig-003': { status: 'todo', comment: '', at: '' },
  })
  expect('原始格式 / 无错误', error, null)
  expect('原始格式 / 识别', shape, 'raw')
  expect('原始格式 / 计数', countProgress(progress), { ok: 1, fix: 1 })
  expect('原始格式 / todo 不进表', progress['fig-003'], undefined)
}

// ── 坏输入 ──
expect('非对象要报错', parseProgress([1, 2, 3]).error !== null, true)
expect('null 要报错', parseProgress(null).error !== null, true)
expect('空对象要报错', parseProgress({}).error !== null, true)
expect('认不出的形状要报错', parseProgress({ foo: 'bar' }).error !== null, true)
expect(
  '导出格式但没有已审条目要报错',
  parseProgress({ approved: [], needs_fix: [] }).error !== null,
  true,
)
expect(
  'needs_fix 里缺 id 的条目跳过',
  countProgress(parseProgress({ approved: ['a'], needs_fix: [{ comment: 'x' }] }).progress),
  { ok: 1, fix: 0 },
)

// ── 项目里真实的 review_result.json ──
{
  const file = path.resolve(process.cwd(), '..', 'review_result.json')
  if (fs.existsSync(file)) {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
    const { progress, error } = parseProgress(raw)
    expect('真实文件 / 无错误', error, null)
    expect('真实文件 / 计数与 summary 相符', countProgress(progress), {
      ok: raw.summary.approved,
      fix: raw.summary.needs_fix,
    })
  } else {
    console.log('[SKIP] 真实文件 —— 上一级没有 review_result.json')
  }
}

console.log(failures ? `\n${failures} 项异常` : '\n全部通过')
process.exit(failures ? 1 : 0)
