// ===== Lunar Nova: The Monolith Core =====
const APP_STATE = {
    projects: [],
    currentId: null,
    isEditorActive: false,
    user: null
};

// Config
const FIREBASE_CONFIG = {
    apiKey: "AIzaSyD2eFoJ7qDEQbHd2YVcPx6xGEushmN1vVk",
    authDomain: "lunar-nova-1223e.firebaseapp.com",
    projectId: "lunar-nova-1223e",
    storageBucket: "lunar-nova-1223e.firebasestorage.app",
    messagingSenderId: "1029952234254",
    appId: "1:1029952234254:web:e072800db543acf0966d5f"
};

let db, auth;
let saveTimeout = null;

// DOM Elements
const els = {};

document.addEventListener('DOMContentLoaded', () => {
    // Cache DOM
    els.sidebar = document.getElementById('sidebar');
    els.docList = document.getElementById('docList');
    els.previewLayer = document.getElementById('previewLayer');
    els.editorLayer = document.getElementById('editorLayer');
    els.markdownPreview = document.getElementById('markdownPreview');
    els.markdownEditor = document.getElementById('markdownEditor');
    els.docTitle = document.getElementById('docTitle');
    els.saveStatus = document.getElementById('saveStatus');
    els.modeSwitch = document.getElementById('modeSwitch'); // Add to cache
    els.emptyState = document.getElementById('emptyState');

    // Init Info
    initEvents();
    initFirebase();
});

// ===== Initialization & Sync =====
async function initFirebase() {
    if (!window.firebase) return;

    firebase.initializeApp(FIREBASE_CONFIG);
    db = firebase.firestore();
    auth = firebase.auth();

    const manualUid = localStorage.getItem('lunar-nova-manual-uid');

    try {
        if (manualUid) {
            APP_STATE.user = { uid: manualUid };
            console.log("SYNC ID:", manualUid);
        } else {
            const cred = await auth.signInAnonymously();
            APP_STATE.user = cred.user;
            console.log("ANON ID:", APP_STATE.user.uid);
        }

        await loadProjects();
    } catch (e) {
        console.error("Auth Error:", e);
        // Fallback to local storage if needed, but for now we rely on cloud logic structure
        loadProjectsLocal();
    }
}

async function loadProjects() {
    if (!APP_STATE.user) return loadProjectsLocal();

    try {
        const doc = await db.collection('users').doc(APP_STATE.user.uid).get();
        if (doc.exists && doc.data().projects) {
            APP_STATE.projects = doc.data().projects;
        }
    } catch (e) {
        console.error("Load Error:", e);
        loadProjectsLocal();
    }

    renderSidebar();

    // Auto-open first project or create initial
    if (APP_STATE.projects.length > 0) {
        openProject(APP_STATE.projects[0].id);
    } else {
        createNewProject();
    }
}

function loadProjectsLocal() {
    const local = localStorage.getItem('lunar-nova-projects');
    if (local) APP_STATE.projects = JSON.parse(local);
    renderSidebar();
}

async function saveAll() {
    // Save to Local
    localStorage.setItem('lunar-nova-projects', JSON.stringify(APP_STATE.projects));

    // Save to Cloud
    if (APP_STATE.user) {
        els.saveStatus.classList.remove('saved'); // blink
        try {
            await db.collection('users').doc(APP_STATE.user.uid).set({
                projects: APP_STATE.projects,
                updatedAt: new Date().toISOString()
            }, { merge: true });
            els.saveStatus.classList.add('saved');
        } catch (e) {
            console.error("Save failed:", e);
        }
    }
}

// ===== Core Logic =====
function createNewProject() {
    const newProj = {
        id: Date.now().toString(),
        title: 'Untitled Protocol',
        content: '# New Protocol\n\nStart typing...',
        updatedAt: new Date().toISOString()
    };
    APP_STATE.projects.unshift(newProj);
    saveAll();
    renderSidebar();
    openProject(newProj.id);
}

function openProject(id) {
    // If clicking the already open project, just ensure we go back to preview mode
    if (APP_STATE.currentId === id) {
        if (APP_STATE.isEditorActive) {
            switchMode('preview');
        }
        return;
    }

    APP_STATE.currentId = id;
    const project = APP_STATE.projects.find(p => p.id === id);
    if (!project) return;

    // UI Update
    els.docTitle.value = project.title;
    els.markdownEditor.value = project.content;
    renderPreview(project.content);

    // Sidebar highlight
    document.querySelectorAll('.doc-item').forEach(el => el.classList.remove('active'));
    document.getElementById(`doc-${id}`)?.classList.add('active');

    // Switch to preview mode
    switchMode('preview');
}

function renderSidebar() {
    els.docList.innerHTML = '';
    APP_STATE.projects.forEach(p => {
        const div = document.createElement('div');
        div.className = 'doc-item';
        div.id = `doc-${p.id}`;
        div.textContent = p.title || 'Untitled';
        div.onclick = () => openProject(p.id);
        els.docList.appendChild(div);
    });
}

function renderPreview(markdown) {
    if (!markdown) {
        els.markdownPreview.innerHTML = '';
        els.emptyState.style.display = 'flex';
        return;
    }
    els.emptyState.style.display = 'none';
    els.markdownPreview.innerHTML = marked.parse(markdown);

    // Checkbox interactivity in preview
    els.markdownPreview.querySelectorAll('input[type="checkbox"]').forEach((cb, idx) => {
        cb.disabled = false; // Allow clicking
        cb.addEventListener('change', () => {
            // Very naive implementation of updating checkbox in markdown source
            // Ideally we'd map line numbers, but for now we simply don't sync back 1-to-1 in this simple logic
            // To do this properly requires parsing the AST. 
            // For this minimalist version, we just let it be visual in preview or require edit mode.
            // Let's just re-enable edit mode if they click it.
            switchMode('editor');
        });
    });
}

// ===== Interaction & Modes =====
function switchMode(mode) {
    if (mode === 'editor') {
        els.previewLayer.style.display = 'none';
        els.editorLayer.style.display = 'block';
        els.markdownEditor.focus();
        APP_STATE.isEditorActive = true;

        // Update Switch Button
        els.modeSwitch.textContent = 'EDITING';
        els.modeSwitch.classList.add('active');
    } else {
        els.editorLayer.style.display = 'none';
        els.previewLayer.style.display = 'block';

        // Update content from editor before previewing
        const content = els.markdownEditor.value;
        const current = APP_STATE.projects.find(p => p.id === APP_STATE.currentId);
        if (current) {
            current.content = content;
            current.title = els.docTitle.value;
            current.updatedAt = new Date().toISOString();
            renderPreview(content);
            saveAll();
        }
        APP_STATE.isEditorActive = false;

        // Update Switch Button
        els.modeSwitch.textContent = 'VIEW';
        els.modeSwitch.classList.remove('active');
    }
}

function initEvents() {
    // Mode Switch Button
    els.modeSwitch.addEventListener('click', () => {
        switchMode(APP_STATE.isEditorActive ? 'preview' : 'editor');
    });

    // Double click to Edit
    els.previewLayer.addEventListener('dblclick', () => switchMode('editor'));

    // Toggle Sidebar
    document.getElementById('toggleSidebar').addEventListener('click', () => {
        els.sidebar.classList.toggle('expanded');
    });

    // New Doc
    document.getElementById('newDocBtn').addEventListener('click', createNewProject);

    // Save on blur or pause
    els.markdownEditor.addEventListener('input', () => {
        clearTimeout(saveTimeout);
        saveTimeout = setTimeout(() => {
            const current = APP_STATE.projects.find(p => p.id === APP_STATE.currentId);
            if (current) {
                current.content = els.markdownEditor.value;
                // No full saveAll yet, just memory update
            }
        }, 500);
    });

    // Exit edit mode (Cmd+Enter or Escape?) Let's use Double Click to exit? No, Esc is better.
    els.markdownEditor.addEventListener('keydown', (e) => {
        if ((e.metaKey || e.ctrlKey) && e.key === 's') {
            e.preventDefault();
            switchMode('preview');
        }
        if (e.key === 'Escape') {
            switchMode('preview');
        }
    });

    // Title editing
    els.docTitle.addEventListener('dblclick', () => {
        els.docTitle.readOnly = false;
        els.docTitle.classList.add('editable');
        els.docTitle.focus();
    });

    els.docTitle.addEventListener('blur', () => {
        els.docTitle.readOnly = true;
        els.docTitle.classList.remove('editable');
        const current = APP_STATE.projects.find(p => p.id === APP_STATE.currentId);
        if (current) {
            current.title = els.docTitle.value;
            saveAll();
            renderSidebar();
        }
    });

    // Sync UI
    const modal = document.getElementById('firebaseModal');
    document.getElementById('syncBtn').addEventListener('click', () => {
        modal.classList.add('show');
        document.getElementById('firebaseApiKey').value = APP_STATE.user ? APP_STATE.user.uid : 'LOADING...';
    });
    document.getElementById('closeFirebase').addEventListener('click', () => modal.classList.remove('show'));

    document.getElementById('saveFirebase').addEventListener('click', () => {
        const id = document.getElementById('manualSyncId').value;
        if (id) {
            localStorage.setItem('lunar-nova-manual-uid', id);
            location.reload();
        }
    });

    document.getElementById('copySyncIdBtn').addEventListener('click', () => {
        const field = document.getElementById('firebaseApiKey');
        field.select();
        document.execCommand('copy');
        alert('COPIED');
    });
}
