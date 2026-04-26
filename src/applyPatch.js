const { spawn } = require('node:child_process');
const { mkdtemp, rm, writeFile } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');

const REPO_RE = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;

function run(cmd, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { ...options, shell: false });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', (err) => resolve({ code: -1, stdout, stderr: stderr || err.message }));
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

async function fetchAuthorFromGitHub(token) {
  const res = await fetch('https://api.github.com/user', {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'github-proxy',
    },
  });
  if (!res.ok) {
    throw new Error(`GitHub /user returned ${res.status}`);
  }
  const user = await res.json();
  const name = user.name || user.login;
  const email = user.email || `${user.id}+${user.login}@users.noreply.github.com`;
  return { name, email };
}

async function applyPatch({ token, repo, branch, patch, commitMessage, author }) {
  if (!REPO_RE.test(repo)) {
    return { status: 'failed', result: { error: 'invalid repo', details: 'expected format owner/name' } };
  }

  const workdir = await mkdtemp(path.join(tmpdir(), 'gh-proxy-'));
  const repoDir = path.join(workdir, 'repo');

  try {
    const remote = `https://x-access-token:${token}@github.com/${repo}.git`;

    const cloned = await run('git', [
      'clone',
      '--depth', '1',
      '--single-branch',
      '--branch', branch,
      remote,
      repoDir,
    ]);
    if (cloned.code !== 0) {
      return {
        status: 'failed',
        result: {
          error: 'clone failed (invalid repo, branch, or token?)',
          details: redactToken(cloned.stderr, token),
        },
      };
    }

    const finalAuthor = author?.name && author?.email
      ? author
      : await fetchAuthorFromGitHub(token);

    // The patch file lives in workdir, outside the repo working tree, so
    // `git add -A` never picks it up.
    const patchFile = path.join(workdir, '.proxy-incoming.patch');
    await writeFile(patchFile, normalizePatch(patch));

    let applied = await run('git', ['apply', '--3way', patchFile], { cwd: repoDir });
    if (applied.code !== 0 && /lacks the necessary blob/i.test(applied.stderr)) {
      // The shallow clone is missing the base blobs the patch references.
      // Fetch the full history and retry the 3-way apply.
      const unshallow = await run('git', ['fetch', '--unshallow'], { cwd: repoDir });
      if (unshallow.code === 0) {
        applied = await run('git', ['apply', '--3way', patchFile], { cwd: repoDir });
      }
    }
    if (applied.code !== 0) {
      return {
        status: 'needs_review',
        result: {
          reason: redactToken(applied.stderr, token) || 'patch does not apply cleanly, even with 3-way merge',
        },
      };
    }

    await run('git', ['config', 'user.name', finalAuthor.name], { cwd: repoDir });
    await run('git', ['config', 'user.email', finalAuthor.email], { cwd: repoDir });

    const added = await run('git', ['add', '-A'], { cwd: repoDir });
    if (added.code !== 0) {
      return { status: 'failed', result: { error: 'git add failed', details: redactToken(added.stderr, token) } };
    }

    const committed = await run('git', ['commit', '-m', commitMessage], { cwd: repoDir });
    if (committed.code !== 0) {
      return { status: 'failed', result: { error: 'git commit failed', details: redactToken(committed.stderr, token) } };
    }

    const pushed = await run('git', ['push', 'origin', branch], { cwd: repoDir });
    if (pushed.code !== 0) {
      return { status: 'failed', result: { error: 'git push failed', details: redactToken(pushed.stderr, token) } };
    }

    const sha = await run('git', ['rev-parse', 'HEAD'], { cwd: repoDir });
    const commitSha = sha.stdout.trim();

    return {
      status: 'success',
      result: {
        commitSha,
        commitUrl: `https://github.com/${repo}/commit/${commitSha}`,
      },
    };
  } catch (err) {
    return {
      status: 'failed',
      result: { error: 'unexpected error', details: redactToken(String(err.message ?? err), token) },
    };
  } finally {
    await rm(workdir, { recursive: true, force: true }).catch(() => {});
  }
}

function normalizePatch(patch) {
  return patch.endsWith('\n') ? patch : patch + '\n';
}

function redactToken(text, token) {
  if (!text || !token) return text;
  return text.split(token).join('***');
}

module.exports = { applyPatch };
