import { use as _$use } from "@opentui/solid";
import { memo as _$memo } from "@opentui/solid";
import { createComponent as _$createComponent } from "@opentui/solid";
import { effect as _$effect } from "@opentui/solid";
import { insert as _$insert } from "@opentui/solid";
import { createTextNode as _$createTextNode } from "@opentui/solid";
import { insertNode as _$insertNode } from "@opentui/solid";
import { setProp as _$setProp } from "@opentui/solid";
import { spread as _$spread } from "@opentui/solid";
import { createElement as _$createElement } from "@opentui/solid";
import { TextAttributes } from "@opentui/core";
import { Plugin, usePlugin } from "@opencode/plugin/tui";
import { For, Show, createEffect, createMemo, createSignal, on, onCleanup, onMount } from "solid-js";
const PANEL = "opencode.subagent-dashboard.panel";
const BOLD = TextAttributes.BOLD;
function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
function truncate(value, width) {
  const text = value.replace(/\s+/g, " ").trim();
  if (width <= 1) return "";
  if (text.length <= width) return text;
  return text.slice(0, width - 1) + "…";
}
function pad(value, width, align = "left") {
  const text = value.length > width ? truncate(value, width) : value;
  return align === "right" ? text.padStart(width) : text.padEnd(width);
}
function Span(props) {
  return (() => {
    var _el$ = _$createElement("span");
    _$spread(_el$, props, false);
    return _el$;
  })();
}
function formatNumber(value) {
  return Math.round(value).toLocaleString("en-US");
}
function formatDuration(ms) {
  const total = Math.max(0, Math.round(ms / 1000));
  if (total < 60) return `${total}s`;
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  if (minutes < 60) return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${String(minutes % 60).padStart(2, "0")}m`;
}
function formatClock(ms) {
  const date = new Date(ms);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}
function tokenTotal(tokens) {
  if (!tokens) return 0;
  return tokens.input + tokens.output + tokens.reasoning + tokens.cache.read + tokens.cache.write;
}
function meter(ratio, width) {
  const filled = clamp(Math.round(clamp(ratio, 0, 1) * width), 0, width);
  return {
    filled: "█".repeat(filled),
    empty: "░".repeat(width - filled)
  };
}
function statusOf(row) {
  if (row.status === "running") return {
    icon: "●",
    label: "running",
    tone: "running"
  };
  if (row.info?.outcome === "failed") return {
    icon: "✗",
    label: "failed",
    tone: "error"
  };
  if (row.info?.outcome === "interrupted") return {
    icon: "■",
    label: "interrupted",
    tone: "warning"
  };
  if (row.info?.outcome === "succeeded") return {
    icon: "✓",
    label: "completed",
    tone: "success"
  };
  return {
    icon: "○",
    label: "idle",
    tone: "muted"
  };
}
function durationOf(row, now) {
  const info = row.info;
  if (!info) return "—";
  const start = info.time.created;
  const end = row.status === "running" ? now : info.time.idle ?? info.time.updated;
  return formatDuration(end - start);
}
function toolSummary(part) {
  const input = part?.state?.input ?? {};
  if (typeof input.command === "string") return input.command.split("\n")[0] ?? "";
  if (typeof input.description === "string") return input.description;
  if (typeof input.path === "string") return input.path;
  if (typeof input.pattern === "string") return input.pattern;
  if (typeof input.query === "string") return input.query;
  if (typeof input.url === "string") return input.url;
  return "";
}
function toolTone(status) {
  if (status === "completed") return "success";
  if (status === "error") return "error";
  if (status === "running" || status === "streaming") return "warning";
  return "muted";
}
function orderedMessages(messages) {
  return [...messages].sort((a, b) => (a?.time?.created ?? 0) - (b?.time?.created ?? 0));
}
function activityOf(messages, now, limit) {
  const items = [];
  const ordered = orderedMessages(messages);
  for (let m = ordered.length - 1; m >= 0 && items.length < limit; m--) {
    const message = ordered[m];
    if (message?.type !== "assistant" || !Array.isArray(message.content)) continue;
    for (let c = message.content.length - 1; c >= 0 && items.length < limit; c--) {
      const part = message.content[c];
      if (part?.type !== "tool") continue;
      const state = part.state?.status;
      const started = part.time?.ran ?? part.time?.created;
      const ended = part.time?.completed;
      const duration = ended && started ? formatDuration(ended - started) : started ? formatDuration(now - started) : "";
      items.push({
        icon: state === "completed" ? "✓" : state === "error" ? "✗" : state === "running" ? "●" : "○",
        tone: toolTone(state),
        name: part.name ?? "tool",
        detail: toolSummary(part),
        duration
      });
    }
  }
  return items;
}
function lastAssistantTokens(messages) {
  const ordered = orderedMessages(messages);
  for (let i = ordered.length - 1; i >= 0; i--) {
    if (ordered[i]?.type === "assistant" && ordered[i]?.tokens) return ordered[i].tokens;
  }
  return undefined;
}
function Dashboard(props) {
  const context = usePlugin();
  const theme = context.theme;
  const [version, setVersion] = createSignal(0);
  const [selected, setSelected] = createSignal(0);
  const [now, setNow] = createSignal(Date.now());
  const [refreshing, setRefreshing] = createSignal(false);
  const [syncState, setSyncState] = createSignal("");
  let listScroll;
  let scrollTimer;
  const bump = () => setVersion(value => value + 1);
  let bumpTimer;
  const scheduleBump = () => {
    if (bumpTimer) return;
    bumpTimer = setTimeout(() => {
      bumpTimer = undefined;
      bump();
    }, 120);
  };
  const rootID = createMemo(() => {
    version();
    return context.data.session.root(props.panel.sessionID);
  });
  const rows = createMemo(() => {
    version();
    const root = rootID();
    const family = context.data.session.family(root);
    const ids = new Set([root, ...family]);
    const infos = new Map();
    for (const id of ids) infos.set(id, context.data.session.get(id));
    const children = new Map();
    for (const id of ids) {
      const parent = infos.get(id)?.parentID;
      if (!parent || !ids.has(parent)) continue;
      const list = children.get(parent) ?? [];
      list.push(id);
      children.set(parent, list);
    }
    for (const list of children.values()) {
      list.sort((a, b) => (infos.get(a)?.time.created ?? 0) - (infos.get(b)?.time.created ?? 0));
    }
    const order = [];
    const seen = new Set();
    const walk = (id, depth) => {
      if (seen.has(id)) return;
      seen.add(id);
      const info = infos.get(id);
      order.push({
        id,
        index: order.length,
        depth,
        info,
        status: context.data.session.status(id)
      });
      for (const child of children.get(id) ?? []) walk(child, depth + 1);
    };
    walk(root, 0);
    for (const id of ids) walk(id, 1);
    return order;
  });
  const selectedRow = createMemo(() => rows()[selected()] ?? rows()[0]);
  const selectedID = createMemo(() => selectedRow()?.id ?? rootID());
  const messagesFor = id => {
    version();
    return context.data.session.message.list(id) ?? [];
  };
  const contextUsage = createMemo(() => {
    version();
    const usage = new Map();
    for (const row of rows()) {
      usage.set(row.id, tokenTotal(lastAssistantTokens(context.data.session.message.list(row.id) ?? [])));
    }
    return usage;
  });
  const models = createMemo(() => {
    version();
    const location = context.location ?? context.data.location.default();
    return context.data.location.model.list(location) ?? [];
  });
  const modelInfo = info => {
    if (!info?.model) return undefined;
    return models().find(model => model.modelID === info.model.id && model.providerID === info.model.providerID);
  };
  const limitFor = info => modelInfo(info)?.limit.context;
  const usedFor = row => contextUsage().get(row.id) ?? 0;
  const modelLabel = info => {
    if (!info?.model) return "no model";
    const found = modelInfo(info);
    return found?.name ?? info.model.id;
  };
  const refresh = async all => {
    if (refreshing()) return;
    setRefreshing(true);
    try {
      const targets = all ? rows().map(row => row.id) : [selectedID()];
      await Promise.all(targets.map(async id => {
        await context.data.session.sync(id).catch(() => {});
        await context.data.session.message.sync(id).catch(() => {});
      }));
      setSyncState(`refreshed ${targets.length}`);
      bump();
    } finally {
      setRefreshing(false);
    }
  };
  onMount(() => {
    const stop = context.data.listen(() => scheduleBump());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    void (async () => {
      try {
        const location = context.location ?? context.data.location.default();
        await context.data.location.model.sync(location).catch(() => {});
      } catch {
        setSyncState("sync failed");
      }
    })();
    onCleanup(() => {
      stop();
      clearInterval(timer);
      clearTimeout(scrollTimer);
      clearTimeout(bumpTimer);
    });
  });
  createEffect(on(() => props.panel.sessionID, id => {
    const index = rows().findIndex(row => row.id === id);
    setSelected(index >= 0 ? index : 0);
  }, {
    defer: false
  }));
  let initialized = false;
  createEffect(() => {
    const list = rows();
    if (initialized || list.length === 0) return;
    const expected = new Set([rootID(), ...context.data.session.family(rootID())]).size;
    if (list.length < expected) return;
    initialized = true;
    const runningChild = list.find(row => row.index > 0 && row.status === "running");
    const current = list.findIndex(row => row.id === props.panel.sessionID);
    setSelected(runningChild?.index ?? (current >= 0 ? current : 0));
  });
  const synced = new Set();
  createEffect(() => {
    const fresh = rows().map(row => row.id).filter(id => !synced.has(id));
    if (fresh.length === 0) return;
    for (const id of fresh) synced.add(id);
    setSyncState(`syncing ${fresh.length}`);
    void (async () => {
      for (const id of fresh) {
        await context.data.session.sync(id).catch(() => {});
        await context.data.session.message.sync(id).catch(() => {});
      }
      setSyncState("");
      bump();
    })();
  });
  createEffect(() => {
    const length = rows().length;
    if (length > 0 && selected() >= length) setSelected(length - 1);
  });
  createEffect(on(selectedID, id => {
    void (async () => {
      setSyncState(`loading ${id.slice(4, 12)}`);
      await context.data.session.message.sync(id).catch(() => {});
      setSyncState("");
      bump();
    })();
  }));
  createEffect(() => {
    const row = rows()[selected()];
    if (!row) return;
    const id = `subagent-row-${row.id}`;
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => listScroll?.scrollChildIntoView?.(id, {
      align: "nearest"
    }), 0);
  });
  const close = () => props.panel.close();
  const open = () => {
    const row = selectedRow();
    if (!row) return;
    close();
    context.ui.router.navigate({
      type: "session",
      sessionID: row.id
    });
  };
  context.keymap.layer(() => ({
    mode: "global",
    priority: 60,
    commands: [{
      id: "opencode.subagent-dashboard.next",
      title: "Next subagent",
      bind: "down",
      run: () => setSelected(value => clamp(value + 1, 0, rows().length - 1))
    }, {
      id: "opencode.subagent-dashboard.next.k",
      title: "Next subagent (k)",
      bind: "k",
      run: () => setSelected(value => clamp(value + 1, 0, rows().length - 1))
    }, {
      id: "opencode.subagent-dashboard.previous",
      title: "Previous subagent",
      bind: "up",
      run: () => setSelected(value => clamp(value - 1, 0, rows().length - 1))
    }, {
      id: "opencode.subagent-dashboard.previous.j",
      title: "Previous subagent (j)",
      bind: "j",
      run: () => setSelected(value => clamp(value - 1, 0, rows().length - 1))
    }, {
      id: "opencode.subagent-dashboard.open-selected",
      title: "Open selected session",
      bind: "return",
      run: open
    }, {
      id: "opencode.subagent-dashboard.refresh",
      title: "Refresh subagents",
      bind: "r",
      run: () => void refresh(true)
    }, {
      id: "opencode.subagent-dashboard.fullscreen",
      title: "Toggle fullscreen",
      bind: "f",
      run: () => props.panel.toggleFullscreen()
    }, {
      id: "opencode.subagent-dashboard.close",
      title: "Close subagents",
      bind: "escape",
      run: close
    }, {
      id: "opencode.subagent-dashboard.close.q",
      title: "Close subagents (q)",
      bind: "q",
      run: close
    }],
    bindings: ["opencode.subagent-dashboard.next", "opencode.subagent-dashboard.next.k", "opencode.subagent-dashboard.previous", "opencode.subagent-dashboard.previous.j", "opencode.subagent-dashboard.open-selected", "opencode.subagent-dashboard.refresh", "opencode.subagent-dashboard.fullscreen", "opencode.subagent-dashboard.close", "opencode.subagent-dashboard.close.q"]
  }));
  const wide = () => props.panel.width >= 112;
  const detailWidth = () => Math.max(42, Math.floor(props.panel.width * 0.44));
  const listWidth = () => Math.max(46, props.panel.width - detailWidth() - 3);
  const runningCount = () => rows().filter(row => row.status === "running").length;
  const doneCount = () => rows().filter(row => statusOf(row).tone === "success").length;
  const failedCount = () => rows().filter(row => statusOf(row).tone === "error").length;
  const rootTitle = () => rows()[0]?.info?.title ?? props.panel.sessionID;
  const color = tone => {
    if (tone === "running") return theme.text.feedback.warning.base;
    if (tone === "success") return theme.text.feedback.success.base;
    if (tone === "error") return theme.text.feedback.error.base;
    if (tone === "warning") return theme.text.feedback.warning.muted;
    return theme.text.faint;
  };
  const Header = () => (() => {
    var _el$2 = _$createElement("box"),
      _el$3 = _$createElement("text"),
      _el$5 = _$createElement("text"),
      _el$6 = _$createElement("text"),
      _el$7 = _$createElement("text"),
      _el$9 = _$createElement("box"),
      _el$0 = _$createElement("text");
    _$insertNode(_el$2, _el$3);
    _$insertNode(_el$2, _el$5);
    _$insertNode(_el$2, _el$6);
    _$insertNode(_el$2, _el$7);
    _$insertNode(_el$2, _el$9);
    _$insertNode(_el$2, _el$0);
    _$setProp(_el$2, "flexDirection", "row");
    _$setProp(_el$2, "width", "100%");
    _$setProp(_el$2, "marginBottom", 1);
    _$insertNode(_el$3, _$createTextNode(`SUBAGENTS`));
    _$setProp(_el$3, "attributes", BOLD);
    _$insert(_el$5, () => `  ${rows().length} session${rows().length === 1 ? "" : "s"}`);
    _$insert(_el$6, () => `   ● ${runningCount()} running`);
    _$insert(_el$7, () => `   ✓ ${doneCount()} done`);
    _$insert(_el$2, _$createComponent(Show, {
      get when() {
        return failedCount() > 0;
      },
      get children() {
        var _el$8 = _$createElement("text");
        _$insert(_el$8, () => `   ✗ ${failedCount()} failed`);
        _$effect(_$p => _$setProp(_el$8, "fg", color("error"), _$p));
        return _el$8;
      }
    }), _el$9);
    _$setProp(_el$9, "flexGrow", 1);
    _$insert(_el$0, () => truncate(rootTitle(), Math.max(16, props.panel.width - 64)));
    _$effect(_p$ => {
      var _v$ = theme.text.action.primary.base,
        _v$2 = theme.text.muted,
        _v$3 = color("running"),
        _v$4 = color("success"),
        _v$5 = theme.text.faint;
      _v$ !== _p$.e && (_p$.e = _$setProp(_el$3, "fg", _v$, _p$.e));
      _v$2 !== _p$.t && (_p$.t = _$setProp(_el$5, "fg", _v$2, _p$.t));
      _v$3 !== _p$.a && (_p$.a = _$setProp(_el$6, "fg", _v$3, _p$.a));
      _v$4 !== _p$.o && (_p$.o = _$setProp(_el$7, "fg", _v$4, _p$.o));
      _v$5 !== _p$.i && (_p$.i = _$setProp(_el$0, "fg", _v$5, _p$.i));
      return _p$;
    }, {
      e: undefined,
      t: undefined,
      a: undefined,
      o: undefined,
      i: undefined
    });
    return _el$2;
  })();
  const Row = props => {
    const info = () => props.row.info;
    const status = () => statusOf(props.row);
    const limit = () => limitFor(info());
    const used = () => usedFor(props.row);
    const ratio = () => limit() ? used() / limit() : 0;
    const compact = () => props.width < 78;
    const indexWidth = 3;
    const markerWidth = 1;
    const iconWidth = 2;
    const agentWidth = 9;
    const timeWidth = 7;
    const barWidth = 8;
    const modelWidth = 18;
    const effortWidth = 7;
    const fixed = compact() ? markerWidth + indexWidth + iconWidth + agentWidth + timeWidth : markerWidth + indexWidth + iconWidth + agentWidth + modelWidth + effortWidth + timeWidth + barWidth;
    const titleWidth = Math.max(8, props.width - fixed - (compact() ? 3 : 6));
    const bar = () => meter(ratio(), barWidth);
    return (() => {
      var _el$1 = _$createElement("box"),
        _el$10 = _$createElement("text");
      _$insertNode(_el$1, _el$10);
      _$setProp(_el$1, "flexDirection", "row");
      _$setProp(_el$1, "width", "100%");
      _$setProp(_el$1, "onMouseDown", () => setSelected(props.row.index));
      _$insert(_el$10, _$createComponent(Span, {
        get fg() {
          return theme.text.action.primary.base;
        },
        get children() {
          return props.selected ? "▸" : " ";
        }
      }), null);
      _$insert(_el$10, _$createComponent(Span, {
        get fg() {
          return theme.text.faint;
        },
        get children() {
          return [_$memo(() => pad(String(props.row.index), indexWidth - 1)), " "];
        }
      }), null);
      _$insert(_el$10, _$createComponent(Span, {
        get fg() {
          return color(status().tone);
        },
        get children() {
          return [_$memo(() => status().icon), " "];
        }
      }), null);
      _$insert(_el$10, _$createComponent(Span, {
        get fg() {
          return theme.text.muted;
        },
        get children() {
          return [_$memo(() => pad(info()?.agent ?? "unknown", agentWidth)), " "];
        }
      }), null);
      _$insert(_el$10, _$createComponent(Span, {
        get fg() {
          return _$memo(() => !!props.selected)() ? theme.text.base : theme.text.muted;
        },
        get children() {
          return [_$memo(() => pad(info()?.title ?? props.row.id, titleWidth)), " "];
        }
      }), null);
      _$insert(_el$10, _$createComponent(Show, {
        get when() {
          return !compact();
        },
        get children() {
          return [_$createComponent(Span, {
            get fg() {
              return theme.text.faint;
            },
            get children() {
              return [_$memo(() => pad(modelLabel(info()), modelWidth)), " "];
            }
          }), _$createComponent(Span, {
            get fg() {
              return theme.text.muted;
            },
            get children() {
              return [_$memo(() => pad(info()?.model?.variant ?? "default", effortWidth)), " "];
            }
          })];
        }
      }), null);
      _$insert(_el$10, _$createComponent(Span, {
        get fg() {
          return theme.text.faint;
        },
        get children() {
          return [_$memo(() => pad(durationOf(props.row, now()), timeWidth, "right")), " "];
        }
      }), null);
      _$insert(_el$10, _$createComponent(Show, {
        get when() {
          return !compact();
        },
        get children() {
          return [_$createComponent(Span, {
            get fg() {
              return _$memo(() => ratio() > 0.8)() ? color("error") : theme.text.action.primary.base;
            },
            get children() {
              return bar().filled;
            }
          }), _$createComponent(Span, {
            get fg() {
              return theme.text.faint;
            },
            get children() {
              return bar().empty;
            }
          })];
        }
      }), null);
      _$effect(_p$ => {
        var _v$6 = `subagent-row-${props.row.id}`,
          _v$7 = props.selected ? theme.background.raised.high : undefined;
        _v$6 !== _p$.e && (_p$.e = _$setProp(_el$1, "id", _v$6, _p$.e));
        _v$7 !== _p$.t && (_p$.t = _$setProp(_el$1, "backgroundColor", _v$7, _p$.t));
        return _p$;
      }, {
        e: undefined,
        t: undefined
      });
      return _el$1;
    })();
  };
  const List = props => (() => {
    var _el$11 = _$createElement("box"),
      _el$12 = _$createElement("scrollbox");
    _$insertNode(_el$11, _el$12);
    _$setProp(_el$11, "flexDirection", "column");
    _$setProp(_el$11, "flexGrow", 1);
    _$setProp(_el$11, "flexShrink", 1);
    _$setProp(_el$11, "minHeight", 0);
    _$use(element => {
      listScroll = element;
    }, _el$12);
    _$setProp(_el$12, "flexGrow", 1);
    _$setProp(_el$12, "width", "100%");
    _$setProp(_el$12, "focusable", false);
    _$setProp(_el$12, "scrollY", true);
    _$setProp(_el$12, "scrollX", false);
    _$insert(_el$12, _$createComponent(For, {
      get each() {
        return rows();
      },
      children: row => _$createComponent(Row, {
        row: row,
        get width() {
          return props.width - 1;
        },
        get selected() {
          return selected() === row.index;
        }
      })
    }));
    _$effect(_$p => _$setProp(_el$11, "width", props.width, _$p));
    return _el$11;
  })();
  const TaskCard = props => {
    const status = () => statusOf(props.row);
    return (() => {
      var _el$13 = _$createElement("box"),
        _el$14 = _$createElement("box"),
        _el$15 = _$createElement("text"),
        _el$16 = _$createTextNode(` `),
        _el$17 = _$createElement("text"),
        _el$18 = _$createElement("box"),
        _el$19 = _$createElement("text"),
        _el$20 = _$createElement("text");
      _$insertNode(_el$13, _el$14);
      _$insertNode(_el$13, _el$20);
      _$setProp(_el$13, "flexDirection", "column");
      _$setProp(_el$13, "width", "100%");
      _$setProp(_el$13, "marginBottom", 1);
      _$setProp(_el$13, "paddingX", 1);
      _$setProp(_el$13, "onMouseDown", () => setSelected(props.row.index));
      _$insertNode(_el$14, _el$15);
      _$insertNode(_el$14, _el$17);
      _$insertNode(_el$14, _el$18);
      _$insertNode(_el$14, _el$19);
      _$setProp(_el$14, "flexDirection", "row");
      _$setProp(_el$14, "width", "100%");
      _$insertNode(_el$15, _el$16);
      _$insert(_el$15, () => status().icon, _el$16);
      _$insert(_el$17, () => truncate(props.row.info?.title ?? props.row.id, props.width - 18));
      _$setProp(_el$18, "flexGrow", 1);
      _$insert(_el$19, () => durationOf(props.row, now()));
      _$insert(_el$20, _$createComponent(Span, {
        get fg() {
          return theme.text.faint;
        },
        get children() {
          return `#${props.row.index} · `;
        }
      }), null);
      _$insert(_el$20, () => props.subtitle ?? `${props.row.info?.agent ?? "unknown"} · ${status().label}`, null);
      _$effect(_p$ => {
        var _v$8 = theme.background.raised.base,
          _v$9 = color(status().tone),
          _v$0 = theme.text.base,
          _v$1 = theme.text.faint,
          _v$10 = theme.text.muted;
        _v$8 !== _p$.e && (_p$.e = _$setProp(_el$13, "backgroundColor", _v$8, _p$.e));
        _v$9 !== _p$.t && (_p$.t = _$setProp(_el$15, "fg", _v$9, _p$.t));
        _v$0 !== _p$.a && (_p$.a = _$setProp(_el$17, "fg", _v$0, _p$.a));
        _v$1 !== _p$.o && (_p$.o = _$setProp(_el$19, "fg", _v$1, _p$.o));
        _v$10 !== _p$.i && (_p$.i = _$setProp(_el$20, "fg", _v$10, _p$.i));
        return _p$;
      }, {
        e: undefined,
        t: undefined,
        a: undefined,
        o: undefined,
        i: undefined
      });
      return _el$13;
    })();
  };
  const Detail = props => {
    const row = () => selectedRow();
    const info = () => row()?.info;
    const status = () => row() ? statusOf(row()) : undefined;
    const limit = () => limitFor(info());
    const used = () => row() ? usedFor(row()) : 0;
    const ratio = () => limit() ? used() / limit() : 0;
    const bar = () => meter(ratio(), Math.max(12, props.width - 6));
    const tasks = createMemo(() => rows().filter(item => item.info?.parentID === selectedID()));
    const activity = createMemo(() => activityOf(messagesFor(selectedID()), now(), 5));
    return (() => {
      var _el$21 = _$createElement("box");
      _$setProp(_el$21, "flexDirection", "column");
      _$setProp(_el$21, "flexShrink", 1);
      _$setProp(_el$21, "minHeight", 0);
      _$setProp(_el$21, "border", true);
      _$setProp(_el$21, "borderStyle", "rounded");
      _$setProp(_el$21, "padding", 1);
      _$insert(_el$21, _$createComponent(Show, {
        get when() {
          return _$memo(() => !!row())() && status();
        },
        get fallback() {
          return (() => {
            var _el$40 = _$createElement("text");
            _$insertNode(_el$40, _$createTextNode(`No subagent sessions`));
            _$effect(_$p => _$setProp(_el$40, "fg", theme.text.muted, _$p));
            return _el$40;
          })();
        },
        get children() {
          return [(() => {
            var _el$22 = _$createElement("box"),
              _el$23 = _$createElement("text"),
              _el$24 = _$createElement("text"),
              _el$25 = _$createElement("box"),
              _el$26 = _$createElement("text");
            _$insertNode(_el$22, _el$23);
            _$insertNode(_el$22, _el$24);
            _$insertNode(_el$22, _el$25);
            _$insertNode(_el$22, _el$26);
            _$setProp(_el$22, "flexDirection", "row");
            _$setProp(_el$22, "width", "100%");
            _$setProp(_el$23, "attributes", BOLD);
            _$insert(_el$23, () => `#${row().index} `);
            _$setProp(_el$24, "attributes", BOLD);
            _$insert(_el$24, () => truncate(info()?.title ?? row().id, Math.max(10, props.width - 18)));
            _$setProp(_el$25, "flexGrow", 1);
            _$insert(_el$26, () => status().label);
            _$effect(_p$ => {
              var _v$11 = theme.text.base,
                _v$12 = theme.text.base,
                _v$13 = color(status().tone);
              _v$11 !== _p$.e && (_p$.e = _$setProp(_el$23, "fg", _v$11, _p$.e));
              _v$12 !== _p$.t && (_p$.t = _$setProp(_el$24, "fg", _v$12, _p$.t));
              _v$13 !== _p$.a && (_p$.a = _$setProp(_el$26, "fg", _v$13, _p$.a));
              return _p$;
            }, {
              e: undefined,
              t: undefined,
              a: undefined
            });
            return _el$22;
          })(), (() => {
            var _el$27 = _$createElement("text");
            _$insert(_el$27, () => `${modelLabel(info())} · ${info()?.model?.variant ?? "default"}`);
            _$effect(_$p => _$setProp(_el$27, "fg", theme.text.muted, _$p));
            return _el$27;
          })(), (() => {
            var _el$28 = _$createElement("text");
            _$insert(_el$28, () => `started ${formatClock(info()?.time.created ?? Date.now())} · ${durationOf(row(), now())}`);
            _$effect(_$p => _$setProp(_el$28, "fg", theme.text.faint, _$p));
            return _el$28;
          })(), (() => {
            var _el$29 = _$createElement("box"),
              _el$30 = _$createElement("text"),
              _el$31 = _$createElement("text"),
              _el$32 = _$createElement("text");
            _$insertNode(_el$29, _el$30);
            _$insertNode(_el$29, _el$31);
            _$insertNode(_el$29, _el$32);
            _$setProp(_el$29, "flexDirection", "column");
            _$setProp(_el$29, "marginTop", 1);
            _$insert(_el$30, () => `${formatNumber(used())} / ${limit() ? formatNumber(limit()) : "?"} tokens`);
            _$insert(_el$31, _$createComponent(Span, {
              get fg() {
                return _$memo(() => ratio() > 0.8)() ? color("error") : theme.text.action.primary.base;
              },
              get children() {
                return bar().filled;
              }
            }), null);
            _$insert(_el$31, _$createComponent(Span, {
              get fg() {
                return theme.text.faint;
              },
              get children() {
                return bar().empty;
              }
            }), null);
            _$insert(_el$32, () => `${(ratio() * 100).toFixed(1)}% of context window${limit() ? ` · ${formatNumber(Math.max(0, limit() - used()))} remaining` : ""}`);
            _$effect(_p$ => {
              var _v$14 = theme.text.base,
                _v$15 = theme.text.muted;
              _v$14 !== _p$.e && (_p$.e = _$setProp(_el$30, "fg", _v$14, _p$.e));
              _v$15 !== _p$.t && (_p$.t = _$setProp(_el$32, "fg", _v$15, _p$.t));
              return _p$;
            }, {
              e: undefined,
              t: undefined
            });
            return _el$29;
          })(), _$createComponent(Show, {
            get when() {
              return !props.compact;
            },
            get children() {
              return [(() => {
                var _el$33 = _$createElement("text");
                _$setProp(_el$33, "marginTop", 1);
                _$insert(_el$33, () => "─".repeat(Math.max(8, props.width - 4)));
                _$effect(_$p => _$setProp(_el$33, "fg", theme.text.faint, _$p));
                return _el$33;
              })(), (() => {
                var _el$34 = _$createElement("text");
                _$setProp(_el$34, "attributes", BOLD);
                _$insert(_el$34, (() => {
                  var _c$ = _$memo(() => tasks().length > 0);
                  return () => _c$() ? `TASKS (${tasks().length})` : "TASK";
                })());
                _$effect(_$p => _$setProp(_el$34, "fg", theme.text.muted, _$p));
                return _el$34;
              })(), _$createComponent(Show, {
                get when() {
                  return tasks().length > 0;
                },
                get fallback() {
                  return _$createComponent(Show, {
                    get when() {
                      return row().index > 0;
                    },
                    get fallback() {
                      return (() => {
                        var _el$43 = _$createElement("text");
                        _$insertNode(_el$43, _$createTextNode(`No child sessions yet`));
                        _$effect(_$p => _$setProp(_el$43, "fg", theme.text.faint, _$p));
                        return _el$43;
                      })();
                    },
                    get children() {
                      var _el$42 = _$createElement("box");
                      _$setProp(_el$42, "flexDirection", "column");
                      _$insert(_el$42, _$createComponent(TaskCard, {
                        get row() {
                          return row();
                        },
                        get width() {
                          return Math.max(20, props.width - 4);
                        },
                        get subtitle() {
                          return `from ${truncate(rows().find(item => item.id === info()?.parentID)?.info?.title ?? "root", Math.max(8, props.width - 22))} · ${status().label}`;
                        }
                      }));
                      return _el$42;
                    }
                  });
                },
                get children() {
                  var _el$35 = _$createElement("box");
                  _$setProp(_el$35, "flexDirection", "column");
                  _$setProp(_el$35, "marginTop", 0);
                  _$insert(_el$35, _$createComponent(For, {
                    get each() {
                      return tasks().slice(0, 4);
                    },
                    children: task => _$createComponent(TaskCard, {
                      row: task,
                      get width() {
                        return Math.max(20, props.width - 4);
                      }
                    })
                  }), null);
                  _$insert(_el$35, _$createComponent(Show, {
                    get when() {
                      return tasks().length > 4;
                    },
                    get children() {
                      var _el$36 = _$createElement("text");
                      _$insert(_el$36, () => `+ ${tasks().length - 4} more`);
                      _$effect(_$p => _$setProp(_el$36, "fg", theme.text.faint, _$p));
                      return _el$36;
                    }
                  }), null);
                  return _el$35;
                }
              }), (() => {
                var _el$37 = _$createElement("text");
                _$insertNode(_el$37, _$createTextNode(`RECENT ACTIVITY`));
                _$setProp(_el$37, "attributes", BOLD);
                _$setProp(_el$37, "marginTop", 0);
                _$effect(_$p => _$setProp(_el$37, "fg", theme.text.muted, _$p));
                return _el$37;
              })(), _$createComponent(Show, {
                get when() {
                  return activity().length > 0;
                },
                get fallback() {
                  return (() => {
                    var _el$45 = _$createElement("text");
                    _$insertNode(_el$45, _$createTextNode(`No tool activity yet`));
                    _$effect(_$p => _$setProp(_el$45, "fg", theme.text.faint, _$p));
                    return _el$45;
                  })();
                },
                get children() {
                  var _el$39 = _$createElement("box");
                  _$setProp(_el$39, "flexDirection", "column");
                  _$insert(_el$39, _$createComponent(For, {
                    get each() {
                      return activity();
                    },
                    children: item => (() => {
                      var _el$47 = _$createElement("box"),
                        _el$48 = _$createElement("text"),
                        _el$49 = _$createElement("text"),
                        _el$50 = _$createElement("text"),
                        _el$51 = _$createElement("box"),
                        _el$52 = _$createElement("text");
                      _$insertNode(_el$47, _el$48);
                      _$insertNode(_el$47, _el$49);
                      _$insertNode(_el$47, _el$50);
                      _$insertNode(_el$47, _el$51);
                      _$insertNode(_el$47, _el$52);
                      _$setProp(_el$47, "flexDirection", "row");
                      _$setProp(_el$47, "width", "100%");
                      _$insert(_el$48, () => `${item.icon} `);
                      _$insert(_el$49, () => pad(item.name, 8));
                      _$insert(_el$50, () => truncate(item.detail, Math.max(8, props.width - 22)));
                      _$setProp(_el$51, "flexGrow", 1);
                      _$insert(_el$52, () => item.duration);
                      _$effect(_p$ => {
                        var _v$19 = color(item.tone),
                          _v$20 = theme.text.muted,
                          _v$21 = theme.text.base,
                          _v$22 = theme.text.faint;
                        _v$19 !== _p$.e && (_p$.e = _$setProp(_el$48, "fg", _v$19, _p$.e));
                        _v$20 !== _p$.t && (_p$.t = _$setProp(_el$49, "fg", _v$20, _p$.t));
                        _v$21 !== _p$.a && (_p$.a = _$setProp(_el$50, "fg", _v$21, _p$.a));
                        _v$22 !== _p$.o && (_p$.o = _$setProp(_el$52, "fg", _v$22, _p$.o));
                        return _p$;
                      }, {
                        e: undefined,
                        t: undefined,
                        a: undefined,
                        o: undefined
                      });
                      return _el$47;
                    })()
                  }));
                  return _el$39;
                }
              })];
            }
          })];
        }
      }));
      _$effect(_p$ => {
        var _v$16 = props.width,
          _v$17 = theme.border.base,
          _v$18 = props.compact ? 1 : 0;
        _v$16 !== _p$.e && (_p$.e = _$setProp(_el$21, "width", _v$16, _p$.e));
        _v$17 !== _p$.t && (_p$.t = _$setProp(_el$21, "borderColor", _v$17, _p$.t));
        _v$18 !== _p$.a && (_p$.a = _$setProp(_el$21, "marginBottom", _v$18, _p$.a));
        return _p$;
      }, {
        e: undefined,
        t: undefined,
        a: undefined
      });
      return _el$21;
    })();
  };
  return (() => {
    var _el$53 = _$createElement("box"),
      _el$55 = _$createElement("box"),
      _el$56 = _$createElement("text"),
      _el$58 = _$createElement("box"),
      _el$59 = _$createElement("text");
    _$insertNode(_el$53, _el$55);
    _$setProp(_el$53, "flexDirection", "column");
    _$setProp(_el$53, "width", "100%");
    _$setProp(_el$53, "height", "100%");
    _$setProp(_el$53, "padding", 1);
    _$insert(_el$53, _$createComponent(Header, {}), _el$55);
    _$insert(_el$53, _$createComponent(Show, {
      get when() {
        return wide();
      },
      get fallback() {
        return (() => {
          var _el$60 = _$createElement("box");
          _$setProp(_el$60, "flexDirection", "column");
          _$setProp(_el$60, "flexGrow", 1);
          _$setProp(_el$60, "flexShrink", 1);
          _$setProp(_el$60, "minHeight", 0);
          _$setProp(_el$60, "width", "100%");
          _$insert(_el$60, _$createComponent(Detail, {
            get width() {
              return props.panel.width - 2;
            },
            compact: true
          }), null);
          _$insert(_el$60, _$createComponent(List, {
            get width() {
              return props.panel.width - 2;
            }
          }), null);
          return _el$60;
        })();
      },
      get children() {
        var _el$54 = _$createElement("box");
        _$setProp(_el$54, "flexDirection", "row");
        _$setProp(_el$54, "flexGrow", 1);
        _$setProp(_el$54, "width", "100%");
        _$setProp(_el$54, "gap", 1);
        _$insert(_el$54, _$createComponent(Detail, {
          get width() {
            return detailWidth();
          }
        }), null);
        _$insert(_el$54, _$createComponent(List, {
          get width() {
            return listWidth();
          }
        }), null);
        return _el$54;
      }
    }), _el$55);
    _$insertNode(_el$55, _el$56);
    _$insertNode(_el$55, _el$58);
    _$insertNode(_el$55, _el$59);
    _$setProp(_el$55, "flexDirection", "row");
    _$setProp(_el$55, "width", "100%");
    _$setProp(_el$55, "marginTop", 1);
    _$insertNode(_el$56, _$createTextNode(`↑↓ select · enter open · r refresh · f fullscreen · esc close`));
    _$setProp(_el$58, "flexGrow", 1);
    _$insert(_el$59, (() => {
      var _c$2 = _$memo(() => !!refreshing());
      return () => _c$2() ? "refreshing…" : syncState();
    })());
    _$effect(_p$ => {
      var _v$23 = theme.background.base,
        _v$24 = theme.text.faint,
        _v$25 = theme.text.faint;
      _v$23 !== _p$.e && (_p$.e = _$setProp(_el$53, "backgroundColor", _v$23, _p$.e));
      _v$24 !== _p$.t && (_p$.t = _$setProp(_el$56, "fg", _v$24, _p$.t));
      _v$25 !== _p$.a && (_p$.a = _$setProp(_el$59, "fg", _v$25, _p$.a));
      return _p$;
    }, {
      e: undefined,
      t: undefined,
      a: undefined
    });
    return _el$53;
  })();
}
export default Plugin.define({
  id: "opencode.subagent-dashboard.tui",
  setup(context) {
    const unregister = context.ui.slot({
      append: "session.panel",
      render: panel => _$createComponent(Show, {
        get when() {
          return panel.name === PANEL;
        },
        get children() {
          return _$createComponent(Dashboard, {
            panel: panel
          });
        }
      })
    });
    context.keymap.layer(() => ({
      mode: "global",
      priority: 20,
      commands: [{
        id: "opencode.subagent-dashboard.open",
        title: "Open subagents dashboard",
        description: "Live progress for this session and its subagents",
        group: "Subagents",
        bind: "ctrl+alt+s",
        palette: true,
        slash: {
          name: "subagents",
          aliases: ["subagent"]
        },
        run: () => {
          if (!context.ui.panel.open(PANEL, {
            presentation: "fullscreen"
          })) {
            context.ui.toast.show({
              message: "Open a session first to view its subagents.",
              variant: "warning"
            });
          }
        }
      }],
      bindings: ["opencode.subagent-dashboard.open"]
    }));
    return () => unregister();
  }
});