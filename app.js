// ============================================================
//  BASE26 — app.js
//  Firebase: Auth + Firestore + Storage
//  Versão integrada com:
//  - Sobre do grupo
//  - Agenda de eventos
//  - Eventos realizados com galeria
//  - Pagamento / PIX
//  - Curtidas nos carros
//  - Ranking dos carros mais curtidos
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
    doc, getDoc, setDoc, updateDoc, deleteDoc, runTransaction,
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

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

// ── ESTADO GLOBAL ─────────────────────────────────────────────
let usuarioLogado = null;
let unsubscribeChat = null;
let eventoEmEdicaoId = null;
let eventoHistoricoEmEdicaoId = null;
let eventoVisualizado = null;
let usuarioPerfilAbertoId = null;

// ── REFERÊNCIAS DE COLEÇÕES / DOCUMENTOS ──────────────────────
const REF_SOBRE = doc(db, 'configuracoes', 'sobre');
const REF_PAGAMENTO = doc(db, 'configuracoes', 'pagamento');
const COL_EVENTOS = collection(db, 'eventos');
const COL_EVENTOS_HISTORICO = collection(db, 'eventos_historico');
const COL_USUARIOS = collection(db, 'usuarios');
const COL_CHAT = collection(db, 'chat');

// ── HELPERS GERAIS ────────────────────────────────────────────
const el = (id) => document.getElementById(id);

function escapeHtml(str = '') {
    return String(str).replace(/[&<>"']/g, (m) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    }[m]));
}

function resumoTexto(texto = '', max = 120) {
    const clean = String(texto || '').trim();
    return clean.length > max ? clean.slice(0, max).trim() + '…' : clean;
}

function formatarDataHoraBR(valor) {
    if (!valor) return '--';
    const d = new Date(valor);
    if (Number.isNaN(d.getTime())) return valor;
    return d.toLocaleDateString('pt-BR') + ' às ' +
        d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function formatarDataBR(valor) {
    if (!valor) return '--';
    const d = new Date(valor);
    if (Number.isNaN(d.getTime())) return valor;
    return d.toLocaleDateString('pt-BR');
}

function formatarMoeda(valor) {
    const num = Number(valor || 0);
    return num.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function normalizarTag(tag = '') {
    const t = String(tag || '').trim();
    if (!t) return '#' + String(Math.floor(Math.random() * 9000) + 1000);
    return t.startsWith('#') ? t : '#' + t;
}

function gerarUrlQrCode(chavePix = '') {
    const chave = String(chavePix || '').trim();
    if (!chave) return '';
    return `https://api.qrserver.com/v1/create-qr-code/?size=320x320&data=${encodeURIComponent(chave)}`;
}

function getImagemPrincipalUsuario(data = {}) {
    return (data.bannerImg && data.bannerImg !== 'none')
        ? data.bannerImg
        : (data.carro?.fotoThumb || 'https://via.placeholder.com/400x200?text=Sem+foto');
}

function totalCurtidasUsuario(data = {}) {
    if (typeof data.curtidasCarro === 'number') return data.curtidasCarro;
    if (Array.isArray(data.curtidoPor)) return data.curtidoPor.length;
    return 0;
}

function usuarioCurtiuCarro(data = {}, userId) {
    return Array.isArray(data.curtidoPor) && data.curtidoPor.includes(userId);
}

function mostrarErro(elementId, msg) {
    const alvo = el(elementId);
    if (!alvo) return;
    alvo.textContent = msg;
    alvo.classList.add('visible');
}

function limparErro(elementId) {
    const alvo = el(elementId);
    if (!alvo) return;
    alvo.textContent = '';
    alvo.classList.remove('visible');
}

function setBtnLoading(btnId, loading, textoOriginal) {
    const btn = el(btnId);
    if (!btn) return;
    if (!btn.dataset.originalText) btn.dataset.originalText = textoOriginal || btn.textContent;
    btn.disabled = loading;
    btn.textContent = loading ? 'Aguarde...' : (textoOriginal || btn.dataset.originalText);
}

// ── PERMISSÕES / CARGOS ───────────────────────────────────────
function obterCargo(u = {}) {
    if (u.cargo === '🛠️ Criador')   return { classe: 'creator-badge',   texto: '🛠️ Criador' };
    if (u.cargo === '👑 Presidente') return { classe: 'president-badge', texto: '👑 Presidente' };
    if (u.isAdmin)                  return { classe: 'admin-badge',     texto: '🛡️ Diretoria' };
    return { classe: 'member-badge', texto: '🚗 Membro' };
}

function isCriador(u = usuarioLogado) {
    return !!u && u.cargo === '🛠️ Criador';
}

function isPresidente(u = usuarioLogado) {
    return !!u && u.cargo === '👑 Presidente';
}

function isDiretoriaPlus(u = usuarioLogado) {
    return !!u && (u.isAdmin || isCriador(u) || isPresidente(u));
}

function podeEditarSobre(u = usuarioLogado) {
    return isDiretoriaPlus(u);
}

function podeEditarHistorico(u = usuarioLogado) {
    return isDiretoriaPlus(u);
}

function podeEditarAgenda(u = usuarioLogado) {
    return isDiretoriaPlus(u);
}

function podeEditarPagamento(u = usuarioLogado) {
    return !!u && (isCriador(u) || isPresidente(u));
}

// ── UPLOAD COM COMPRESSÃO E PROGRESSO ────────────────────────
function blobParaJpeg(canvas, quality) {
    return new Promise((resolve) => {
        canvas.toBlob((blob) => resolve(blob), 'image/jpeg', quality);
    });
}

function comprimirImagem(file, options = {}) {
    const {
        maxPx = 1000,
        quality = 0.72,
        minQuality = 0.45,
        targetBytes = 450 * 1024
    } = options;

    return new Promise((resolve, reject) => {
        const img = new Image();
        const url = URL.createObjectURL(file);

        img.onload = async () => {
            try {
                URL.revokeObjectURL(url);

                let larguraMax = maxPx;
                let qualidadeInicial = quality;

                if (file.size > 8 * 1024 * 1024) {
                    larguraMax = Math.min(larguraMax, 800);
                    qualidadeInicial = Math.min(qualidadeInicial, 0.52);
                } else if (file.size > 4 * 1024 * 1024) {
                    larguraMax = Math.min(larguraMax, 900);
                    qualidadeInicial = Math.min(qualidadeInicial, 0.58);
                }

                let { width, height } = img;

                if (width > larguraMax || height > larguraMax) {
                    if (width > height) {
                        height = Math.round(height * larguraMax / width);
                        width = larguraMax;
                    } else {
                        width = Math.round(width * larguraMax / height);
                        height = larguraMax;
                    }
                }

                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;

                const ctx = canvas.getContext('2d', { alpha: false });
                ctx.drawImage(img, 0, 0, width, height);

                let qualidadeAtual = qualidadeInicial;
                let blob = await blobParaJpeg(canvas, qualidadeAtual);

                while (blob && blob.size > targetBytes && qualidadeAtual > minQuality) {
                    qualidadeAtual = Math.max(minQuality, qualidadeAtual - 0.06);
                    blob = await blobParaJpeg(canvas, qualidadeAtual);
                }

                resolve(blob);
            } catch (err) {
                reject(err);
            }
        };

        img.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error('Não foi possível ler a imagem.'));
        };

        img.src = url;
    });
}
function uploadImagem(file, caminho, onProgress = null, options = {}) {
    return new Promise(async (resolve, reject) => {
        try {
            const blob = await comprimirImagem(file, options);

            if (!blob) {
                reject(new Error('Falha ao comprimir a imagem.'));
                return;
            }

            const storageRef = ref(storage, caminho);
            const task = uploadBytesResumable(storageRef, blob, {
                contentType: 'image/jpeg'
            });

            task.on(
                'state_changed',
                (snapshot) => {
                    if (onProgress) {
                        const pct = Math.round(
                            (snapshot.bytesTransferred / snapshot.totalBytes) * 100
                        );
                        onProgress(pct);
                    }
                },
                (err) => reject(err),
                async () => {
                    const url = await getDownloadURL(task.snapshot.ref);
                    resolve(url);
                }
            );
        } catch (err) {
            reject(err);
        }
    });
}
function uploadImagemBanner(file, caminho, onProgress = null) {
    return uploadImagem(file, caminho, onProgress, {
        maxPx: 900,
        quality: 0.58,
        minQuality: 0.38,
        targetBytes: 180 * 1024
    });
}

// ── BARRA DE PROGRESSO ────────────────────────────────────────
function mostrarProgresso(parentEl, texto = 'Enviando imagens...') {
    removerProgresso();
    if (!parentEl) return;

    const wrapper = document.createElement('div');
    wrapper.id = 'upload-progress-wrapper';
    wrapper.innerHTML = `
        <div id="upload-progress-bar"></div>
        <p id="upload-progress-text">${texto}</p>
    `;
    parentEl.appendChild(wrapper);
}

function atualizarProgresso(pct, label) {
    const bar = el('upload-progress-bar');
    const text = el('upload-progress-text');
    if (bar) bar.style.width = pct + '%';
    if (text) text.textContent = label;
}

function removerProgresso() {
    el('upload-progress-wrapper')?.remove();
}

// ── TROCA ENTRE LOGIN E REGISTRO ──────────────────────────────
el('go-to-register')?.addEventListener('click', () => {
    el('login-card')?.classList.add('hidden');
    el('register-card')?.classList.remove('hidden');
    limparErro('login-error');
});

el('go-to-login')?.addEventListener('click', () => {
    el('register-card')?.classList.add('hidden');
    el('login-card')?.classList.remove('hidden');
    limparErro('register-error');
});

// ── REGISTRO ──────────────────────────────────────────────────
el('btn-register')?.addEventListener('click', async () => {
    limparErro('register-error');

    const nome = el('reg-nome')?.value.trim();
    const email = el('reg-email')?.value.trim();
    const senha = el('reg-password')?.value;
    const carro = el('reg-carro')?.value.trim();

    if (!nome || !email || !senha || !carro) {
        mostrarErro('register-error', 'Preencha todos os campos.');
        return;
    }

    if (senha.length < 6) {
        mostrarErro('register-error', 'A senha precisa ter ao menos 6 caracteres.');
        return;
    }

    setBtnLoading('btn-register', true, 'Enviar Solicitação');

    try {
        const cred = await createUserWithEmailAndPassword(auth, email, senha);
        const uid = cred.user.uid;
        const tag = '#' + String(Math.floor(Math.random() * 9000) + 1000);

        await setDoc(doc(db, 'usuarios', uid), {
            nome,
            email,
            tag,
            isAdmin: false,
            aprovado: false,
            cargo: '',
            themeColor: '#e63946',
            bio: '',
            bannerImg: 'none',
            avatar: `https://ui-avatars.com/api/?name=${encodeURIComponent(nome)}&background=e63946&color=fff`,
            carro: {
                modelo: carro,
                ano: '',
                specs: '',
                fotoThumb: ''
            },
            galeria: [],
            curtidasCarro: 0,
            curtidoPor: [],
            criadoEm: serverTimestamp()
        });
    } catch (err) {
        const msgs = {
            'auth/email-already-in-use': 'Este e-mail já está cadastrado.',
            'auth/invalid-email': 'E-mail inválido.',
            'auth/weak-password': 'Senha fraca (mín. 6 caracteres).'
        };
        mostrarErro('register-error', msgs[err.code] || err.message);
        setBtnLoading('btn-register', false, 'Enviar Solicitação');
    }
});

// ── LOGIN ─────────────────────────────────────────────────────
el('btn-login')?.addEventListener('click', async () => {
    limparErro('login-error');

    const email = el('login-email')?.value.trim();
    const senha = el('login-password')?.value;

    if (!email || !senha) {
        mostrarErro('login-error', 'Preencha e-mail e senha.');
        return;
    }

    setBtnLoading('btn-login', true, 'Entrar na Garagem');

    try {
        await signInWithEmailAndPassword(auth, email, senha);
    } catch (err) {
        const msgs = {
            'auth/user-not-found': 'Nenhuma conta com este e-mail.',
            'auth/wrong-password': 'Senha incorreta.',
            'auth/invalid-credential': 'E-mail ou senha incorretos.',
            'auth/too-many-requests': 'Muitas tentativas. Tente mais tarde.'
        };
        mostrarErro('login-error', msgs[err.code] || err.message);
        setBtnLoading('btn-login', false, 'Entrar na Garagem');
    }
});

el('login-password')?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') el('btn-login')?.click();
});

// ── LOGOUT ────────────────────────────────────────────────────
async function fazerLogout() {
    if (unsubscribeChat) unsubscribeChat();
    await signOut(auth);
}

el('btn-logout')?.addEventListener('click', fazerLogout);
el('btn-pending-logout')?.addEventListener('click', fazerLogout);

// ── TELA / AUTH ───────────────────────────────────────────────
function mostrarTela(tela) {
    ['auth-section', 'pending-section', 'app-container'].forEach((id) =>
        el(id)?.classList.add('hidden')
    );

    const map = {
        auth: 'auth-section',
        pending: 'pending-section',
        app: 'app-container'
    };
    el(map[tela])?.classList.remove('hidden');
}

onAuthStateChanged(auth, async (firebaseUser) => {
    if (!firebaseUser) {
        usuarioLogado = null;
        mostrarTela('auth');
        setBtnLoading('btn-login', false, 'Entrar na Garagem');
        setBtnLoading('btn-register', false, 'Enviar Solicitação');
        return;
    }

    const snap = await getDoc(doc(db, 'usuarios', firebaseUser.uid));
    if (!snap.exists()) {
        await signOut(auth);
        return;
    }

    const dados = snap.data();
    usuarioLogado = { id: firebaseUser.uid, ...dados };

    if (!dados.aprovado) {
        mostrarTela('pending');
        return;
    }

    iniciarApp();
});

// ── NAVEGAÇÃO ─────────────────────────────────────────────────
const navButtons = document.querySelectorAll('.nav-btn');
const pageTitle = el('current-page-title');
const footer = el('site-footer');

navButtons.forEach((btn) => {
    btn.addEventListener('click', (e) => {
        navButtons.forEach((b) => b.classList.remove('active'));
        e.currentTarget.classList.add('active');

        document.querySelectorAll('.app-section').forEach((s) => s.classList.add('hidden'));

        const targetId = e.currentTarget.getAttribute('data-target');
        el(targetId)?.classList.remove('hidden');

        if (pageTitle) {
            pageTitle.innerHTML = `<span class="hash">#</span> ${e.currentTarget.getAttribute('data-title')}`;
        }

        footer?.classList.toggle('hidden', targetId === 'chat-section');
        fecharMenu();
    });
});

el('open-sidebar')?.addEventListener('click', () => {
    el('sidebar')?.classList.add('open');
    el('sidebar-overlay')?.classList.add('active');
});

function fecharMenu() {
    el('sidebar')?.classList.remove('open');
    el('sidebar-overlay')?.classList.remove('active');
}

el('close-sidebar')?.addEventListener('click', fecharMenu);
el('sidebar-overlay')?.addEventListener('click', fecharMenu);

// ── INÍCIO DO APP ─────────────────────────────────────────────
function atualizarSidebar() {
    el('sidebar-name').textContent = usuarioLogado.nome || 'Usuário';
    el('sidebar-tag').textContent = usuarioLogado.tag || '#----';
    el('sidebar-avatar').src = usuarioLogado.avatar || '';
}

async function iniciarApp() {
    mostrarTela('app');
    atualizarSidebar();
    configurarPermissoesUI();
    await renderizarTudo();
    iniciarChatListener();
}

function configurarPermissoesUI() {
    const mostrarAdminNav = isDiretoriaPlus(usuarioLogado);

    el('admin-nav-title').style.display = mostrarAdminNav ? '' : 'none';
    el('admin-nav-btn')?.classList.toggle('hidden', !mostrarAdminNav);
    el('btn-new-event')?.classList.toggle('hidden', !podeEditarAgenda(usuarioLogado));
    el('btn-new-historic-event')?.classList.toggle('hidden', !podeEditarHistorico(usuarioLogado));
    el('btn-edit-about')?.classList.toggle('hidden', !podeEditarSobre(usuarioLogado));
    el('btn-edit-payment')?.classList.toggle('hidden', !podeEditarPagamento(usuarioLogado));
    el('about-admin-controls')?.classList.toggle('hidden', !podeEditarSobre(usuarioLogado));
    el('historic-events-admin-controls')?.classList.toggle('hidden', !podeEditarHistorico(usuarioLogado));
    el('payment-admin-controls')?.classList.toggle('hidden', !podeEditarPagamento(usuarioLogado));
    el('association-admin-extra-controls')?.classList.toggle('hidden', !mostrarAdminNav);
}

// ── RENDERIZAÇÃO GERAL ────────────────────────────────────────
async function renderizarTudo() {
    await Promise.all([
        renderizarGaragem(),
        renderizarMembros(),
        renderizarEventos(),
        renderizarEventosHistoricos(),
        renderizarSobre(),
        renderizarPagamento(),
        renderizarMeuPerfilTab(),
        renderizarRanking(),
        renderizarAdminPanel()
    ]);
}

// ── GARAGEM / CURTIDAS ────────────────────────────────────────
async function renderizarGaragem() {
    const grid = el('cars-grid');
    if (!grid) return;

    grid.innerHTML = '<p class="text-muted">Carregando garagem...</p>';

    const snap = await getDocs(COL_USUARIOS);
    grid.innerHTML = '';

    const membros = [];
    snap.forEach((docSnap) => {
        const data = docSnap.data();
        if (!data.aprovado || !data.carro?.modelo) return;
        membros.push({ id: docSnap.id, ...data });
    });

    membros.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));

    membros.forEach((data) => {
        const imgSrc = getImagemPrincipalUsuario(data);
        const curtidas = totalCurtidasUsuario(data);
        const curtiu = usuarioCurtiuCarro(data, usuarioLogado.id);
        const meuCarro = data.id === usuarioLogado.id;

        const card = document.createElement('div');
        card.className = 'car-card';
        card.innerHTML = `
            <img src="${imgSrc}" class="car-image" loading="lazy"
                 onerror="this.src='https://via.placeholder.com/400x200?text=Sem+foto'">
            <div class="car-info">
                <h3>${escapeHtml(data.carro.modelo)}</h3>
                <p class="text-muted">${escapeHtml(data.nome)}</p>
            </div>
            <div class="car-card-footer">
                <span class="like-count">❤️ ${curtidas} curtida${curtidas === 1 ? '' : 's'}</span>
                <button class="like-btn ${curtiu ? 'active' : ''}" ${meuCarro ? 'disabled' : ''}>
                    ${meuCarro ? 'Seu carro' : (curtiu ? 'Curtido' : 'Curtir')}
                </button>
            </div>
        `;

        const btnCurtir = card.querySelector('.like-btn');
        btnCurtir?.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (meuCarro) return;
            await alternarCurtidaCarro(data.id);
        });

        card.addEventListener('click', () => abrirModalPerfil(data.id));
        grid.appendChild(card);
    });

    if (!grid.children.length) {
        grid.innerHTML = '<p class="text-muted">Nenhum veículo cadastrado ainda.</p>';
    }
}

async function alternarCurtidaCarro(userIdAlvo) {
    if (!usuarioLogado || !userIdAlvo || userIdAlvo === usuarioLogado.id) return;

    const refUser = doc(db, 'usuarios', userIdAlvo);

    try {
        await runTransaction(db, async (transaction) => {
            const snap = await transaction.get(refUser);
            if (!snap.exists()) throw new Error('Usuário não encontrado.');

            const dados = snap.data();
            const curtidoPor = Array.isArray(dados.curtidoPor) ? [...dados.curtidoPor] : [];
            const index = curtidoPor.indexOf(usuarioLogado.id);
            const jaCurtiu = index >= 0;

            if (jaCurtiu) {
                curtidoPor.splice(index, 1);
            } else {
                curtidoPor.push(usuarioLogado.id);
            }

            transaction.update(refUser, {
                curtidoPor,
                curtidasCarro: curtidoPor.length
            });
        });

        await Promise.all([
            renderizarGaragem(),
            renderizarRanking(),
            renderizarMeuPerfilTab()
        ]);

        if (usuarioPerfilAbertoId === userIdAlvo) {
            await abrirModalPerfil(userIdAlvo);
        }
    } catch (err) {
        alert('Erro ao atualizar curtida: ' + err.message);
    }
}

// ── MEMBROS ───────────────────────────────────────────────────
async function renderizarMembros() {
    const adminList = el('admin-list');
    const memberList = el('member-list');
    if (!adminList || !memberList) return;

    adminList.innerHTML = '';
    memberList.innerHTML = '';

    const snap = await getDocs(COL_USUARIOS);

    snap.forEach((docSnap) => {
        const data = docSnap.data();
        if (!data.aprovado) return;

        const infoCargo = obterCargo(data);
        const li = document.createElement('li');

        li.innerHTML = `
            <div class="member-info-left">
                <img src="${data.avatar}" loading="lazy"
                     style="border:2px solid ${data.themeColor || 'var(--bg-base)'}">
                <div class="member-text">
                    <h4>${escapeHtml(data.nome)}
                        <span class="text-muted" style="font-weight:normal;font-size:0.8rem">${escapeHtml(data.tag || '')}</span>
                    </h4>
                    <p>${escapeHtml(data.carro?.modelo || 'Sem veículo')}</p>
                </div>
            </div>
            <span class="badge ${infoCargo.classe}">${infoCargo.texto}</span>
        `;

        li.onclick = () => abrirModalPerfil(docSnap.id);

        if (data.isAdmin || data.cargo) adminList.appendChild(li);
        else memberList.appendChild(li);
    });
}

// ── CHAT EM TEMPO REAL ────────────────────────────────────────
function iniciarChatListener() {
    if (unsubscribeChat) unsubscribeChat();

    const q = query(COL_CHAT, orderBy('criadoEm', 'asc'), limit(50));
    unsubscribeChat = onSnapshot(q, async (snapshot) => {
        const container = el('chat-messages');
        const adminControls = el('chat-admin-controls');
        if (!container || !adminControls) return;

        if (usuarioLogado.isAdmin) {
            adminControls.innerHTML = `
                <button class="btn-outline btn-small red-outline"
                    onclick="window.limparChatCompleto()">🧹 Limpar Todo o Chat (Admin)</button>`;
            adminControls.classList.remove('hidden');
        } else {
            adminControls.classList.add('hidden');
            adminControls.innerHTML = '';
        }

        const autorIds = [...new Set(snapshot.docs.map((d) => d.data().authorId).filter(Boolean))];
        const autores = {};

        await Promise.all(autorIds.map(async (id) => {
            const s = await getDoc(doc(db, 'usuarios', id));
            autores[id] = s.exists()
                ? s.data()
                : { nome: 'Usuário removido', avatar: '', themeColor: '' };
        }));

        container.innerHTML = '';

        snapshot.docs.forEach((docSnap) => {
            const msg = docSnap.data();
            const autor = autores[msg.authorId] || { nome: 'Usuário', avatar: '', themeColor: '' };
            const hora = msg.criadoEm?.toDate
                ? msg.criadoEm.toDate().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
                : '--:--';

            container.innerHTML += `
                <div class="discord-msg">
                    <img src="${autor.avatar}" class="avatar" loading="lazy"
                         style="border-color:${autor.themeColor || 'var(--bg-base)'}">
                    <div class="msg-content">
                        <div class="msg-header">
                            <span class="author" onclick="window.abrirModalPerfil('${msg.authorId}')">${escapeHtml(autor.nome)}</span>
                            <span class="time">Hoje às ${hora}</span>
                        </div>
                        <p class="text">${escapeHtml(msg.text || '')}</p>
                    </div>
                </div>
            `;
        });

        container.scrollTop = container.scrollHeight;
    });
}

async function enviarMensagemChat() {
    const input = el('chat-input-field');
    if (!input) return;
    const texto = input.value.trim();
    if (!texto) return;

    input.value = '';
    await addDoc(COL_CHAT, {
        authorId: usuarioLogado.id,
        text: texto,
        criadoEm: serverTimestamp()
    });
}

el('btn-send-msg')?.addEventListener('click', enviarMensagemChat);
el('chat-input-field')?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') enviarMensagemChat();
});

window.limparChatCompleto = async function () {
    if (!confirm('⚠️ Apagar TODAS as mensagens do chat? Isso não pode ser desfeito.')) return;
    const snap = await getDocs(COL_CHAT);
    await Promise.all(snap.docs.map((d) => deleteDoc(doc(db, 'chat', d.id))));
};
// ── MEU PERFIL ────────────────────────────────────────────────
async function renderizarMeuPerfilTab() {
    if (!usuarioLogado) return;

    const refAtual = doc(db, 'usuarios', usuarioLogado.id);
    const snap = await getDoc(refAtual);

    if (snap.exists()) {
        usuarioLogado = { id: usuarioLogado.id, ...snap.data() };
        atualizarSidebar();
        configurarPermissoesUI();
    }

    const d = usuarioLogado;
    el('my-name').innerText = d.nome || '';
    el('my-id').innerText = d.tag || '';
    el('my-bio').innerText = d.bio || '';
    el('my-avatar').src = d.avatar || '';
    el('my-avatar').style.borderColor = d.themeColor || 'var(--bg-base)';

    const bannerDiv = el('my-banner');
    if (d.bannerImg && d.bannerImg !== 'none') {
        bannerDiv.style.backgroundImage = `url('${d.bannerImg}')`;
        bannerDiv.style.backgroundColor = 'transparent';
    } else {
        bannerDiv.style.backgroundImage = 'none';
        bannerDiv.style.backgroundColor = d.themeColor || 'var(--bg-panel)';
    }

    const infoCargo = obterCargo(d);
    el('my-badges').innerHTML = `
        <span class="badge ${infoCargo.classe}">${infoCargo.texto}</span>
        ${d.carro?.modelo
            ? `<span class="badge car-badge"
                style="border-color:${d.themeColor};color:${d.themeColor}">🚗 ${escapeHtml(d.carro.modelo)}</span>`
            : ''}
    `;

    const carContainer = el('my-car-card');
    if (d.carro?.modelo) {
        carContainer.style.borderLeft = `3px solid ${d.themeColor}`;
        carContainer.innerHTML = `
            ${d.carro.fotoThumb ? `<img src="${d.carro.fotoThumb}" loading="lazy">` : ''}
            <div>
                <p>⚙️ <strong>${escapeHtml(d.carro.modelo)} ${d.carro.ano ? `(${escapeHtml(d.carro.ano)})` : ''}</strong></p>
                <p class="text-muted" style="font-size:0.85rem">${escapeHtml(d.carro.specs || '')}</p>
            </div>`;
    } else {
        carContainer.innerHTML = '<p>Nenhum veículo cadastrado.</p>';
        carContainer.style.borderLeft = 'none';
    }

    const grid = el('my-insta-grid');
    grid.innerHTML = '';
    (d.galeria || []).forEach((url) => {
        grid.innerHTML += `<img src="${url}" loading="lazy">`;
    });

    el('my-car-likes').innerText = String(totalCurtidasUsuario(d));

    const rankingDados = await obterRankingUsuarios();
    const pos = rankingDados.findIndex((u) => u.id === d.id);
    el('my-car-ranking-position').innerText = pos >= 0 ? `${pos + 1}º` : '--';
}

// ── EDITAR PERFIL ─────────────────────────────────────────────
const editProfileModal = el('edit-profile-modal');

el('btn-edit-profile')?.addEventListener('click', () => {
    const u = usuarioLogado;
    el('edit-nome').value = u.nome || '';
    el('edit-bio').value = u.bio || '';
    el('edit-color').value = u.themeColor || '#e63946';
    el('edit-car-modelo').value = u.carro?.modelo || '';
    el('edit-car-specs').value = u.carro?.specs || '';
    editProfileModal?.classList.remove('hidden');
});

el('close-edit-profile')?.addEventListener('click', () => editProfileModal?.classList.add('hidden'));
editProfileModal?.addEventListener('click', (e) => {
    if (e.target === editProfileModal) editProfileModal.classList.add('hidden');
});

el('btn-add-photos')?.addEventListener('click', () => el('hidden-gallery-input')?.click());

el('hidden-gallery-input')?.addEventListener('change', async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    const btn = el('btn-add-photos');
    btn.disabled = true;
    btn.textContent = 'Enviando...';

    const grid = el('my-insta-grid');
    mostrarProgresso(grid);

    try {
        const novasUrls = [];

        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            const caminho = `galeria/${usuarioLogado.id}/${Date.now()}_${i}`;
            const url = await uploadImagem(file, caminho, (pct) => {
                const total = Math.round(((i + pct / 100) / files.length) * 100);
                atualizarProgresso(total, `Enviando foto ${i + 1} de ${files.length}... ${total}%`);
            });
            novasUrls.push(url);
        }

        usuarioLogado.galeria = [...(usuarioLogado.galeria || []), ...novasUrls];
        await updateDoc(doc(db, 'usuarios', usuarioLogado.id), { galeria: usuarioLogado.galeria });
        await renderizarMeuPerfilTab();
    } catch (err) {
        alert('Erro ao enviar foto: ' + err.message);
    } finally {
        removerProgresso();
        btn.disabled = false;
        btn.textContent = 'Adicionar Fotos do Carro';
        e.target.value = '';
    }
});

el('btn-save-profile')?.addEventListener('click', async () => {
    const btn = el('btn-save-profile');
    btn.disabled = true;
    btn.textContent = 'Salvando...';
    mostrarProgresso(btn.parentNode, 'Preparando...');

    try {
        const uid = usuarioLogado.id;
        const updates = {
            nome: el('edit-nome').value.trim(),
            bio: el('edit-bio').value.trim(),
            themeColor: el('edit-color').value,
            'carro.modelo': el('edit-car-modelo').value.trim(),
            'carro.specs': el('edit-car-specs').value.trim()
        };

        const arquivos = [];
        const avatarFile = el('edit-avatar').files[0];
        const bannerFile = el('edit-banner').files[0];
        const carroFile = el('edit-car-foto').files[0];

        if (avatarFile) arquivos.push({ file: avatarFile, campo: 'avatar', caminho: `avatares/${uid}/avatar_${Date.now()}` });
        if (bannerFile) arquivos.push({ file: bannerFile, campo: 'bannerImg', caminho: `banners/${uid}/banner_${Date.now()}` });
        if (carroFile) arquivos.push({ file: carroFile, campo: 'carro.fotoThumb', caminho: `carros/${uid}/carro_${Date.now()}` });

        if (arquivos.length > 0) {
    const progressos = new Array(arquivos.length).fill(0);

    await Promise.all(arquivos.map(({ file, campo, caminho }, idx) => {
        const uploader = campo === 'bannerImg' ? uploadImagemBanner : uploadImagem;

        return uploader(file, caminho, (pct) => {
            progressos[idx] = pct;
            const total = Math.round(progressos.reduce((a, b) => a + b, 0) / arquivos.length);
            atualizarProgresso(total, `Enviando imagens... ${total}%`);
        }).then((url) => {
            updates[campo] = url;
        });
    }));
}

        atualizarProgresso(100, 'Salvando dados...');
        await updateDoc(doc(db, 'usuarios', uid), updates);

        Object.entries(updates).forEach(([key, val]) => {
            if (key.startsWith('carro.')) {
                if (!usuarioLogado.carro) usuarioLogado.carro = {};
                usuarioLogado.carro[key.replace('carro.', '')] = val;
            } else {
                usuarioLogado[key] = val;
            }
        });

        await Promise.all([
            renderizarMeuPerfilTab(),
            renderizarGaragem(),
            renderizarMembros(),
            renderizarRanking()
        ]);

        editProfileModal.classList.add('hidden');
    } catch (err) {
        alert('Erro ao salvar perfil: ' + err.message);
    } finally {
        removerProgresso();
        btn.disabled = false;
        btn.textContent = 'Salvar Tudo';
    }
});

// ── SOBRE ─────────────────────────────────────────────────────
async function renderizarSobre() {
    try {
        const snap = await getDoc(REF_SOBRE);
        const dados = snap.exists() ? snap.data() : {};

        el('about-slogan').innerText = dados.bordao || 'Sem bordão cadastrado.';
        el('about-bio').innerText = dados.biografia || 'A história da Base26 ainda não foi cadastrada.';

        const bannerDiv = el('about-banner');
        if (dados.bannerImg) {
            bannerDiv.style.backgroundImage = `url('${dados.bannerImg}')`;
            bannerDiv.style.backgroundColor = 'transparent';
        } else {
            bannerDiv.style.backgroundImage = 'none';
            bannerDiv.style.backgroundColor = 'var(--bg-panel)';
        }
    } catch (err) {
        el('about-slogan').innerText = 'Erro ao carregar.';
        el('about-bio').innerText = err.message;
    }
}

const aboutModal = el('about-modal');

el('btn-edit-about')?.addEventListener('click', abrirModalSobre);
el('btn-admin-open-about-editor')?.addEventListener('click', abrirModalSobre);

async function abrirModalSobre() {
    if (!podeEditarSobre(usuarioLogado)) return;

    const snap = await getDoc(REF_SOBRE);
    const dados = snap.exists() ? snap.data() : {};

    el('about-edit-slogan').value = dados.bordao || '';
    el('about-edit-bio').value = dados.biografia || '';
    el('about-edit-banner').value = '';
    aboutModal?.classList.remove('hidden');
}

el('close-about-modal')?.addEventListener('click', () => aboutModal?.classList.add('hidden'));
aboutModal?.addEventListener('click', (e) => {
    if (e.target === aboutModal) aboutModal.classList.add('hidden');
});

el('btn-save-about')?.addEventListener('click', async () => {
    if (!podeEditarSobre(usuarioLogado)) return;

    const btn = el('btn-save-about');
    btn.disabled = true;
    btn.textContent = 'Salvando...';

    try {
        const updates = {
            bordao: el('about-edit-slogan').value.trim(),
            biografia: el('about-edit-bio').value.trim(),
            atualizadoPor: usuarioLogado.id,
            atualizadoEm: serverTimestamp()
        };

        const banner = el('about-edit-banner').files[0];
if (banner) {
    const url = await uploadImagemBanner(
        banner,
        `configuracoes/sobre/banner_${Date.now()}`,
        (pct) => atualizarProgresso(pct, `Enviando banner... ${pct}%`)
    );
    updates.bannerImg = url;
}

        await setDoc(REF_SOBRE, updates, { merge: true });
        aboutModal.classList.add('hidden');
        await renderizarSobre();
    } catch (err) {
        alert('Erro ao salvar o Sobre: ' + err.message);
    } finally {
        btn.disabled = false;
        btn.textContent = 'Salvar Sobre';
        removerProgresso();
    }
});

// ── PAGAMENTO ─────────────────────────────────────────────────
async function renderizarPagamento() {
    try {
        const snap = await getDoc(REF_PAGAMENTO);
        const dados = snap.exists() ? snap.data() : {};

        el('association-price').innerText = formatarMoeda(dados.valor ?? 20);
        el('association-pix-key').innerText = dados.chavePix || 'Nenhuma chave PIX cadastrada.';
        el('association-payment-note').innerText = dados.observacao || 'Use esta área para contribuir com a associação e manter a Base26 ativa.';

        const img = el('association-qrcode');
        const empty = el('association-qrcode-empty');

        const qrUrl = dados.qrCodeImg || gerarUrlQrCode(dados.chavePix);

        if (qrUrl) {
            img.src = qrUrl;
            img.style.display = 'block';
            empty.style.display = 'none';
        } else {
            img.style.display = 'none';
            empty.style.display = 'block';
        }
    } catch (err) {
        el('association-price').innerText = 'Erro';
        el('association-pix-key').innerText = err.message;
    }
}

const paymentModal = el('payment-modal');

el('btn-edit-payment')?.addEventListener('click', abrirModalPagamento);
el('btn-admin-open-payment-editor')?.addEventListener('click', abrirModalPagamento);

async function abrirModalPagamento() {
    if (!podeEditarPagamento(usuarioLogado)) return;

    const snap = await getDoc(REF_PAGAMENTO);
    const dados = snap.exists() ? snap.data() : {};

    el('payment-edit-price').value = dados.valor ?? 20;
    el('payment-edit-pix-key').value = dados.chavePix || '';
    el('payment-edit-note').value = dados.observacao || '';
    el('payment-edit-qrcode').value = '';

    paymentModal?.classList.remove('hidden');
}

el('close-payment-modal')?.addEventListener('click', () => paymentModal?.classList.add('hidden'));
paymentModal?.addEventListener('click', (e) => {
    if (e.target === paymentModal) paymentModal.classList.add('hidden');
});

el('btn-save-payment')?.addEventListener('click', async () => {
    if (!podeEditarPagamento(usuarioLogado)) return;

    const btn = el('btn-save-payment');
    btn.disabled = true;
    btn.textContent = 'Salvando...';

    try {
        const updates = {
            valor: Number(el('payment-edit-price').value || 20),
            chavePix: el('payment-edit-pix-key').value.trim(),
            observacao: el('payment-edit-note').value.trim(),
            atualizadoPor: usuarioLogado.id,
            atualizadoEm: serverTimestamp()
        };

        const qrFile = el('payment-edit-qrcode').files[0];
        if (qrFile) {
            const url = await uploadImagem(
                qrFile,
                `configuracoes/pagamento/qrcode_${Date.now()}`,
                (pct) => atualizarProgresso(pct, `Enviando QR Code... ${pct}%`)
            );
            updates.qrCodeImg = url;
        }

        await setDoc(REF_PAGAMENTO, updates, { merge: true });
        paymentModal.classList.add('hidden');
        await renderizarPagamento();
    } catch (err) {
        alert('Erro ao salvar pagamento: ' + err.message);
    } finally {
        btn.disabled = false;
        btn.textContent = 'Salvar Pagamento';
        removerProgresso();
    }
});
// ── EVENTOS DA AGENDA ─────────────────────────────────────────
const eventModal = el('event-modal');

async function renderizarEventos() {
    const container = el('events-list');
    if (!container) return;

    container.innerHTML = '<p class="text-muted">Carregando eventos...</p>';

    const snap = await getDocs(query(COL_EVENTOS, orderBy('data', 'asc')));
    container.innerHTML = '';

    snap.forEach((docSnap) => {
        const ev = { id: docSnap.id, ...docSnap.data() };
        const statusMap = {
            active: 'Confirmado',
            done: 'Realizado',
            canceled: 'Cancelado'
        };

        const card = document.createElement('div');
        card.className = 'event-card';

        card.innerHTML = `
            ${ev.capaImg ? `
                <div style="margin:-16px -16px 14px -16px;">
                    <img src="${ev.capaImg}" alt="${escapeHtml(ev.nome)}"
                        style="width:100%;height:220px;object-fit:cover;border-radius:8px 8px 0 0;">
                </div>` : ''
            }
            <div class="event-header-row">
                <h3>${escapeHtml(ev.nome || 'Evento')}</h3>
                <div class="event-actions">
                    ${podeEditarAgenda(usuarioLogado) ? `
                        <button title="Editar" onclick="window.abrirEdicaoEvento('${ev.id}')">✏️</button>
                        <button title="Excluir" onclick="window.excluirEvento('${ev.id}')">🗑️</button>
                    ` : ''}
                </div>
            </div>
            <div class="event-details">
                <p>🕒 ${formatarDataHoraBR(ev.data)}</p>
                <p>📍 ${ev.local?.startsWith('http')
                    ? `<a href="${ev.local}" target="_blank">Abrir no Maps</a>`
                    : escapeHtml(ev.local || 'Local não informado')}</p>
                ${ev.descricao ? `<p>📝 ${escapeHtml(ev.descricao)}</p>` : ''}
            </div>
            <span class="status-badge status-${ev.status || 'active'}">${statusMap[ev.status] || ev.status || 'Confirmado'}</span>
        `;

        container.appendChild(card);
    });

    if (!container.children.length) {
        container.innerHTML = '<p class="text-muted">Nenhum evento agendado.</p>';
    }
}

el('btn-new-event')?.addEventListener('click', () => {
    eventoEmEdicaoId = null;
    el('event-modal-title').innerText = 'Agendar Novo Encontro';
    ['event-nome', 'event-data', 'event-local', 'event-desc'].forEach((id) => {
        if (el(id)) el(id).value = '';
    });
    el('event-status').value = 'active';
    el('event-cover-image').value = '';
    eventModal?.classList.remove('hidden');
});

window.abrirEdicaoEvento = async function (id) {
    if (!podeEditarAgenda(usuarioLogado)) return;

    const snap = await getDoc(doc(db, 'eventos', id));
    if (!snap.exists()) return;

    const ev = snap.data();
    el('event-nome').value = ev.nome || '';
    el('event-data').value = ev.data || '';
    el('event-local').value = ev.local || '';
    el('event-desc').value = ev.descricao || '';
    el('event-status').value = ev.status || 'active';
    el('event-cover-image').value = '';
    eventoEmEdicaoId = id;
    el('event-modal-title').innerText = 'Editar Encontro';
    eventModal?.classList.remove('hidden');
};

el('btn-save-event')?.addEventListener('click', async () => {
    if (!podeEditarAgenda(usuarioLogado)) return;

    const nome = el('event-nome').value.trim();
    const data = el('event-data').value;
    const local = el('event-local').value.trim();
    const status = el('event-status').value;
    const descricao = el('event-desc').value.trim();
    const capaFile = el('event-cover-image').files[0];

    if (!nome || !data || !local) {
        alert('Preencha nome, data e local.');
        return;
    }

    const payload = {
        nome,
        data,
        local,
        status,
        descricao,
        atualizadoPor: usuarioLogado.id,
        atualizadoEm: serverTimestamp()
    };

    try {
        if (capaFile) {
            payload.capaImg = await uploadImagem(
                capaFile,
                `eventos/agenda/${Date.now()}_${nome.replace(/\s+/g, '_')}`,
                (pct) => atualizarProgresso(pct, `Enviando capa... ${pct}%`)
            );
        }

        if (eventoEmEdicaoId) {
            await updateDoc(doc(db, 'eventos', eventoEmEdicaoId), payload);
        } else {
            await addDoc(COL_EVENTOS, {
                ...payload,
                criadoEm: serverTimestamp(),
                criadoPor: usuarioLogado.id
            });
        }

        eventModal?.classList.add('hidden');
        await renderizarEventos();
    } catch (err) {
        alert('Erro ao salvar evento: ' + err.message);
    } finally {
        removerProgresso();
    }
});

window.excluirEvento = async function (id) {
    if (!podeEditarAgenda(usuarioLogado)) return;
    if (confirm('Excluir este evento?')) {
        await deleteDoc(doc(db, 'eventos', id));
        await renderizarEventos();
    }
};

el('close-event-modal')?.addEventListener('click', () => eventModal?.classList.add('hidden'));
eventModal?.addEventListener('click', (e) => {
    if (e.target === eventModal) eventModal.classList.add('hidden');
});

// ── EVENTOS REALIZADOS / HISTÓRICO ────────────────────────────
const historicEventModal = el('historic-event-modal');
const historicEventViewModal = el('historic-event-view-modal');

async function renderizarEventosHistoricos() {
    const container = el('historic-events-list');
    if (!container) return;

    container.innerHTML = '<p class="text-muted">Carregando eventos realizados...</p>';

    const snap = await getDocs(query(COL_EVENTOS_HISTORICO, orderBy('data', 'desc')));
    container.innerHTML = '';

    snap.forEach((docSnap) => {
        const ev = { id: docSnap.id, ...docSnap.data() };
        const card = document.createElement('div');
        card.className = 'historic-event-card';
        card.innerHTML = `
            <img class="historic-event-cover"
                 src="${ev.capaImg || 'https://via.placeholder.com/800x400?text=Evento'}"
                 alt="${escapeHtml(ev.titulo || 'Evento')}">
            <div class="historic-event-body">
                <h3>${escapeHtml(ev.titulo || 'Evento realizado')}</h3>
                <p>${formatarDataBR(ev.data)}</p>
                <p style="margin-top:8px;">${escapeHtml(resumoTexto(ev.descricao || 'Sem descrição.', 100))}</p>
                ${podeEditarHistorico(usuarioLogado) ? `
                    <div class="event-actions" style="margin-top:12px;">
                        <button title="Editar" onclick="window.editarEventoHistorico('${ev.id}')">✏️</button>
                        <button title="Excluir" onclick="window.excluirEventoHistorico('${ev.id}')">🗑️</button>
                    </div>
                ` : ''}
            </div>
        `;
        card.addEventListener('click', (e) => {
            const target = e.target;
            if (target.tagName === 'BUTTON') return;
            abrirEventoHistorico(ev);
        });
        container.appendChild(card);
    });

    if (!container.children.length) {
        container.innerHTML = '<p class="text-muted">Nenhum evento realizado cadastrado ainda.</p>';
    }
}

function abrirEventoHistorico(ev) {
    eventoVisualizado = ev;

    const banner = el('historic-view-banner');
    if (ev.capaImg) {
        banner.style.backgroundImage = `url('${ev.capaImg}')`;
        banner.style.backgroundColor = 'transparent';
    } else {
        banner.style.backgroundImage = 'none';
        banner.style.backgroundColor = 'var(--bg-panel)';
    }

    el('historic-view-title').innerText = ev.titulo || 'Evento';
    el('historic-view-date-badge').innerText = formatarDataBR(ev.data);
    el('historic-view-description').innerText = ev.descricao || 'Sem descrição.';

    const galeria = el('historic-view-gallery');
    galeria.innerHTML = '';

    (ev.galeria || []).forEach((url) => {
        galeria.innerHTML += `<img src="${url}" loading="lazy" alt="Foto do evento">`;
    });

    if (!(ev.galeria || []).length) {
        galeria.innerHTML = '<p class="text-muted">Nenhuma imagem adicional cadastrada.</p>';
    }

    historicEventViewModal?.classList.remove('hidden');
}

el('btn-new-historic-event')?.addEventListener('click', abrirModalEventoHistorico);
el('btn-admin-open-historic-editor')?.addEventListener('click', abrirModalEventoHistorico);
el('btn-view-historic-events')?.addEventListener('click', () => {
    document.querySelector('[data-target="about-section"]')?.click();
});

function abrirModalEventoHistorico() {
    if (!podeEditarHistorico(usuarioLogado)) return;

    eventoHistoricoEmEdicaoId = null;
    el('historic-event-modal-title').innerText = 'Adicionar Evento Realizado';
    el('historic-event-title').value = '';
    el('historic-event-date').value = '';
    el('historic-event-description').value = '';
    el('historic-event-cover').value = '';
    el('historic-event-gallery').value = '';
    historicEventModal?.classList.remove('hidden');
}

window.editarEventoHistorico = async function (id) {
    if (!podeEditarHistorico(usuarioLogado)) return;
    const snap = await getDoc(doc(db, 'eventos_historico', id));
    if (!snap.exists()) return;

    const ev = snap.data();
    eventoHistoricoEmEdicaoId = id;

    el('historic-event-modal-title').innerText = 'Editar Evento Realizado';
    el('historic-event-title').value = ev.titulo || '';
    el('historic-event-date').value = ev.data || '';
    el('historic-event-description').value = ev.descricao || '';
    el('historic-event-cover').value = '';
    el('historic-event-gallery').value = '';
    historicEventModal?.classList.remove('hidden');
};

window.excluirEventoHistorico = async function (id) {
    if (!podeEditarHistorico(usuarioLogado)) return;
    if (!confirm('Excluir este evento realizado?')) return;
    await deleteDoc(doc(db, 'eventos_historico', id));
    await renderizarEventosHistoricos();
};

el('close-historic-event-modal')?.addEventListener('click', () => historicEventModal?.classList.add('hidden'));
historicEventModal?.addEventListener('click', (e) => {
    if (e.target === historicEventModal) historicEventModal.classList.add('hidden');
});

el('close-historic-event-view-modal')?.addEventListener('click', () => historicEventViewModal?.classList.add('hidden'));
historicEventViewModal?.addEventListener('click', (e) => {
    if (e.target === historicEventViewModal) historicEventViewModal.classList.add('hidden');
});

el('btn-save-historic-event')?.addEventListener('click', async () => {
    if (!podeEditarHistorico(usuarioLogado)) return;

    const titulo = el('historic-event-title').value.trim();
    const data = el('historic-event-date').value;
    const descricao = el('historic-event-description').value.trim();
    const capaFile = el('historic-event-cover').files[0];
    const galeriaFiles = Array.from(el('historic-event-gallery').files || []).slice(0, 5);

    if (!titulo || !data) {
        alert('Preencha ao menos o título e a data do evento.');
        return;
    }

    const btn = el('btn-save-historic-event');
    btn.disabled = true;
    btn.textContent = 'Salvando...';

    try {
        const payload = {
            titulo,
            data,
            descricao,
            atualizadoPor: usuarioLogado.id,
            atualizadoEm: serverTimestamp()
        };

        if (capaFile) {
            payload.capaImg = await uploadImagem(
                capaFile,
                `eventos/historico/capa_${Date.now()}_${titulo.replace(/\s+/g, '_')}`,
                (pct) => atualizarProgresso(pct, `Enviando capa... ${pct}%`)
            );
        }

        if (galeriaFiles.length) {
            const urls = [];
            for (let i = 0; i < galeriaFiles.length; i++) {
                const file = galeriaFiles[i];
                const url = await uploadImagem(
                    file,
                    `eventos/historico/galeria_${Date.now()}_${i}`,
                    (pct) => {
                        const total = Math.round(((i + pct / 100) / galeriaFiles.length) * 100);
                        atualizarProgresso(total, `Enviando galeria ${i + 1}/${galeriaFiles.length}... ${total}%`);
                    }
                );
                urls.push(url);
            }
            payload.galeria = urls;
        }

        if (eventoHistoricoEmEdicaoId) {
            await updateDoc(doc(db, 'eventos_historico', eventoHistoricoEmEdicaoId), payload);
        } else {
            await addDoc(COL_EVENTOS_HISTORICO, {
                ...payload,
                criadoPor: usuarioLogado.id,
                criadoEm: serverTimestamp()
            });
        }

        historicEventModal?.classList.add('hidden');
        await renderizarEventosHistoricos();
    } catch (err) {
        alert('Erro ao salvar evento realizado: ' + err.message);
    } finally {
        btn.disabled = false;
        btn.textContent = 'Salvar Evento Realizado';
        removerProgresso();
    }
});

// ── RANKING ───────────────────────────────────────────────────
async function obterRankingUsuarios() {
    const snap = await getDocs(COL_USUARIOS);
    const usuarios = [];

    snap.forEach((docSnap) => {
        const data = docSnap.data();
        if (!data.aprovado || !data.carro?.modelo) return;
        usuarios.push({
            id: docSnap.id,
            ...data,
            _curtidas: totalCurtidasUsuario(data)
        });
    });

    usuarios.sort((a, b) => {
        if (b._curtidas !== a._curtidas) return b._curtidas - a._curtidas;
        return (a.nome || '').localeCompare(b.nome || '', 'pt-BR');
    });

    return usuarios;
}

async function renderizarRanking() {
    const ranking = await obterRankingUsuarios();

    const podium = el('ranking-podium');
    const lista = el('ranking-list');
    if (!podium || !lista) return;

    podium.innerHTML = '';
    lista.innerHTML = '';

    const top3 = ranking.slice(0, 3);
    const labels = [
        { texto: '1º Lugar', classe: 'gold', card: 'first' },
        { texto: '2º Lugar', classe: 'silver', card: 'second' },
        { texto: '3º Lugar', classe: 'bronze', card: 'third' }
    ];

    top3.forEach((u, idx) => {
        const posInfo = labels[idx];
        const card = document.createElement('div');
        card.className = `podium-card ${posInfo.card}`;
        card.innerHTML = `
            <div class="podium-top">
                <span class="podium-badge ${posInfo.classe}">${posInfo.texto}</span>
                <img class="podium-image" src="${getImagemPrincipalUsuario(u)}" alt="${escapeHtml(u.carro.modelo)}">
            </div>
            <div class="podium-body">
                <h3>${escapeHtml(u.carro.modelo)}</h3>
                <p>${escapeHtml(u.nome)}</p>
                <p style="margin-top:8px;">❤️ ${u._curtidas} curtida${u._curtidas === 1 ? '' : 's'}</p>
            </div>
        `;
        card.addEventListener('click', () => abrirModalPerfil(u.id));
        podium.appendChild(card);
    });

    ranking.forEach((u, idx) => {
        const item = document.createElement('div');
        item.className = 'ranking-list-item';
        item.innerHTML = `
            <div class="ranking-left">
                <div class="ranking-position">${idx + 1}</div>
                <img class="ranking-thumb" src="${getImagemPrincipalUsuario(u)}" alt="${escapeHtml(u.carro.modelo)}">
                <div class="ranking-info">
                    <h4>${escapeHtml(u.carro.modelo)}</h4>
                    <p>${escapeHtml(u.nome)} ${u.tag ? '• ' + escapeHtml(u.tag) : ''}</p>
                </div>
            </div>
            <div class="ranking-right">
                <strong>${u._curtidas}</strong><br>
                <span>curtida${u._curtidas === 1 ? '' : 's'}</span>
            </div>
        `;
        item.addEventListener('click', () => abrirModalPerfil(u.id));
        lista.appendChild(item);
    });

    if (!ranking.length) {
        podium.innerHTML = '<p class="text-muted">Nenhum carro disponível para ranking.</p>';
        lista.innerHTML = '';
    }
}

el('btn-refresh-ranking')?.addEventListener('click', renderizarRanking);
el('btn-refresh-garage')?.addEventListener('click', renderizarGaragem);
// ── MODAL DE PERFIL ───────────────────────────────────────────
const profileModal = el('profile-modal');

window.abrirModalPerfil = async function (userId) {
    usuarioPerfilAbertoId = userId;

    const snap = await getDoc(doc(db, 'usuarios', userId));
    if (!snap.exists()) return;

    const data = snap.data();

    el('modal-name').innerText = data.nome || '';
    el('modal-id').innerText = data.tag || '';
    el('modal-bio').innerText = data.bio || '';
    el('modal-avatar').src = data.avatar || '';
    el('modal-avatar').style.borderColor = data.themeColor || 'var(--bg-base)';

    const bannerDiv = el('modal-banner');
    if (data.bannerImg && data.bannerImg !== 'none') {
        bannerDiv.style.backgroundImage = `url('${data.bannerImg}')`;
        bannerDiv.style.backgroundColor = 'transparent';
    } else {
        bannerDiv.style.backgroundImage = 'none';
        bannerDiv.style.backgroundColor = data.themeColor || 'var(--bg-panel)';
    }

    const badges = el('modal-badges');
    const infoCargo = obterCargo(data);
    badges.innerHTML = `<span class="badge ${infoCargo.classe}">${infoCargo.texto}</span>`;
    if (data.carro?.modelo) {
        badges.innerHTML += `<span class="badge car-badge"
            style="border-color:${data.themeColor};color:${data.themeColor}">🚗 ${escapeHtml(data.carro.modelo)}</span>`;
    }

    const carContainer = el('modal-car-card');
    if (data.carro?.modelo) {
        carContainer.style.borderLeft = `3px solid ${data.themeColor}`;
        carContainer.innerHTML = `
            ${data.carro.fotoThumb ? `<img src="${data.carro.fotoThumb}" loading="lazy">` : ''}
            <div>
                <p>⚙️ <strong>${escapeHtml(data.carro.modelo)} ${data.carro.ano ? `(${escapeHtml(data.carro.ano)})` : ''}</strong></p>
                <p class="text-muted" style="font-size:0.85rem">${escapeHtml(data.carro.specs || '')}</p>
            </div>`;
    } else {
        carContainer.innerHTML = '<p>Nenhum veículo cadastrado.</p>';
        carContainer.style.borderLeft = 'none';
    }

    const grid = el('modal-insta-grid');
    grid.innerHTML = '';
    (data.galeria || []).forEach((url) => {
        grid.innerHTML += `<img src="${url}" loading="lazy">`;
    });

    const totalCurtidas = totalCurtidasUsuario(data);
    el('modal-car-likes').innerText = String(totalCurtidas);

    const adminControls = el('modal-admin-controls');
    const eu = usuarioLogado;
    const possoModerar = userId !== eu.id &&
        (eu.cargo === '🛠️ Criador' || (eu.isAdmin && !data.isAdmin && !data.cargo));
    adminControls.classList.toggle('hidden', !possoModerar);

    const btnCurtir = el('btn-like-car');
    const btnDescurtir = el('btn-unlike-car');
    const meuCarro = userId === usuarioLogado.id;
    const curtiu = usuarioCurtiuCarro(data, usuarioLogado.id);

    if (meuCarro) {
        btnCurtir.classList.add('hidden');
        btnDescurtir.classList.add('hidden');
    } else {
        btnCurtir.classList.toggle('hidden', curtiu);
        btnDescurtir.classList.toggle('hidden', !curtiu);

        btnCurtir.onclick = async () => {
            await alternarCurtidaCarro(userId);
        };
        btnDescurtir.onclick = async () => {
            await alternarCurtidaCarro(userId);
        };
    }

    const btnModerarBio = el('btn-modal-moderate-bio');
    const btnRemoverFotos = el('btn-modal-remove-photos');

    btnModerarBio.onclick = async () => {
        const novaBio = prompt(`Editar bio de ${data.nome}:`, data.bio || '');
        if (novaBio === null) return;
        await updateDoc(doc(db, 'usuarios', userId), { bio: novaBio.trim() });
        await abrirModalPerfil(userId);
        await renderizarMeuPerfilTab();
    };

    btnRemoverFotos.onclick = async () => {
        if (!confirm(`Remover todas as fotos da galeria de ${data.nome}?`)) return;
        await updateDoc(doc(db, 'usuarios', userId), { galeria: [] });
        await abrirModalPerfil(userId);
    };

    profileModal?.classList.remove('hidden');
};

el('close-modal')?.addEventListener('click', () => profileModal?.classList.add('hidden'));
profileModal?.addEventListener('click', (e) => {
    if (e.target === profileModal) profileModal.classList.add('hidden');
});

// ── PAINEL DA DIRETORIA ───────────────────────────────────────
async function renderizarAdminPanel() {
    const container = el('admin-users-list');
    if (!container) return;

    container.innerHTML = '';

    if (!isDiretoriaPlus(usuarioLogado)) {
        container.innerHTML = '<p class="text-muted">Sem permissão.</p>';
        return;
    }

    const allSnap = await getDocs(COL_USUARIOS);
    const pendentes = [];

    allSnap.forEach((d) => {
        if (!d.data().aprovado) pendentes.push({ id: d.id, ...d.data() });
    });

    const pendingSection = el('pending-users-section');
    const pendingList = el('pending-users-list');

    if (pendentes.length > 0) {
        pendingSection.classList.remove('hidden');
        pendingList.innerHTML = '';

        pendentes.forEach((u) => {
            pendingList.innerHTML += `
                <div class="admin-user-card" style="border-left-color:var(--yellow);">
                    <div class="admin-user-info">
                        <img src="${u.avatar}" loading="lazy">
                        <div>
                            <h4 style="color:var(--white);">${escapeHtml(u.nome)}
                                <span class="badge pending-badge" style="margin-left:8px;">Pendente</span>
                            </h4>
                            <p style="font-size:0.8rem;color:var(--text-muted);">${escapeHtml(u.email)} | ${escapeHtml(u.carro?.modelo || 'Sem veículo')}</p>
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
    } else {
        pendingSection.classList.add('hidden');
    }

    const eu = usuarioLogado;

    allSnap.forEach((docSnap) => {
        const data = docSnap.data();
        if (!data.aprovado) return;

        const userId = docSnap.id;
        const isMe = userId === eu.id;
        const infoCargo = obterCargo(data);

        let podeEditar = false;
        let msgBloqueio = '';

        if (isMe) {
            msgBloqueio = 'Seu Perfil (Intocável)';
        } else if (eu.cargo === '🛠️ Criador') {
            podeEditar = true;
        } else if (eu.cargo === '👑 Presidente') {
            (data.cargo === '🛠️ Criador' || data.cargo === '👑 Presidente')
                ? msgBloqueio = 'Hierarquia Superior'
                : podeEditar = true;
        } else if (eu.isAdmin) {
            (data.cargo || data.isAdmin)
                ? msgBloqueio = 'Hierarquia Superior ou Igual'
                : podeEditar = true;
        }

        container.innerHTML += `
            <div class="admin-user-card">
                <div class="admin-user-info">
                    <img src="${data.avatar}" loading="lazy">
                    <div>
                        <h4 style="color:var(--white);">${escapeHtml(data.nome)}
                            <span class="text-muted" style="font-size:0.85rem">${escapeHtml(data.tag || '')}</span>
                        </h4>
                        <p style="font-size:0.8rem;color:var(--text-muted);">${infoCargo.texto} | ${escapeHtml(data.carro?.modelo || 'Sem veículo')}</p>
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
        await renderizarAdminPanel();
        await renderizarMembros();
    }
};

window.rejeitarMembro = async function (userId) {
    if (confirm('⚠️ Rejeitar e excluir este cadastro permanentemente?')) {
        await deleteDoc(doc(db, 'usuarios', userId));
        await renderizarAdminPanel();
    }
};

window.alternarCargo = async function (userId) {
    const snap = await getDoc(doc(db, 'usuarios', userId));
    if (!snap.exists()) return;

    const data = snap.data();
    if (confirm(`Alterar cargo de ${data.nome} para ${data.isAdmin ? 'Membro' : 'Diretoria'}?`)) {
        const newAdmin = !data.isAdmin;
        await updateDoc(doc(db, 'usuarios', userId), {
            isAdmin: newAdmin,
            ...(newAdmin ? {} : { cargo: '' })
        });
        await renderizarAdminPanel();
        await renderizarMembros();
    }
};

window.mudarTag = async function (userId) {
    const snap = await getDoc(doc(db, 'usuarios', userId));
    if (!snap.exists()) return;

    const novaTag = prompt(`Nova tag para ${snap.data().nome}:`, snap.data().tag);
    if (novaTag?.trim()) {
        const tag = normalizarTag(novaTag);
        await updateDoc(doc(db, 'usuarios', userId), { tag });
        await renderizarAdminPanel();
        await renderizarMembros();
    }
};

window.banirMembro = async function (userId) {
    const snap = await getDoc(doc(db, 'usuarios', userId));
    if (!snap.exists()) return;

    if (confirm(`⚠️ Banir ${snap.data().nome}? Isso remove o acesso permanentemente.`)) {
        await deleteDoc(doc(db, 'usuarios', userId));
        await renderizarTudo();
    }
};