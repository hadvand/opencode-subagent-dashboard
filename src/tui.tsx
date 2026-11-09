import { TextAttributes } from "@opentui/core"
import { Plugin, usePlugin } from "@opencode/plugin/tui"
import { For, Show, createEffect, createMemo, createSignal, on, onCleanup, onMount } from "solid-js"

const PANEL = "opencode.subagent-dashboard.panel"
const BOLD = TextAttributes.BOLD

type TokenUsage = {
  input: number
  output: number
  reasoning: number
  cache: { read: number; write: number }
}

type SessionLike = {
  id: string
  parentID?: string
  title?: string
  agent?: string
  model?: { id: string; providerID: string; variant?: string }
  tokens?: TokenUsage
  cost?: number
  outcome?: "succeeded" | "failed" | "interrupted"
  time: {
    created: number
    updated: number
    busy?: number
    idle?: number
  }
}

type Row = {
  id: string
  index: number
  depth: number
  info: SessionLike | undefined
  status: "running" | "idle"
}

type ActivityItem = {
  icon: string
  tone: "success" | "error" | "warning" | "muted"
  name: string
  detail: string
  duration: string
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function truncate(value: string, width: number) {
  const text = value.replace(/\s+/g, " ").trim()
  if (width <= 1) return ""
  if (text.length <= width) return text
  return text.slice(0, width - 1) + "…"
}

function pad(value: string, width: number, align: "left" | "right" = "left") {
  const text = value.length > width ? truncate(value, width) : value
  return align === "right" ? text.padStart(width) : text.padEnd(width)
}

function Span(props: { fg?: unknown; children?: unknown }) {
  return <span {...(props as any)} />
}

function formatNumber(value: number) {
  return Math.round(value).toLocaleString("en-US")
}

function formatDuration(ms: number) {
  const total = Math.max(0, Math.round(ms / 1000))
  if (total < 60) return `${total}s`
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  if (minutes < 60) return `${minutes}m ${String(seconds).padStart(2, "0")}s`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ${String(minutes % 60).padStart(2, "0")}m`
}

function formatClock(ms: number) {
  const date = new Date(ms)
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`
}

function tokenTotal(tokens: TokenUsage | undefined) {
  if (!tokens) return 0
  return tokens.input + tokens.output + tokens.reasoning + tokens.cache.read + tokens.cache.write
}

function meter(ratio: number, width: number) {
  const filled = clamp(Math.round(clamp(ratio, 0, 1) * width), 0, width)
  return { filled: "█".repeat(filled), empty: "░".repeat(width - filled) }
}

function statusOf(row: Row): { icon: string; label: string; tone: "running" | "success" | "error" | "warning" | "muted" } {
  if (row.status === "running") return { icon: "●", label: "running", tone: "running" }
  if (row.info?.outcome === "failed") return { icon: "✗", label: "failed", tone: "error" }
  if (row.info?.outcome === "interrupted") return { icon: "■", label: "interrupted", tone: "warning" }
  if (row.info?.outcome === "succeeded") return { icon: "✓", label: "completed", tone: "success" }
  return { icon: "○", label: "idle", tone: "muted" }
}

function durationOf(row: Row, now: number) {
  const info = row.info
  if (!info) return "—"
  const start = info.time.created
  const end = row.status === "running" ? now : (info.time.idle ?? info.time.updated)
  return formatDuration(end - start)
}

function toolSummary(part: any): string {
  const input = part?.state?.input ?? {}
  if (typeof input.command === "string") return input.command.split("\n")[0] ?? ""
  if (typeof input.description === "string") return input.description
  if (typeof input.path === "string") return input.path
  if (typeof input.pattern === "string") return input.pattern
  if (typeof input.query === "string") return input.query
  if (typeof input.url === "string") return input.url
  return ""
}

function toolTone(status: string | undefined): ActivityItem["tone"] {
  if (status === "completed") return "success"
  if (status === "error") return "error"
  if (status === "running" || status === "streaming") return "warning"
  return "muted"
}

function orderedMessages(messages: any[]) {
  return [...messages].sort((a, b) => (a?.time?.created ?? 0) - (b?.time?.created ?? 0))
}

function activityOf(messages: any[], now: number, limit: number): ActivityItem[] {
  const items: ActivityItem[] = []
  const ordered = orderedMessages(messages)
  for (let m = ordered.length - 1; m >= 0 && items.length < limit; m--) {
    const message = ordered[m]
    if (message?.type !== "assistant" || !Array.isArray(message.content)) continue
    for (let c = message.content.length - 1; c >= 0 && items.length < limit; c--) {
      const part = message.content[c]
      if (part?.type !== "tool") continue
      const state = part.state?.status
      const started = part.time?.ran ?? part.time?.created
      const ended = part.time?.completed
      const duration = ended && started ? formatDuration(ended - started) : started ? formatDuration(now - started) : ""
      items.push({
        icon: state === "completed" ? "✓" : state === "error" ? "✗" : state === "running" ? "●" : "○",
        tone: toolTone(state),
        name: part.name ?? "tool",
        detail: toolSummary(part),
        duration,
      })
    }
  }
  return items
}

function lastAssistantTokens(messages: any[]) {
  const ordered = orderedMessages(messages)
  for (let i = ordered.length - 1; i >= 0; i--) {
    if (ordered[i]?.type === "assistant" && ordered[i]?.tokens) return ordered[i].tokens as TokenUsage
  }
  return undefined
}

function Dashboard(props: {
  panel: {
    name: string
    sessionID: string
    width: number
    presentation: "panel" | "fullscreen"
    focused: boolean
    focus: () => void
    close: () => void
    toggleFullscreen: () => void
  }
}) {
  const context = usePlugin()
  const theme = context.theme
  const [version, setVersion] = createSignal(0)
  const [selected, setSelected] = createSignal(0)
  const [now, setNow] = createSignal(Date.now())
  const [refreshing, setRefreshing] = createSignal(false)
  const [syncState, setSyncState] = createSignal("")

  let listScroll: any
  let scrollTimer: ReturnType<typeof setTimeout> | undefined

  const bump = () => setVersion((value) => value + 1)

  let bumpTimer: ReturnType<typeof setTimeout> | undefined
  const scheduleBump = () => {
    if (bumpTimer) return
    bumpTimer = setTimeout(() => {
      bumpTimer = undefined
      bump()
    }, 120)
  }

  const rootID = createMemo(() => {
    version()
    return context.data.session.root(props.panel.sessionID)
  })

  const rows = createMemo<Row[]>(() => {
    version()
    const root = rootID()
    const family = context.data.session.family(root)
    const ids = new Set<string>([root, ...family])
    const infos = new Map<string, SessionLike | undefined>()
    for (const id of ids) infos.set(id, context.data.session.get(id) as SessionLike | undefined)

    const children = new Map<string, string[]>()
    for (const id of ids) {
      const parent = infos.get(id)?.parentID
      if (!parent || !ids.has(parent)) continue
      const list = children.get(parent) ?? []
      list.push(id)
      children.set(parent, list)
    }
    for (const list of children.values()) {
      list.sort((a, b) => (infos.get(a)?.time.created ?? 0) - (infos.get(b)?.time.created ?? 0))
    }

    const order: Row[] = []
    const seen = new Set<string>()
    const walk = (id: string, depth: number) => {
      if (seen.has(id)) return
      seen.add(id)
      const info = infos.get(id)
      order.push({
        id,
        index: order.length,
        depth,
        info,
        status: context.data.session.status(id),
      })
      for (const child of children.get(id) ?? []) walk(child, depth + 1)
    }
    walk(root, 0)
    for (const id of ids) walk(id, 1)
    return order
  })

  const selectedRow = createMemo(() => rows()[selected()] ?? rows()[0])
  const selectedID = createMemo(() => selectedRow()?.id ?? rootID())

  const messagesFor = (id: string) => {
    version()
    return context.data.session.message.list(id) ?? []
  }

  const contextUsage = createMemo(() => {
    version()
    const usage = new Map<string, number>()
    for (const row of rows()) {
      usage.set(row.id, tokenTotal(lastAssistantTokens(context.data.session.message.list(row.id) ?? [])))
    }
    return usage
  })

  const models = createMemo(() => {
    version()
    const location = context.location ?? context.data.location.default()
    return context.data.location.model.list(location) ?? []
  })

  const modelInfo = (info: SessionLike | undefined) => {
    if (!info?.model) return undefined
    return models().find(
      (model) => model.modelID === info.model!.id && model.providerID === info.model!.providerID,
    )
  }

  const limitFor = (info: SessionLike | undefined) => modelInfo(info)?.limit.context

  const usedFor = (row: Row) => contextUsage().get(row.id) ?? 0

  const modelLabel = (info: SessionLike | undefined) => {
    if (!info?.model) return "no model"
    const found = modelInfo(info)
    return found?.name ?? info.model.id
  }

  const refresh = async (all: boolean) => {
    if (refreshing()) return
    setRefreshing(true)
    try {
      const targets = all ? rows().map((row) => row.id) : [selectedID()]
      await Promise.all(
        targets.map(async (id) => {
          await context.data.session.sync(id).catch(() => {})
          await context.data.session.message.sync(id).catch(() => {})
        }),
      )
      setSyncState(`refreshed ${targets.length}`)
      bump()
    } finally {
      setRefreshing(false)
    }
  }

  onMount(() => {
    const stop = context.data.listen(() => scheduleBump())
    const timer = setInterval(() => setNow(Date.now()), 1000)

    void (async () => {
      try {
        const location = context.location ?? context.data.location.default()
        await context.data.location.model.sync(location).catch(() => {})
      } catch {
        setSyncState("sync failed")
      }
    })()

    onCleanup(() => {
      stop()
      clearInterval(timer)
      clearTimeout(scrollTimer)
      clearTimeout(bumpTimer)
    })
  })

  createEffect(
    on(
      () => props.panel.sessionID,
      (id) => {
        const index = rows().findIndex((row) => row.id === id)
        setSelected(index >= 0 ? index : 0)
      },
      { defer: false },
    ),
  )

  let initialized = false
  createEffect(() => {
    const list = rows()
    if (initialized || list.length === 0) return
    const expected = new Set([rootID(), ...context.data.session.family(rootID())]).size
    if (list.length < expected) return
    initialized = true
    const runningChild = list.find((row) => row.index > 0 && row.status === "running")
    const current = list.findIndex((row) => row.id === props.panel.sessionID)
    setSelected(runningChild?.index ?? (current >= 0 ? current : 0))
  })

  const synced = new Set<string>()
  createEffect(() => {
    const fresh = rows()
      .map((row) => row.id)
      .filter((id) => !synced.has(id))
    if (fresh.length === 0) return
    for (const id of fresh) synced.add(id)
    setSyncState(`syncing ${fresh.length}`)
    void (async () => {
      for (const id of fresh) {
        await context.data.session.sync(id).catch(() => {})
        await context.data.session.message.sync(id).catch(() => {})
      }
      setSyncState("")
      bump()
    })()
  })

  createEffect(() => {
    const length = rows().length
    if (length > 0 && selected() >= length) setSelected(length - 1)
  })

  createEffect(
    on(selectedID, (id) => {
      void (async () => {
        setSyncState(`loading ${id.slice(4, 12)}`)
        await context.data.session.message.sync(id).catch(() => {})
        setSyncState("")
        bump()
      })()
    }),
  )

  createEffect(() => {
    const row = rows()[selected()]
    if (!row) return
    const id = `subagent-row-${row.id}`
    clearTimeout(scrollTimer)
    scrollTimer = setTimeout(() => listScroll?.scrollChildIntoView?.(id, { align: "nearest" }), 0)
  })

  const close = () => props.panel.close()
  const open = () => {
    const row = selectedRow()
    if (!row) return
    close()
    context.ui.router.navigate({ type: "session", sessionID: row.id })
  }

  context.keymap.layer(() => ({
    mode: "global",
    priority: 60,
    commands: [
      { id: "opencode.subagent-dashboard.next", title: "Next subagent", bind: "down", run: () => setSelected((value) => clamp(value + 1, 0, rows().length - 1)) },
      { id: "opencode.subagent-dashboard.next.k", title: "Next subagent (k)", bind: "k", run: () => setSelected((value) => clamp(value + 1, 0, rows().length - 1)) },
      { id: "opencode.subagent-dashboard.previous", title: "Previous subagent", bind: "up", run: () => setSelected((value) => clamp(value - 1, 0, rows().length - 1)) },
      { id: "opencode.subagent-dashboard.previous.j", title: "Previous subagent (j)", bind: "j", run: () => setSelected((value) => clamp(value - 1, 0, rows().length - 1)) },
      { id: "opencode.subagent-dashboard.open-selected", title: "Open selected session", bind: "return", run: open },
      { id: "opencode.subagent-dashboard.refresh", title: "Refresh subagents", bind: "r", run: () => void refresh(true) },
      { id: "opencode.subagent-dashboard.fullscreen", title: "Toggle fullscreen", bind: "f", run: () => props.panel.toggleFullscreen() },
      { id: "opencode.subagent-dashboard.close", title: "Close subagents", bind: "escape", run: close },
      { id: "opencode.subagent-dashboard.close.q", title: "Close subagents (q)", bind: "q", run: close },
    ],
    bindings: [
      "opencode.subagent-dashboard.next",
      "opencode.subagent-dashboard.next.k",
      "opencode.subagent-dashboard.previous",
      "opencode.subagent-dashboard.previous.j",
      "opencode.subagent-dashboard.open-selected",
      "opencode.subagent-dashboard.refresh",
      "opencode.subagent-dashboard.fullscreen",
      "opencode.subagent-dashboard.close",
      "opencode.subagent-dashboard.close.q",
    ],
  }))

  const wide = () => props.panel.width >= 112
  const detailWidth = () => Math.max(42, Math.floor(props.panel.width * 0.44))
  const listWidth = () => Math.max(46, props.panel.width - detailWidth() - 3)

  const runningCount = () => rows().filter((row) => row.status === "running").length
  const doneCount = () => rows().filter((row) => statusOf(row).tone === "success").length
  const failedCount = () => rows().filter((row) => statusOf(row).tone === "error").length
  const rootTitle = () => rows()[0]?.info?.title ?? props.panel.sessionID

  const color = (tone: "running" | "success" | "error" | "warning" | "muted") => {
    if (tone === "running") return theme.text.feedback.warning.base
    if (tone === "success") return theme.text.feedback.success.base
    if (tone === "error") return theme.text.feedback.error.base
    if (tone === "warning") return theme.text.feedback.warning.muted
    return theme.text.faint
  }

  const Header = () => (
    <box flexDirection="row" width="100%" marginBottom={1}>
      <text fg={theme.text.action.primary.base} attributes={BOLD}>
        SUBAGENTS
      </text>
      <text fg={theme.text.muted}>{`  ${rows().length} session${rows().length === 1 ? "" : "s"}`}</text>
      <text fg={color("running")}>{`   ● ${runningCount()} running`}</text>
      <text fg={color("success")}>{`   ✓ ${doneCount()} done`}</text>
      <Show when={failedCount() > 0}>
        <text fg={color("error")}>{`   ✗ ${failedCount()} failed`}</text>
      </Show>
      <box flexGrow={1} />
      <text fg={theme.text.faint}>{truncate(rootTitle(), Math.max(16, props.panel.width - 64))}</text>
    </box>
  )

  const Row = (props: { row: Row; width: number; selected: boolean }) => {
    const info = () => props.row.info
    const status = () => statusOf(props.row)
    const limit = () => limitFor(info())
    const used = () => usedFor(props.row)
    const ratio = () => (limit() ? used() / limit()! : 0)
    const compact = () => props.width < 78

    const indexWidth = 3
    const markerWidth = 1
    const iconWidth = 2
    const agentWidth = 9
    const timeWidth = 7
    const barWidth = 8
    const modelWidth = 18
    const effortWidth = 7
    const fixed = compact()
      ? markerWidth + indexWidth + iconWidth + agentWidth + timeWidth
      : markerWidth + indexWidth + iconWidth + agentWidth + modelWidth + effortWidth + timeWidth + barWidth
    const titleWidth = Math.max(8, props.width - fixed - (compact() ? 3 : 6))
    const bar = () => meter(ratio(), barWidth)

    return (
      <box
        id={`subagent-row-${props.row.id}`}
        flexDirection="row"
        width="100%"
        backgroundColor={props.selected ? theme.background.raised.high : undefined}
        onMouseDown={() => setSelected(props.row.index)}
      >
        <text>
          <Span fg={theme.text.action.primary.base}>{props.selected ? "▸" : " "}</Span>
          <Span fg={theme.text.faint}>{pad(String(props.row.index), indexWidth - 1)} </Span>
          <Span fg={color(status().tone)}>{status().icon} </Span>
          <Span fg={theme.text.muted}>{pad(info()?.agent ?? "unknown", agentWidth)} </Span>
          <Span fg={props.selected ? theme.text.base : theme.text.muted}>{pad(info()?.title ?? props.row.id, titleWidth)} </Span>
          <Show when={!compact()}>
            <Span fg={theme.text.faint}>{pad(modelLabel(info()), modelWidth)} </Span>
            <Span fg={theme.text.muted}>{pad(info()?.model?.variant ?? "default", effortWidth)} </Span>
          </Show>
          <Span fg={theme.text.faint}>{pad(durationOf(props.row, now()), timeWidth, "right")} </Span>
          <Show when={!compact()}>
            <Span fg={ratio() > 0.8 ? color("error") : theme.text.action.primary.base}>{bar().filled}</Span>
            <Span fg={theme.text.faint}>{bar().empty}</Span>
          </Show>
        </text>
      </box>
    )
  }

  const List = (props: { width: number }) => (
    <box flexDirection="column" width={props.width} flexGrow={1} flexShrink={1} minHeight={0}>
      <scrollbox
        ref={(element) => {
          listScroll = element
        }}
        flexGrow={1}
        width="100%"
        focusable={false}
        scrollY={true}
        scrollX={false}
      >
        <For each={rows()}>{(row) => <Row row={row} width={props.width - 1} selected={selected() === row.index} />}</For>
      </scrollbox>
    </box>
  )

  const TaskCard = (props: { row: Row; width: number; subtitle?: string }) => {
    const status = () => statusOf(props.row)
    return (
      <box
        flexDirection="column"
        width="100%"
        marginBottom={1}
        paddingX={1}
        backgroundColor={theme.background.raised.base}
        onMouseDown={() => setSelected(props.row.index)}
      >
        <box flexDirection="row" width="100%">
          <text fg={color(status().tone)}>{status().icon} </text>
          <text fg={theme.text.base}>{truncate(props.row.info?.title ?? props.row.id, props.width - 18)}</text>
          <box flexGrow={1} />
          <text fg={theme.text.faint}>{durationOf(props.row, now())}</text>
        </box>
        <text fg={theme.text.muted}>
          <Span fg={theme.text.faint}>{`#${props.row.index} · `}</Span>
          {props.subtitle ?? `${props.row.info?.agent ?? "unknown"} · ${status().label}`}
        </text>
      </box>
    )
  }

  const Detail = (props: { width: number; compact?: boolean }) => {
    const row = () => selectedRow()
    const info = () => row()?.info
    const status = () => (row() ? statusOf(row()!) : undefined)
    const limit = () => limitFor(info())
    const used = () => (row() ? usedFor(row()!) : 0)
    const ratio = () => (limit() ? used() / limit()! : 0)
    const bar = () => meter(ratio(), Math.max(12, props.width - 6))
    const tasks = createMemo(() => rows().filter((item) => item.info?.parentID === selectedID()))
    const activity = createMemo(() => activityOf(messagesFor(selectedID()), now(), 5))

    return (
      <box
        flexDirection="column"
        width={props.width}
        flexShrink={1}
        minHeight={0}
        border
        borderStyle="rounded"
        borderColor={theme.border.base}
        padding={1}
        marginBottom={props.compact ? 1 : 0}
      >
        <Show when={row() && status()} fallback={<text fg={theme.text.muted}>No subagent sessions</text>}>
          <box flexDirection="row" width="100%">
            <text fg={theme.text.base} attributes={BOLD}>
              {`#${row()!.index} `}
            </text>
            <text fg={theme.text.base} attributes={BOLD}>
              {truncate(info()?.title ?? row()!.id, Math.max(10, props.width - 18))}
            </text>
            <box flexGrow={1} />
            <text fg={color(status()!.tone)}>{status()!.label}</text>
          </box>

          <text fg={theme.text.muted}>{`${modelLabel(info())} · ${info()?.model?.variant ?? "default"}`}</text>
          <text fg={theme.text.faint}>
            {`started ${formatClock(info()?.time.created ?? Date.now())} · ${durationOf(row()!, now())}`}
          </text>

          <box flexDirection="column" marginTop={1}>
            <text fg={theme.text.base}>
              {`${formatNumber(used())} / ${limit() ? formatNumber(limit()!) : "?"} tokens`}
            </text>
            <text>
              <Span fg={ratio() > 0.8 ? color("error") : theme.text.action.primary.base}>{bar().filled}</Span>
              <Span fg={theme.text.faint}>{bar().empty}</Span>
            </text>
            <text fg={theme.text.muted}>
              {`${(ratio() * 100).toFixed(1)}% of context window${limit() ? ` · ${formatNumber(Math.max(0, limit()! - used()))} remaining` : ""}`}
            </text>
          </box>

          <Show when={!props.compact}>
            <text fg={theme.text.faint} marginTop={1}>
              {"─".repeat(Math.max(8, props.width - 4))}
            </text>

            <text fg={theme.text.muted} attributes={BOLD}>
              {tasks().length > 0 ? `TASKS (${tasks().length})` : "TASK"}
            </text>
            <Show
              when={tasks().length > 0}
              fallback={
                <Show
                  when={row()!.index > 0}
                  fallback={<text fg={theme.text.faint}>No child sessions yet</text>}
                >
                  <box flexDirection="column">
                    <TaskCard
                      row={row()!}
                      width={Math.max(20, props.width - 4)}
                      subtitle={`from ${truncate(rows().find((item) => item.id === info()?.parentID)?.info?.title ?? "root", Math.max(8, props.width - 22))} · ${status()!.label}`}
                    />
                  </box>
                </Show>
              }
            >
              <box flexDirection="column" marginTop={0}>
                <For each={tasks().slice(0, 4)}>{(task) => <TaskCard row={task} width={Math.max(20, props.width - 4)} />}</For>
                <Show when={tasks().length > 4}>
                  <text fg={theme.text.faint}>{`+ ${tasks().length - 4} more`}</text>
                </Show>
              </box>
            </Show>

            <text fg={theme.text.muted} attributes={BOLD} marginTop={0}>
              RECENT ACTIVITY
            </text>
            <Show when={activity().length > 0} fallback={<text fg={theme.text.faint}>No tool activity yet</text>}>
              <box flexDirection="column">
                <For each={activity()}>
                  {(item) => (
                    <box flexDirection="row" width="100%">
                      <text fg={color(item.tone)}>{`${item.icon} `}</text>
                      <text fg={theme.text.muted}>{pad(item.name, 8)}</text>
                      <text fg={theme.text.base}>{truncate(item.detail, Math.max(8, props.width - 22))}</text>
                      <box flexGrow={1} />
                      <text fg={theme.text.faint}>{item.duration}</text>
                    </box>
                  )}
                </For>
              </box>
            </Show>
          </Show>
        </Show>
      </box>
    )
  }

  return (
    <box flexDirection="column" width="100%" height="100%" padding={1} backgroundColor={theme.background.base}>
      <Header />
      <Show
        when={wide()}
        fallback={
          <box flexDirection="column" flexGrow={1} flexShrink={1} minHeight={0} width="100%">
            <Detail width={props.panel.width - 2} compact />
            <List width={props.panel.width - 2} />
          </box>
        }
      >
        <box flexDirection="row" flexGrow={1} width="100%" gap={1}>
          <Detail width={detailWidth()} />
          <List width={listWidth()} />
        </box>
      </Show>
      <box flexDirection="row" width="100%" marginTop={1}>
        <text fg={theme.text.faint}>↑↓ select · enter open · r refresh · f fullscreen · esc close</text>
        <box flexGrow={1} />
        <text fg={theme.text.faint}>{refreshing() ? "refreshing…" : syncState()}</text>
      </box>
    </box>
  )
}

export default Plugin.define({
  id: "opencode.subagent-dashboard.tui",
  setup(context) {
    const unregister = context.ui.slot({
      append: "session.panel",
      render: (panel) => (
        <Show when={panel.name === PANEL}>
          <Dashboard panel={panel} />
        </Show>
      ),
    })

    context.keymap.layer(() => ({
      mode: "global",
      priority: 20,
      commands: [
        {
          id: "opencode.subagent-dashboard.open",
          title: "Open subagents dashboard",
          description: "Live progress for this session and its subagents",
          group: "Subagents",
          bind: "ctrl+alt+s",
          palette: true,
          slash: { name: "subagents", aliases: ["subagent"] },
          run: () => {
            if (!context.ui.panel.open(PANEL, { presentation: "fullscreen" })) {
              context.ui.toast.show({ message: "Open a session first to view its subagents.", variant: "warning" })
            }
          },
        },
      ],
      bindings: ["opencode.subagent-dashboard.open"],
    }))

    return () => unregister()
  },
})
