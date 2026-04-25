const express = require('express');
const path = require('node:path');

const { createJob, getJob, finishJob } = require('./jobsStore');
const { createUpload, consumeUpload } = require('./uploadsStore');
const { applyPatch } = require('./applyPatch');
const { attachMcp } = require('./mcpServer');

const app = express();

app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

attachMcp(app);

app.post('/uploads', express.text({ limit: '10mb', type: '*/*' }), (req, res) => {
  const auth = req.get('authorization') || '';
  if (!/^Bearer\s+\S+$/i.test(auth)) {
    return res.status(401).json({ error: 'Missing Authorization: Bearer <token>' });
  }

  const body = typeof req.body === 'string' ? req.body : '';
  if (!body.trim()) {
    return res.status(400).json({ error: 'empty body: send the patch content as raw text (curl --data-binary @file.diff)' });
  }

  const upload = createUpload(body);
  res.status(201).json(upload);
});

app.post('/jobs', (req, res) => {
  const auth = req.get('authorization') || '';
  const match = auth.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return res.status(401).json({ error: 'Missing Authorization: Bearer <token>' });
  }
  const token = match[1].trim();

  const { repo, branch, patch, patchId, commitMessage, author } = req.body ?? {};
  if (typeof repo !== 'string' || typeof branch !== 'string' || typeof commitMessage !== 'string') {
    return res.status(400).json({ error: 'required fields: repo, branch, commitMessage' });
  }
  if (!repo || !branch || !commitMessage) {
    return res.status(400).json({ error: 'fields cannot be empty' });
  }

  const hasPatch = typeof patch === 'string' && patch.trim().length > 0;
  const hasPatchId = typeof patchId === 'string' && patchId.trim().length > 0;
  if (hasPatch === hasPatchId) {
    return res.status(400).json({ error: 'provide exactly one of: patch, patchId' });
  }

  let resolvedPatch;
  if (hasPatchId) {
    resolvedPatch = consumeUpload(patchId.trim());
    if (resolvedPatch == null) {
      return res.status(410).json({ error: 'upload not found or expired' });
    }
  } else {
    resolvedPatch = patch;
  }

  const job = createJob();
  res.status(202).json({ id: job.id });

  setImmediate(async () => {
    try {
      const outcome = await applyPatch({ token, repo, branch, patch: resolvedPatch, commitMessage, author });
      finishJob(job.id, outcome.status, outcome.result);
    } catch (err) {
      finishJob(job.id, 'failed', { error: 'unexpected error', details: String(err?.message ?? err) });
    }
  });
});

app.get('/jobs/:id', (req, res) => {
  const job = getJob(req.params.id);
  if (!job) {
    return res.status(404).json({ error: 'job not found or expired' });
  }
  res.json(job);
});

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => {
  console.log(`github-proxy listening on :${port}`);
});
