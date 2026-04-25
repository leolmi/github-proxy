(function () {
  const STORAGE_KEY = 'github-proxy:settings';
  const POLL_INTERVAL_MS = 1500;
  const POLL_MAX_ATTEMPTS = 400; // ~10 minutes

  const form = document.getElementById('patch-form');
  const tokenEl = document.getElementById('token');
  const patDescriptionEl = document.getElementById('pat-description');
  const coordinateEl = document.getElementById('coordinate');
  const commitMessageEl = document.getElementById('commit-message');
  const submitBtn = document.getElementById('submit-btn');

  const openCoordinatesBtn = document.getElementById('open-coordinates-dialog');
  const coordinatesDialog = document.getElementById('coordinates-dialog');
  const coordinatesListEl = document.getElementById('coordinates-list');
  const coordinatesEmptyEl = document.getElementById('coordinates-empty');
  const coordinatesConfirmBtn = document.getElementById('coordinates-confirm');
  const coordinatesCancelBtn = document.getElementById('coordinates-cancel');

  const patDisplayEl = document.getElementById('pat-display');
  const openPatBtn = document.getElementById('open-pat-dialog');
  const patDialog = document.getElementById('pat-dialog');
  const patDialogDescriptionEl = document.getElementById('pat-dialog-description');
  const patDialogTokenEl = document.getElementById('pat-dialog-token');
  const patDialogSaveBtn = document.getElementById('pat-dialog-save');
  const patDialogCancelBtn = document.getElementById('pat-dialog-cancel');

  let savedCoordinates = [];
  let dialogSelectedIdx = -1;

  const dropZone = document.getElementById('drop-zone');
  const fileInput = document.getElementById('patch-file');
  const fileNameEl = document.getElementById('patch-file-name');
  const dropEmptyEl = dropZone.querySelector('.drop-empty');
  const dropSelectedEl = dropZone.querySelector('.drop-selected');
  const clearBtn = document.getElementById('patch-clear');

  let selectedFile = null;

  const statusBox = document.getElementById('status');
  const statusLine = document.getElementById('status-line');
  const statusDetail = document.getElementById('status-detail');

  document.getElementById('mcp-endpoint').textContent = `${location.origin}/mcp`;

  loadSettings();
  updatePatDisplay();
  setupCoordinatesDialog();
  setupPatDialog();
  setupDropZone();

  form.addEventListener('submit', onSubmit);

  function setupDropZone() {
    let depth = 0;

    dropZone.addEventListener('click', (ev) => {
      if (ev.target === clearBtn || selectedFile) return;
      fileInput.click();
    });

    dropZone.addEventListener('keydown', (ev) => {
      if ((ev.key === 'Enter' || ev.key === ' ') && !selectedFile) {
        ev.preventDefault();
        fileInput.click();
      }
    });

    fileInput.addEventListener('change', () => {
      const file = fileInput.files?.[0];
      if (file) selectFile(file);
    });

    clearBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      clearFile();
    });

    dropZone.addEventListener('dragenter', (ev) => {
      if (!hasFiles(ev)) return;
      ev.preventDefault();
      depth++;
      dropZone.classList.add('is-dragging');
    });

    dropZone.addEventListener('dragover', (ev) => {
      if (!hasFiles(ev)) return;
      ev.preventDefault();
      ev.dataTransfer.dropEffect = 'copy';
    });

    dropZone.addEventListener('dragleave', (ev) => {
      if (!hasFiles(ev)) return;
      ev.preventDefault();
      depth--;
      if (depth <= 0) {
        depth = 0;
        dropZone.classList.remove('is-dragging');
      }
    });

    dropZone.addEventListener('drop', (ev) => {
      if (!hasFiles(ev)) return;
      ev.preventDefault();
      depth = 0;
      dropZone.classList.remove('is-dragging');
      const file = ev.dataTransfer.files[0];
      if (file) selectFile(file);
    });
  }

  function selectFile(file) {
    selectedFile = file;
    fileNameEl.textContent = `${file.name} (${formatBytes(file.size)})`;
    dropEmptyEl.hidden = true;
    dropSelectedEl.hidden = false;
    dropZone.classList.add('has-file');
  }

  function clearFile() {
    selectedFile = null;
    fileInput.value = '';
    dropEmptyEl.hidden = false;
    dropSelectedEl.hidden = true;
    dropZone.classList.remove('has-file');
  }

  function hasFiles(ev) {
    const types = ev.dataTransfer?.types;
    return types && Array.from(types).includes('Files');
  }

  function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function loadSettings() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        if (saved.token) tokenEl.value = saved.token;
        if (saved.description) patDescriptionEl.value = saved.description;

        if (Array.isArray(saved.coordinates)) {
          savedCoordinates = saved.coordinates
            .map(toCoordinateString)
            .filter((c) => c !== null);
        } else if (saved.repo && saved.branch) {
          // Migration from the legacy { token, repo, branch } format
          savedCoordinates = [`${saved.repo}:${saved.branch}`];
        }

        if (savedCoordinates.length > 0 && !coordinateEl.value) {
          coordinateEl.value = savedCoordinates[0];
        }
      }
    } catch (_) {
      // ignore corrupt storage
    }
  }

  function saveSettings() {
    const coord = coordinateEl.value.trim();
    if (coord && parseCoordinate(coord)) {
      addOrPromoteCoordinate(coord);
    }
    persistSettings();
  }

  function persistSettings() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        token: tokenEl.value,
        description: patDescriptionEl.value,
        coordinates: savedCoordinates,
      }));
    } catch (_) { /* quota exceeded, nothing to do */ }
  }

  function addOrPromoteCoordinate(coord) {
    const idx = savedCoordinates.indexOf(coord);
    if (idx >= 0) savedCoordinates.splice(idx, 1);
    savedCoordinates.unshift(coord);
  }

  function setupPatDialog() {
    openPatBtn.addEventListener('click', () => {
      patDialogDescriptionEl.value = patDescriptionEl.value;
      patDialogTokenEl.value = tokenEl.value;
      patDialog.showModal();
    });

    patDialogCancelBtn.addEventListener('click', () => {
      patDialog.close();
    });

    patDialogSaveBtn.addEventListener('click', () => {
      patDescriptionEl.value = patDialogDescriptionEl.value.trim();
      tokenEl.value = patDialogTokenEl.value.trim();
      updatePatDisplay();
      persistSettings();
      patDialog.close();
    });
  }

  function updatePatDisplay() {
    const desc = patDescriptionEl.value.trim();
    const hasToken = tokenEl.value.length > 0;
    if (!hasToken) {
      patDisplayEl.textContent = '(no PAT set)';
      patDisplayEl.classList.add('is-empty');
    } else if (desc) {
      patDisplayEl.textContent = desc;
      patDisplayEl.classList.remove('is-empty');
    } else {
      patDisplayEl.textContent = '(PAT set, no notes)';
      patDisplayEl.classList.add('is-empty');
    }
  }

  function setupCoordinatesDialog() {
    openCoordinatesBtn.addEventListener('click', () => {
      dialogSelectedIdx = -1;
      coordinatesConfirmBtn.disabled = true;
      renderCoordinatesDialog();
      coordinatesDialog.showModal();
    });

    coordinatesCancelBtn.addEventListener('click', () => {
      coordinatesDialog.close();
    });

    coordinatesConfirmBtn.addEventListener('click', () => {
      if (dialogSelectedIdx >= 0 && savedCoordinates[dialogSelectedIdx]) {
        coordinateEl.value = savedCoordinates[dialogSelectedIdx];
      }
      coordinatesDialog.close();
    });

    coordinatesListEl.addEventListener('click', (ev) => {
      const pickBtn = ev.target.closest('.coord-pick');
      if (pickBtn) {
        selectInDialog(parseInt(pickBtn.dataset.index, 10));
        return;
      }
      const delBtn = ev.target.closest('.coord-delete');
      if (delBtn) {
        const idx = parseInt(delBtn.dataset.index, 10);
        savedCoordinates.splice(idx, 1);
        persistSettings();
        if (dialogSelectedIdx === idx) {
          dialogSelectedIdx = -1;
          coordinatesConfirmBtn.disabled = true;
        } else if (dialogSelectedIdx > idx) {
          dialogSelectedIdx--;
        }
        renderCoordinatesDialog();
      }
    });
  }

  function selectInDialog(idx) {
    dialogSelectedIdx = idx;
    coordinatesConfirmBtn.disabled = idx < 0;
    for (const btn of coordinatesListEl.querySelectorAll('.coord-pick')) {
      btn.classList.toggle('is-selected', parseInt(btn.dataset.index, 10) === idx);
    }
  }

  function renderCoordinatesDialog() {
    coordinatesListEl.replaceChildren();
    if (savedCoordinates.length === 0) {
      coordinatesEmptyEl.hidden = false;
      coordinatesListEl.hidden = true;
      return;
    }
    coordinatesEmptyEl.hidden = true;
    coordinatesListEl.hidden = false;

    savedCoordinates.forEach((coord, i) => {
      const li = document.createElement('li');

      const pick = document.createElement('button');
      pick.type = 'button';
      pick.className = 'coord-pick';
      pick.dataset.index = String(i);
      pick.textContent = coord;
      if (i === dialogSelectedIdx) pick.classList.add('is-selected');

      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'coord-delete';
      del.dataset.index = String(i);
      del.setAttribute('aria-label', `Remove ${coord}`);
      del.textContent = '×';

      li.appendChild(pick);
      li.appendChild(del);
      coordinatesListEl.appendChild(li);
    });
  }

  function parseCoordinate(text) {
    const sep = text.indexOf(':');
    if (sep < 0) return null;
    const repo = text.slice(0, sep).trim();
    const branch = text.slice(sep + 1).trim();
    if (!repo.includes('/') || !branch) return null;
    const [owner, name] = repo.split('/');
    if (!owner || !name) return null;
    return { repo, branch };
  }

  function toCoordinateString(item) {
    if (typeof item === 'string') {
      const trimmed = item.trim();
      if (!trimmed) return null;
      // Transitional migration: strings in the old "owner/name@branch" format
      // (with @ and no :) are converted to "owner/name:branch".
      if (!trimmed.includes(':') && trimmed.includes('@')) {
        const at = trimmed.indexOf('@');
        return trimmed.slice(0, at) + ':' + trimmed.slice(at + 1);
      }
      return trimmed;
    }
    if (item && typeof item.repo === 'string' && typeof item.branch === 'string') {
      return `${item.repo}:${item.branch}`;
    }
    return null;
  }

  async function onSubmit(ev) {
    ev.preventDefault();
    if (!tokenEl.value.trim()) {
      setStatus('failed', 'No GitHub PAT set', 'Click the edit icon to enter your PAT.');
      return;
    }
    if (!selectedFile) {
      setStatus('failed', 'No patch file selected', 'Drag or pick a .patch file before submitting.');
      return;
    }
    const parsed = parseCoordinate(coordinateEl.value.trim());
    if (!parsed) {
      setStatus('failed', 'Invalid coordinate', 'Expected format: owner/name:branch');
      return;
    }
    saveSettings();
    setStatus('running', 'Sending request...', '');
    submitBtn.disabled = true;

    try {
      const patch = await selectedFile.text();
      const res = await fetch('/jobs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tokenEl.value.trim()}`,
        },
        body: JSON.stringify({
          repo: parsed.repo,
          branch: parsed.branch,
          patch,
          commitMessage: commitMessageEl.value.trim(),
        }),
      });

      if (res.status !== 202) {
        const body = await safeJson(res);
        setStatus('failed', `Error ${res.status}`, body?.error || res.statusText);
        return;
      }

      const { id } = await res.json();
      setStatus('running', `Job queued (id ${id}). Waiting...`, '');
      await pollJob(id);
    } catch (err) {
      setStatus('failed', 'Network error', String(err?.message ?? err));
    } finally {
      submitBtn.disabled = false;
    }
  }

  async function pollJob(id) {
    for (let i = 0; i < POLL_MAX_ATTEMPTS; i++) {
      await sleep(POLL_INTERVAL_MS);
      let res;
      try {
        res = await fetch(`/jobs/${encodeURIComponent(id)}`);
      } catch (err) {
        setStatus('failed', 'Network error during polling', String(err?.message ?? err));
        return;
      }
      if (res.status === 404) {
        setStatus('failed', 'Job not found (the dyno probably restarted).', 'Try resending the patch.');
        return;
      }
      if (!res.ok) {
        setStatus('failed', `Polling error ${res.status}`, res.statusText);
        return;
      }
      const job = await res.json();
      if (job.status === 'running') {
        statusLine.textContent = `Running... (attempt ${i + 1})`;
        continue;
      }
      renderFinalJob(job);
      return;
    }
    setStatus('failed', 'Polling timed out', 'Maximum wait time reached.');
  }

  function renderFinalJob(job) {
    if (job.status === 'success') {
      setStatus(
        'success',
        'Patch applied and pushed.',
        `commit ${job.result.commitSha}\n${job.result.commitUrl}`
      );
      return;
    }
    if (job.status === 'needs_review') {
      setStatus(
        'needs-review',
        'Patch needs manual review: operation skipped.',
        job.result?.reason ?? ''
      );
      return;
    }
    setStatus(
      'failed',
      job.result?.error ?? 'Error',
      job.result?.details ?? ''
    );
  }

  function setStatus(kind, line, detail) {
    statusBox.hidden = false;
    statusLine.className = `status-${kind}`;
    statusLine.textContent = line;
    statusDetail.textContent = detail || '';
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  async function safeJson(res) {
    try { return await res.json(); } catch { return null; }
  }
})();
