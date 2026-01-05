// ===== State Management =====
let projects = [];
let currentProject = null;
let isEditMode = false;
let showArchived = false;
let searchQuery = '';
let statusFilter = '';
let sortBy = 'updated-desc';
let pendingImportData = null;

// Firebase configuration
const defaultFirebaseConfig = {
    apiKey: "AIzaSyD2eFoJ7qDEQbHd2YVcPx6xGEushmN1vVk",
    authDomain: "lunar-nova-1223e.firebaseapp.com",
    projectId: "lunar-nova-1223e",
    storageBucket: "lunar-nova-1223e.firebasestorage.app",
    messagingSenderId: "1029952234254",
    appId: "1:1029952234254:web:e072800db543acf0966d5f",
    measurementId: "G-LYKP24CH76"
};

let db = null;
let auth = null;
let currentUser = null;
let isFirebaseInitialized = false;

// ===== Initialize App =====
document.addEventListener('DOMContentLoaded', async () => {
    loadLocalProjects();
    initializeEventListeners();
    loadThemePreference();
    renderDashboard();

    // Initialize Firebase
    await initFirebase();
});

async function initFirebase() {
    try {
        if (!window.firebase) {
            console.warn("Firebase SDK not found.");
            showNotification('エラー: Firebase SDKが読み込まれていません');
            updateSyncButtonUI(false);
            return;
        }

        // Initialize Firebase if not already initialized
        if (!firebase.apps.length) {
            firebase.initializeApp(defaultFirebaseConfig);
        }

        db = firebase.firestore();
        auth = firebase.auth();

        // 以前設定した手動IDがあるか確認
        const manualUid = localStorage.getItem('lunar-nova-manual-uid');

        if (manualUid) {
            currentUser = { uid: manualUid };
            console.log("Using manual Sync ID:", manualUid);
        } else {
            // 新規匿名ログイン
            try {
                const userCredential = await auth.signInAnonymously();
                currentUser = userCredential.user;
                console.log("Using anonymous ID:", currentUser.uid);
            } catch (authError) {
                if (authError.code === 'auth/operation-not-allowed') {
                    showNotification('設定エラー: Firebaseコンソールで「匿名認証」を有効にしてください');
                    alert('【重要】クラウド同期を使うには設定が必要です\n\nFirebaseコンソール > Authentication > Sign-in method\nで「匿名 (Anonymous)」を有効にしてください。');
                } else {
                    throw authError;
                }
                return;
            }
        }

        isFirebaseInitialized = true;

        // Initial sync from cloud
        await syncFromFirebase(true);

    } catch (error) {
        console.error("Firebase initialization failed:", error);
        showNotification(`初期化エラー: ${error.message}`);
        updateSyncButtonUI(false);
    }
}

// ===== Event Listeners =====
function initializeEventListeners() {
    // Navigation
    document.getElementById('newProjectBtn').addEventListener('click', () => showEditor());
    document.getElementById('createFirstProjectBtn').addEventListener('click', () => showEditor());
    document.getElementById('backBtn').addEventListener('click', () => showDashboard());

    // Editor actions
    document.getElementById('saveBtn').addEventListener('click', saveProject);
    document.getElementById('editModeToggle').addEventListener('click', toggleEditMode);
    document.getElementById('markdownEditor').addEventListener('input', updatePreview);

    // Theme toggle
    document.getElementById('themeToggle').addEventListener('click', toggleTheme);

    // Search and filter
    document.getElementById('searchInput').addEventListener('input', handleSearch);
    document.getElementById('clearSearch').addEventListener('click', clearSearch);
    document.getElementById('statusFilter').addEventListener('change', handleStatusFilter);
    document.getElementById('sortBy').addEventListener('change', handleSort);
    document.getElementById('toggleArchived').addEventListener('click', toggleArchivedView);

    // Export/Import
    document.getElementById('exportBtn').addEventListener('click', () => toggleDropdown('exportMenu'));
    document.getElementById('exportAllJson').addEventListener('click', exportAllJson);
    document.getElementById('exportAllMarkdown').addEventListener('click', exportAllMarkdown);
    document.getElementById('importBtn').addEventListener('click', () => document.getElementById('importFile').click());
    document.getElementById('importFile').addEventListener('change', handleImport);

    // Firebase sync
    document.getElementById('syncBtn').addEventListener('click', async () => {
        if (!isFirebaseInitialized) {
            showNotification('クラウドに接続中...');
            await initFirebase();
            if (isFirebaseInitialized) {
                showModal('firebaseModal');
                updateSyncIdUI();
            }
        } else {
            showModal('firebaseModal');
            updateSyncIdUI();
        }
    });

    document.getElementById('closeFirebase').addEventListener('click', () => hideModal('firebaseModal'));
    document.getElementById('cancelFirebase').addEventListener('click', () => hideModal('firebaseModal'));
    document.getElementById('saveFirebase').addEventListener('click', handleSyncIdAction);

    // Modal close hooks
    document.getElementById('closeDelete').addEventListener('click', () => hideModal('deleteModal'));
    document.getElementById('cancelDelete').addEventListener('click', () => hideModal('deleteModal'));
    document.getElementById('confirmDelete').addEventListener('click', confirmDelete);

    document.getElementById('closeImport').addEventListener('click', () => hideModal('importModal'));
    document.getElementById('cancelImport').addEventListener('click', () => hideModal('importModal'));
    document.getElementById('confirmImport').addEventListener('click', confirmImport);

    document.getElementById('helpBtn').addEventListener('click', () => showModal('helpModal'));
    document.getElementById('closeHelp').addEventListener('click', () => hideModal('helpModal'));

    // Global listeners
    document.querySelectorAll('.modal').forEach(modal => {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) hideModal(modal.id);
        });
    });

    document.addEventListener('click', (e) => {
        if (!e.target.closest('.dropdown')) {
            document.querySelectorAll('.dropdown-menu').forEach(menu => menu.classList.remove('show'));
        }
    });
}

// ===== Cloud Sync Logic =====

async function syncToFirebase() {
    if (!isFirebaseInitialized || !currentUser) return;

    updateSyncButtonUI(true);
    try {
        const userDocRef = db.collection('users').doc(currentUser.uid);
        await userDocRef.set({
            projects: projects,
            lastUpdated: new Date().toISOString()
        }, { merge: true });
        console.log("Synced to cloud.");
        updateSyncButtonUI(false);
    } catch (error) {
        console.error("Cloud sync failed:", error);
        updateSyncButtonUI(false);
        showNotification('クラウド同期に失敗しました');
    }
}

async function syncFromFirebase(silent = false) {
    if (!isFirebaseInitialized || !currentUser) return;

    if (!silent) updateSyncButtonUI(true);
    try {
        const userDocRef = db.collection('users').doc(currentUser.uid);
        const doc = await userDocRef.get();

        if (doc.exists) {
            const data = doc.data();
            if (data.projects) {
                // Determine if we should update local data
                // In this simple version, we prefer the cloud data if it has projects
                // but let's do a simple merge for existing local projects that might not be in the cloud
                const cloudProjects = data.projects;
                const localProjects = projects;

                // Simple strategy: Cloud wins for MVP
                if (cloudProjects.length > 0 || localProjects.length === 0) {
                    projects = cloudProjects;
                    saveLocalProjectsOnly();
                    renderDashboard();
                } else if (localProjects.length > 0) {
                    // Upload local projects to cloud if cloud is empty
                    await syncToFirebase();
                }
            }
        } else {
            // New user, push local projects to cloud
            if (projects.length > 0) {
                await syncToFirebase();
            }
        }

        if (!silent) showNotification('クラウドから同期しました');
    } catch (error) {
        console.error("Cloud fetch failed:", error);
        if (!silent) showNotification('クラウドデータの取得に失敗しました');
    } finally {
        updateSyncButtonUI(false);
    }
}

function updateSyncButtonUI(syncing) {
    const btn = document.getElementById('syncBtn');
    if (!btn) return;
    const statusText = btn.querySelector('.sync-status');
    const icon = btn.querySelector('.btn-icon');

    if (syncing) {
        statusText.textContent = '同期中...';
        icon.classList.add('syncing-animation');
    } else {
        statusText.textContent = isFirebaseInitialized ? '同期済' : '同期';
        icon.classList.remove('syncing-animation');
    }
}

function updateSyncIdUI() {
    const apiKeyField = document.getElementById('firebaseApiKey');
    const manualSyncField = document.getElementById('manualSyncId');

    apiKeyField.value = currentUser ? currentUser.uid : 'Initializing...';
    manualSyncField.value = localStorage.getItem('lunar-nova-manual-uid') || '';
}

async function handleSyncIdAction() {
    const manualId = document.getElementById('manualSyncId').value.trim();

    if (manualId) {
        // 保存して再読み込み
        localStorage.setItem('lunar-nova-manual-uid', manualId);
        showNotification('Sync ID を適用しました。再読み込み中...');
        setTimeout(() => location.reload(), 1500);
    } else {
        showNotification('ID を入力してください');
    }
}

// コピーボタンの処理
document.addEventListener('DOMContentLoaded', () => {
    const copyBtn = document.getElementById('copySyncIdBtn');
    if (copyBtn) {
        copyBtn.addEventListener('click', () => {
            const apiKeyField = document.getElementById('firebaseApiKey');
            apiKeyField.select();
            navigator.clipboard.writeText(apiKeyField.value);
            showNotification('Sync ID をコピーしました');
        });
    }
});

// ===== Local Storage Functions =====
function loadLocalProjects() {
    const stored = localStorage.getItem('lunar-nova-projects');
    projects = stored ? JSON.parse(stored) : [];
}

function saveLocalProjectsOnly() {
    localStorage.setItem('lunar-nova-projects', JSON.stringify(projects));
}

function saveProjects() {
    saveLocalProjectsOnly();
    if (isFirebaseInitialized) {
        syncToFirebase();
    }
}

// ===== Theme Management =====
function loadThemePreference() {
    const theme = localStorage.getItem('lunar-nova-theme') || 'dark';
    if (theme === 'light') {
        document.body.classList.add('light-theme');
        document.getElementById('themeToggle').innerHTML = '<span class="btn-icon">☀️</span>';
    }
}

function toggleTheme() {
    const isLight = document.body.classList.toggle('light-theme');
    const icon = isLight ? '☀️' : '🌙';
    document.getElementById('themeToggle').innerHTML = `<span class="btn-icon">${icon}</span>`;
    localStorage.setItem('lunar-nova-theme', isLight ? 'light' : 'dark');
}

// ===== Dashboard Functions =====
function showDashboard() {
    document.getElementById('dashboardView').classList.add('active');
    document.getElementById('editorView').classList.remove('active');
    renderDashboard();
}

function renderDashboard() {
    const grid = document.getElementById('projectsGrid');
    const emptyState = document.getElementById('emptyState');

    updateStats();

    let filteredProjects = filterProjects();
    filteredProjects = sortProjects(filteredProjects);

    if (filteredProjects.length === 0 && projects.length === 0) {
        grid.innerHTML = '';
        emptyState.classList.add('show');
    } else if (filteredProjects.length === 0) {
        grid.innerHTML = '<div class="empty-state show"><p>検索条件に一致するプロジェクトがありません</p></div>';
        emptyState.classList.remove('show');
    } else {
        emptyState.classList.remove('show');
        grid.innerHTML = filteredProjects.map(project => createProjectCard(project)).join('');

        // Re-attach event listeners to new elements
        filteredProjects.forEach((project, index) => {
            const card = grid.children[index];
            card.addEventListener('click', (e) => {
                if (!e.target.closest('.action-btn')) {
                    viewProject(project);
                }
            });

            const editBtn = card.querySelector('.action-btn.edit');
            editBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                editProject(project);
            });

            const archiveBtn = card.querySelector('.action-btn.archive');
            archiveBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                toggleArchive(project);
            });

            const deleteBtn = card.querySelector('.action-btn.delete');
            deleteBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                deleteProject(project);
            });
        });
    }
}

function filterProjects() {
    return projects.filter(project => {
        if (!showArchived && project.status === 'archived') return false;
        if (statusFilter && project.status !== statusFilter) return false;
        if (searchQuery) {
            const query = searchQuery.toLowerCase();
            const titleMatch = project.title.toLowerCase().includes(query);
            const contentMatch = project.content.toLowerCase().includes(query);
            const tagsMatch = (project.tags || []).some(tag => tag.toLowerCase().includes(query));
            if (!titleMatch && !contentMatch && !tagsMatch) return false;
        }
        return true;
    });
}

function sortProjects(projectsList) {
    const sorted = [...projectsList];
    switch (sortBy) {
        case 'updated-desc': sorted.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)); break;
        case 'updated-asc': sorted.sort((a, b) => new Date(a.updatedAt) - new Date(b.updatedAt)); break;
        case 'created-desc': sorted.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)); break;
        case 'created-asc': sorted.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)); break;
        case 'title-asc': sorted.sort((a, b) => a.title.localeCompare(b.title)); break;
        case 'title-desc': sorted.sort((a, b) => b.title.localeCompare(a.title)); break;
        case 'status':
            const statusOrder = { 'planning': 0, 'active': 1, 'on-hold': 2, 'completed': 3, 'archived': 4 };
            sorted.sort((a, b) => statusOrder[a.status] - statusOrder[b.status]);
            break;
    }
    return sorted;
}

function updateStats() {
    document.getElementById('totalProjects').textContent = projects.filter(p => p.status !== 'archived').length;
    document.getElementById('activeProjects').textContent = projects.filter(p => p.status === 'active').length;
    document.getElementById('completedProjects').textContent = projects.filter(p => p.status === 'completed').length;
    document.getElementById('archivedProjects').textContent = projects.filter(p => p.status === 'archived').length;
}

function createProjectCard(project) {
    const statusClass = `status-${project.status}`;
    const statusLabel = getStatusLabel(project.status);
    const preview = getTextPreview(project.content);
    const tags = project.tags || [];
    const isArchived = project.status === 'archived';

    return `
        <div class="project-card ${isArchived ? 'archived' : ''}" data-id="${project.id}">
            <div class="project-card-header">
                <div>
                    <h3 class="project-title">${escapeHtml(project.title)}</h3>
                    <span class="project-status ${statusClass}">${statusLabel}</span>
                </div>
                <div class="project-actions">
                    <button class="action-btn edit" title="編集">✏️</button>
                    <button class="action-btn archive" title="${isArchived ? 'アーカイブ解除' : 'アーカイブ'}">${isArchived ? '📂' : '📦'}</button>
                    <button class="action-btn delete" title="削除">🗑️</button>
                </div>
            </div>
            <div class="project-preview">${escapeHtml(preview)}</div>
            ${tags.length > 0 ? `
                <div class="project-tags">
                    ${tags.map(tag => `<span class="tag">${escapeHtml(tag)}</span>`).join('')}
                </div>
            ` : ''}
            <div class="project-meta">
                <span>最終更新: ${formatDate(project.updatedAt)}</span>
                <span>${getWordCount(project.content)} 文字</span>
            </div>
        </div>
    `;
}

// ===== Search and Filter Functions =====
function handleSearch(e) {
    searchQuery = e.target.value;
    document.getElementById('clearSearch').style.display = searchQuery ? 'flex' : 'none';
    renderDashboard();
}

function clearSearch() {
    searchQuery = '';
    document.getElementById('searchInput').value = '';
    document.getElementById('clearSearch').style.display = 'none';
    renderDashboard();
}

function handleStatusFilter(e) { statusFilter = e.target.value; renderDashboard(); }
function handleSort(e) { sortBy = e.target.value; renderDashboard(); }
function toggleArchivedView() {
    showArchived = !showArchived;
    document.getElementById('toggleArchived').style.opacity = showArchived ? '1' : '0.5';
    renderDashboard();
}

function toggleArchive(project) {
    const index = projects.findIndex(p => p.id === project.id);
    if (index !== -1) {
        if (projects[index].status === 'archived') {
            projects[index].status = projects[index].previousStatus || 'on-hold';
            delete projects[index].previousStatus;
        } else {
            projects[index].previousStatus = projects[index].status;
            projects[index].status = 'archived';
        }
        projects[index].updatedAt = new Date().toISOString();
        saveProjects();
        renderDashboard();
        showNotification(projects[index].status === 'archived' ? 'プロジェクトをアーカイブしました' : 'アーカイブを解除しました');
    }
}

// ===== Editor Functions =====
function showEditor(project = null, editMode = false) {
    document.getElementById('dashboardView').classList.remove('active');
    document.getElementById('editorView').classList.add('active');

    isEditMode = editMode;

    if (project) {
        currentProject = project;
        document.getElementById('projectTitle').value = project.title;
        document.getElementById('projectStatus').value = project.status;
        document.getElementById('projectTags').value = (project.tags || []).join(', ');
        document.getElementById('markdownEditor').value = project.content;
    } else {
        currentProject = null;
        isEditMode = true;
        document.getElementById('projectTitle').value = '';
        document.getElementById('projectStatus').value = 'planning';
        document.getElementById('projectTags').value = '';

        // デフォルトテンプレートをセット
        const template = `## プロジェクト概要
ここにプロジェクトの目的や背景を記入してください。

## 🎯 マイルストーン
- [ ] マイルストーン 1
- [ ] マイルストーン 2

## 📝 タスク一覧
- [ ] タスク A
- [ ] タスク B

## 📎 参考資料・リンク
- [Lunar Nova Documentation](https://lunar-nova.vercel.app)`;

        document.getElementById('markdownEditor').value = template;
    }

    updateEditorMode();
    updatePreview();
}

function viewProject(p) { showEditor(p, false); }
function editProject(p) { showEditor(p, true); }
function toggleEditMode() { isEditMode = !isEditMode; updateEditorMode(); }

function updateEditorMode() {
    const layout = document.querySelector('.editor-layout');
    const editorMeta = document.querySelector('.editor-meta');
    const saveBtn = document.getElementById('saveBtn');
    const editModeText = document.getElementById('editModeText');
    const editModeToggle = document.getElementById('editModeToggle');
    const previewPane = document.querySelector('.preview-pane');

    if (isEditMode) {
        layout.classList.remove('preview-only');
        editorMeta.classList.remove('readonly');
        saveBtn.style.display = 'inline-flex';
        editModeText.textContent = 'プレビューのみ';
        editModeToggle.querySelector('.btn-icon').textContent = '👁️';
        if (previewPane) previewPane.classList.remove('fullscreen');
    } else {
        layout.classList.add('preview-only');
        editorMeta.classList.add('readonly');
        saveBtn.style.display = 'none';
        editModeText.textContent = '編集モード';
        editModeToggle.querySelector('.btn-icon').textContent = '✏️';
        if (previewPane) previewPane.classList.add('fullscreen');
    }
}

function saveProject() {
    const title = document.getElementById('projectTitle').value.trim();
    const status = document.getElementById('projectStatus').value;
    const tagsInput = document.getElementById('projectTags').value;
    const content = document.getElementById('markdownEditor').value;

    if (!title) return alert('プロジェクト名を入力してください');

    const tags = tagsInput.split(',').map(tag => tag.trim()).filter(tag => tag.length > 0);
    const now = new Date().toISOString();

    if (currentProject) {
        const index = projects.findIndex(p => p.id === currentProject.id);
        if (index !== -1) {
            projects[index] = { ...projects[index], title, status, tags, content, updatedAt: now };
        }
    } else {
        projects.unshift({ id: generateId(), title, status, tags, content, createdAt: now, updatedAt: now });
    }

    saveProjects();
    showDashboard();
    showNotification('プロジェクトを保存しました');
}

function deleteProject(p) { currentProject = p; showModal('deleteModal'); }
function confirmDelete() {
    if (currentProject) {
        const index = projects.findIndex(p => p.id === currentProject.id);
        if (index !== -1) {
            projects.splice(index, 1);
            saveProjects();
            renderDashboard();
            showNotification('プロジェクトを削除しました');
        }
    }
    hideModal('deleteModal');
    currentProject = null;
}

function updatePreview() {
    const content = document.getElementById('markdownEditor').value;
    const preview = document.getElementById('markdownPreview');
    if (content.trim()) {
        preview.innerHTML = DOMPurify.sanitize(marked.parse(content));
    } else {
        preview.innerHTML = '<p class="preview-placeholder">ここにプレビューが表示されます</p>';
    }
}

// ===== Export/Import Functions =====
function toggleDropdown(id) { document.getElementById(id).classList.toggle('show'); }

function exportAllJson() {
    const dataStr = JSON.stringify(projects, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `lunar-nova-projects-${new Date().toISOString().split('T')[0]}.json`;
    link.click();
    URL.revokeObjectURL(url);
    toggleDropdown('exportMenu');
    showNotification('JSONを書き出しました');
}

function exportAllMarkdown() {
    let md = `# Lunar Nova プロジェクト一覧\n\n`;
    projects.forEach(p => {
        md += `## ${p.title} (${getStatusLabel(p.status)})\n\n${p.content}\n\n---\n\n`;
    });
    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `lunar-nova-export.md`;
    link.click();
    URL.revokeObjectURL(url);
    toggleDropdown('exportMenu');
    showNotification('Markdownを書き出しました');
}

function handleImport(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
        try {
            const data = JSON.parse(ev.target.result);
            if (!Array.isArray(data)) throw new Error();
            pendingImportData = data;
            document.getElementById('importMessage').textContent = `${data.length}個のプロジェクトをインポートします。`;
            showModal('importModal');
        } catch (err) {
            alert('不正なファイル形式です');
        }
    };
    reader.readAsText(file);
    e.target.value = '';
}

function confirmImport() {
    if (!pendingImportData) return;
    const mode = document.querySelector('input[name="importMode"]:checked').value;
    if (mode === 'replace') projects = pendingImportData;
    else projects = [...projects, ...pendingImportData];
    saveProjects();
    hideModal('importModal');
    pendingImportData = null;
    renderDashboard();
    showNotification('インポートしました');
}

// ===== Utils =====
function generateId() { return Date.now().toString(36) + Math.random().toString(36).substr(2); }
function escapeHtml(t) { const div = document.createElement('div'); div.textContent = t; return div.innerHTML; }
function getStatusLabel(s) {
    const labels = { 'planning': '計画中', 'active': '進行中', 'completed': '完了', 'on-hold': '保留', 'archived': 'アーカイブ' };
    return labels[s] || s;
}
function getTextPreview(text, max = 150) {
    let p = text.replace(/^#{1,6}\s+/gm, '').replace(/\*\*(.+?)\*\*/g, '$1').replace(/\*(.+?)\*/g, '$1').replace(/\n+/g, ' ').trim();
    return p.length > max ? p.substring(0, max) + '...' : p || '内容なし';
}
function getWordCount(t) { return t.length; }
function formatDate(iso) {
    const d = new Date(iso);
    const diff = new Date() - d;
    if (diff < 60000) return 'たった今';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}分前`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}時間前`;
    return d.toLocaleDateString('ja-JP');
}
function showModal(id) { document.getElementById(id).classList.add('show'); }
function hideModal(id) { document.getElementById(id).classList.remove('show'); }

function showNotification(message) {
    const n = document.createElement('div');
    n.style.cssText = `
        position: fixed; top: 20px; right: 20px;
        background: linear-gradient(135deg, #00d4ff 0%, #7c3aed 100%);
        color: white; padding: 1rem 1.5rem; border-radius: 0.75rem;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5); z-index: 10000;
        animation: slideIn 0.3s ease; font-family: 'Inter', sans-serif; font-weight: 500;
    `;
    n.textContent = message;
    document.body.appendChild(n);
    setTimeout(() => {
        n.style.animation = 'slideOut 0.3s ease';
        setTimeout(() => n.remove(), 300);
    }, 3000);
}

// CSS style for animation
const styleSheet = document.createElement("style");
styleSheet.innerText = `
    @keyframes slideIn { from { opacity: 0; transform: translateX(100px); } to { opacity: 1; transform: translateX(0); } }
    @keyframes slideOut { from { opacity: 1; transform: translateX(0); } to { opacity: 0; transform: translateX(100px); } }
    .syncing-animation { animation: rotate 1s linear infinite; display: inline-block; }
    @keyframes rotate { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
`;
document.head.appendChild(styleSheet);
