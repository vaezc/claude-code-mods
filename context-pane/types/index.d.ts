export type Usage = { tokens: number | null; window: number; percent: number | null }

export type Row = {
  name: string
  tokens: number
  color: string
  kind: 'used' | 'free' | 'buffer' | 'deferred'
}

export type Snapshot = {
  rows: Row[]
  totalTokens: number
  maxTokens: number
  percentage: number
  detail: 'full' | 'summary'
  at: number
  memoryFiles: { path: string; tokens: number }[]
  mcpTools: { name: string; tokens: number; isLoaded: boolean }[]
}

export type Open = { mem: boolean; mcp: boolean }

declare module 'claude-code' {
  interface PluginState {
    'context-pane': {
      usage: Usage | null
      snapshot: Shaped<Snapshot | null>
      open: Open
    }
  }
}
