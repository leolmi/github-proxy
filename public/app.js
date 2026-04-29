(function () {
  const STORAGE_KEY = 'github-proxy:settings';
  const POLL_INTERVAL_MS = 1500;
  const POLL_MAX_ATTEMPTS = 400; // ~10 minutes

  const form = document.getElementById('patch-form');
  const commitMessageEl = document.getElementById('commit-message');
  const submitBtn = document.getElementById('submit-btn');
  const submitHintEl = document.getElementById('submit-hint');
  const resetBtn = document.getElementById('reset-btn');

  const entryFieldEl = document.getElementById('entry-field');
  const entryExpiredTagEl = document.getElementById('entry-expired-tag');
  const entryDisplayEl = document.getElementById('entry-display');
  const entryDisplayTextEl = entryDisplayEl.querySelector('.entry-display-text');
  const entriesDialog = document.getElementById('entries-dialog');
  const entriesListEl = document.getElementById('entries-list');
  const entriesEmptyEl = document.getElementById('entries-empty');
  const entryAddNewBtn = document.getElementById('entry-add-new');
  const entryMainActionsEl = document.getElementById('entry-main-actions');
  const entriesCancelBtn = document.getElementById('entries-cancel');
  const entriesConfirmBtn = document.getElementById('entries-confirm');
  const entryEditFormEl = document.getElementById('entry-edit-form');
  const entryEditTitleEl = document.getElementById('entry-edit-title');
  const entryEditDescEl = document.getElementById('entry-edit-description');
  const entryEditTokenEl = document.getElementById('entry-edit-token');
  const entryEditExpiresEl = document.getElementById('entry-edit-expires');
  const entryEditCoordEl = document.getElementById('entry-edit-coord');
  const entryEditCancelBtn = document.getElementById('entry-edit-cancel');
  const entryEditSaveBtn = document.getElementById('entry-edit-save');

  let entries = [];
  let activeEntryId = null;
  let dialogSelectedId = null;
  let editingId = null;

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
  updateEntryDisplay();
  updateResetVisibility();
  updateSubmitState();
  setupEntriesDialog();
  setupDropZone();

  form.addEventListener('submit', onSubmit);
  resetBtn.addEventListener('click', resetForm);
  commitMessageEl.addEventListener('input', () => {
    updateResetVisibility();
    updateSubmitState();
  });

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
    updateResetVisibility();
    updateSubmitState();
  }

  function clearFile() {
    selectedFile = null;
    fileInput.value = '';
    dropEmptyEl.hidden = false;
    dropSelectedEl.hidden = true;
    dropZone.classList.remove('has-file');
    updateResetVisibility();
    updateSubmitState();
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
    let raw;
    try {
      raw = localStorage.getItem(STORAGE_KEY);
    } catch (_) {
      return;
    }
    if (!raw) return;

    let saved;
    try {
      saved = JSON.parse(raw);
    } catch (_) {
      return;
    }

    if (Array.isArray(saved.entries)) {
      entries = saved.entries.map(normalizeEntry).filter((e) => e !== null);
      activeEntryId = saved.activeEntryId && entries.some((e) => e.id === saved.activeEntryId)
        ? saved.activeEntryId
        : null;
      return;
    }

    // Legacy migration: keep PAT info, drop coordinates (user will re-add).
    const migrated = migrateLegacy(saved);
    if (migrated.entries.length > 0) {
      entries = migrated.entries;
      activeEntryId = migrated.activeEntryId;
      persistSettings();
    }
  }

  function migrateLegacy(saved) {
    let oldPats = [];
    if (Array.isArray(saved.pats)) {
      oldPats = saved.pats.filter((p) => p && typeof p.token === 'string' && p.token);
    } else if (typeof saved.token === 'string' && saved.token) {
      oldPats = [{
        id: generateId(),
        description: typeof saved.description === 'string' ? saved.description : '',
        token: saved.token,
        expiresAt: '',
      }];
    }

    const migratedEntries = oldPats.map((p) => ({
      id: typeof p.id === 'string' && p.id ? p.id : generateId(),
      description: typeof p.description === 'string' ? p.description : '',
      token: p.token,
      expiresAt: typeof p.expiresAt === 'string' ? p.expiresAt : '',
      repo: '',
      branch: '',
    }));

    let migratedActiveId = null;
    if (saved.activePatId && migratedEntries.some((e) => e.id === saved.activePatId)) {
      migratedActiveId = saved.activePatId;
    } else if (migratedEntries.length > 0) {
      migratedActiveId = migratedEntries[0].id;
    }

    return { entries: migratedEntries, activeEntryId: migratedActiveId };
  }

  function normalizeEntry(e) {
    if (!e || typeof e.token !== 'string' || !e.token) return null;
    return {
      id: typeof e.id === 'string' && e.id ? e.id : generateId(),
      description: typeof e.description === 'string' ? e.description : '',
      token: e.token,
      expiresAt: typeof e.expiresAt === 'string' ? e.expiresAt : '',
      repo: typeof e.repo === 'string' ? e.repo : '',
      branch: typeof e.branch === 'string' ? e.branch : '',
    };
  }

  function generateId() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    return `entry_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function persistSettings() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        entries,
        activeEntryId,
      }));
    } catch (_) { /* quota exceeded, nothing to do */ }
  }

  function getActiveEntry() {
    return entries.find((e) => e.id === activeEntryId) || null;
  }

  function isEntryExpired(entry) {
    if (!entry || !entry.expiresAt) return false;
    const today = new Date().toISOString().slice(0, 10);
    return entry.expiresAt < today;
  }

  function entryHasCoordinate(entry) {
    return !!(entry && entry.repo && entry.branch);
  }

  function setupEntriesDialog() {
    entryDisplayEl.addEventListener('click', () => {
      dialogSelectedId = activeEntryId;
      hideEntryEditForm();
      renderEntriesList();
      entriesDialog.showModal();
    });

    entriesCancelBtn.addEventListener('click', () => {
      entriesDialog.close();
    });

    entriesConfirmBtn.addEventListener('click', () => {
      if (dialogSelectedId && entries.some((e) => e.id === dialogSelectedId)) {
        activeEntryId = dialogSelectedId;
        persistSettings();
        updateEntryDisplay();
      }
      entriesDialog.close();
    });

    entryAddNewBtn.addEventListener('click', () => {
      showEntryEditForm(null);
    });

    entryEditCancelBtn.addEventListener('click', () => {
      hideEntryEditForm();
      renderEntriesList();
    });

    entryEditSaveBtn.addEventListener('click', () => {
      const desc = entryEditDescEl.value.trim();
      const token = entryEditTokenEl.value.trim();
      const expiresAt = entryEditExpiresEl.value;
      const coordText = entryEditCoordEl.value.trim();
      if (!token) {
        entryEditTokenEl.focus();
        return;
      }
      let repo = '';
      let branch = '';
      if (coordText) {
        const parsed = parseCoordinate(coordText);
        if (!parsed) {
          entryEditCoordEl.focus();
          return;
        }
        repo = parsed.repo;
        branch = parsed.branch;
      }
      if (editingId) {
        const existing = entries.find((e) => e.id === editingId);
        if (existing) {
          existing.description = desc;
          existing.token = token;
          existing.expiresAt = expiresAt;
          existing.repo = repo;
          existing.branch = branch;
        }
      } else {
        const created = {
          id: generateId(),
          description: desc,
          token,
          expiresAt,
          repo,
          branch,
        };
        entries.push(created);
        if (!activeEntryId) {
          activeEntryId = created.id;
          dialogSelectedId = created.id;
        }
      }
      persistSettings();
      updateEntryDisplay();
      hideEntryEditForm();
      renderEntriesList();
    });

    entriesListEl.addEventListener('click', (ev) => {
      const editBtn = ev.target.closest('.entry-edit');
      if (editBtn) {
        showEntryEditForm(editBtn.dataset.id);
        return;
      }
      const delBtn = ev.target.closest('.entry-delete');
      if (delBtn) {
        const id = delBtn.dataset.id;
        const idx = entries.findIndex((e) => e.id === id);
        if (idx < 0) return;
        entries.splice(idx, 1);
        if (activeEntryId === id) activeEntryId = null;
        if (dialogSelectedId === id) dialogSelectedId = activeEntryId;
        persistSettings();
        updateEntryDisplay();
        renderEntriesList();
        return;
      }
      const pickBtn = ev.target.closest('.entry-pick');
      if (pickBtn) {
        dialogSelectedId = pickBtn.dataset.id;
        renderEntriesList();
      }
    });
  }

  function showEntryEditForm(id) {
    editingId = id;
    if (id) {
      const entry = entries.find((e) => e.id === id);
      if (!entry) return;
      entryEditTitleEl.textContent = 'Edit entry';
      entryEditDescEl.value = entry.description;
      entryEditTokenEl.value = entry.token;
      entryEditExpiresEl.value = entry.expiresAt || '';
      entryEditCoordEl.value = entryHasCoordinate(entry) ? `${entry.repo}:${entry.branch}` : '';
    } else {
      entryEditTitleEl.textContent = 'New entry';
      entryEditDescEl.value = '';
      entryEditTokenEl.value = '';
      entryEditExpiresEl.value = '';
      entryEditCoordEl.value = '';
    }
    entriesListEl.hidden = true;
    entriesEmptyEl.hidden = true;
    entryAddNewBtn.hidden = true;
    entryMainActionsEl.hidden = true;
    entryEditFormEl.hidden = false;
  }

  function hideEntryEditForm() {
    editingId = null;
    entryEditFormEl.hidden = true;
    entryAddNewBtn.hidden = false;
    entryMainActionsEl.hidden = false;
  }

  function renderEntriesList() {
    entriesListEl.replaceChildren();
    if (entries.length === 0) {
      entriesEmptyEl.hidden = false;
      entriesListEl.hidden = true;
      entriesConfirmBtn.disabled = true;
      return;
    }
    entriesEmptyEl.hidden = true;
    entriesListEl.hidden = false;

    entries.forEach((entry) => {
      const li = document.createElement('li');
      const pick = document.createElement('button');
      pick.type = 'button';
      pick.className = 'entry-pick';
      pick.dataset.id = entry.id;

      const desc = document.createElement('span');
      desc.className = 'entry-pick-desc';
      desc.textContent = entry.description || '(no notes)';
      if (!entry.description) desc.classList.add('is-empty');
      pick.appendChild(desc);

      const coord = document.createElement('span');
      coord.className = 'entry-pick-coord';
      if (entryHasCoordinate(entry)) {
        coord.textContent = `${entry.repo}:${entry.branch}`;
      } else {
        coord.textContent = '(no coordinate)';
        coord.classList.add('is-empty');
      }
      pick.appendChild(coord);

      if (entry.id === activeEntryId) {
        const activeTag = document.createElement('span');
        activeTag.className = 'entry-pick-active';
        activeTag.textContent = '(active)';
        pick.appendChild(activeTag);
      }

      if (isEntryExpired(entry)) {
        const expTag = document.createElement('span');
        expTag.className = 'entry-pick-expired';
        expTag.textContent = '(expired)';
        pick.appendChild(expTag);
      }

      if (entry.id === dialogSelectedId) pick.classList.add('is-selected');

      const edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'entry-edit';
      edit.dataset.id = entry.id;
      edit.setAttribute('aria-label', `Edit ${entry.description || 'entry'}`);
      edit.textContent = 'edit';

      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'entry-delete';
      del.dataset.id = entry.id;
      del.setAttribute('aria-label', `Remove ${entry.description || 'entry'}`);
      del.textContent = '×';

      li.appendChild(pick);
      li.appendChild(edit);
      li.appendChild(del);
      entriesListEl.appendChild(li);
    });

    entriesConfirmBtn.disabled =
      !dialogSelectedId
      || dialogSelectedId === activeEntryId
      || !entries.some((e) => e.id === dialogSelectedId);
  }

  function formatExpiresDate(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
  }

  function updateEntryDisplay() {
    const entry = getActiveEntry();
    const expired = isEntryExpired(entry);

    entryDisplayTextEl.textContent = '';
    if (!entry) {
      entryDisplayTextEl.append('(no context set)');
      entryDisplayEl.classList.add('is-empty');
    } else {
      if (entry.description) {
        entryDisplayTextEl.append(entry.description);
        entryDisplayEl.classList.remove('is-empty');
      } else {
        entryDisplayTextEl.append('(PAT set, no notes)');
        entryDisplayEl.classList.add('is-empty');
      }

      const coordEl = document.createElement('span');
      coordEl.className = 'entry-display-coord';
      if (entryHasCoordinate(entry)) {
        coordEl.textContent = `${entry.repo}:${entry.branch}`;
      } else {
        coordEl.textContent = '(no coordinate)';
        coordEl.classList.add('is-empty');
      }
      entryDisplayTextEl.append(coordEl);

      if (entry.expiresAt) {
        const expEl = document.createElement('span');
        expEl.className = 'entry-display-expires';
        expEl.textContent = formatExpiresDate(entry.expiresAt);
        entryDisplayTextEl.append(expEl);
      }
    }

    entryFieldEl.classList.toggle('is-expired', expired);
    entryExpiredTagEl.hidden = !expired;
    updateSubmitState();
  }

  function parseCoordinate(text) {
    if (typeof text !== 'string') return null;
    const sep = text.indexOf(':');
    if (sep < 0) return null;
    const repo = text.slice(0, sep).trim();
    const branch = text.slice(sep + 1).trim();
    if (!repo.includes('/') || !branch) return null;
    const [owner, name] = repo.split('/');
    if (!owner || !name) return null;
    return { repo, branch };
  }

  async function onSubmit(ev) {
    ev.preventDefault();
    const entry = getActiveEntry();
    if (!entry || !entry.token.trim()) {
      setStatus('failed', 'No GitHub PAT set', 'Click the edit icon to add one.');
      return;
    }
    if (!entryHasCoordinate(entry)) {
      setStatus('failed', 'No coordinate set on the active entry', 'Edit the entry to add owner/name:branch.');
      return;
    }
    if (!selectedFile) {
      setStatus('failed', 'No patch file selected', 'Drag or pick a .patch file before submitting.');
      return;
    }
    setStatus('running', 'Sending request...', '');
    submitBtn.disabled = true;

    try {
      const patch = await selectedFile.text();
      const res = await fetch('/jobs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${entry.token.trim()}`,
        },
        body: JSON.stringify({
          repo: entry.repo,
          branch: entry.branch,
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
      updateSubmitState();
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

  function updateResetVisibility() {
    const dirty = !!commitMessageEl.value || !!selectedFile;
    resetBtn.hidden = !dirty;
  }

  function updateSubmitState() {
    const entry = getActiveEntry();
    const missingPat = !entry;
    const missingCoord = !!entry && !entryHasCoordinate(entry);
    const missingMessage = !commitMessageEl.value.trim();
    const missingFile = !selectedFile;
    let reason = '';
    if (missingPat) reason = 'GitHub PAT required';
    else if (missingCoord) reason = 'Coordinate required';
    else if (missingMessage) reason = 'Commit message required';
    else if (missingFile) reason = 'Patch file required';

    submitBtn.disabled = !!reason;
    submitHintEl.textContent = reason;
    submitHintEl.hidden = !reason;

    entryDisplayEl.classList.toggle('is-warn', missingPat);
    commitMessageEl.classList.toggle('is-warn', missingMessage);
    dropZone.classList.toggle('is-warn', missingFile);
  }

  function resetForm() {
    commitMessageEl.value = '';
    clearFile();
    statusBox.hidden = true;
    updateResetVisibility();
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  async function safeJson(res) {
    try { return await res.json(); } catch { return null; }
  }
})();
