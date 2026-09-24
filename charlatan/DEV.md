# Charlatan Web Client

Minimal, native HTML/CSS/JS client for the Charlatan game (no framework, no build step). Visual language reused from sarmad.studio: dark grid background, Orbitron headers, Inter body, purple gradient accent, rem-based scaling.

---

## 1. File Structure

```
charlatan/
├── en/
│   └── index.html      # structure to work with LTR
├── ar/
│   └── index.html      # structure to work with RTL
├── styles/
│   ├── base.css        # reset, fonts, :root vars, typography (ported from /styles.css)
│   ├── layout.css      # nav, containers, responsive grid
│   └── screens.css     # per-phase screen styles
├── scripts/
│   ├── main.js         # entry: connects ws, boots router
│   ├── ws.js           # WebSocket client + envelope (de)serialization
│   ├── state.js        # in-memory/session store + tiny pub/sub event bus
│   ├── router.js       # Phase -> screen swap, mounts/unmounts DOM
│   ├── i18n.js         # i18n loader using last dir in URI path as locale name
│   └── screens/
│       ├── lobby.js    # Stage "lobby": room code, players, start btn
│       ├── mission.js  # Phase "mission": task UI per Mission type
│       ├── debate.js   # Phase "debate": chat + captain kill prompt
│       ├── hunter.js   # Phase "hunter": blind hunt prompt
│       ├── voting.js   # Phase "voting": accuse/eject + consensus
│       └── ended.js    # Phase "ended": win/lose summary
├── locales/
│   ├── ar.json         # Arabic translations
│   └── en.json         # English translations
└── assets/
    └── icons/          # inline-svg sources for UI elemnets
```

No bundler. `<script type="module" src="/scripts/main.js">` in `index.html`; each screen is an ES module exporting `mount(container, state)` / `unmount()`.

---

## 2. Design System (sarmad.studio, sci-fi/terminal variant)

Same foundation as the marketing site (dark grid bg, Orbitron headers, Inter body, rem scaling, purple accent), pushed into a more futuristic "ship terminal" direction: bracket-cornered panels, status indicators, and glow accents. Port these tokens into `styles/base.css` as the source of truth and don't hand-roll new ones per screen.

```css
:root {
  --bg: #0a0a0f;
  --panel: rgba(17, 18, 26, 0.72);
  --panel-solid: #121218;
  --border: rgba(255, 255, 255, 0.08);
  --line: rgba(255, 255, 255, 0.06);
  --text: #e6e6ea;
  --muted: #86868f;
  --dim: #55555f;

  --purple: #6333cc;
  --purple-soft: #8b6ef0;
  --purple-glow: rgba(99, 51, 204, 0.45);

  --green: #2ee6a6;
  --green-glow: rgba(46, 230, 166, 0.4);

  --red: #ff3d5e;
  --red-glow: rgba(255, 61, 94, 0.4);

  --font-display: 'Orbitron', ui-monospace, monospace;
  --font-body: 'Inter', system-ui, sans-serif;

  --radius-sm: 3px;
  --radius-md: 6px;
}
```
- `html { font-size: 62.5%; }` + rem units throughout.
- Headers: `--font-display` (Orbitron 700/900, `'Noto Kufi Arabic'` fallback for `ar/`). Wordmark uses a white→`--purple-soft` gradient text fill.
- Body: `--font-body` (Inter 400/500/600).
- Same repeating-grid radial `.bg` div as the marketing site, plus a subtle scanline overlay (`.bg::after`, 3px repeating diagonal, `mix-blend-mode: overlay`) for the terminal feel.
- **Panels** (`.terminal-frame`, `.task-shell`, `.role-card`, `.phase-bar`): `var(--panel)` bg, `1px solid var(--border)`, `backdrop-filter: blur(16–20px)`, `--radius-sm`. Primary panels (`.terminal-frame`) get open corner-bracket decorations (`::before`/`::after`, 2px `--purple-soft` border, glow via `drop-shadow`) instead of a full border. reused across lobby, role-reveal, and voting cards.
- **Status/presence dots**: small glow-backed circles (`box-shadow: 0 0 8–10px <color-glow>`). green = connected/alive, amber pulsing = connecting, red = disconnected/error/eliminated. Used in `#connection-status`, `.roster-row .presence`, `.player-chip .dot`.
- **Buttons** (`.btn-primary`, `.btn-danger`, `.btn-ghost`): gradient fills with matching glow shadow (purple/red), `translateY(-2px)` lift + stronger glow on hover, ghost variant for secondary actions.
- **Tabs** (`.mode-tabs` / `.mode-tab`): pill-track segmented control, active tab filled `--purple`, used for join/host and similar binary mode switches.
- Room codes and other display values use `--font-display` with wide letter-spacing (e.g. `.room-code-block .code`).
- Accessibility: `:focus-visible` gets a `--purple-soft` outline; `prefers-reduced-motion` collapses all animation/transition durations.
- Responsive breakpoint at `560px` tightens panel padding and shrinks the room-code type.

---

## 3. State & Routing

`state.js` holds a single plain object:
```js
{ room, session, players, self, role, trait, task, votes }
```
Small pub/sub (`on(event, fn)` / `emit(event, data)`) with no reactive framework needed at this scale.

`router.js` listens for `phase_change` (and `stage` on `session_state_sync`) and swaps the mounted screen module:

| Stage / Phase | Screen Module  |
|---------------|----------------|
| `lobby`       | `lobby.js`     |
| `initial`     | `lobby.js`     |
| `mission`     | `mission.js`   |
| `debate`      | `debate.js`    |
| `hunter`      | `hunter.js`    |
| `voting`      | `voting.js`    |
| `ended`       | `ended.js`     |

---

## 4. WebSocket Client (`ws.js`)

Wraps the envelope from server exactly:
```js
{ event, payload, id }
```
Responsibilities:
- `connect(ticket)`: opens `wss://api.<domain>/charlatan/room/{id}/ws?ticket=...`.
- `send(event, payload)`: auto-generates snowflake `id`.
- Dispatches incoming events through `state.js`'s bus (`ws:<event_name>`).
- **Reconnect**: on drop, retry with backoff for 30s (matches server's graceful-reconnect window) before showing a "connection lost" screen.
- `ping` sent every ~20s to keep the connection alive.

Each screen only subscribes to the events it cares about (`role_assigned`, `task`, `vote_result`, etc.) and calls `ws.send(...)` for client actions (`action`, `vote_cast`, `game_start`).

---

## 5. Screens responsibilities

- **lobby.js**: join code, player list (`player_joined`/`player_left`), host-only Start button (`game_start`).
- **mission.js**: renders `Task` payload per `Mission` type (weaponry/power_supply/decode/etc) as distinct minigame components under `scripts/screens/missions/`; submits via `action`.
- **debate.js**: free chat (`message`).
- **hunter.js**: Hunter-only kill/skip prompt; spectators see a waiting state.
- **voting.js**: accuse/eject UI, consensus re-vote handling, renders `vote_result`.
- **ended.js**: win/lose banner styled like the hero section's gradient highlight.

---

## 6. Non-goals (kept intentionally minimal)

- No build tooling (Vite/Webpack) only raw JS + native CSS.
- No client-side framework which DOM diffing done manually per screen (small, phase-scoped surfaces).
- No client-side game logic as server is fully authoritative; client only renders state and sends actions.
