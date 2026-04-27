(function () {
  const STORAGE_KEY = 'github-proxy:settings';
  const POLL_INTERVAL_MS = 1500;
  const POLL_MAX_ATTEMPTS = 400; // ~10 minutes

  const form = document.getElementById('patch-form');
  const commitMessageEl = document.getElementById('commit-message');
  const submitBtn = document.getElementById('submit-btn');
  const submitHintEl = document.getElementById('submit-hint');
  const resetBtn = document.getElementById('reset-btn');

  const coordFieldEl = document.getElementById('coord-field');
  const coordDisplayEl = document.getElementById('coord-display');
  const coordDisplayTextEl = coordDisplayEl.querySelector('.coord-display-text');
  const coordinatesDialog = document.getElementById('coordinates-dialog');
  const coordinatesListEl = document.getElementById('coordinates-list');
  const coordinatesEmptyEl = document.getElementById('coordinates-empty');
  const coordAddNewBtn = document.getElementById('coord-add-new');
  const coordMainActionsEl = document.getElementById('coord-main-actions');
  const coordinatesCancelBtn = document.getElementById('coordinates-cancel');
  const coordinatesConfirmBtn = document.getElementById('coordinates-confirm');
  const coordEditFormEl = document.getElementById('coord-edit-form');
  const coordEditTitleEl = document.getElementById('coord-edit-title');
  const coordEditInputEl = document.getElementById('coord-edit-input');
  const coordEditCancelBtn = document.getElementById('coord-edit-cancel');
  const coordEditSaveBtn = document.getElementById('coord-edit-save');

  const patFieldEl = document.getElementById('pat-field');
  const patExpiredTagEl = document.getElementById('pat-expired-tag');
  const patDisplayEl = document.getElementById('pat-display');
  const patDisplayTextEl = patDisplayEl.querySelector('.pat-display-text');
  const patDialog = document.getElementById('pat-dialog');
  const patListEl = document.getElementById('pat-list');
  const patListEmptyEl = document.getElementById('pat-list-empty');
  const patAddNewBtn = document.getElementById('pat-add-new');
  const patMainActionsEl = document.getElementById('pat-main-actions');
  const patDialogCancelBtn = document.getElementById('pat-dialog-cancel');
  const patDialogConfirmBtn = document.getElementById('pat-dialog-confirm');
  const patEditFormEl = document.getElementById('pat-edit-form');
  const patEditTitleEl = document.getElementById('pat-edit-title');
  const patEditDescEl = document.getElementById('pat-dialog-description');
  const patEditTokenEl = document.getElementById('pat-dialog-token');
  const patEditExpiresEl = document.getElementById('pat-dialog-expires');
  const patEditCancelBtn = document.getElementById('pat-edit-cancel');
  const patEditSaveBtn = document.getElementById('pat-edit-save');

  let savedCoordinates = [];
  let activeCoordinate = null;
  let coordDialogSelected = null;
  let coordEditingIdx = -1;

  let pats = [];
  let activePatId = null;
  let patDialogSelectedId = null;
  let patEditingId = null;

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
  updateCoordinateDisplay();
  updateResetVisibility();
  updateSubmitState();
  setupCoordinatesDialog();
  setupPatDialog();
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
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw);

      if (Array.isArray(saved.pats)) {
        pats = saved.pats.map(normalizePat).filter((p) => p !== null);
        activePatId = saved.activePatId && pats.some((p) => p.id === saved.activePatId)
          ? saved.activePatId
          : null;
      } else if (saved.token) {
        // Migration from the legacy { token, description } single-PAT format
        const migrated = {
          id: generateId(),
          description: typeof saved.description === 'string' ? saved.description : '',
          token: saved.token,
          expiresAt: '',
        };
        pats = [migrated];
        activePatId = migrated.id;
      }

      if (Array.isArray(saved.coordinates)) {
        savedCoordinates = saved.coordinates
          .map(toCoordinateString)
          .filter((c) => c !== null && parseCoordinate(c) !== null);
      } else if (saved.repo && saved.branch) {
        // Migration from the legacy { token, repo, branch } format
        savedCoordinates = [`${saved.repo}:${saved.branch}`];
      }

      if (typeof saved.activeCoordinate === 'string'
          && savedCoordinates.includes(saved.activeCoordinate)) {
        activeCoordinate = saved.activeCoordinate;
      } else if (savedCoordinates.length > 0) {
        // Migration: previously the first item was implicitly active.
        activeCoordinate = savedCoordinates[0];
      }
    } catch (_) {
      // ignore corrupt storage
    }
  }

  function normalizePat(p) {
    if (!p || typeof p.token !== 'string' || !p.token) return null;
    return {
      id: typeof p.id === 'string' && p.id ? p.id : generateId(),
      description: typeof p.description === 'string' ? p.description : '',
      token: p.token,
      expiresAt: typeof p.expiresAt === 'string' ? p.expiresAt : '',
    };
  }

  function generateId() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    return `pat_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function persistSettings() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        pats,
        activePatId,
        coordinates: savedCoordinates,
        activeCoordinate,
      }));
    } catch (_) { /* quota exceeded, nothing to do */ }
  }

  function getActivePat() {
    return pats.find((p) => p.id === activePatId) || null;
  }

  function isPatExpired(pat) {
    if (!pat || !pat.expiresAt) return false;
    const today = new Date().toISOString().slice(0, 10);
    return pat.expiresAt < today;
  }

  function setupPatDialog() {
    patDisplayEl.addEventListener('click', () => {
      patDialogSelectedId = activePatId;
      hidePatEditForm();
      renderPatList();
      patDialog.showModal();
    });

    patDialogCancelBtn.addEventListener('click', () => {
      patDialog.close();
    });

    patDialogConfirmBtn.addEventListener('click', () => {
      if (patDialogSelectedId && pats.some((p) => p.id === patDialogSelectedId)) {
        activePatId = patDialogSelectedId;
        persistSettings();
        updatePatDisplay();
      }
      patDialog.close();
    });

    patAddNewBtn.addEventListener('click', () => {
      showPatEditForm(null);
    });

    patEditCancelBtn.addEventListener('click', () => {
      hidePatEditForm();
      renderPatList();
    });

    patEditSaveBtn.addEventListener('click', () => {
      const desc = patEditDescEl.value.trim();
      const token = patEditTokenEl.value.trim();
      const expiresAt = patEditExpiresEl.value;
      if (!token) {
        patEditTokenEl.focus();
        return;
      }
      if (patEditingId) {
        const existing = pats.find((p) => p.id === patEditingId);
        if (existing) {
          existing.description = desc;
          existing.token = token;
          existing.expiresAt = expiresAt;
        }
      } else {
        const created = {
          id: generateId(),
          description: desc,
          token,
          expiresAt,
        };
        pats.push(created);
        if (!activePatId) {
          activePatId = created.id;
          patDialogSelectedId = created.id;
        }
      }
      persistSettings();
      updatePatDisplay();
      hidePatEditForm();
      renderPatList();
    });

    patListEl.addEventListener('click', (ev) => {
      const editBtn = ev.target.closest('.pat-edit');
      if (editBtn) {
        showPatEditForm(editBtn.dataset.id);
        return;
      }
      const delBtn = ev.target.closest('.pat-delete');
      if (delBtn) {
        const id = delBtn.dataset.id;
        const idx = pats.findIndex((p) => p.id === id);
        if (idx < 0) return;
        pats.splice(idx, 1);
        if (activePatId === id) activePatId = null;
        if (patDialogSelectedId === id) patDialogSelectedId = activePatId;
        persistSettings();
        updatePatDisplay();
        renderPatList();
        return;
      }
      const pickBtn = ev.target.closest('.pat-pick');
      if (pickBtn) {
        patDialogSelectedId = pickBtn.dataset.id;
        renderPatList();
      }
    });
  }

  function showPatEditForm(id) {
    patEditingId = id;
    if (id) {
      const pat = pats.find((p) => p.id === id);
      if (!pat) return;
      patEditTitleEl.textContent = 'Edit PAT';
      patEditDescEl.value = pat.description;
      patEditTokenEl.value = pat.token;
      patEditExpiresEl.value = pat.expiresAt || '';
    } else {
      patEditTitleEl.textContent = 'New PAT';
      patEditDescEl.value = '';
      patEditTokenEl.value = '';
      patEditExpiresEl.value = '';
    }
    patListEl.hidden = true;
    patListEmptyEl.hidden = true;
    patAddNewBtn.hidden = true;
    patMainActionsEl.hidden = true;
    patEditFormEl.hidden = false;
  }

  function hidePatEditForm() {
    patEditingId = null;
    patEditFormEl.hidden = true;
    patAddNewBtn.hidden = false;
    patMainActionsEl.hidden = false;
  }

  function renderPatList() {
    patListEl.replaceChildren();
    if (pats.length === 0) {
      patListEmptyEl.hidden = false;
      patListEl.hidden = true;
      patDialogConfirmBtn.disabled = true;
      return;
    }
    patListEmptyEl.hidden = true;
    patListEl.hidden = false;

    pats.forEach((pat) => {
      const li = document.createElement('li');
      const pick = document.createElement('button');
      pick.type = 'button';
      pick.className = 'pat-pick';
      pick.dataset.id = pat.id;

      const desc = document.createElement('span');
      desc.className = 'pat-pick-desc';
      desc.textContent = pat.description || '(no notes)';
      if (!pat.description) desc.classList.add('is-empty');
      pick.appendChild(desc);

      if (pat.id === activePatId) {
        const activeTag = document.createElement('span');
        activeTag.className = 'pat-pick-active';
        activeTag.textContent = '(active)';
        pick.appendChild(activeTag);
      }

      if (isPatExpired(pat)) {
        const expTag = document.createElement('span');
        expTag.className = 'pat-pick-expired';
        expTag.textContent = '(expired)';
        pick.appendChild(expTag);
      }

      if (pat.id === patDialogSelectedId) pick.classList.add('is-selected');

      const edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'pat-edit';
      edit.dataset.id = pat.id;
      edit.setAttribute('aria-label', `Edit ${pat.description || 'PAT'}`);
      edit.textContent = 'edit';

      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'pat-delete';
      del.dataset.id = pat.id;
      del.setAttribute('aria-label', `Remove ${pat.description || 'PAT'}`);
      del.textContent = '×';

      li.appendChild(pick);
      li.appendChild(edit);
      li.appendChild(del);
      patListEl.appendChild(li);
    });

    patDialogConfirmBtn.disabled =
      !patDialogSelectedId
      || patDialogSelectedId === activePatId
      || !pats.some((p) => p.id === patDialogSelectedId);
  }

  function updatePatDisplay() {
    const pat = getActivePat();
    const expired = isPatExpired(pat);

    if (!pat) {
      patDisplayTextEl.textContent = '(no PAT set)';
      patDisplayEl.classList.add('is-empty');
    } else if (pat.description) {
      patDisplayTextEl.textContent = pat.description;
      patDisplayEl.classList.remove('is-empty');
    } else {
      patDisplayTextEl.textContent = '(PAT set, no notes)';
      patDisplayEl.classList.add('is-empty');
    }

    patFieldEl.classList.toggle('is-expired', expired);
    patExpiredTagEl.hidden = !expired;
    updateSubmitState();
  }

  function setupCoordinatesDialog() {
    coordDisplayEl.addEventListener('click', () => {
      coordDialogSelected = activeCoordinate;
      hideCoordEditForm();
      renderCoordinatesDialog();
      coordinatesDialog.showModal();
    });

    coordinatesCancelBtn.addEventListener('click', () => {
      coordinatesDialog.close();
    });

    coordinatesConfirmBtn.addEventListener('click', () => {
      if (coordDialogSelected && savedCoordinates.includes(coordDialogSelected)) {
        activeCoordinate = coordDialogSelected;
        persistSettings();
        updateCoordinateDisplay();
      }
      coordinatesDialog.close();
    });

    coordAddNewBtn.addEventListener('click', () => {
      showCoordEditForm(-1);
    });

    coordEditCancelBtn.addEventListener('click', () => {
      hideCoordEditForm();
      renderCoordinatesDialog();
    });

    coordEditSaveBtn.addEventListener('click', () => {
      const text = coordEditInputEl.value.trim();
      if (!parseCoordinate(text)) {
        coordEditInputEl.focus();
        return;
      }
      if (coordEditingIdx >= 0) {
        const oldValue = savedCoordinates[coordEditingIdx];
        savedCoordinates[coordEditingIdx] = text;
        // Dedupe: drop other occurrences of the new value
        for (let i = savedCoordinates.length - 1; i >= 0; i--) {
          if (i !== coordEditingIdx && savedCoordinates[i] === text) {
            savedCoordinates.splice(i, 1);
          }
        }
        if (activeCoordinate === oldValue) activeCoordinate = text;
        if (coordDialogSelected === oldValue) coordDialogSelected = text;
      } else {
        if (!savedCoordinates.includes(text)) {
          savedCoordinates.push(text);
        }
        if (!activeCoordinate) {
          activeCoordinate = text;
          coordDialogSelected = text;
        }
      }
      persistSettings();
      updateCoordinateDisplay();
      hideCoordEditForm();
      renderCoordinatesDialog();
    });

    coordinatesListEl.addEventListener('click', (ev) => {
      const editBtn = ev.target.closest('.coord-edit');
      if (editBtn) {
        showCoordEditForm(parseInt(editBtn.dataset.index, 10));
        return;
      }
      const delBtn = ev.target.closest('.coord-delete');
      if (delBtn) {
        const idx = parseInt(delBtn.dataset.index, 10);
        const value = savedCoordinates[idx];
        savedCoordinates.splice(idx, 1);
        if (activeCoordinate === value) activeCoordinate = null;
        if (coordDialogSelected === value) coordDialogSelected = activeCoordinate;
        persistSettings();
        updateCoordinateDisplay();
        renderCoordinatesDialog();
        return;
      }
      const pickBtn = ev.target.closest('.coord-pick');
      if (pickBtn) {
        coordDialogSelected = savedCoordinates[parseInt(pickBtn.dataset.index, 10)];
        renderCoordinatesDialog();
      }
    });
  }

  function showCoordEditForm(idx) {
    coordEditingIdx = idx;
    if (idx >= 0) {
      coordEditTitleEl.textContent = 'Edit coordinate';
      coordEditInputEl.value = savedCoordinates[idx] || '';
    } else {
      coordEditTitleEl.textContent = 'New coordinate';
      coordEditInputEl.value = '';
    }
    coordinatesListEl.hidden = true;
    coordinatesEmptyEl.hidden = true;
    coordAddNewBtn.hidden = true;
    coordMainActionsEl.hidden = true;
    coordEditFormEl.hidden = false;
  }

  function hideCoordEditForm() {
    coordEditingIdx = -1;
    coordEditFormEl.hidden = true;
    coordAddNewBtn.hidden = false;
    coordMainActionsEl.hidden = false;
  }

  function renderCoordinatesDialog() {
    coordinatesListEl.replaceChildren();
    if (savedCoordinates.length === 0) {
      coordinatesEmptyEl.hidden = false;
      coordinatesListEl.hidden = true;
      coordinatesConfirmBtn.disabled = true;
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
      pick.appendChild(document.createTextNode(coord));

      if (coord === activeCoordinate) {
        const activeTag = document.createElement('span');
        activeTag.className = 'coord-pick-active';
        activeTag.textContent = '(active)';
        pick.appendChild(activeTag);
      }

      if (coord === coordDialogSelected) pick.classList.add('is-selected');

      const edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'coord-edit';
      edit.dataset.index = String(i);
      edit.setAttribute('aria-label', `Edit ${coord}`);
      edit.textContent = 'edit';

      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'coord-delete';
      del.dataset.index = String(i);
      del.setAttribute('aria-label', `Remove ${coord}`);
      del.textContent = '×';

      li.appendChild(pick);
      li.appendChild(edit);
      li.appendChild(del);
      coordinatesListEl.appendChild(li);
    });

    coordinatesConfirmBtn.disabled =
      !coordDialogSelected
      || coordDialogSelected === activeCoordinate
      || !savedCoordinates.includes(coordDialogSelected);
  }

  function updateCoordinateDisplay() {
    if (activeCoordinate) {
      coordDisplayTextEl.textContent = activeCoordinate;
      coordDisplayEl.classList.remove('is-empty');
    } else {
      coordDisplayTextEl.textContent = '(no coordinate set)';
      coordDisplayEl.classList.add('is-empty');
    }
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
    const activePat = getActivePat();
    if (!activePat || !activePat.token.trim()) {
      setStatus('failed', 'No GitHub PAT set', 'Click the edit icon to add one.');
      return;
    }
    if (!selectedFile) {
      setStatus('failed', 'No patch file selected', 'Drag or pick a .patch file before submitting.');
      return;
    }
    const parsed = parseCoordinate(activeCoordinate || '');
    if (!parsed) {
      setStatus('failed', 'No coordinate set', 'Click the edit icon to add one.');
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
          Authorization: `Bearer ${activePat.token.trim()}`,
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
    const missingPat = !getActivePat();
    const missingCoord = !activeCoordinate;
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

    patDisplayEl.classList.toggle('is-warn', missingPat);
    coordDisplayEl.classList.toggle('is-warn', missingCoord);
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
