# github-proxy

Stateless proxy that applies git patches to a GitHub repository using a user-supplied Personal Access Token, exposed both over HTTP and as an MCP tool for AI agents.

## Features

- **Apply patches** to a GitHub repo: shallow clone → `git apply --3way` → commit → direct push to the target branch.
- **Patches with real conflicts are skipped**: no commit, no push, the user is informed via the `needs_review` state.
- **Minimal web UI** (vanilla HTML/CSS/JS) with a drop-zone for `.patch` files and a list of `repo:branch` pairs persisted in `localStorage`.
- **Async HTTP API** with job + polling (`POST /jobs` → `GET /jobs/:id`) to work around HTTP timeouts on PaaS hosts during potentially slow operations.
- **MCP endpoint** (`POST /mcp`, Streamable HTTP transport) exposing the `apply_patch` tool with automatic schema discovery for any MCP-aware client.
- **PAT is never persisted server-side**: the token lives only in process memory for the duration of a single operation, and is redacted from any stderr returned to the client.

## Architecture

Everything runs in a single Node + Express process. No database, no Redis: job state lives in an in-memory `Map` with a 5-minute TTL after completion.

```
public/                 static frontend (vanilla JS)
├── index.html
├── style.css
└── app.js              POST /jobs + polling + saved-pairs dialog
src/
├── server.js           Express bootstrap, /jobs routes, MCP mount
├── jobsStore.js        Map<id, Job> + TTL cleanup
├── applyPatch.js       clone → git apply --3way → commit → push (pure)
└── mcpServer.js        /mcp endpoint + apply_patch tool
```

## Local setup

Requires **Node ≥ 20** and `git` available in `PATH`.

```sh
npm install
npm start
```

Open `http://localhost:3000`.

## Heroku deployment

`Procfile`, `engines.node`, and `Aptfile` are already set up. The repo provides an ephemeral writable filesystem at `/tmp`, which is all the temporary clone needs.

> ⚠️ Heroku runtime images do **not** ship with `git` by default — only the build phase has it. We install it at runtime via the `apt` buildpack and an `Aptfile` listing `git`.

Buildpack setup (one-time, before the first deploy):

```sh
heroku buildpacks:add --index 1 https://github.com/heroku/heroku-buildpack-apt
heroku buildpacks:add heroku/nodejs
```

The `apt` buildpack must run **before** `heroku/nodejs`. You can also configure this from the Heroku dashboard under *Settings → Buildpacks*, dragging the apt buildpack above nodejs.

Then deploy:

```sh
heroku create <app-name>
git push heroku main
```

## Web UI usage

1. Open the page and paste a **fine-grained PAT** (see *Security*).
2. Enter the coordinate as `owner/name:branch` (e.g. `octocat/hello-world:main`). Coordinates you submit are saved to `localStorage` and reachable from the *Saved pairs* dialog.
3. Drag and drop, or pick, a `.patch` or `.diff` file.
4. Fill in the commit message.
5. *Apply patch*: the page reports the live status (`running` → `success` / `needs_review` / `failed`).

## HTTP API

### `POST /jobs`

Queues a job and returns immediately. Execution is asynchronous.

```sh
curl -X POST https://<host>/jobs \
  -H 'Authorization: Bearer <PAT>' \
  -H 'Content-Type: application/json' \
  -d '{
    "repo": "owner/name",
    "branch": "main",
    "patch": "diff --git a/file b/file\n...",
    "commitMessage": "Apply patch X",
    "author": { "name": "John", "email": "john@example.com" }
  }'
```

`author` is optional: if omitted, the server fetches it from `GET /user` on GitHub using the PAT.

Responses:
- `202 { "id": "<uuid>" }` — job queued
- `400` — malformed body or missing fields
- `401` — missing `Authorization` header

### `GET /jobs/:id`

Current job state.

```json
{
  "id": "...",
  "status": "running" | "success" | "needs_review" | "failed",
  "createdAt": "...",
  "finishedAt": "..." | null,
  "result": { ... } | null
}
```

Shape of `result` per state:
- `success` → `{ commitSha, commitUrl }`
- `needs_review` → `{ reason }` (stderr from `git apply`)
- `failed` → `{ error, details }`

`404` if the id does not exist or has expired.

## MCP usage

The `/mcp` endpoint speaks **Streamable HTTP** (the official MCP transport). The PAT travels as an `Authorization: Bearer ...` header on the MCP connection.

Example client configuration (Claude Desktop, Claude Code, Cursor, etc.):

```json
{
  "github-proxy": {
    "url": "https://<host>/mcp",
    "headers": { "Authorization": "Bearer <PAT>" }
  }
}
```

Once connected, the client automatically discovers the **`apply_patch`** tool:

| Argument | Type | Required | Description |
|---|---|---|---|
| `coordinate` | string | ✅ | format `owner/name:branch` |
| `patch` | string | ✅ | patch content (output of `git diff` or `git format-patch`) |
| `commit_message` | string | ✅ | commit message |
| `author_name` | string | – | optional (defaults to name from PAT) |
| `author_email` | string | – | optional (defaults to email from PAT) |

The tool call is synchronous from the client's perspective: the proxy performs clone + apply + push and returns the final result directly. Polling, coordinate parsing, and state handling are hidden behind the MCP abstraction.

The MCP server also exposes a documentation **resource** with detailed usage guidance, edge cases, and outcome handling:

```
URI:  github-proxy://skill.md
Type: text/markdown
```

AI clients that support MCP resources can fetch it via `resources/read`. The same file is also served over HTTPS at `/skill.md` on the proxy host, and viewable directly on GitHub at [public/skill.md](public/skill.md).

## Security

- **Generate a fine-grained PAT with minimal scope**: `Contents: Read & Write` on the single target repo. Never use a classic PAT with org-wide access.
- The token is never logged: every git stderr returned to the client passes through `redactToken()`.
- Web UI: the token only lives in the browser's `localStorage`. No cookies, no server-side session.
- The web client **never uses `innerHTML`** for data coming from the server or the patch — only `textContent`. XSS mitigation against malicious patches.

## Known limitations

- **30-second HTTP timeout on Heroku**: the MCP tool call is synchronous, so very large repos may exceed the limit. With `git clone --depth 1` operations are typically a few seconds. If this becomes a problem, MCP `notifications/progress` can be added to keep the stream alive during the operation.
- **Single-dyno only**: the HTTP job store is in-memory. Scaling out to multiple dynos would let `POST /jobs` and polling land on different instances.
- **Dyno restart loses jobs**: the UI handles this case by showing a message and suggesting a retry.

## License

[MIT](LICENSE) © leolmi
