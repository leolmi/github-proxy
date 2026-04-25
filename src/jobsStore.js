const { randomUUID } = require('node:crypto');

const TTL_AFTER_FINISH_MS = 5 * 60 * 1000;

const jobs = new Map();

function createJob() {
  const id = randomUUID();
  const job = {
    id,
    status: 'running',
    createdAt: new Date().toISOString(),
    finishedAt: null,
    result: null,
  };
  jobs.set(id, job);
  return job;
}

function getJob(id) {
  return jobs.get(id) ?? null;
}

function finishJob(id, status, result) {
  const job = jobs.get(id);
  if (!job) return;
  job.status = status;
  job.result = result;
  job.finishedAt = new Date().toISOString();
  setTimeout(() => jobs.delete(id), TTL_AFTER_FINISH_MS).unref();
}

module.exports = { createJob, getJob, finishJob };
