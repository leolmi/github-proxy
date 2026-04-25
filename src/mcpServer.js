const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { ListToolsRequestSchema, CallToolRequestSchema } = require('@modelcontextprotocol/sdk/types.js');

const { applyPatch } = require('./applyPatch');

const REPO_RE = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;

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
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [{
      name: 'apply_patch',
      description: [
        'Apply a git patch to a GitHub repository and push the resulting commit directly to the target branch.',
        'Authentication is handled by the proxy via the GitHub PAT supplied as an Authorization header on the MCP connection.',
        "Return states: 'success' (commit created and pushed), 'needs_review' (patch does not apply cleanly, operation skipped),",
        "'failed' (clone/commit/push error or invalid input).",
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
            description: "Git patch content (output of 'git diff' or 'git format-patch'). Applied via 'git apply --3way'.",
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
        required: ['coordinate', 'patch', 'commit_message'],
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
    if (typeof args.patch !== 'string' || !args.patch.trim()) {
      return errorResult('Argument "patch" missing or empty.');
    }
    if (typeof args.commit_message !== 'string' || !args.commit_message.trim()) {
      return errorResult('Argument "commit_message" missing or empty.');
    }

    const author = (args.author_name && args.author_email)
      ? { name: String(args.author_name), email: String(args.author_email) }
      : undefined;

    const outcome = await applyPatch({
      token,
      repo: parsed.repo,
      branch: parsed.branch,
      patch: args.patch,
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
