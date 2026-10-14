# Relay — a client-side API workspace

A Postman-style API testing tool built as a single page of vanilla HTML, CSS and
JavaScript. No build step, no dependencies, no server: open the file and it runs.

```bash
start index.html
```

Any static server works too, and is worth using if you want a real origin rather
than `file://` (some APIs reject the `null` origin a file-served page sends):

```bash
npx serve .
```

---

## What it does

**Requests**
- `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD`, `OPTIONS`
- Query parameters and headers as key/value tables, each row individually
  enable-able, with a bulk `key: value` paste mode
- Bodies as JSON (validated as you type), raw text, or `x-www-form-urlencoded`
- `Content-Type` is filled in for you unless you set one yourself
- Several requests open at once as tabs; middle-click or `×` to close

**Responses**
- Colour-coded status badge, round-trip time, and payload size
- Pretty-printed and syntax-highlighted JSON, plus raw and preview views
  (HTML renders in a locked-down sandboxed frame)
- Full response header table
- A **Sent** tab showing exactly what left the browser — final URL, headers,
  body, timing split, and anything the browser refused to send

**Environments**
- `{{variable}}` anywhere in the URL, headers, or body
- Variables may reference other variables
- The URL bar previews what it will actually resolve to, marking unknown
  variables in red before you send

**Persistence and portability**
- Every send is logged to history; click any entry to load it back
- Saved requests, environments, open tabs, theme and pane split survive a reload
  (`localStorage`)
- Export the workspace as JSON; import Relay exports, a bare request, a **Postman
  collection v2.x**, or a Postman environment export — drag the file onto the
  window or use **Import**

**Interface**
- Dark and light themes, driven entirely by CSS custom properties
- Draggable split between request and response, remembered between sessions
- Works down to phone width, where the sidebar becomes a drawer

## Keyboard

| Shortcut | Action |
| --- | --- |
| `Ctrl`/`Cmd` + `Enter` | Send (or cancel an in-flight request) |
| `Ctrl`/`Cmd` + `S` | Save the current request |
| `Ctrl` + `Alt` + `T` | New tab |
| `Ctrl` + `Alt` + `W` | Close tab |
| `Ctrl` + `Alt` + `←` / `→` | Previous / next tab |
| `Esc` | Dismiss a dialog |

## Layout

```
index.html          markup: split panes, tab strips, dynamic form containers
css/style.css       one stylesheet; every colour is a variable, themes swap the set
js/
  util.js           formatting, escaping, DOM building, the JSON highlighter
  store.js          the localStorage boundary — handles absent and full storage
  state.js          the whole workspace in one object, plus a topic bus
  env.js            {{variable}} resolution and the URL/query helpers
  kv.js             the key/value editor widget
  ui.js             toasts and promise-based modals
  http.js           request assembly, execution, timing, error classification
  request.js        request editor: tabs, URL bar, params, headers, body, send
  response.js       response inspector and the failure diagnostics
  sidebar.js        history, saved requests, environment editing
  portability.js    import / export, including the Postman converters
  app.js            boot, theme, split dragging, settings, shortcuts
```

Scripts are plain classic `<script>` tags loaded in dependency order rather than
ES modules, so the tool also runs straight off the filesystem — `file://` blocks
module loading under the same-origin rules.

### How the pieces fit

`state.js` owns everything and publishes topics (`tabs`, `req`, `res`, `history`,
`saved`, `env`, `settings`). Panels never call each other; they mutate state and
re-render on the topics they care about. Saves to `localStorage` are debounced,
and response bodies are deliberately left out of what gets saved.

The URL bar and the params table are two views of the same data. Typing a query
string parses it into rows; editing the rows rewrites the URL. Disabled rows stay
in the table but never reach the URL, and `{{tokens}}` are exempted from
percent-encoding so a URL stays readable as a template.

`http.js` `build()` produces the exact object `fetch` is given, after variable
substitution. The Sent tab renders that same object, so what you inspect is what
went out — there is no second guess at the final shape.

## The CORS ceiling

Requests run inside the browser tab, under the same rules as any other page
script. If a server does not answer with an `Access-Control-Allow-Origin` header
that covers this page, the browser discards the response before the tool ever
sees it — and a blocked reply is indistinguishable from a host that never
answered. Both surface as `Failed to fetch`.

When that happens the response pane explains the likely cause rather than just
printing the message, and offers the ways round it:

- **Test against APIs that opt in** — `jsonplaceholder.typicode.com`,
  `reqres.in`, `httpbin.org` all allow cross-origin calls.
- **Allow your origin** on the API itself, if it is yours to configure.
- **Point Relay at a CORS proxy** (Settings → CORS proxy). Put `{url}` in the
  proxy address where the encoded target should go, e.g.
  `https://my-proxy.example.com/?url={url}`; without it the target is appended.
  Requests then travel through whatever you name there, so use a proxy you run
  or trust — never for credentials or production data.
- **Copy as cURL** and run it in a terminal, where the same-origin rule does not
  apply at all.

Two related limits are worth knowing: the browser silently drops forbidden
headers such as `Host`, `Origin` and `Content-Length` (Relay tells you when you
set one), and a cross-origin response only exposes safelisted headers unless the
server sends `Access-Control-Expose-Headers`.

## Data

Everything stays in this browser. No telemetry, no backend, no account. Requests
go directly from your browser to the host you typed — except through a proxy you
configure yourself. **Settings → Delete everything** clears the lot.
