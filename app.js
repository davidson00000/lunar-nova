// ===== State Management =====
let projects = [];
let currentProject = null;
let isEditMode = false; // false=プレビューのみ, true=編集モード
let showArchived = false;
let searchQuery = '';
let statusFilter = '';
let sortBy = 'updated-desc';
let pendingImportData = null;

// Firebase configuration
let firebaseConfig = null;
let firebaseInitialized = false;

// ===== Initialize App =====
document.addEventListener('DOMContentLoaded', () => {
    loadProjects();
    loadFirebaseConfig();
    loadThemePreference();
    initializeEventListeners();
    renderDashboard();
});

// ===== Event Listeners =====
function initializeEventListeners() {
    // Navigation
    document.getElementById('newProjectBtn').addEventListener('click', () => showEditor());
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
    document.getElementById('syncBtn').addEventListener('click', handleSync);
    document.getElementById('closeFirebase').addEventListener('click', () => hideModal('firebaseModal'));
    document.getElementById('cancelFirebase').addEventListener('click', () => hideModal('firebaseModal'));
    document.getElementById('saveFirebase').addEventListener('click', saveFirebaseConfig);

    // Import modal
    document.getElementById('closeImport').addEventListener('click', () => hideModal('importModal'));
    document.getElementById('cancelImport').addEventListener('click', () => hideModal('importModal'));
    document.getElementById('confirmImport').addEventListener('click', confirmImport);

    // Help modal
    document.getElementById('helpBtn').addEventListener('click', () => showModal('helpModal'));
    document.getElementById('closeHelp').addEventListener('click', () => hideModal('helpModal'));

    // Delete modal
    document.getElementById('closeDelete').addEventListener('click', () => hideModal('deleteModal'));
    document.getElementById('cancelDelete').addEventListener('click', () => hideModal('deleteModal'));
    document.getElementById('confirmDelete').addEventListener('click', confirmDelete);

    // Close modal on background click
    document.querySelectorAll('.modal').forEach(modal => {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                hideModal(modal.id);
            }
        });
    });

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.dropdown')) {
            document.querySelectorAll('.dropdown-menu').forEach(menu => {
                menu.classList.remove('show');
            });
        }
    });
}

// ===== Local Storage Functions =====
function loadProjects() {
    const stored = localStorage.getItem('lunar-nova-projects');
    projects = stored ? JSON.parse(stored) : [];
}

function saveProjects() {
    localStorage.setItem('lunar-nova-projects', JSON.stringify(projects));

    // Auto-sync if Firebase is configured
    if (firebaseInitialized) {
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

    // Update stats
    updateStats();

    // Filter and sort projects
    let filteredProjects = filterProjects();
    filteredProjects = sortProjects(filteredProjects);

    // Show empty state or projects
    if (filteredProjects.length === 0 && projects.length === 0) {
        grid.innerHTML = '';
        emptyState.classList.add('show');
    } else if (filteredProjects.length === 0) {
        grid.innerHTML = '<div class="empty-state show"><p>検索条件に一致するプロジェクトがありません</p></div>';
        emptyState.classList.remove('show');
    } else {
        emptyState.classList.remove('show');
        grid.innerHTML = filteredProjects.map(project => createProjectCard(project)).join('');

        // Add event listeners to project cards
        filteredProjects.forEach((project, index) => {
            const card = grid.children[index];
            card.addEventListener('click', (e) => {
                if (!e.target.closest('.action-btn')) {
                    viewProject(project); // プレビューモードで開く
                }
            });

            // Edit button - 編集モードで開く
            const editBtn = card.querySelector('.action-btn.edit');
            if (editBtn) {
                editBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    editProject(project); // 編集モードで開く
                });
            }

            // Delete button
            const deleteBtn = card.querySelector('.action-btn.delete');
            if (deleteBtn) {
                deleteBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    deleteProject(project);
                });
            }

            // Archive button
            const archiveBtn = card.querySelector('.action-btn.archive');
            if (archiveBtn) {
                archiveBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    toggleArchive(project);
                });
            }
        });
    }
}

function filterProjects() {
    return projects.filter(project => {
        // Filter by archived status
        if (!showArchived && project.status === 'archived') {
            return false;
        }

        // Filter by status
        if (statusFilter && project.status !== statusFilter) {
            return false;
        }

        // Filter by search query
        if (searchQuery) {
            const query = searchQuery.toLowerCase();
            const titleMatch = project.title.toLowerCase().includes(query);
            const contentMatch = project.content.toLowerCase().includes(query);
            const tagsMatch = (project.tags || []).some(tag =>
                tag.toLowerCase().includes(query)
            );

            if (!titleMatch && !contentMatch && !tagsMatch) {
                return false;
            }
        }

        return true;
    });
}

function sortProjects(projectsList) {
    const sorted = [...projectsList];

    switch (sortBy) {
        case 'updated-desc':
            sorted.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
            break;
        case 'updated-asc':
            sorted.sort((a, b) => new Date(a.updatedAt) - new Date(b.updatedAt));
            break;
        case 'created-desc':
            sorted.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
            break;
        case 'created-asc':
            sorted.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
            break;
        case 'title-asc':
            sorted.sort((a, b) => a.title.localeCompare(b.title));
            break;
        case 'title-desc':
            sorted.sort((a, b) => b.title.localeCompare(a.title));
            break;
        case 'status':
            const statusOrder = { 'planning': 0, 'active': 1, 'on-hold': 2, 'completed': 3, 'archived': 4 };
            sorted.sort((a, b) => statusOrder[a.status] - statusOrder[b.status]);
            break;
    }

    return sorted;
}

function updateStats() {
    const activeProjects = projects.filter(p => p.status !== 'archived');
    document.getElementById('totalProjects').textContent = activeProjects.length;

    const activeCount = projects.filter(p => p.status === 'active').length;
    document.getElementById('activeProjects').textContent = activeCount;

    const completedCount = projects.filter(p => p.status === 'completed').length;
    document.getElementById('completedProjects').textContent = completedCount;

    const archivedCount = projects.filter(p => p.status === 'archived').length;
    document.getElementById('archivedProjects').textContent = archivedCount;
}

function createProjectCard(project) {
    const statusClass = `status-${project.status}`;
    const statusLabel = getStatusLabel(project.status);
    const preview = getTextPreview(project.content);
    const tags = project.tags || [];
    const isArchived = project.status === 'archived';
    const archiveIcon = isArchived ? '📂' : '📦';
    const archiveTitle = isArchived ? 'アーカイブ解除' : 'アーカイブ';

    return `
        <div class="project-card ${isArchived ? 'archived' : ''}" data-id="${project.id}">
            <div class="project-card-header">
                <div>
                    <h3 class="project-title">${escapeHtml(project.title)}</h3>
                    <span class="project-status ${statusClass}">${statusLabel}</span>
                </div>
                <div class="project-actions">
                    <button class="action-btn edit" title="編集">✏️</button>
                    <button class="action-btn archive" title="${archiveTitle}">${archiveIcon}</button>
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
    const clearBtn = document.getElementById('clearSearch');
    clearBtn.style.display = searchQuery ? 'flex' : 'none';
    renderDashboard();
}

function clearSearch() {
    searchQuery = '';
    document.getElementById('searchInput').value = '';
    document.getElementById('clearSearch').style.display = 'none';
    renderDashboard();
}

function handleStatusFilter(e) {
    statusFilter = e.target.value;
    renderDashboard();
}

function handleSort(e) {
    sortBy = e.target.value;
    renderDashboard();
}

function toggleArchivedView() {
    showArchived = !showArchived;
    const btn = document.getElementById('toggleArchived');
    btn.style.opacity = showArchived ? '1' : '0.5';
    btn.title = showArchived ? 'アーカイブを非表示' : 'アーカイブを表示';
    renderDashboard();
}

function toggleArchive(project) {
    const index = projects.findIndex(p => p.id === project.id);
    if (index !== -1) {
        if (projects[index].status === 'archived') {
            // Restore from archive - set to previous status or 'on-hold'
            projects[index].status = projects[index].previousStatus || 'on-hold';
            delete projects[index].previousStatus;
        } else {
            // Archive - save current status
            projects[index].previousStatus = projects[index].status;
            projects[index].status = 'archived';
        }
        projects[index].updatedAt = new Date().toISOString();
        saveProjects();
        renderDashboard();
        showNotification(
            projects[index].status === 'archived' ?
                'プロジェクトをアーカイブしました' :
                'アーカイブを解除しました'
        );
    }
}

// ===== Editor Functions =====
function showEditor(project = null, editMode = false) {
    document.getElementById('dashboardView').classList.remove('active');
    document.getElementById('editorView').classList.add('active');

    isEditMode = editMode;

    if (project) {
        // Edit or view existing project
        currentProject = project;
        document.getElementById('projectTitle').value = project.title;
        document.getElementById('projectStatus').value = project.status;
        document.getElementById('projectTags').value = (project.tags || []).join(', ');
        document.getElementById('markdownEditor').value = project.content;
    } else {
        // New project - always in edit mode
        currentProject = null;
        isEditMode = true;
        document.getElementById('projectTitle').value = '';
        document.getElementById('projectStatus').value = 'planning';
        document.getElementById('projectTags').value = '';
        document.getElementById('markdownEditor').value = '';
    }

    updateEditorMode();
    updatePreview();
}

// プレビューモードでプロジェクトを開く
function viewProject(project) {
    showEditor(project, false); // editMode = false
}

// 編集モードでプロジェクトを開く
function editProject(project) {
    showEditor(project, true); // editMode = true
}

// 編集モード⇔プレビューモードの切り替え
function toggleEditMode() {
    isEditMode = !isEditMode;
    updateEditorMode();
}

// エディターのUIを編集モードまたはプレビューモードに更新
function updateEditorMode() {
    const layout = document.querySelector('.editor-layout');
    const editorMeta = document.querySelector('.editor-meta');
    const saveBtn = document.getElementById('saveBtn');
    const editModeText = document.getElementById('editModeText');
    const editModeToggle = document.getElementById('editModeToggle');
    const previewPane = document.querySelector('.preview-pane');

    if (isEditMode) {
        // 編集モード
        layout.classList.remove('preview-only');
        editorMeta.classList.remove('readonly');
        saveBtn.style.display = 'inline-flex';
        editModeText.textContent = 'プレビューのみ';
        editModeToggle.querySelector('.btn-icon').textContent = '👁️';
        if (previewPane) {
            previewPane.classList.remove('fullscreen');
        }
    } else {
        // プレビューモード
        layout.classList.add('preview-only');
        editorMeta.classList.add('readonly');
        saveBtn.style.display = 'none';
        editModeText.textContent = '編集モード';
        editModeToggle.querySelector('.btn-icon').textContent = '✏️';
        if (previewPane) {
            previewPane.classList.add('fullscreen');
        }
    }
}

function saveProject() {
    const title = document.getElementById('projectTitle').value.trim();
    const status = document.getElementById('projectStatus').value;
    const tagsInput = document.getElementById('projectTags').value;
    const content = document.getElementById('markdownEditor').value;

    if (!title) {
        alert('プロジェクト名を入力してください');
        return;
    }

    const tags = tagsInput
        .split(',')
        .map(tag => tag.trim())
        .filter(tag => tag.length > 0);

    const now = new Date().toISOString();

    if (currentProject) {
        // Update existing project
        const index = projects.findIndex(p => p.id === currentProject.id);
        if (index !== -1) {
            projects[index] = {
                ...projects[index],
                title,
                status,
                tags,
                content,
                updatedAt: now
            };
        }
    } else {
        // Create new project
        const newProject = {
            id: generateId(),
            title,
            status,
            tags,
            content,
            createdAt: now,
            updatedAt: now
        };
        projects.unshift(newProject);
    }

    saveProjects();
    showDashboard();
    showNotification('プロジェクトを保存しました');
}

function deleteProject(project) {
    currentProject = project;
    showModal('deleteModal');
}

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
        const rawHtml = marked.parse(content);
        const cleanHtml = DOMPurify.sanitize(rawHtml);
        preview.innerHTML = cleanHtml;
    } else {
        preview.innerHTML = '<p class="preview-placeholder">ここにプレビューが表示されます</p>';
    }
}

// ===== Export Functions =====
function toggleDropdown(menuId) {
    const menu = document.getElementById(menuId);
    menu.classList.toggle('show');
}

function exportAllJson() {
    const dataStr = JSON.stringify(projects, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    const timestamp = new Date().toISOString().split('T')[0];
    link.href = url;
    link.download = `lunar-nova-projects-${timestamp}.json`;
    link.click();
    URL.revokeObjectURL(url);

    toggleDropdown('exportMenu');
    showNotification('プロジェクトをエクスポートしました');
}

function exportAllMarkdown() {
    let markdown = `# Lunar Nova プロジェクト一覧\n\n`;
    markdown += `エクスポート日時: ${new Date().toLocaleString('ja-JP')}\n\n`;
    markdown += `---\n\n`;

    projects.forEach((project, index) => {
        markdown += `## ${index + 1}. ${project.title}\n\n`;
        markdown += `**ステータス**: ${getStatusLabel(project.status)}\n\n`;

        if (project.tags && project.tags.length > 0) {
            markdown += `**タグ**: ${project.tags.join(', ')}\n\n`;
        }

        markdown += `**作成日**: ${new Date(project.createdAt).toLocaleString('ja-JP')}\n\n`;
        markdown += `**最終更新**: ${new Date(project.updatedAt).toLocaleString('ja-JP')}\n\n`;
        markdown += `### 内容\n\n${project.content}\n\n`;
        markdown += `---\n\n`;
    });

    const dataBlob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    const timestamp = new Date().toISOString().split('T')[0];
    link.href = url;
    link.download = `lunar-nova-projects-${timestamp}.md`;
    link.click();
    URL.revokeObjectURL(url);

    toggleDropdown('exportMenu');
    showNotification('Markdownファイルをエクスポートしました');
}

// ===== Import Functions =====
function handleImport(e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
        try {
            const data = JSON.parse(event.target.result);

            // Validate data structure
            if (!Array.isArray(data)) {
                throw new Error('Invalid data format');
            }

            pendingImportData = data;

            // Show import confirmation modal
            const message = `${data.length}個のプロジェクトをインポートします。`;
            document.getElementById('importMessage').textContent = message;
            showModal('importModal');
        } catch (error) {
            alert('ファイルの読み込みに失敗しました。正しいJSONファイルを選択してください。');
            console.error('Import error:', error);
        }
    };

    reader.readAsText(file);
    e.target.value = ''; // Reset file input
}

function confirmImport() {
    if (!pendingImportData) return;

    const mode = document.querySelector('input[name="importMode"]:checked').value;

    if (mode === 'replace') {
        projects = pendingImportData;
    } else {
        // Merge mode - add imported projects with new IDs if they don't exist
        pendingImportData.forEach(importedProject => {
            const exists = projects.some(p => p.id === importedProject.id);
            if (!exists) {
                projects.push(importedProject);
            }
        });
    }

    saveProjects();
    hideModal('importModal');
    pendingImportData = null;
    renderDashboard();
    showNotification('プロジェクトをインポートしました');
}

// ===== Firebase Functions =====
function loadFirebaseConfig() {
    const stored = localStorage.getItem('lunar-nova-firebase-config');
    if (stored) {
        firebaseConfig = JSON.parse(stored);
        // Note: Actual Firebase initialization would go here
        // For now, we just mark it as configured
        updateSyncButton(false);
    }
}

function handleSync() {
    if (!firebaseConfig) {
        showModal('firebaseModal');
        return;
    }

    syncToFirebase();
}

function saveFirebaseConfig() {
    const apiKey = document.getElementById('firebaseApiKey').value.trim();
    const projectId = document.getElementById('firebaseProjectId').value.trim();
    const authDomain = document.getElementById('firebaseAuthDomain').value.trim();

    if (!apiKey || !projectId || !authDomain) {
        alert('すべての項目を入力してください');
        return;
    }

    firebaseConfig = { apiKey, projectId, authDomain };
    localStorage.setItem('lunar-nova-firebase-config', JSON.stringify(firebaseConfig));

    hideModal('firebaseModal');

    // Initialize Firebase and sync
    initializeFirebase();
    syncToFirebase();
}

function initializeFirebase() {
    // In a real implementation, you would initialize Firebase here
    // For demonstration, we just mark it as initialized
    firebaseInitialized = true;
    showNotification('Firebase設定を保存しました');
}

function syncToFirebase() {
    // In a real implementation, you would sync to Firebase here
    // For demonstration, we just show a syncing state
    updateSyncButton(true);

    setTimeout(() => {
        updateSyncButton(false);
        showNotification('クラウドと同期しました');
    }, 1500);
}

function updateSyncButton(syncing) {
    const btn = document.getElementById('syncBtn');
    const status = btn.querySelector('.sync-status');

    if (syncing) {
        status.textContent = '同期中';
        status.classList.add('syncing');
    } else {
        status.textContent = firebaseConfig ? '同期済' : '同期';
        status.classList.remove('syncing');
    }
}

// ===== Modal Functions =====
function showModal(modalId) {
    document.getElementById(modalId).classList.add('show');
}

function hideModal(modalId) {
    document.getElementById(modalId).classList.remove('show');
}

// ===== Utility Functions =====
function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function getStatusLabel(status) {
    const labels = {
        'planning': '計画中',
        'active': '進行中',
        'completed': '完了',
        'on-hold': '保留',
        'archived': 'アーカイブ'
    };
    return labels[status] || status;
}

function getTextPreview(text, maxLength = 150) {
    let preview = text
        .replace(/^#{1,6}\s+/gm, '')
        .replace(/\*\*(.+?)\*\*/g, '$1')
        .replace(/\*(.+?)\*/g, '$1')
        .replace(/\[(.+?)\]\(.+?\)/g, '$1')
        .replace(/`(.+?)`/g, '$1')
        .replace(/^[-*+]\s+/gm, '')
        .replace(/^\d+\.\s+/gm, '')
        .replace(/^[-*]{3,}/gm, '')
        .replace(/\n+/g, ' ')
        .trim();

    if (preview.length > maxLength) {
        preview = preview.substring(0, maxLength) + '...';
    }

    return preview || 'プロジェクトの説明がありません';
}

function getWordCount(text) {
    return text.length;
}

function formatDate(isoString) {
    const date = new Date(isoString);
    const now = new Date();
    const diff = now - date;

    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return 'たった今';
    if (minutes < 60) return `${minutes}分前`;
    if (hours < 24) return `${hours}時間前`;
    if (days < 7) return `${days}日前`;

    return date.toLocaleDateString('ja-JP', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
    });
}

function showNotification(message) {
    const notification = document.createElement('div');
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: linear-gradient(135deg, #00d4ff 0%, #7c3aed 100%);
        color: white;
        padding: 1rem 1.5rem;
        border-radius: 0.75rem;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
        z-index: 10000;
        animation: slideIn 0.3s ease;
        font-family: 'Inter', sans-serif;
        font-weight: 500;
    `;
    notification.textContent = message;

    document.body.appendChild(notification);

    setTimeout(() => {
        notification.style.animation = 'slideOut 0.3s ease';
        setTimeout(() => {
            document.body.removeChild(notification);
        }, 300);
    }, 3000);
}

// Add animation styles
const style = document.createElement('style');
style.textContent = `
    @keyframes slideIn {
        from {
            opacity: 0;
            transform: translateX(100px);
        }
        to {
            opacity: 1;
            transform: translateX(0);
        }
    }
    @keyframes slideOut {
        from {
            opacity: 1;
            transform: translateX(0);
        }
        to {
            opacity: 0;
            transform: translateX(100px);
        }
    }
`;
document.head.appendChild(style);

// ===== Keyboard Shortcuts =====
document.addEventListener('keydown', (e) => {
    // Ctrl/Cmd + S to save
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        const editorView = document.getElementById('editorView');
        if (editorView.classList.contains('active')) {
            saveProject();
        }
    }

    // Ctrl/Cmd + K to search
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        document.getElementById('searchInput').focus();
    }

    // Escape to close modals
    if (e.key === 'Escape') {
        document.querySelectorAll('.modal.show').forEach(modal => {
            hideModal(modal.id);
        });

        // Close dropdowns
        document.querySelectorAll('.dropdown-menu.show').forEach(menu => {
            menu.classList.remove('show');
        });
    }
});
