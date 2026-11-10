import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const PANE = {
  plugin: 'context-pane',
  component: 'Pane',
  requestId: 'context-pane',
  props: {
    title: '上下文',
    isFocused: false,
    bodyColumns: 44,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

const cat = (
  name: string,
  tokens: number,
  kind: 'used' | 'free' | 'buffer' | 'deferred',
) => ({ name, tokens, color: 'promptBorder', kind, isDeferred: kind === 'deferred' })

const BREAKDOWN = {
  categories: [
    cat('System prompt', 4_000, 'used'),
    cat('Messages', 20_000, 'used'),
    cat('MCP tools (deferred)', 120_000, 'deferred'),
    cat('Free space', 143_000, 'free'),
    cat('Autocompact buffer', 33_000, 'buffer'),
  ],
  totalTokens: 24_000,
  maxTokens: 200_000,
  rawMaxTokens: 200_000,
  autocompactSource: 'model',
  percentage: 12,
  gridRows: [],
  model: 'test',
  memoryFiles: [{ path: '/home/me/CLAUDE.md', type: 'User', tokens: 1_800 }],
  mcpTools: [
    { name: 'mcp__a__big', serverName: 'a', tokens: 900, isLoaded: true },
  ],
  agents: [],
  isAutoCompactEnabled: true,
  apiUsage: null,
}

// The engine beneath the mod: `usage` answers `$.session.usage` per call.
function engine(on: On, usage: (breakdown?: string) => unknown) {
  const asked: (string | undefined)[] = []
  on('command.register', () => ({ value: { command: 'context-pane' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.measure', (_, e) => ({ changed: e.changed }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('clock.now', () => ({ value: 1_700_000_000_000 }))
  on('session.usage', (_, e) => {
    asked.push(e?.breakdown)

    return { value: usage(e?.breakdown) } as never
  })

  return asked
}

const answer = (breakdown: unknown) => ({
  startedAt: 0,
  rateLimits: [],
  context: { window: 200_000, breakdown },
})

const START = { cwd: '/', surface: 'terminal', isInteractive: true } as const

test('the pane lists the breakdown rows on terminal and desktop', async ($, on) => {
  engine(on, () => answer(BREAKDOWN))
  await $.session.start(START)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })

    const messages = await ui.find({ type: 'Text', text: /Messages/ })
    expect(messages?.text).toMatch(/■ Messages\s+20k\s+10\.0%/)
    expect((await ui.find({ type: 'Text', text: /Free space/ }))?.text).toMatch(
      /□ Free space\s+143k\s+71\.5%/,
    )
    expect(await ui.find({ type: 'Text', text: /分项更新于 \d\d:\d\d:\d\d$/ })).toBeDefined()
    // used and buffer by tokens, then free, then deferred
    const order = (await ui.findAll({ type: 'Text', text: /\d(k|M)?\s+(\d+\.\d%|—)$/ }))
      .map(row => row.text.replace(/^\W+/, '').replace(/\s{2,}.*$/, ''))
    expect(order).toEqual([
      'Autocompact buffer',
      'Messages',
      'System prompt',
      'Free space',
      'MCP tools (deferred)',
    ])
    await ui.unmount()
  }
})

test('a deferred row has no percentage and stays out of the total', async ($, on) => {
  engine(on, () => answer(BREAKDOWN))
  await $.session.start(START)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  const row = await ui.find({ type: 'Text', text: /MCP tools \(deferred\)/ })
  expect(row?.text).toMatch(/120k\s+—$/)
  expect(row?.text).not.toMatch(/%/)
  // 24k of 200k, the 120k deferred left out
  expect(await ui.find({ type: 'Text', text: /已使用 12%/ })).toBeDefined()
  await ui.unmount()
})

test('a failed full count falls back to summary', async ($, on) => {
  const asked = engine(on, breakdown => {
    if (breakdown === 'full') throw new Error('count_tokens failed')

    return answer(BREAKDOWN)
  })
  await $.session.start(START)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  expect(asked).toEqual(['full', 'summary'])
  expect(await ui.find({ type: 'Text', text: /Messages/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /\(估算\)/ })).toBeDefined()
  await ui.unmount()
})

test('the pane draws when both counts fail', async ($, on) => {
  engine(on, () => {
    throw new Error('no usage')
  })
  await $.session.start(START)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  expect(await ui.find({ type: 'Text', text: /分项统计中/ })).toBeDefined()
  await ui.unmount()
})

test('session.measure moves the total and turn.complete recounts', async ($, on) => {
  let messages = 20_000
  const asked = engine(on, () =>
    answer({
      ...BREAKDOWN,
      categories: [cat('Messages', messages, 'used'), cat('Free space', 100_000, 'free')],
    }),
  )
  await $.session.start(START)
  await $.session.measure({
    context: { tokens: 50_000, window: 200_000, percent: 25 },
    rateLimits: [],
    changed: ['context'],
  })
  messages = 60_000
  await $.turn.complete({
    reason: 'answer',
    answer: 'ok',
    durationMs: 1,
    isAborted: false,
    turnId: 't1',
  } as never)
  // a subagent's end does not recount
  await $.turn.complete({
    reason: 'answer',
    answer: 'ok',
    durationMs: 1,
    isAborted: false,
    turnId: 't2',
    agentId: 'a1',
  } as never)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  expect(await ui.find({ type: 'Text', text: /已使用 25%\s+50k \/ 200k/ })).toBeDefined()
  expect((await ui.find({ type: 'Text', text: /Messages/ }))?.text).toMatch(/60k\s+30\.0%/)
  expect(asked).toEqual(['full', 'full'])
  await ui.unmount()
})

test('a narrow pane draws names and numbers only', async ($, on) => {
  engine(on, () => answer(BREAKDOWN))
  await $.session.start(START)
  const ui = await $.ui.mount({
    ...PANE,
    props: { ...PANE.props, bodyColumns: 24 },
    surface: 'terminal',
  })

  expect((await ui.find({ type: 'Text', text: /Messages/ }))?.text).toMatch(/Messages\s+20k$/)
  expect(await ui.find({ type: 'Text', text: /█/ })).toBeUndefined()
  await ui.unmount()
})

test('Memory files expands on a press', async ($, on) => {
  engine(on, () => answer(BREAKDOWN))
  await $.session.start(START)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  expect(await ui.find({ type: 'Text', text: /CLAUDE\.md/ })).toBeUndefined()
  await ui.press({ key: 'mem' })
  expect((await ui.find({ type: 'Text', text: /CLAUDE\.md/ }))?.text).toMatch(/1\.8k$/)
  await ui.unmount()
})
