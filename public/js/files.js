(function () {
  const { fmt } = Panel;
  const ICONS = {
    dir: '<svg class="h-4 w-4 text-amber-300" viewBox="0 0 24 24" fill="currentColor"><path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
    file: '<svg class="h-4 w-4 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/></svg>',
    other: '<svg class="h-4 w-4 text-slate-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="8"/></svg>',
  };

  let root = null;
  let current = null; // { path, parent, entries }
  let editor = null; // { monaco editor, path, mtime, dirty }
  let monacoPromise = null;
  let lastPath = null;

  function template() {
    return `
      <div class="mb-4 flex flex-wrap items-end justify-between gap-3">
        <h1 class="text-2xl font-semibold">Dosyalar</h1>
        <div class="flex flex-wrap gap-2 text-sm">
          <button id="fm-newfile" class="rounded-lg border border-slate-700 px-3 py-1.5 hover:bg-slate-800">Yeni dosya</button>
          <button id="fm-newdir" class="rounded-lg border border-slate-700 px-3 py-1.5 hover:bg-slate-800">Yeni klasör</button>
          <label class="cursor-pointer rounded-lg bg-emerald-600 px-3 py-1.5 font-medium text-white hover:bg-emerald-500">
            Yükle<input id="fm-upload" type="file" multiple class="hidden">
          </label>
        </div>
      </div>

      <form id="fm-form" class="mb-3 flex gap-2">
        <button type="button" id="fm-up" title="Üst klasör" class="shrink-0 rounded-lg border border-slate-700 px-3 hover:bg-slate-800">↑</button>
        <input id="fm-path" spellcheck="false" class="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 font-mono text-sm outline-none focus:border-slate-500">
        <button type="button" id="fm-refresh" title="Yenile" class="shrink-0 rounded-lg border border-slate-700 px-3 hover:bg-slate-800">⟳</button>
      </form>
      <div id="fm-crumbs" class="mb-3 flex flex-wrap items-center gap-1 text-sm text-slate-400"></div>
      <div id="fm-progress" class="mb-3 hidden rounded-lg border border-slate-800 bg-slate-900 px-4 py-2 text-sm">
        <div class="mb-1 flex justify-between"><span id="fm-progress-text">Yükleniyor…</span><span id="fm-progress-pct" class="tabular"></span></div>
        <div class="bar"><span id="fm-progress-bar" class="bg-emerald-500" style="width:0%"></span></div>
      </div>

      <div id="fm-drop" class="overflow-x-auto rounded-xl border border-slate-800 bg-slate-900">
        <table class="w-full min-w-[640px] text-left text-sm">
          <thead class="border-b border-slate-800 text-xs uppercase text-slate-400">
            <tr><th class="px-4 py-3">Ad</th><th class="px-4 py-3 text-right">Boyut</th>
                <th class="px-4 py-3">Değiştirilme</th><th class="px-4 py-3">İzinler</th><th class="px-4 py-3 text-right">İşlemler</th></tr>
          </thead>
          <tbody id="fm-rows"></tbody>
        </table>
      </div>
      <p class="mt-2 text-xs text-slate-500">Dosyaları listenin üzerine sürükleyip bırakarak da yükleyebilirsiniz.</p>

      <div id="fm-editor" class="fixed inset-0 z-40 hidden flex-col bg-slate-950">
        <div class="flex flex-wrap items-center gap-2 border-b border-slate-800 bg-slate-900 px-4 py-2">
          <span id="ed-dirty" class="hidden h-2 w-2 rounded-full bg-amber-400" title="Kaydedilmemiş değişiklik"></span>
          <span id="ed-path" class="min-w-0 flex-1 truncate font-mono text-sm"></span>
          <select id="ed-lang" class="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-xs"></select>
          <button id="ed-save" class="rounded-md bg-emerald-600 px-3 py-1 text-sm font-medium text-white hover:bg-emerald-500">Kaydet</button>
          <button id="ed-close" class="rounded-md px-3 py-1 text-sm text-slate-300 hover:bg-slate-800">Kapat</button>
        </div>
        <div id="ed-host" class="min-h-0 flex-1"></div>
      </div>`;
  }

  function join(dir, name) { return dir.endsWith('/') ? dir + name : `${dir}/${name}`; }

  async function load(p) {
    try {
      const q = p ? `?path=${encodeURIComponent(p)}` : '';
      current = await Panel.api(`/api/files/list${q}`);
      lastPath = current.path;
      render();
    } catch (err) {
      Panel.toast(err.message, 'error');
      if (current) root.querySelector('#fm-path').value = current.path;
    }
  }

  function render() {
    if (!root) return;
    root.querySelector('#fm-path').value = current.path;
    root.querySelector('#fm-up').disabled = !current.parent;

    // Kırıntı yolu
    const parts = current.path.split('/').filter(Boolean);
    let acc = '';
    const crumbs = [`<button data-go="/" class="rounded px-1 hover:bg-slate-800 hover:text-slate-200">/</button>`];
    parts.forEach((part) => {
      acc += '/' + part;
      crumbs.push(`<span class="text-slate-600">›</span><button data-go="${fmt.escapeHtml(acc)}" class="rounded px-1 hover:bg-slate-800 hover:text-slate-200">${fmt.escapeHtml(part)}</button>`);
    });
    root.querySelector('#fm-crumbs').innerHTML = crumbs.join('');

    const rows = current.entries.map((e, i) => `
      <tr data-i="${i}" class="border-b border-slate-800/60 last:border-0 hover:bg-slate-800/40">
        <td class="px-4 py-2">
          <button data-open="${i}" class="flex max-w-md items-center gap-2 truncate text-left hover:text-emerald-300">
            ${ICONS[e.type] || ICONS.other}
            <span class="truncate">${fmt.escapeHtml(e.name)}</span>
            ${e.symlink ? `<span class="truncate text-xs text-slate-500">→ ${fmt.escapeHtml(e.linkTarget || '?')}</span>` : ''}
          </button>
        </td>
        <td class="tabular whitespace-nowrap px-4 py-2 text-right text-slate-400">${e.type === 'dir' ? '–' : fmt.bytes(e.size)}</td>
        <td class="tabular whitespace-nowrap px-4 py-2 text-slate-400">${e.mtime ? new Date(e.mtime).toLocaleString('tr-TR') : '–'}</td>
        <td class="whitespace-nowrap px-4 py-2 font-mono text-xs text-slate-500">${fmt.escapeHtml(e.mode)}</td>
        <td class="whitespace-nowrap px-4 py-2 text-right">
          ${e.type === 'file' ? `<a data-dl="${i}" href="/api/files/download?path=${encodeURIComponent(join(current.path, e.name))}" class="rounded-md px-2 py-1 text-xs text-slate-300 hover:bg-slate-800">İndir</a>` : ''}
          <button data-rename="${i}" class="rounded-md px-2 py-1 text-xs text-slate-300 hover:bg-slate-800">Ad değiştir</button>
          <button data-del="${i}" class="rounded-md px-2 py-1 text-xs text-rose-300 hover:bg-rose-900/40">Sil</button>
        </td>
      </tr>`);
    root.querySelector('#fm-rows').innerHTML = rows.length ? rows.join('')
      : '<tr><td colspan="5" class="px-4 py-6 text-center text-slate-500">Klasör boş</td></tr>';
    if (current.truncated) Panel.toast('Klasörde çok fazla öğe var, ilk 5000 tanesi gösteriliyor', 'warn');
  }

  // ---- İşlemler ----
  async function remove(e) {
    const p = join(current.path, e.name);
    const isDir = e.type === 'dir' && !e.symlink;
    const ok = await Panel.confirm({
      title: isDir ? 'Klasörü sil' : 'Dosyayı sil',
      message: isDir
        ? `${p}\n\nKlasör ve içindeki her şey kalıcı olarak silinecek. Bu işlem geri alınamaz.`
        : `${p}\n\nDosya kalıcı olarak silinecek. Bu işlem geri alınamaz.`,
      confirmText: 'Kalıcı olarak sil',
      danger: true,
      requireText: isDir ? e.name : null,
    });
    if (!ok) return;
    try {
      await Panel.api(`/api/files?path=${encodeURIComponent(p)}`, { method: 'DELETE' });
      Panel.toast(`"${e.name}" silindi`, 'success', 3000);
      load(current.path);
    } catch (err) { Panel.toast(err.message, 'error'); }
  }

  async function rename(e) {
    const name = await Panel.prompt({ title: 'Ad değiştir', label: 'Yeni ad', value: e.name, confirmText: 'Değiştir' });
    if (!name || name === e.name) return;
    try {
      await Panel.api('/api/files/rename', { method: 'POST', body: { path: join(current.path, e.name), name } });
      load(current.path);
    } catch (err) { Panel.toast(err.message, 'error'); }
  }

  async function mkdir() {
    const name = await Panel.prompt({ title: 'Yeni klasör', label: 'Klasör adı', confirmText: 'Oluştur' });
    if (!name) return;
    try {
      await Panel.api('/api/files/mkdir', { method: 'POST', body: { path: current.path, name } });
      load(current.path);
    } catch (err) { Panel.toast(err.message, 'error'); }
  }

  async function newFile() {
    const name = await Panel.prompt({ title: 'Yeni dosya', label: 'Dosya adı', confirmText: 'Oluştur' });
    if (!name) return;
    if (current.entries.some((e) => e.name === name)) return Panel.toast('Bu adda bir öğe zaten var', 'error');
    try {
      await Panel.api('/api/files/write', { method: 'PUT', body: { path: join(current.path, name), content: '' } });
      await load(current.path);
      openFile(join(current.path, name));
    } catch (err) { Panel.toast(err.message, 'error'); }
  }

  function uploadFiles(fileList, overwrite = false) {
    const list = Array.from(fileList || []);
    if (!list.length) return;
    const existing = list.filter((f) => current.entries.some((e) => e.name === f.name));
    const go = (ow) => {
      const fd = new FormData();
      list.forEach((f) => fd.append('files', f, f.name));
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `/api/files/upload?path=${encodeURIComponent(current.path)}${ow ? '&overwrite=1' : ''}`);
      xhr.setRequestHeader('X-CSRF-Token', Panel.state.csrfToken);
      const box = root.querySelector('#fm-progress');
      box.classList.remove('hidden');
      root.querySelector('#fm-progress-text').textContent = `${list.length} dosya yükleniyor…`;
      xhr.upload.onprogress = (ev) => {
        if (!ev.lengthComputable) return;
        const p = (ev.loaded / ev.total) * 100;
        root.querySelector('#fm-progress-bar').style.width = p.toFixed(1) + '%';
        root.querySelector('#fm-progress-pct').textContent = p.toFixed(0) + '%';
      };
      xhr.onloadend = () => {
        box.classList.add('hidden');
        let data = {};
        try { data = JSON.parse(xhr.responseText); } catch (_) { /* yok say */ }
        if (xhr.status === 200) {
          Panel.toast(`${data.uploaded.length} dosya yüklendi`, 'success', 3000);
          load(current.path);
        } else {
          Panel.toast(`Yükleme başarısız: ${data.error || xhr.status}`, 'error');
        }
      };
      xhr.send(fd);
    };
    if (existing.length && !overwrite) {
      Panel.confirm({
        title: 'Üzerine yazılsın mı?',
        message: `Şu dosyalar zaten var:\n${existing.map((f) => f.name).join('\n')}`,
        confirmText: 'Üzerine yaz',
        danger: true,
      }).then((ok) => ok && go(true));
    } else {
      go(overwrite);
    }
  }

  // ---- Editör (Monaco) ----
  function loadMonaco() {
    if (!monacoPromise) {
      monacoPromise = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = '/vendor/monaco/vs/loader.js';
        s.onload = () => {
          window.require.config({ paths: { vs: '/vendor/monaco/vs' } });
          window.require(['vs/editor/editor.main'], () => resolve(window.monaco), reject);
        };
        s.onerror = reject;
        document.head.appendChild(s);
      });
    }
    return monacoPromise;
  }

  function languageFor(monaco, filePath) {
    const name = filePath.split('/').pop().toLowerCase();
    const special = { dockerfile: 'dockerfile', makefile: 'shell', '.bashrc': 'shell', '.profile': 'shell', '.env': 'ini' };
    if (special[name]) return special[name];
    if (name.startsWith('.env')) return 'ini';
    if (/\.(conf|cnf|service|timer|socket)$/.test(name)) return 'ini';
    const ext = name.includes('.') ? '.' + name.split('.').pop() : '';
    const lang = monaco.languages.getLanguages().find((l) => (l.extensions || []).includes(ext) || (l.filenames || []).map((f) => f.toLowerCase()).includes(name));
    return lang ? lang.id : 'plaintext';
  }

  function setDirty(v) {
    if (!editor) return;
    editor.dirty = v;
    root.querySelector('#ed-dirty').classList.toggle('hidden', !v);
  }

  async function openFile(p) {
    let data;
    try {
      data = await Panel.api(`/api/files/read?path=${encodeURIComponent(p)}`);
    } catch (err) { return Panel.toast(err.message, 'error'); }
    if (data.binary || data.tooLarge) {
      const ok = await Panel.confirm({
        title: data.binary ? 'İkili dosya' : 'Dosya çok büyük',
        message: `${p} (${fmt.bytes(data.size)}) editörde açılamaz. İndirmek ister misiniz?`,
        confirmText: 'İndir',
      });
      if (ok) location.href = `/api/files/download?path=${encodeURIComponent(p)}`;
      return;
    }
    let monaco;
    try { monaco = await loadMonaco(); } catch (err) { return Panel.toast('Editör yüklenemedi', 'error'); }
    if (!root) return;

    const box = root.querySelector('#fm-editor');
    box.classList.remove('hidden');
    box.classList.add('flex');
    root.querySelector('#ed-path').textContent = data.path;
    const host = root.querySelector('#ed-host');
    host.innerHTML = '';
    const lang = languageFor(monaco, data.path);
    const ed = monaco.editor.create(host, {
      value: data.content,
      language: lang,
      theme: 'vs-dark',
      automaticLayout: true,
      fontSize: 13,
      minimap: { enabled: window.innerWidth > 900 },
      scrollBeyondLastLine: false,
      tabSize: 2,
      unicodeHighlight: { ambiguousCharacters: false }, // Türkçe karakterleri vurgulama
    });
    editor = { ed, path: data.path, mtime: data.mtime, dirty: false };
    setDirty(false);
    ed.onDidChangeModelContent(() => setDirty(true));
    ed.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, save);

    const sel = root.querySelector('#ed-lang');
    sel.innerHTML = monaco.languages.getLanguages().map((l) => l.id).sort()
      .map((id) => `<option ${id === lang ? 'selected' : ''}>${id}</option>`).join('');
    sel.onchange = () => monaco.editor.setModelLanguage(ed.getModel(), sel.value);
    ed.focus();
  }

  async function save() {
    if (!editor) return;
    try {
      const r = await Panel.api('/api/files/write', {
        method: 'PUT',
        body: { path: editor.path, content: editor.ed.getValue(), expectedMtime: editor.mtime },
      });
      editor.mtime = r.mtime;
      setDirty(false);
      Panel.toast('Kaydedildi', 'success', 2000);
    } catch (err) {
      Panel.toast(`Kaydedilemedi: ${err.message}`, 'error');
    }
  }

  async function closeEditor(force) {
    if (!editor) return;
    if (editor.dirty && !force) {
      const ok = await Panel.confirm({ title: 'Kaydedilmemiş değişiklikler', message: 'Değişiklikler kaybolacak. Kapatılsın mı?', confirmText: 'Kaydetmeden kapat', danger: true });
      if (!ok) return;
    }
    editor.ed.getModel().dispose();
    editor.ed.dispose();
    editor = null;
    const box = root.querySelector('#fm-editor');
    box.classList.add('hidden');
    box.classList.remove('flex');
    load(current.path);
  }

  Panel.register('files', {
    mount(el) {
      root = el;
      root.innerHTML = template();
      root.querySelector('#fm-form').addEventListener('submit', (e) => { e.preventDefault(); load(root.querySelector('#fm-path').value.trim()); });
      root.querySelector('#fm-up').addEventListener('click', () => current && current.parent && load(current.parent));
      root.querySelector('#fm-refresh').addEventListener('click', () => current && load(current.path));
      root.querySelector('#fm-newdir').addEventListener('click', mkdir);
      root.querySelector('#fm-newfile').addEventListener('click', newFile);
      root.querySelector('#fm-upload').addEventListener('change', (e) => { uploadFiles(e.target.files); e.target.value = ''; });
      root.querySelector('#fm-crumbs').addEventListener('click', (e) => {
        const b = e.target.closest('[data-go]');
        if (b) load(b.dataset.go);
      });
      root.querySelector('#fm-rows').addEventListener('click', (e) => {
        const t = e.target.closest('[data-open],[data-rename],[data-del]');
        if (!t) return;
        const entry = current.entries[Number(t.dataset.open ?? t.dataset.rename ?? t.dataset.del)];
        if (t.dataset.open !== undefined) {
          if (entry.type === 'dir') load(join(current.path, entry.name));
          else if (entry.type === 'file') openFile(join(current.path, entry.name));
        } else if (t.dataset.rename !== undefined) rename(entry);
        else remove(entry);
      });
      const drop = root.querySelector('#fm-drop');
      drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('border-emerald-500'); });
      drop.addEventListener('dragleave', () => drop.classList.remove('border-emerald-500'));
      drop.addEventListener('drop', (e) => {
        e.preventDefault();
        drop.classList.remove('border-emerald-500');
        uploadFiles(e.dataTransfer.files);
      });
      root.querySelector('#ed-save').addEventListener('click', save);
      root.querySelector('#ed-close').addEventListener('click', () => closeEditor(false));
      load(lastPath);
    },
    unmount() {
      if (editor) { editor.ed.dispose(); editor = null; }
      root = null;
    },
  });
})();
