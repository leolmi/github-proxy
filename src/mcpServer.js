const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} = require('@modelcontextprotocol/sdk/types.js');
const { readFile } = require('node:fs/promises');
const path = require('node:path');

const { applyPatch } = require('./applyPatch');
const { consumeUpload } = require('./uploadsStore');

const REPO_RE = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;
const SKILL_RESOURCE_URI = 'github-proxy://skill.md';
const SKILL_FILE_PATH = path.join(__dirname, '..', 'public', 'skill.md');

function parseCoordinate(text) {
  if (typeof text !== 'string') return null;
  const sep = text.indexOf(':');
  if (sep < 0) return null;
  const repo = text.slice(0, sep).trim();
  const branch = text.slice(sep + 1).trim();
  if (!REPO_RE.test(repo) || !branch) return null;
  return { repo, branch };
}

function buildServer(token) {
  const server = new Server(
    { name: 'github-proxy', version: '0.1.0' },
    { capabilities: { tools: {}, resources: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [{
      name: 'apply_patch',
      description: [
        'Apply a git patch to a GitHub repository: shallow clone, "git apply --3way", commit, then direct push to the target branch.',
        'Use it when the user has (or you can generate) a git patch and wants it landed on a GitHub branch without cloning locally.',
        'Single or multi-file patches, including new files and renames, are supported.',
        'Coordinate format is "owner/name:branch" (e.g. "octocat/hello-world:main").',
        'Provide the patch via EITHER "patch" (inline string) OR "patch_id" (id returned by POST /uploads). For non-trivial patches (more than a few KB) prefer "patch_id": upload the patch via "curl -X POST .../uploads -H \'Authorization: Bearer <pat>\' --data-binary @file.diff" and pass the returned id here. This avoids re-emitting the whole patch as a tool argument.',
        'Three outcomes: "success" returns commit_sha + commit_url; "needs_review" means the patch does NOT apply cleanly (operation SKIPPED — do NOT retry blindly, surface the conflict reason and suggest manual resolution); "failed" returns the underlying error in result.details.',
        'For edge cases, format tips, and detailed outcome handling, read the MCP resource "github-proxy://skill.md" via resources/read (or fetch the same content over HTTPS at "/skill.md" on this proxy host) before invoking the tool on non-trivial inputs.',
      ].join(' '),
      inputSchema: {
        type: 'object',
        properties: {
          coordinate: {
            type: 'string',
            description: "Repository coordinate in the form owner/name:branch (e.g. 'octocat/hello-world:main').",
          },
          patch: {
            type: 'string',
            description: "Git patch content (output of 'git diff' or 'git format-patch'). Applied via 'git apply --3way'. Mutually exclusive with patch_id.",
          },
          patch_id: {
            type: 'string',
            description: "Id returned by POST /uploads on this proxy. Single-use; expires after ~10 minutes. Mutually exclusive with patch.",
          },
          commit_message: {
            type: 'string',
            description: 'Commit message that will accompany the patch.',
          },
          author_name: {
            type: 'string',
            description: 'Commit author name. Optional: if omitted (or if author_email is also omitted), it is fetched from the PAT.',
          },
          author_email: {
            type: 'string',
            description: 'Commit author email. Optional: see author_name.',
          },
        },
        required: ['coordinate', 'commit_message'],
        additionalProperties: false,
      },
    }],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (request.params.name !== 'apply_patch') {
      return errorResult(`Unknown tool: ${request.params.name}`);
    }
    if (!token) {
      return errorResult('Missing Authorization: Bearer <github-pat> header on the MCP connection.');
    }

    const args = request.params.arguments ?? {};
    const parsed = parseCoordinate(args.coordinate);
    if (!parsed) {
      return errorResult('Invalid coordinate. Expected format: owner/name:branch.');
    }
    if (typeof args.commit_message !== 'string' || !args.commit_message.trim()) {
      return errorResult('Argument "commit_message" missing or empty.');
    }

    const hasPatch = typeof args.patch === 'string' && args.patch.trim().length > 0;
    const hasPatchId = typeof args.patch_id === 'string' && args.patch_id.trim().length > 0;
    if (hasPatch === hasPatchId) {
      return errorResult('Provide exactly one of: "patch" (inline) or "patch_id" (from POST /uploads).');
    }

    let patchContent;
    if (hasPatchId) {
      patchContent = consumeUpload(args.patch_id.trim());
      if (patchContent == null) {
        return errorResult(`Upload "${args.patch_id}" not found or expired. Upload the patch again via POST /uploads.`);
      }
    } else {
      patchContent = args.patch;
    }

    const author = (args.author_name && args.author_email)
      ? { name: String(args.author_name), email: String(args.author_email) }
      : undefined;

    const outcome = await applyPatch({
      token,
      repo: parsed.repo,
      branch: parsed.branch,
      patch: patchContent,
      commitMessage: args.commit_message,
      author,
    });

    if (outcome.status === 'success') {
      return {
        content: [{
          type: 'text',
          text: `Patch applied.\nCommit SHA: ${outcome.result.commitSha}\nCommit URL: ${outcome.result.commitUrl}`,
        }],
      };
    }
    if (outcome.status === 'needs_review') {
      return {
        isError: true,
        content: [{
          type: 'text',
          text: `Patch needs manual review (operation skipped).\n\n${outcome.result.reason ?? ''}`.trim(),
        }],
      };
    }
    return errorResult(
      `${outcome.result.error ?? 'unknown error'}\n\n${outcome.result.details ?? ''}`.trim(),
    );
  });

  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: [{
      uri: SKILL_RESOURCE_URI,
      name: 'apply_patch usage guide',
      description: 'Detailed instructions, edge cases, and outcome handling for the apply_patch tool. Also reachable over HTTPS at /skill.md on this proxy host.',
      mimeType: 'text/markdown',
    }],
  }));

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    if (request.params.uri !== SKILL_RESOURCE_URI) {
      throw new Error(`Unknown resource: ${request.params.uri}`);
    }
    const text = await readFile(SKILL_FILE_PATH, 'utf8');
    return {
      contents: [{ uri: SKILL_RESOURCE_URI, mimeType: 'text/markdown', text }],
    };
  });

  // Note: the same skill.md is also web-served by express.static at /skill.md.

  return server;
}

function errorResult(message) {
  return { isError: true, content: [{ type: 'text', text: message }] };
}

function attachMcp(app) {
  app.post('/mcp', async (req, res) => {
    const auth = req.get('authorization') || '';
    const match = auth.match(/^Bearer\s+(.+)$/i);
    if (!match) {
      return res.status(401).json({
        jsonrpc: '2.0',
        error: { code: -32001, message: 'Authorization: Bearer <github-pat> required' },
        id: null,
      });
    }
    const token = match[1].trim();

    let transport;
    let server;
    try {
      server = buildServer(token);
      transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

      res.on('close', () => {
        transport?.close().catch(() => {});
        server?.close().catch(() => {});
      });

      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      console.error('MCP error:', err);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal server error' },
          id: null,
        });
      }
    }
  });

  // In stateless mode the transport does not use GET (upstream SSE channel) or DELETE.
  app.get('/mcp', methodNotAllowed);
  app.delete('/mcp', methodNotAllowed);
}

function methodNotAllowed(_req, res) {
  res.status(405).json({
    jsonrpc: '2.0',
    error: { code: -32000, message: 'Method not allowed in stateless mode.' },
    id: null,
  });
}

module.exports = { attachMcp };
