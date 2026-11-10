import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Open, Row, Snapshot, Usage } from '../types'

const PANE = 'context-pane'
const TITLE = '上下文'
const NARROW = 30

const usageAtom = atom(
  { plugin: 'context-pane', key: 'usage' } as const,
  null as Usage | null,
)
// Change the tag when Snapshot's fields change: a stored value outlives a reload.
const snapshotAtom = atom(
  { plugin: 'context-pane', key: 'snapshot' } as const,
  null as Snapshot | null,
  { shape: 'snapshot-1' },
)
const openAtom = atom({ plugin: 'context-pane', key: 'open' } as const, {
  mem: false,
  mcp: false,
} as Open)

// One breakdown call at a time; calls that arrive meanwhile fold into one more.
let isBusy = false
let isQueued = false

async function measure($: EngineInterface): Promise<void> {
  let detail: Snapshot['detail'] = 'full'
  let usage
  try {
    usage = await $.session.usage({ breakdown: 'full' })
  } catch {
    detail = 'summary'
    usage = await $.session.usage({ breakdown: 'summary' })
  }
  const { context } = usage
  // Never let a reading without a fill replace one session.measure brought.
  await update($, usageAtom, old =>
    context.tokens === undefined && old !== null ? old : toUsage(context),
  )
  const b = context.breakdown
  if (b === undefined) return
  const snap: Snapshot = {
    rows: b.categories.map(c => ({
      name: c.name,
      tokens: c.tokens,
      color: c.color,
      kind: c.kind,
    })),
    totalTokens: b.totalTokens,
    maxTokens: b.rawMaxTokens,
    percentage: b.percentage,
    detail,
    at: await $.clock.now(),
    memoryFiles: b.memoryFiles.map(f => ({ path: f.path, tokens: f.tokens })),
    mcpTools: b.mcpTools.map(t => ({
      name: t.name,
      tokens: t.tokens,
      isLoaded: t.isLoaded,
    })),
  }
  await update($, snapshotAtom, () => snap)
  // A write that lands while the pane's first draw is still reading is not
  // drawn by itself: ask for the redraw.
  $.ui.invalidate('ui.render')
}

async function refresh($: EngineInterface): Promise<void> {
  if (isBusy) {
    isQueued = true
    return
  }
  isBusy = true
  try {
    do {
      isQueued = false
      await measure($)
    } while (isQueued)
  } catch {
    // Both counts failed: the pane keeps what it had.
  } finally {
    isBusy = false
    isQueued = false
  }
}

function toUsage(c: { tokens?: number; window: number; percent?: number }): Usage {
  return { tokens: c.tokens ?? null, window: c.window, percent: c.percent ?? null }
}

function fmt(n: number): string {
  const short = (v: number, unit: string) =>
    v.toFixed(1).replace(/\.0$/, '') + unit
  if (n >= 999_950) return short(n / 1_000_000, 'M')
  if (n >= 1000) return short(n / 1000, 'k')
  return String(Math.round(n))
}

function pct(tokens: number, max: number): string {
  return max > 0 ? ((tokens / max) * 100).toFixed(1) + '%' : '—'
}

// Terminal cells: CJK and fullwidth forms take two.
function width(s: string): number {
  let w = 0
  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 0
    w += (c >= 0x1100 && c <= 0x115f) || (c >= 0x2e80 && c <= 0xa4cf) ||
      (c >= 0xac00 && c <= 0xd7a3) || (c >= 0xf900 && c <= 0xfaff) ||
      (c >= 0xfe30 && c <= 0xfe4f) || (c >= 0xff00 && c <= 0xff60) ||
      (c >= 0xffe0 && c <= 0xffe6) ? 2 : 1
  }
  return w
}

function fit(s: string, w: number): string {
  if (s.length <= w) return s.padEnd(w)
  return w <= 1 ? s.slice(0, w) : s.slice(0, w - 1) + '…'
}

function fitStart(s: string, w: number): string {
  if (s.length <= w) return s.padEnd(w)
  return w <= 1 ? s.slice(-w) : '…' + s.slice(-(w - 1))
}

function clock(ms: number): string {
  const d = new Date(ms)
  const two = (n: number) => String(n).padStart(2, '0')
  return `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`
}

const GLYPH = { used: '█', buffer: '▒', free: '░', deferred: ' ' } as const

// The bar in runs of one colour: each cell is the row its midpoint falls in.
function bar(rows: Row[], max: number, cells: number) {
  const runs: { color: string; kind: Row['kind']; text: string }[] = []
  if (max <= 0 || cells <= 0) return runs
  let index = 0
  let end = rows[0]?.tokens ?? 0
  for (let i = 0; i < cells; i++) {
    const at = ((i + 0.5) / cells) * max
    while (at > end && index < rows.length - 1) {
      index++
      end += rows[index]?.tokens ?? 0
    }
    const row = rows[index]
    if (row === undefined) break
    const last = runs[runs.length - 1]
    if (last !== undefined && last.color === row.color && last.kind === row.kind)
      last.text += GLYPH[row.kind]
    else runs.push({ color: row.color, kind: row.kind, text: GLYPH[row.kind] })
  }
  return runs
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'context-pane',
      description: 'Open the context usage pane',
    })
    // Not placed (a narrow terminal) is fine: /context-pane opens it later.
    void $.ui.open({ id: PANE, title: TITLE }).catch(() => undefined)
    void refresh($)

    return next(e)
  })

  on('command.run', { command: 'context-pane' }, async $ => {
    await $.ui.open({ id: PANE, title: TITLE })
    void refresh($)

    return { text: 'Context pane opened.' }
  })

  on('session.measure', async ($, e, next) => {
    await update($, usageAtom, () => toUsage(e.context))

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId === undefined) void refresh($)

    return done
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const usage = await read($, usageAtom)
    const snap = await read($, snapshotAtom)
    const open = await read($, openAtom)
    const cols = Math.max(12, Math.floor(e.props.bodyColumns))
    const isNarrow = cols < NARROW

    // The status line's figures when a response has reported them; before
    // that, the breakdown's own estimate.
    const used = usage?.tokens ?? snap?.totalTokens
    const total =
      usage?.tokens != null ? usage.window : (snap?.maxTokens ?? usage?.window)
    const percent =
      usage?.tokens != null && usage.percent != null
        ? usage.percent
        : snap?.percentage
    const left = percent === undefined ? '已使用 —' : `已使用 ${Math.round(percent)}%`
    const right =
      total === undefined
        ? ''
        : `${used === undefined ? '—' : fmt(used)} / ${fmt(total)}`
    const gap = cols - width(left) - width(right)

    const max = snap?.maxTokens ?? 0
    const byTokens = (a: Row, b: Row) => b.tokens - a.tokens
    const rows = snap?.rows ?? []
    const taken = rows
      .filter(r => r.kind === 'used' || r.kind === 'buffer')
      .sort(byTokens)
    const free = rows.filter(r => r.kind === 'free')
    const deferred = rows.filter(r => r.kind === 'deferred').sort(byTokens)
    const inBar = [
      ...rows.filter(r => r.kind === 'used').sort(byTokens),
      ...rows.filter(r => r.kind === 'buffer'),
      ...free,
    ]

    const numW = 7
    const pctW = 6
    const nameW = Math.max(4, cols - 2 - 1 - numW - (isNarrow ? 0 : 1 + pctW))
    const line = (r: Row) => {
      const tail =
        ' ' +
        fmt(r.tokens).padStart(numW) +
        (isNarrow
          ? ''
          : ' ' + (r.kind === 'deferred' ? '—' : pct(r.tokens, max)).padStart(pctW))
      if (r.kind === 'deferred')
        return (
          <Text dimColor wrap="truncate-end">
            {'  ' + fit(r.name, nameW) + tail}
          </Text>
        )
      return (
        <Text wrap="truncate-end">
          <Text color={r.color}>{r.kind === 'free' ? '□' : '■'}</Text>
          {' ' + fit(r.name, nameW) + tail}
        </Text>
      )
    }
    const detailW = Math.max(4, cols - 2 - 1 - numW)
    const detail = (label: string, tokens: number, isDim = true) => (
      <Text dimColor={isDim} wrap="truncate-end">
        {'  ' + fitStart(label, detailW) + ' ' + fmt(tokens).padStart(numW)}
      </Text>
    )
    const memory = [...(snap?.memoryFiles ?? [])].sort((a, b) => b.tokens - a.tokens)
    const tools = [...(snap?.mcpTools ?? [])]
      .sort((a, b) => b.tokens - a.tokens)
      .slice(0, 5)

    return (
      <Box flexDirection="column">
        {gap >= 1 ? (
          <Text>
            <Text weight="bold">{left}</Text>
            {' '.repeat(gap) + right}
          </Text>
        ) : (
          <Box flexDirection="column">
            <Text weight="bold">{left}</Text>
            <Text>{right}</Text>
          </Box>
        )}
        {!isNarrow && snap !== null && (
          <Text wrap="truncate-end">
            {bar(inBar, max, cols).map(run => (
              <Text color={run.color} dimColor={run.kind === 'free'}>
                {run.text}
              </Text>
            ))}
          </Text>
        )}
        {snap === null && <Text dimColor>分项统计中…</Text>}
        {taken.map(line)}
        {free.map(line)}
        {deferred.map(line)}
        {memory.length > 0 && (
          <Button
            key="mem"
            plain
            onPress={() => update($, openAtom, o => ({ ...o, mem: !o.mem }))}
          >
            {`${open.mem ? '▾' : '▸'} Memory files (${memory.length})`}
          </Button>
        )}
        {open.mem && memory.map(f => detail(f.path, f.tokens))}
        {tools.length > 0 && (
          <Button
            key="mcp"
            plain
            onPress={() => update($, openAtom, o => ({ ...o, mcp: !o.mcp }))}
          >
            {`${open.mcp ? '▾' : '▸'} MCP tools top ${tools.length}`}
          </Button>
        )}
        {open.mcp && tools.map(t => detail(t.name, t.tokens, !t.isLoaded))}
        {snap !== null && (
          <Text dimColor wrap="truncate-end">
            {`分项更新于 ${clock(snap.at)}${snap.detail === 'summary' ? ' (估算)' : ''}`}
          </Text>
        )}
      </Box>
    )
  })
}
