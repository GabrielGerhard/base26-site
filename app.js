// ============================================================
//  BASE26 — app.js
//  Firebase: Auth + Firestore + Storage
// ============================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
    getAuth,
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
    signOut,
    onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
    getFirestore,
    doc, getDoc, setDoc, updateDoc, deleteDoc,
    collection, addDoc, getDocs, onSnapshot,
    query, orderBy, limit, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import {
    getStorage,
    ref,
    uploadBytesResumable,
    getDownloadURL
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";

// ── CONFIGURAÇÃO DO FIREBASE ──────────────────────────────────
const firebaseConfig = {
    apiKey: "AIzaSyAMa44h2rG1_Ya6oMVUGIvNY9uCPA2yzyk",
    authDomain: "base26-4df67.firebaseapp.com",
  projectId: "base26-4df67",
  storageBucket: "base26-4df67.firebasestorage.app",
  messagingSenderId: "386966718340",
  appId: "1:386966718340:web:e7bb1020e7d346a5d9bfd1",
  measurementId: "G-N7S957QLN2"
};

const app     = initializeApp(firebaseConfig);
const auth    = getAuth(app);
const db      = getFirestore(app);
const storage = getStorage(app);

// ── ESTADO GLOBAL ─────────────────────────────────────────────
let usuarioLogado    = null;
let unsubscribeChat  = null;
let eventoEmEdicaoId = null;

// ── UPLOAD COM COMPRESSÃO E PROGRESSO ────────────────────────
// Comprime a imagem via Canvas (máx 1200px, qualidade 0.82) antes de enviar
function comprimirImagem(file, maxPx = 1200, quality = 0.82) {
    return new Promise((resolve) => {
        const img = new Image();
        const url = URL.createObjectURL(file);
        img.onload = () => {
            URL.revokeObjectURL(url);
            let { width, height } = img;
            if (width > maxPx || height > maxPx) {
                if (width > height) { height = Math.round(height * maxPx / width); width = maxPx; }
                else                { width  = Math.round(width  * maxPx / height); height = maxPx; }
            }
            const canvas = document.createElement('canvas');
            canvas.width = width; canvas.height = height;
            canvas.getContext('2d').drawImage(img, 0, 0, width, height);
            canvas.toBlob(resolve, 'image/jpeg', quality);
        };
        img.src = url;
    });
}

// Faz upload de um File para o Storage e retorna a URL pública
function uploadImagem(file, caminho, onProgress = null) {
    return new Promise(async (resolve, reject) => {
        try {
            const blob       = await comprimirImagem(file);
            const storageRef = ref(storage, caminho);
            const task       = uploadBytesResumable(storageRef, blob, { contentType: 'image/jpeg' });

            task.on('state_changed',
                (snapshot) => {
                    if (onProgress) {
                        const pct = Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100);
                        onProgress(pct);
                    }
                },
                reject,
                async () => resolve(await getDownloadURL(task.snapshot.ref))
            );
        } catch (err) { reject(err); }
    });
}

// ── BARRA DE PROGRESSO ────────────────────────────────────────
function mostrarProgresso(parentEl, texto = 'Enviando imagens...') {
    removerProgresso();
    const wrapper = document.createElement('div');
    wrapper.id = 'upload-progress-wrapper';
    wrapper.style.cssText = 'width:100%;background:var(--bg-base);border-radius:4px;overflow:hidden;margin-top:10px;';
    wrapper.innerHTML = `
        <div id="upload-progress-bar"
             style="height:4px;width:0%;background:var(--blue);transition:width 0.25s;"></div>
        <p id="upload-progress-text"
           style="font-size:0.75rem;color:var(--text-muted);text-align:center;padding:5px 0;">${texto}</p>`;
    parentEl.appendChild(wrapper);
}
function atualizarProgresso(pct, label) {
    const bar  = document.getElementById('upload-progress-bar');
    const text = document.getElementById('upload-progress-text');
    if (bar)  bar.style.width  = pct + '%';
    if (text) text.textContent = label;
}
function removerProgresso() {
    document.getElementById('upload-progress-wrapper')?.remove();
}

// ── HELPERS DE UI ─────────────────────────────────────────────
function mostrarErro(elementId, msg) {
    const el = document.getElementById(elementId);
    el.textContent = msg;
    el.classList.add('visible');
}
function limparErro(elementId) {
    const el = document.getElementById(elementId);
    el.textContent = '';
    el.classList.remove('visible');
}
function setBtnLoading(btnId, loading, textoOriginal) {
    const btn = document.getElementById(btnId);
    if (!btn) return;
    btn.disabled    = loading;
    btn.textContent = loading ? 'Aguarde...' : textoOriginal;
}

// ── TROCA ENTRE LOGIN E REGISTRO ──────────────────────────────
document.getElementById('go-to-register').addEventListener('click', () => {
    document.getElementById('login-card').classList.add('hidden');
    document.getElementById('register-card').classList.remove('hidden');
    limparErro('login-error');
});
document.getElementById('go-to-login').addEventListener('click', () => {
    document.getElementById('register-card').classList.add('hidden');
    document.getElementById('login-card').classList.remove('hidden');
    limparErro('register-error');
});

// ── REGISTRO ──────────────────────────────────────────────────
document.getElementById('btn-register').addEventListener('click', async () => {
    limparErro('register-error');
    const nome  = document.getElementById('reg-nome').value.trim();
    const email = document.getElementById('reg-email').value.trim();
    const senha = document.getElementById('reg-password').value;
    const carro = document.getElementById('reg-carro').value.trim();

    if (!nome || !email || !senha || !carro) {
        mostrarErro('register-error', 'Preencha todos os campos.'); return;
    }
    if (senha.length < 6) {
        mostrarErro('register-error', 'A senha precisa ter ao menos 6 caracteres.'); return;
    }

    setBtnLoading('btn-register', true, 'Enviar Solicitação');
    try {
        const cred = await createUserWithEmailAndPassword(auth, email, senha);
        const uid  = cred.user.uid;
        const tag  = '#' + String(Math.floor(Math.random() * 9000) + 1000);

        await setDoc(doc(db, 'usuarios', uid), {
            nome, email, tag,
            isAdmin: false, aprovado: false, cargo: '',
            themeColor: '#e63946', bio: '', bannerImg: 'none',
            avatar: `https://ui-avatars.com/api/?name=${encodeURIComponent(nome)}&background=e63946&color=fff`,
            carro: { modelo: carro, ano: '', specs: '', fotoThumb: '' },
            galeria: [], criadoEm: serverTimestamp()
        });
    } catch (err) {
        const msgs = {
            'auth/email-already-in-use': 'Este e-mail já está cadastrado.',
            'auth/invalid-email':        'E-mail inválido.',
            'auth/weak-password':        'Senha fraca (mín. 6 caracteres).'
        };
        mostrarErro('register-error', msgs[err.code] || err.message);
        setBtnLoading('btn-register', false, 'Enviar Solicitação');
    }
});

// ── LOGIN ─────────────────────────────────────────────────────
document.getElementById('btn-login').addEventListener('click', async () => {
    limparErro('login-error');
    const email = document.getElementById('login-email').value.trim();
    const senha = document.getElementById('login-password').value;

    if (!email || !senha) { mostrarErro('login-error', 'Preencha e-mail e senha.'); return; }

    setBtnLoading('btn-login', true, 'Entrar na Garagem');
    try {
        await signInWithEmailAndPassword(auth, email, senha);
    } catch (err) {
        const msgs = {
            'auth/user-not-found':     'Nenhuma conta com este e-mail.',
            'auth/wrong-password':     'Senha incorreta.',
            'auth/invalid-credential': 'E-mail ou senha incorretos.',
            'auth/too-many-requests':  'Muitas tentativas. Tente mais tarde.'
        };
        mostrarErro('login-error', msgs[err.code] || err.message);
        setBtnLoading('btn-login', false, 'Entrar na Garagem');
    }
});
document.getElementById('login-password').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') document.getElementById('btn-login').click();
});

// ── LOGOUT ────────────────────────────────────────────────────
async function fazerLogout() {
    if (unsubscribeChat) unsubscribeChat();
    await signOut(auth);
}
document.getElementById('btn-logout').addEventListener('click', fazerLogout);
document.getElementById('btn-pending-logout').addEventListener('click', fazerLogout);

// ── OBSERVADOR DE AUTENTICAÇÃO ────────────────────────────────
onAuthStateChanged(auth, async (firebaseUser) => {
    if (!firebaseUser) {
        mostrarTela('auth');
        setBtnLoading('btn-login',    false, 'Entrar na Garagem');
        setBtnLoading('btn-register', false, 'Enviar Solicitação');
        return;
    }
    const snap = await getDoc(doc(db, 'usuarios', firebaseUser.uid));
    if (!snap.exists()) { await signOut(auth); return; }

    const dados = snap.data();
    usuarioLogado = { id: firebaseUser.uid, ...dados };

    if (!dados.aprovado) { mostrarTela('pending'); return; }
    iniciarApp();
});

function mostrarTela(tela) {
    ['auth-section', 'pending-section', 'app-container'].forEach(id =>
        document.getElementById(id).classList.add('hidden'));
    const map = { auth: 'auth-section', pending: 'pending-section', app: 'app-container' };
    document.getElementById(map[tela]).classList.remove('hidden');
}

// ── INÍCIO DO APP ─────────────────────────────────────────────
function iniciarApp() {
    mostrarTela('app');
    atualizarSidebar();
    renderizarTudo();
    iniciarChatListener();
    if (usuarioLogado.isAdmin) {
        document.getElementById('admin-nav-title').style.display = '';
        document.getElementById('admin-nav-btn').classList.remove('hidden');
        document.getElementById('btn-new-event').classList.remove('hidden');
    }
}
function atualizarSidebar() {
    document.getElementById('sidebar-name').textContent = usuarioLogado.nome   || 'Usuário';
    document.getElementById('sidebar-tag').textContent  = usuarioLogado.tag    || '#----';
    document.getElementById('sidebar-avatar').src       = usuarioLogado.avatar || '';
}

// ── NAVEGAÇÃO ─────────────────────────────────────────────────
const navButtons = document.querySelectorAll('.nav-btn');
const pageTitle  = document.getElementById('current-page-title');
const footer     = document.getElementById('site-footer');

navButtons.forEach(btn => {
    btn.addEventListener('click', (e) => {
        navButtons.forEach(b => b.classList.remove('active'));
        e.currentTarget.classList.add('active');
        document.querySelectorAll('.app-section').forEach(s => s.classList.add('hidden'));
        const targetId = e.currentTarget.getAttribute('data-target');
        document.getElementById(targetId).classList.remove('hidden');
        pageTitle.innerHTML = `<span class="hash">#</span> ${e.currentTarget.getAttribute('data-title')}`;
        footer.classList.toggle('hidden', targetId === 'chat-section');
        fecharMenu();
    });
});

document.getElementById('open-sidebar').addEventListener('click', () => {
    document.getElementById('sidebar').classList.add('open');
    document.getElementById('sidebar-overlay').classList.add('active');
});
const fecharMenu = () => {
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('sidebar-overlay').classList.remove('active');
};
document.getElementById('close-sidebar').addEventListener('click', fecharMenu);
document.getElementById('sidebar-overlay').addEventListener('click', fecharMenu);

// ── HELPERS DE CARGO ──────────────────────────────────────────
function obterCargo(u) {
    if (u.cargo === '🛠️ Criador')   return { classe: 'creator-badge',   texto: '🛠️ Criador' };
    if (u.cargo === '👑 Presidente') return { classe: 'president-badge', texto: '👑 Presidente' };
    if (u.isAdmin)                   return { classe: 'admin-badge',     texto: '🛡️ Diretoria' };
    return { classe: 'member-badge', texto: '🚗 Membro' };
}

// ── RENDERIZADORES ────────────────────────────────────────────
async function renderizarTudo() {
    await Promise.all([
        renderizarGaragem(), renderizarMembros(), renderizarEventos(),
        renderizarMeuPerfilTab(), renderizarAdminPanel()
    ]);
}

async function renderizarGaragem() {
    const grid = document.getElementById('cars-grid');
    grid.innerHTML = '<p class="text-muted">Carregando garagem...</p>';
    const snap = await getDocs(collection(db, 'usuarios'));
    grid.innerHTML = '';
    snap.forEach(docSnap => {
        const data = docSnap.data();
        if (!data.aprovado || !data.carro?.modelo) return;
        const imgSrc = (data.bannerImg && data.bannerImg !== 'none')
            ? data.bannerImg
            : (data.carro.fotoThumb || 'https://via.placeholder.com/400x200?text=Sem+foto');
        const card = document.createElement('div');
        card.className = 'car-card';
        card.innerHTML = `
            <img src="${imgSrc}" class="car-image" loading="lazy"
                 onerror="this.src='https://via.placeholder.com/400x200?text=Sem+foto'">
            <div class="car-info">
                <h3>${data.carro.modelo}</h3>
                <p class="text-muted">${data.nome}</p>
            </div>`;
        card.onclick = () => abrirModalPerfil(docSnap.id);
        grid.appendChild(card);
    });
    if (!grid.children.length)
        grid.innerHTML = '<p class="text-muted">Nenhum veículo cadastrado ainda.</p>';
}

async function renderizarMembros() {
    const adminList  = document.getElementById('admin-list');
    const memberList = document.getElementById('member-list');
    adminList.innerHTML = ''; memberList.innerHTML = '';
    const snap = await getDocs(collection(db, 'usuarios'));
    snap.forEach(docSnap => {
        const data = docSnap.data();
        if (!data.aprovado) return;
        const infoCargo = obterCargo(data);
        const li = document.createElement('li');
        li.innerHTML = `
            <div class="member-info-left">
                <img src="${data.avatar}" loading="lazy"
                     style="border:2px solid ${data.themeColor || 'var(--bg-base)'}">
                <div class="member-text">
                    <h4>${data.nome}
                        <span class="text-muted" style="font-weight:normal;font-size:0.8rem">${data.tag}</span>
                    </h4>
                    <p>${data.carro?.modelo || 'Sem veículo'}</p>
                </div>
            </div>
            <span class="badge ${infoCargo.classe}">${infoCargo.texto}</span>`;
        li.onclick = () => abrirModalPerfil(docSnap.id);
        (data.isAdmin || data.cargo) ? adminList.appendChild(li) : memberList.appendChild(li);
    });
}

// ── CHAT EM TEMPO REAL ────────────────────────────────────────
function iniciarChatListener() {
    const q = query(collection(db, 'chat'), orderBy('criadoEm', 'asc'), limit(50));
    unsubscribeChat = onSnapshot(q, async (snapshot) => {
        const container     = document.getElementById('chat-messages');
        const adminControls = document.getElementById('chat-admin-controls');

        if (usuarioLogado.isAdmin) {
            adminControls.innerHTML = `
                <button class="btn-outline btn-small red-outline"
                    onclick="window.limparChatCompleto()">🧹 Limpar Todo o Chat (Admin)</button>`;
            adminControls.classList.remove('hidden');
        }

        // Busca autores únicos de uma vez (evita múltiplos requests)
        const autorIds = [...new Set(snapshot.docs.map(d => d.data().authorId))];
        const autores  = {};
        await Promise.all(autorIds.map(async id => {
            const s = await getDoc(doc(db, 'usuarios', id));
            autores[id] = s.exists() ? s.data() : { nome: 'Usuário removido', avatar: '', themeColor: '' };
        }));

        container.innerHTML = '';
        snapshot.docs.forEach(docSnap => {
            const msg   = docSnap.data();
            const autor = autores[msg.authorId] || { nome: 'Usuário', avatar: '', themeColor: '' };
            const hora  = msg.criadoEm?.toDate
                ? msg.criadoEm.toDate().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
                : '--:--';
            container.innerHTML += `
                <div class="discord-msg">
                    <img src="${autor.avatar}" class="avatar" loading="lazy"
                         style="border-color:${autor.themeColor || 'var(--bg-base)'}">
                    <div class="msg-content">
                        <div class="msg-header">
                            <span class="author" onclick="abrirModalPerfil('${msg.authorId}')">${autor.nome}</span>
                            <span class="time">Hoje às ${hora}</span>
                        </div>
                        <p class="text">${msg.text}</p>
                    </div>
                </div>`;
        });
        container.scrollTop = container.scrollHeight;
    });
}

document.getElementById('btn-send-msg').addEventListener('click', enviarMensagemChat);
document.getElementById('chat-input-field').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') enviarMensagemChat();
});
async function enviarMensagemChat() {
    const input = document.getElementById('chat-input-field');
    const texto = input.value.trim();
    if (!texto) return;
    input.value = '';
    await addDoc(collection(db, 'chat'), {
        authorId: usuarioLogado.id, text: texto, criadoEm: serverTimestamp()
    });
}
window.limparChatCompleto = async function () {
    if (!confirm('⚠️ Apagar TODAS as mensagens do chat? Isso não pode ser desfeito.')) return;
    const snap = await getDocs(collection(db, 'chat'));
    await Promise.all(snap.docs.map(d => deleteDoc(doc(db, 'chat', d.id))));
};

// ── MEU PERFIL ────────────────────────────────────────────────
function renderizarMeuPerfilTab() {
    const d = usuarioLogado;
    document.getElementById('my-name').innerText = d.nome  || '';
    document.getElementById('my-id').innerText   = d.tag   || '';
    document.getElementById('my-bio').innerText  = d.bio   || '';
    document.getElementById('my-avatar').src     = d.avatar || '';
    document.getElementById('my-avatar').style.borderColor = d.themeColor || 'var(--bg-base)';

    const bannerDiv = document.getElementById('my-banner');
    if (d.bannerImg && d.bannerImg !== 'none') {
        bannerDiv.style.backgroundImage = `url('${d.bannerImg}')`;
        bannerDiv.style.backgroundColor = 'transparent';
    } else {
        bannerDiv.style.backgroundImage = 'none';
        bannerDiv.style.backgroundColor = d.themeColor || 'var(--bg-panel)';
    }

    const infoCargo = obterCargo(d);
    document.getElementById('my-badges').innerHTML = `
        <span class="badge ${infoCargo.classe}">${infoCargo.texto}</span>
        ${d.carro?.modelo ? `<span class="badge car-badge"
            style="border-color:${d.themeColor};color:${d.themeColor}">🚗 ${d.carro.modelo}</span>` : ''}`;

    const carContainer = document.getElementById('my-car-card');
    if (d.carro?.modelo) {
        carContainer.style.borderLeft = `3px solid ${d.themeColor}`;
        carContainer.innerHTML = `
            ${d.carro.fotoThumb ? `<img src="${d.carro.fotoThumb}" loading="lazy">` : ''}
            <div>
                <p>⚙️ <strong>${d.carro.modelo} ${d.carro.ano ? `(${d.carro.ano})` : ''}</strong></p>
                <p class="text-muted" style="font-size:0.85rem">${d.carro.specs || ''}</p>
            </div>`;
    }

    const grid = document.getElementById('my-insta-grid');
    grid.innerHTML = '';
    (d.galeria || []).forEach(url => grid.innerHTML += `<img src="${url}" loading="lazy">`);
}

// ── EDITAR PERFIL ─────────────────────────────────────────────
const editProfileModal = document.getElementById('edit-profile-modal');

document.getElementById('btn-edit-profile').addEventListener('click', () => {
    const u = usuarioLogado;
    document.getElementById('edit-nome').value        = u.nome           || '';
    document.getElementById('edit-bio').value         = u.bio            || '';
    document.getElementById('edit-color').value       = u.themeColor     || '#e63946';
    document.getElementById('edit-car-modelo').value  = u.carro?.modelo  || '';
    document.getElementById('edit-car-specs').value   = u.carro?.specs   || '';
    editProfileModal.classList.remove('hidden');
});
document.getElementById('close-edit-profile').addEventListener('click', () => editProfileModal.classList.add('hidden'));
editProfileModal.addEventListener('click', (e) => {
    if (e.target === editProfileModal) editProfileModal.classList.add('hidden');
});

// Galeria — agora via Storage
document.getElementById('btn-add-photos').addEventListener('click', () =>
    document.getElementById('hidden-gallery-input').click()
);
document.getElementById('hidden-gallery-input').addEventListener('change', async (e) => {
    const files = Array.from(e.target.files);
    if (!files.length) return;

    const btn = document.getElementById('btn-add-photos');
    btn.disabled = true; btn.textContent = 'Enviando...';

    const grid = document.getElementById('my-insta-grid');
    mostrarProgresso(grid);

    try {
        const novasUrls = [];
        for (let i = 0; i < files.length; i++) {
            const file    = files[i];
            const caminho = `galeria/${usuarioLogado.id}/${Date.now()}_${i}`;
            const url     = await uploadImagem(file, caminho, (pct) => {
                const total = Math.round(((i + pct / 100) / files.length) * 100);
                atualizarProgresso(total, `Enviando foto ${i + 1} de ${files.length}... ${total}%`);
            });
            novasUrls.push(url);
        }
        usuarioLogado.galeria = [...(usuarioLogado.galeria || []), ...novasUrls];
        await updateDoc(doc(db, 'usuarios', usuarioLogado.id), { galeria: usuarioLogado.galeria });
        renderizarMeuPerfilTab();
    } catch (err) {
        alert('Erro ao enviar foto: ' + err.message);
    } finally {
        removerProgresso();
        btn.disabled = false; btn.textContent = 'Adicionar Fotos do Carro';
        e.target.value = '';
    }
});

// Salvar perfil — uploads paralelos via Storage
document.getElementById('btn-save-profile').addEventListener('click', async () => {
    const btn = document.getElementById('btn-save-profile');
    btn.disabled = true; btn.textContent = 'Salvando...';
    mostrarProgresso(btn.parentNode, 'Preparando...');

    try {
        const uid = usuarioLogado.id;
        const updates = {
            nome:            document.getElementById('edit-nome').value.trim(),
            bio:             document.getElementById('edit-bio').value.trim(),
            themeColor:      document.getElementById('edit-color').value,
            'carro.modelo':  document.getElementById('edit-car-modelo').value.trim(),
            'carro.specs':   document.getElementById('edit-car-specs').value.trim()
        };

        const arquivos = [];
        const avatarFile = document.getElementById('edit-avatar').files[0];
        const bannerFile = document.getElementById('edit-banner').files[0];
        const carroFile  = document.getElementById('edit-car-foto').files[0];
        if (avatarFile) arquivos.push({ file: avatarFile, campo: 'avatar',          caminho: `avatares/${uid}/avatar_${Date.now()}` });
        if (bannerFile) arquivos.push({ file: bannerFile, campo: 'bannerImg',        caminho: `banners/${uid}/banner_${Date.now()}` });
        if (carroFile)  arquivos.push({ file: carroFile,  campo: 'carro.fotoThumb', caminho: `carros/${uid}/carro_${Date.now()}` });

        if (arquivos.length > 0) {
            // Uploads em paralelo com progresso agregado
            const progressos = new Array(arquivos.length).fill(0);
            await Promise.all(arquivos.map(({ file, campo, caminho }, idx) =>
                uploadImagem(file, caminho, (pct) => {
                    progressos[idx] = pct;
                    const total = Math.round(progressos.reduce((a, b) => a + b, 0) / arquivos.length);
                    atualizarProgresso(total, `Enviando imagens... ${total}%`);
                }).then(url => { updates[campo] = url; })
            ));
        }

        atualizarProgresso(100, 'Salvando dados...');
        await updateDoc(doc(db, 'usuarios', uid), updates);

        // Atualiza estado local sem recarregar do Firestore
        Object.entries(updates).forEach(([key, val]) => {
            if (key.startsWith('carro.')) {
                if (!usuarioLogado.carro) usuarioLogado.carro = {};
                usuarioLogado.carro[key.replace('carro.', '')] = val;
            } else {
                usuarioLogado[key] = val;
            }
        });

        renderizarMeuPerfilTab();
        atualizarSidebar();
        editProfileModal.classList.add('hidden');
    } catch (err) {
        alert('Erro ao salvar perfil: ' + err.message);
    } finally {
        removerProgresso();
        btn.disabled = false; btn.textContent = 'Salvar Tudo';
    }
});

// ── EVENTOS ───────────────────────────────────────────────────
const eventModal = document.getElementById('event-modal');

async function renderizarEventos() {
    const container = document.getElementById('events-list');
    container.innerHTML = '<p class="text-muted">Carregando eventos...</p>';
    const snap = await getDocs(query(collection(db, 'eventos'), orderBy('data', 'asc')));
    container.innerHTML = '';
    snap.forEach(docSnap => {
        const ev = { id: docSnap.id, ...docSnap.data() };
        const dateObj = new Date(ev.data);
        const dataFormatada = dateObj.toLocaleDateString('pt-BR') + ' às ' +
            dateObj.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        const statusMap = { active: 'Confirmado', done: 'Realizado', canceled: 'Cancelado' };
        container.innerHTML += `
            <div class="event-card">
                <div class="event-header-row">
                    <h3>${ev.nome}</h3>
                    <div class="event-actions">
                        ${usuarioLogado.isAdmin ? `
                            <button title="Editar"  onclick="window.abrirEdicaoEvento('${ev.id}')">✏️</button>
                            <button title="Excluir" onclick="window.excluirEvento('${ev.id}')">🗑️</button>` : ''}
                    </div>
                </div>
                <div class="event-details">
                    <p>🕒 ${dataFormatada}</p>
                    <p>📍 ${ev.local?.startsWith('http')
                        ? `<a href="${ev.local}" target="_blank">Abrir no Maps</a>`
                        : ev.local}</p>
                </div>
                <span class="status-badge status-${ev.status}">${statusMap[ev.status] || ev.status}</span>
            </div>`;
    });
    if (!container.children.length)
        container.innerHTML = '<p class="text-muted">Nenhum evento agendado.</p>';
}

document.getElementById('btn-new-event').addEventListener('click', () => {
    eventoEmEdicaoId = null;
    document.getElementById('event-modal-title').innerText = 'Agendar Novo Encontro';
    ['event-nome', 'event-data', 'event-local'].forEach(id => document.getElementById(id).value = '');
    document.getElementById('event-status').value = 'active';
    eventModal.classList.remove('hidden');
});
window.abrirEdicaoEvento = async function (id) {
    const snap = await getDoc(doc(db, 'eventos', id));
    if (!snap.exists()) return;
    const ev = snap.data();
    document.getElementById('event-nome').value   = ev.nome;
    document.getElementById('event-data').value   = ev.data;
    document.getElementById('event-local').value  = ev.local;
    document.getElementById('event-status').value = ev.status;
    eventoEmEdicaoId = id;
    document.getElementById('event-modal-title').innerText = 'Editar Encontro';
    eventModal.classList.remove('hidden');
};
document.getElementById('btn-save-event').addEventListener('click', async () => {
    const nome   = document.getElementById('event-nome').value;
    const data   = document.getElementById('event-data').value;
    const local  = document.getElementById('event-local').value;
    const status = document.getElementById('event-status').value;
    if (!nome || !data || !local) return;
    if (eventoEmEdicaoId) {
        await updateDoc(doc(db, 'eventos', eventoEmEdicaoId), { nome, data, local, status });
    } else {
        await addDoc(collection(db, 'eventos'), { nome, data, local, status, criadoEm: serverTimestamp() });
    }
    eventModal.classList.add('hidden');
    renderizarEventos();
});
window.excluirEvento = async function (id) {
    if (confirm('Excluir este evento?')) {
        await deleteDoc(doc(db, 'eventos', id));
        renderizarEventos();
    }
};
document.getElementById('close-event-modal').addEventListener('click', () => eventModal.classList.add('hidden'));
eventModal.addEventListener('click', (e) => { if (e.target === eventModal) eventModal.classList.add('hidden'); });

// ── MODAL DE PERFIL ───────────────────────────────────────────
const profileModal = document.getElementById('profile-modal');

window.abrirModalPerfil = async function (userId) {
    const snap = await getDoc(doc(db, 'usuarios', userId));
    if (!snap.exists()) return;
    const data = snap.data();

    document.getElementById('modal-name').innerText = data.nome || '';
    document.getElementById('modal-id').innerText   = data.tag  || '';
    document.getElementById('modal-bio').innerText  = data.bio  || '';
    document.getElementById('modal-avatar').src     = data.avatar || '';
    document.getElementById('modal-avatar').style.borderColor = data.themeColor || 'var(--bg-base)';

    const bannerDiv = document.getElementById('modal-banner');
    if (data.bannerImg && data.bannerImg !== 'none') {
        bannerDiv.style.backgroundImage = `url('${data.bannerImg}')`;
        bannerDiv.style.backgroundColor = 'transparent';
    } else {
        bannerDiv.style.backgroundImage = 'none';
        bannerDiv.style.backgroundColor = data.themeColor || 'var(--bg-panel)';
    }

    const badges = document.getElementById('modal-badges');
    const infoCargo = obterCargo(data);
    badges.innerHTML = `<span class="badge ${infoCargo.classe}">${infoCargo.texto}</span>`;
    if (data.carro?.modelo)
        badges.innerHTML += `<span class="badge car-badge"
            style="border-color:${data.themeColor};color:${data.themeColor}">🚗 ${data.carro.modelo}</span>`;

    const carContainer = document.getElementById('modal-car-card');
    if (data.carro?.modelo) {
        carContainer.style.borderLeft = `3px solid ${data.themeColor}`;
        carContainer.innerHTML = `
            ${data.carro.fotoThumb ? `<img src="${data.carro.fotoThumb}" loading="lazy">` : ''}
            <div>
                <p>⚙️ <strong>${data.carro.modelo} ${data.carro.ano ? `(${data.carro.ano})` : ''}</strong></p>
                <p class="text-muted" style="font-size:0.85rem">${data.carro.specs || ''}</p>
            </div>`;
    } else {
        carContainer.innerHTML = '<p>Nenhum veículo cadastrado.</p>';
        carContainer.style.borderLeft = 'none';
    }

    const grid = document.getElementById('modal-insta-grid');
    grid.innerHTML = '';
    (data.galeria || []).forEach(url => grid.innerHTML += `<img src="${url}" loading="lazy">`);

    const adminControls = document.getElementById('modal-admin-controls');
    const eu = usuarioLogado;
    const possoModerar = userId !== eu.id &&
        (eu.cargo === '🛠️ Criador' || (eu.isAdmin && !data.isAdmin && !data.cargo));
    adminControls.classList.toggle('hidden', !possoModerar);
    profileModal.classList.remove('hidden');
};
document.getElementById('close-modal').addEventListener('click', () => profileModal.classList.add('hidden'));
profileModal.addEventListener('click', (e) => { if (e.target === profileModal) profileModal.classList.add('hidden'); });

// ── PAINEL DA DIRETORIA ───────────────────────────────────────
async function renderizarAdminPanel() {
    const container = document.getElementById('admin-users-list');
    container.innerHTML = '';
    if (!usuarioLogado.isAdmin) {
        container.innerHTML = '<p class="text-muted">Sem permissão.</p>'; return;
    }

    const allSnap    = await getDocs(collection(db, 'usuarios'));
    const pendentes  = [];
    allSnap.forEach(d => { if (!d.data().aprovado) pendentes.push({ id: d.id, ...d.data() }); });

    const pendingSection = document.getElementById('pending-users-section');
    const pendingList    = document.getElementById('pending-users-list');

    if (pendentes.length > 0) {
        pendingSection.classList.remove('hidden');
        pendingList.innerHTML = '';
        pendentes.forEach(u => {
            pendingList.innerHTML += `
                <div class="admin-user-card" style="border-left-color:var(--yellow);">
                    <div class="admin-user-info">
                        <img src="${u.avatar}" loading="lazy">
                        <div>
                            <h4 style="color:var(--white);">${u.nome}
                                <span class="badge pending-badge" style="margin-left:8px;">Pendente</span>
                            </h4>
                            <p style="font-size:0.8rem;color:var(--text-muted);">${u.email} | ${u.carro?.modelo || 'Sem veículo'}</p>
                        </div>
                    </div>
                    <div class="admin-actions">
                        <button class="btn-outline btn-small"
                            style="border-color:var(--green);color:var(--green);"
                            onclick="window.aprovarMembro('${u.id}')">✅ Aprovar</button>
                        <button class="btn-outline btn-small red-outline"
                            onclick="window.rejeitarMembro('${u.id}')">🚫 Rejeitar</button>
                    </div>
                </div>`;
        });
    } else { pendingSection.classList.add('hidden'); }

    const eu = usuarioLogado;
    allSnap.forEach(docSnap => {
        const data = docSnap.data();
        if (!data.aprovado) return;
        const userId = docSnap.id;
        const isMe   = userId === eu.id;
        const infoCargo = obterCargo(data);
        let podeEditar = false, msgBloqueio = '';
        if (isMe) { msgBloqueio = 'Seu Perfil (Intocável)'; }
        else if (eu.cargo === '🛠️ Criador') { podeEditar = true; }
        else if (eu.cargo === '👑 Presidente') {
            (data.cargo === '🛠️ Criador' || data.cargo === '👑 Presidente')
                ? msgBloqueio = 'Hierarquia Superior' : podeEditar = true;
        } else if (eu.isAdmin) {
            (data.cargo || data.isAdmin) ? msgBloqueio = 'Hierarquia Superior ou Igual' : podeEditar = true;
        }
        container.innerHTML += `
            <div class="admin-user-card">
                <div class="admin-user-info">
                    <img src="${data.avatar}" loading="lazy">
                    <div>
                        <h4 style="color:var(--white);">${data.nome}
                            <span class="text-muted" style="font-size:0.85rem">${data.tag}</span>
                        </h4>
                        <p style="font-size:0.8rem;color:var(--text-muted);">${infoCargo.texto} | ${data.carro?.modelo || 'Sem veículo'}</p>
                    </div>
                </div>
                <div class="admin-actions">
                    ${podeEditar ? `
                        <button class="btn-outline btn-small"
                            onclick="window.alternarCargo('${userId}')">${data.isAdmin ? '⬇️ Rebaixar' : '⬆️ Promover'}</button>
                        <button class="btn-outline btn-small"
                            onclick="window.mudarTag('${userId}')">🏷️ Nova Tag</button>
                        <button class="btn-outline btn-small red-outline"
                            onclick="window.banirMembro('${userId}')">🚫 Banir</button>
                    ` : `<span style="color:var(--text-muted);font-size:0.8rem;font-style:italic;">${msgBloqueio}</span>`}
                </div>
            </div>`;
    });
}

window.aprovarMembro = async function (userId) {
    if (confirm('Aprovar este membro?')) {
        await updateDoc(doc(db, 'usuarios', userId), { aprovado: true });
        renderizarAdminPanel();
    }
};
window.rejeitarMembro = async function (userId) {
    if (confirm('⚠️ Rejeitar e excluir este cadastro permanentemente?')) {
        await deleteDoc(doc(db, 'usuarios', userId));
        renderizarAdminPanel();
    }
};
window.alternarCargo = async function (userId) {
    const snap = await getDoc(doc(db, 'usuarios', userId));
    if (!snap.exists()) return;
    const data = snap.data();
    if (confirm(`Alterar cargo de ${data.nome} para ${data.isAdmin ? 'Membro' : 'Diretoria'}?`)) {
        const newAdmin = !data.isAdmin;
        await updateDoc(doc(db, 'usuarios', userId), { isAdmin: newAdmin, ...(newAdmin ? {} : { cargo: '' }) });
        renderizarAdminPanel(); renderizarMembros();
    }
};
window.mudarTag = async function (userId) {
    const snap = await getDoc(doc(db, 'usuarios', userId));
    if (!snap.exists()) return;
    const novaTag = prompt(`Nova tag para ${snap.data().nome}:`, snap.data().tag);
    if (novaTag?.trim()) {
        const tag = novaTag.startsWith('#') ? novaTag : '#' + novaTag;
        await updateDoc(doc(db, 'usuarios', userId), { tag });
        renderizarAdminPanel(); renderizarMembros();
    }
};
window.banirMembro = async function (userId) {
    const snap = await getDoc(doc(db, 'usuarios', userId));
    if (!snap.exists()) return;
    if (confirm(`⚠️ Banir ${snap.data().nome}? Isso remove o acesso permanentemente.`)) {
        await deleteDoc(doc(db, 'usuarios', userId));
        renderizarTudo();
    }
};
