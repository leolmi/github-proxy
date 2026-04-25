const { randomUUID } = require('node:crypto');

const TTL_MS = 10 * 60 * 1000;

const uploads = new Map();

function createUpload(content) {
  const id = randomUUID();
  const expiresAt = new Date(Date.now() + TTL_MS);
  const timer = setTimeout(() => uploads.delete(id), TTL_MS).unref();
  uploads.set(id, { content, expiresAt, timer });
  return { id, expiresAt: expiresAt.toISOString() };
}

function consumeUpload(id) {
  const entry = uploads.get(id);
  if (!entry) return null;
  clearTimeout(entry.timer);
  uploads.delete(id);
  return entry.content;
}

module.exports = { createUpload, consumeUpload };
