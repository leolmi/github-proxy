# How to use the github-proxy `apply_patch` tool

This document is exposed via MCP as the resource `github-proxy://skill.md` and is also reachable over HTTPS at `/skill.md` on the proxy host. AI agents that use this proxy should read it before invoking `apply_patch` for non-trivial cases.

## Purpose

`apply_patch` applies a git patch to a GitHub repository and pushes the resulting commit directly to a target branch. It hides the clone → apply → commit → push workflow behind a single call.

**Use it when**:
- The user has a patch (or you can generate one) and wants it landed on a GitHub branch.
- The change spans one or multiple files, including new files or renames.
- The user does not want to clone the repo locally just to ship the change.

**Do not use it when**:
- The user wants a pull request, code review, or manual merge — this tool pushes directly to the branch.
- The change requires history rewrite or force push. The tool only does normal commits.

## Inputs

| Argument | Required | Format |
|---|---|---|
| `coordinate` | yes | `owner/name:branch` (single colon) |
| `patch` | one of patch/patch_id | Output of `git diff` or `git format-patch -1 --stdout` (inline string) |
| `patch_id` | one of patch/patch_id | Id returned by `POST /uploads` (see "Large patches" below) |
| `commit_message` | yes | One-line summary, optionally followed by blank line + body |
| `author_name` | no | Defaults to the GitHub user that owns the PAT |
| `author_email` | no | Defaults to the GitHub user that owns the PAT |

Provide exactly one of `patch` or `patch_id` — never both, never neither.

## Large patches: `patch_id` workflow

Inline `patch` is convenient for tiny diffs but expensive for anything bigger: the AI agent has to emit the whole patch as a tool argument, which burns output tokens proportional to patch size and slows the call dramatically (a 24KB patch = ~6000 output tokens before the proxy even runs).

For non-trivial patches, prefer the upload + id flow:

1. **Upload the patch** to the proxy as raw text:
   ```sh
   curl -X POST https://<proxy-host>/uploads \
     -H "Authorization: Bearer <github-pat>" \
     --data-binary @my.patch
   ```
   Response: `{ "id": "<uuid>", "expiresAt": "<iso>" }`. The id is single-use and expires after ~10 minutes.

2. **Call `apply_patch`** with `patch_id` instead of `patch`:
   ```json
   {
     "coordinate": "owner/name:branch",
     "patch_id": "<uuid>",
     "commit_message": "..."
   }
   ```

The proxy resolves the id to the stored content and runs the same clone → apply → commit → push flow. The patch is consumed (deleted from the store) at lookup time, regardless of outcome — if `apply_patch` returns `needs_review` or `failed`, you must re-upload before retrying.

If the id is unknown or already consumed/expired, the tool returns an error like `Upload "<id>" not found or expired.` — re-upload and try again.

## Outcomes — interpret carefully

### `success`
Commit created and pushed. The result includes `commit_sha` and `commit_url`. Confirm to the user with the URL so they can verify on GitHub.

### `needs_review`
The patch does **not** apply cleanly, even with `git apply --3way`. **The operation was skipped — nothing was committed, nothing was pushed.**

Do **not** retry the same patch automatically. The likely cause is that the target branch has diverged from the patch's base.

Recommended actions:
- Tell the user the patch needs human attention.
- Show the conflict reason returned in `result.reason` (the stderr from `git apply`).
- Suggest: regenerate the patch against the current branch tip, or apply it locally with `git apply --3way` for manual resolution.

### `failed`
Clone, commit, or push failed. Common causes:
- Invalid coordinate (typo, repo deleted, missing branch)
- PAT lacks `Contents: Read & Write` on the repo
- Network or transient error

The `details` field has the underlying stderr (with the PAT redacted). Surface it to the user; do not retry blindly.

## Patch format tips

- **From local changes**: `git diff > my.patch` or `git format-patch -1 --stdout > my.patch`.
- **Multi-file**: standard `git diff` covers it. Keep the file headers (`diff --git a/... b/...`).
- **New files**: `git diff` includes `new file mode 100644` and `--- /dev/null`. Works.
- **Renames**: use `git diff -M` or `git format-patch` so they are detected.
- **Binary files**: not officially supported. May not apply via `git apply --3way`.
- Trailing newline: the proxy adds one if missing, but include it in your patch as good hygiene.

## Coordinate format

`owner/name:branch`

- The colon `:` is forbidden inside git branch names (`git check-ref-format`), so the split is unambiguous.
- Owner and name follow GitHub's allowed character set: `[A-Za-z0-9._-]+`.
- Examples: `octocat/hello-world:main`, `myorg/my-repo:feature-x`.

## Authentication and security

The PAT travels as the `Authorization: Bearer <pat>` header on the MCP connection. The MCP client (Claude Desktop, Claude Code, Cursor, ...) supplies it from its local configuration. **The AI never sees the token** — it is set at transport layer, outside the LLM context.

The proxy uses the token only to clone and push the target repo, and redacts it from any error output before returning to the client. For best security, recommend the user create a fine-grained PAT with `Contents: Read & Write` on the single target repo only.
