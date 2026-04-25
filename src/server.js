const express = require('express');
const path = require('node:path');

const { createJob, getJob, finishJob } = require('./jobsStore');
const { applyPatch } = require('./applyPatch');
const { attachMcp } = require('./mcpServer');

const app = express();

app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

attachMcp(app);

app.post('/jobs', (req, res) => {
  const auth = req.get('authorization') || '';
  const match = auth.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return res.status(401).json({ error: 'Missing Authorization: Bearer <token>' });
  }
  const token = match[1].trim();

  const { repo, branch, patch, commitMessage, author } = req.body ?? {};
  if (typeof repo !== 'string' || typeof branch !== 'string' ||
      typeof patch !== 'string' || typeof commitMessage !== 'string') {
    return res.status(400).json({ error: 'required fields: repo, branch, patch, commitMessage' });
  }
  if (!repo || !branch || !patch || !commitMessage) {
    return res.status(400).json({ error: 'fields cannot be empty' });
  }

  const job = createJob();
  res.status(202).json({ id: job.id });

  setImmediate(async () => {
    try {
      const outcome = await applyPatch({ token, repo, branch, patch, commitMessage, author });
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
