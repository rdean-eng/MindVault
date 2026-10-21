  const DB_NAME = "filenest-local-db";
    const STORE = "fileBlobs";
    const STORAGE_KEY = "filenest-tree-v1";
    const $ = (s) => document.querySelector(s);
    let state = loadState();
    let currentFolderId = "root";
    let currentView = "all";
    let dialogMode = "create";
    let editingId = null;
    let toastTimer;

    function uid() { return crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2); }
    function loadState() {
      try {
        const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
        if (saved && Array.isArray(saved.items)) return saved;
      } catch (_) {}
      return { items: [{ id: "root", name: "My files", type: "folder", parentId: null, createdAt: Date.now(), starred: false }] };
    }
    function saveState() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
    function escapeHTML(s) { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
    function getItem(id) { return state.items.find(x => x.id === id); }
    function childrenOf(parentId) { return state.items.filter(x => x.parentId === parentId); }
    function humanSize(n) {
      if (!Number.isFinite(n)) return "";
      if (n < 1024) return n + " B";
      if (n < 1024*1024) return (n/1024).toFixed(1) + " KB";
      if (n < 1024*1024*1024) return (n/1024/1024).toFixed(1) + " MB";
      return (n/1024/1024/1024).toFixed(2) + " GB";
    }
    function fileIcon(file) {
      if (file.type === "folder") return "📁";
      const ext = (file.name.split(".").pop() || "").toLowerCase();
      if (ext === "pdf") return "📕";
      if (["doc","docx","txt","rtf"].includes(ext)) return "📘";
      if (["ppt","pptx"].includes(ext)) return "📙";
      if (["jpg","jpeg","png","gif","webp","svg"].includes(ext)) return "🖼️";
      if (["xls","xlsx","csv"].includes(ext)) return "📗";
      return "📄";
    }
    function iconClass(file) {
      const ext = (file.name.split(".").pop() || "").toLowerCase();
      if (ext === "pdf") return "pdf";
      if (["doc","docx","txt","ppt","pptx","xls","xlsx","csv"].includes(ext)) return "doc";
      if (["jpg","jpeg","png","gif","webp","svg"].includes(ext)) return "img";
      return "";
    }
    function showToast(message) {
      const t = $("#toast"); t.textContent = message; t.style.display = "block";
      clearTimeout(toastTimer); toastTimer = setTimeout(() => t.style.display = "none", 2600);
    }
    function descendants(id) {
      const result = [];
      for (const child of childrenOf(id)) {
        result.push(child.id);
        if (child.type === "folder") result.push(...descendants(child.id));
      }
      return result;
    }
    function renderBreadcrumbs() {
      const path = [];
      let node = getItem(currentFolderId);
      while (node) { path.unshift(node); node = node.parentId ? getItem(node.parentId) : null; }
      $("#breadcrumbs").innerHTML = path.map((p,i) =>
        `${i ? '<span>/</span>' : ''}<button data-crumb="${p.id}" ${i === path.length-1 ? 'style="color:var(--text);font-weight:700"' : ''}>${escapeHTML(p.name)}</button>`
      ).join("");
      $("#breadcrumbs").querySelectorAll("[data-crumb]").forEach(b => b.addEventListener("click", () => { currentFolderId = b.dataset.crumb; currentView = "all"; render(); }));
    }
    function renderCard(item) {
      const isFolder = item.type === "folder";
      const icon = fileIcon(item);
      const meta = isFolder ? `${childrenOf(item.id).length} item(s)` : `${humanSize(item.size)} · ${new Date(item.createdAt).toLocaleDateString()}`;
      const openButton = isFolder
        ? `<button class="secondary" data-action="open" data-id="${item.id}">Open folder</button>`
        : `<button class="secondary" data-action="download" data-id="${item.id}">Download</button>`;
      return `<article class="item">
        <div class="item-top"><div class="file-icon ${iconClass(item)}">${icon}</div><button class="menu-btn" title="More options" aria-label="More options for ${escapeHTML(item.name)}" data-action="menu" data-id="${item.id}">⋯</button></div>
        <div class="item-name" title="${escapeHTML(item.name)}">${escapeHTML(item.name)}</div>
        <div class="item-meta">${meta}${item.starred ? " · ★ Starred" : ""}</div>
        <div class="item-buttons">${openButton}<button class="secondary" data-action="rename" data-id="${item.id}">Rename</button></div>
      </article>`;
    }
    function attachCardEvents(container) {
      container.querySelectorAll("[data-action]").forEach(btn => btn.addEventListener("click", async () => {
        const item = getItem(btn.dataset.id); if (!item) return;
        switch (btn.dataset.action) {
          case "open": currentFolderId = item.id; currentView = "all"; render(); break;
          case "download": await downloadFile(item); break;
          case "rename": openNameDialog("rename", item); break;
          case "menu": showItemMenu(item); break;
        }
      }));
    }
    function showItemMenu(item) {
      const action = prompt(`Options for "${item.name}"\nType: star, unstar, move, or delete`, item.starred ? "unstar" : "star");
      if (!action) return;
      if (action.toLowerCase() === "star") { item.starred = true; saveState(); render(); }
      else if (action.toLowerCase() === "unstar") { item.starred = false; saveState(); render(); }
      else if (action.toLowerCase() === "delete") deleteItem(item);
      else if (action.toLowerCase() === "move") moveItem(item);
      else showToast("Choose star, unstar, move, or delete.");
    }
    async function deleteItem(item) {
      if (item.id === "root") return;
      const ids = [item.id, ...(item.type === "folder" ? descendants(item.id) : [])];
      if (!confirm(`Delete "${item.name}"${ids.length > 1 ? " and its contents" : ""}? This cannot be undone.`)) return;
      for (const id of ids) {
        const target = getItem(id);
        if (target?.type === "file") await deleteBlob(id);
      }
      state.items = state.items.filter(x => !ids.includes(x.id));
      if (ids.includes(currentFolderId)) currentFolderId = item.parentId || "root";
      saveState(); render(); showToast("Item deleted.");
    }
    function moveItem(item) {
      const folders = state.items.filter(x => x.type === "folder" && x.id !== item.id && !(item.type === "folder" && descendants(item.id).includes(x.id)));
      const options = folders.map((f,i) => `${i+1}. ${f.name} (${f.id === "root" ? "root" : "folder"})`).join("\n");
      const answer = prompt("Move to which folder? Enter its number:\n" + options);
      const index = Number(answer) - 1;
      if (!Number.isInteger(index) || index < 0 || index >= folders.length) return;
      item.parentId = folders[index].id; saveState(); render(); showToast("Item moved.");
    }
    function render() {
      const query = $("#searchInput").value.trim().toLowerCase();
      const parentId = currentFolderId;
      let folders = childrenOf(parentId).filter(x => x.type === "folder");
      let files = childrenOf(parentId).filter(x => x.type === "file");
      if (currentView === "starred") {
        folders = state.items.filter(x => x.type === "folder" && x.starred);
        files = state.items.filter(x => x.type === "file" && x.starred);
      } else if (currentView === "recent") {
        folders = [];
        files = state.items.filter(x => x.type === "file").sort((a,b) => b.createdAt-a.createdAt).slice(0,30);
      }
      if (query) {
        folders = state.items.filter(x => x.type === "folder" && x.id !== "root" && x.name.toLowerCase().includes(query));
        files = state.items.filter(x => x.type === "file" && x.name.toLowerCase().includes(query));
      }
      $("#pageTitle").textContent = currentView === "starred" ? "Starred" : currentView === "recent" ? "Recent" : query ? "Search results" : (getItem(parentId)?.name || "My files");
      $("#foldersTitle").textContent = "Folders";
      $("#filesTitle").textContent = currentView === "recent" ? "Recent files" : "Files";
      $("#folderCount").textContent = `${folders.length} folder${folders.length === 1 ? "" : "s"}`;
      $("#fileCount").textContent = `${files.length} file${files.length === 1 ? "" : "s"}`;
      $("#folderGrid").innerHTML = folders.length ? folders.map(renderCard).join("") : `<div class="empty"><div class="big">📂</div>No folders here yet.</div>`;
      $("#fileGrid").innerHTML = files.length ? files.map(renderCard).join("") : `<div class="empty"><div class="big">📄</div>No files here yet.<br>Upload a file to get started.</div>`;
      attachCardEvents($("#folderGrid")); attachCardEvents($("#fileGrid"));
      renderBreadcrumbs();
      document.querySelectorAll("[data-view]").forEach(b => b.classList.toggle("active", b.dataset.view === currentView));
    }

    function openNameDialog(mode, item = null) {
      dialogMode = mode; editingId = item?.id || null;
      $("#dialogTitle").textContent = mode === "rename" ? "Rename item" : "Create a folder";
      $("#dialogDescription").textContent = mode === "rename" ? "Enter a new name for this item." : "Choose a name for your new folder.";
      $("#nameInput").value = item?.name || ""; $("#nameDialog").showModal(); $("#nameInput").focus();
    }
    $("#nameForm").addEventListener("submit", e => {
      e.preventDefault();
      const name = $("#nameInput").value.trim();
      if (!name) return;
      if (dialogMode === "create") {
        const duplicate = childrenOf(currentFolderId).some(x => x.name.toLowerCase() === name.toLowerCase());
        if (duplicate) { showToast("An item with that name already exists here."); return; }
        state.items.push({ id: uid(), name, type: "folder", parentId: currentFolderId, createdAt: Date.now(), starred: false });
        showToast("Folder created.");
      } else {
        const item = getItem(editingId);
        if (!item) return;
        item.name = name; showToast("Name updated.");
      }
      saveState(); $("#nameDialog").close(); render();
    });
    $("#cancelDialog").addEventListener("click", () => $("#nameDialog").close());
    $("#newFolderBtn").addEventListener("click", () => openNameDialog("create"));
    $("#newFolderBtnTop").addEventListener("click", () => openNameDialog("create"));
    $("#uploadBtn").addEventListener("click", () => $("#fileInput").click());
    $("#fileInput").addEventListener("change", async e => {
      const files = [...e.target.files];
      if (!files.length) return;
      for (const file of files) {
        const duplicate = childrenOf(currentFolderId).some(x => x.name.toLowerCase() === file.name.toLowerCase());
        if (duplicate) { showToast(`Skipped duplicate: ${file.name}`); continue; }
        const id = uid();
        try {
          await saveBlob(id, file);
          state.items.push({ id, name: file.name, type: "file", parentId: currentFolderId, size: file.size, mime: file.type, createdAt: Date.now(), starred: false });
        } catch (err) {
          console.error(err); showToast("Could not save file. Browser storage may be full."); break;
        }
      }
      saveState(); render(); e.target.value = "";
      showToast("Upload complete (saved on this device).");
    });
    $("#searchInput").addEventListener("input", render);
    document.querySelectorAll("[data-view]").forEach(b => b.addEventListener("click", () => { currentView = b.dataset.view; currentFolderId = "root"; render(); }));

    function openDB() {
      return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = () => request.result.createObjectStore(STORE);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    }
    async function saveBlob(id, blob) {
      const db = await openDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite"); tx.objectStore(STORE).put(blob, id);
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => { db.close(); reject(tx.error); };
      });
    }
    async function getBlob(id) {
      const db = await openDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readonly"); const req = tx.objectStore(STORE).get(id);
        req.onsuccess = () => { db.close(); resolve(req.result); };
        req.onerror = () => { db.close(); reject(req.error); };
      });
    }
    async function deleteBlob(id) {
      try {
        const db = await openDB();
        await new Promise((resolve, reject) => {
          const tx = db.transaction(STORE, "readwrite"); tx.objectStore(STORE).delete(id);
          tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
        }); db.close();
      } catch (e) { console.warn(e); }
    }
    async function downloadFile(item) {
      const blob = await getBlob(item.id);
      if (!blob) { showToast("File data was not found in this browser."); return; }
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = item.name;
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    }
    render();