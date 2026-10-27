// ===== ProfileVerse — lógica principal =====
// Firebase via CDN modular (v11). Abra com um servidor local (ex.: "npx serve" ou Live Server).
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js";
import {
  getFirestore, collection, doc, getDoc, setDoc, addDoc, updateDoc, deleteDoc,
  onSnapshot, query, orderBy, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";

/* ---------- firebase-config ---------- */
// Preencha apiKey com a chave Web do seu projeto (Console Firebase → Configurações do projeto).
// A configuração Web é pública; quem protege os dados são as Regras do Firestore.
const firebaseConfig = {
  apiKey: "COLE_AQUI_SUA_API_KEY",
  authDomain: "nuvem2-pwave.firebaseapp.com",
  projectId: "nuvem2-pwave",
  storageBucket: "nuvem2-pwave.firebasestorage.app",
  messagingSenderId: "116152178500",
  appId: "1:116152178500:web:051baf5a4a6bc64e67a911",
};
const db = getFirestore(initializeApp(firebaseConfig));
const COL = "profiles";

/* ---------- utilidades ---------- */
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const GENDER = { male: "Masculino", female: "Feminino", other: "Outro" };
const FALLBACK = "data:image/svg+xml;utf8," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#e3ebfb"/><circle cx="32" cy="25" r="11" fill="#5a7bd8"/><path d="M12 56c3-11 11-16 20-16s17 5 20 16" fill="#5a7bd8"/></svg>');
const fmtDate = (d) => (d ? d.toLocaleString("pt-BR") : "—");
const toDate = (v) => (v && typeof v.toDate === "function" ? v.toDate() : null);
const imgTag = (src, name, cls) => `<img class="${cls}" src="${esc(src || FALLBACK)}" alt="Foto de ${esc(name)}" loading="lazy" onerror="this.onerror=null;this.src='${FALLBACK}'">`;

/* ---------- notifications ---------- */
function toast(msg, type = "info") {
  const el = document.createElement("div");
  el.className = `toast toast--${type}`;
  el.textContent = msg;
  $("#toasts").append(el);
  setTimeout(() => el.remove(), 4200);
}
function friendly(e) {
  if (e?.code === "permission-denied") return "Acesso negado pelo Firestore. Verifique as regras de segurança.";
  if (e?.code === "unavailable") return "Firestore indisponível. Verifique sua conexão.";
  if (e?.code?.includes?.("api-key")) return "API key do Firebase inválida. Confira o firebaseConfig.";
  return e?.message || "Erro inesperado.";
}

/* ---------- modais ---------- */
function openOverlay(id) { const o = $(id); o.hidden = false; o.querySelector("input,select,button")?.focus(); }
function closeOverlay(id) { $(id).hidden = true; }
document.querySelectorAll(".overlay").forEach((o) => {
  o.addEventListener("click", (e) => { if (e.target === o || e.target.closest("[data-close]")) o.hidden = true; });
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") [...document.querySelectorAll(".overlay:not([hidden])")].pop()?.setAttribute("hidden", "");
});

/* ---------- random-user-service ---------- */
async function fetchRandomProfiles(n) {
  let res;
  try { res = await fetch(`https://randomuser.me/api/?results=${n}&noinfo`); }
  catch { throw new Error("Não foi possível conectar à Random User API."); }
  if (!res.ok) throw new Error(`Random User API indisponível (erro ${res.status}).`);
  const data = await res.json().catch(() => null);
  if (!data?.results?.length) throw new Error("A API retornou uma resposta inválida.");
  return data.results.map((r) => ({
    externalId: r.login.uuid, firstName: r.name.first, lastName: r.name.last,
    photoURL: r.picture.large, thumbnailURL: r.picture.thumbnail, email: r.email,
    age: r.dob.age, gender: ["male", "female"].includes(r.gender) ? r.gender : "other",
    city: r.location.city, state: r.location.state, country: r.location.country,
    phone: r.phone, cell: r.cell, source: "randomuser.me",
  }));
}

/* ---------- profile-service (CRUD Firestore) ---------- */
function payload(p) {
  const firstName = p.firstName.trim(), lastName = p.lastName.trim();
  return {
    externalId: p.externalId ?? null, firstName, lastName, fullName: `${firstName} ${lastName}`,
    photoURL: (p.photoURL || "").trim(), thumbnailURL: (p.thumbnailURL || p.photoURL || "").trim(),
    email: p.email.trim().toLowerCase(), age: Number(p.age), gender: p.gender,
    city: p.city.trim(), state: (p.state || "").trim(), country: p.country.trim(),
    phone: (p.phone || "").trim(), cell: (p.cell || "").trim(), source: p.source,
  };
}
async function createProfile(p) {
  if (p.externalId) { // UUID da API como ID do documento → sem duplicatas
    const ref = doc(db, COL, p.externalId);
    if ((await getDoc(ref)).exists()) return "duplicate";
    await setDoc(ref, { ...payload(p), createdAt: serverTimestamp(), updatedAt: null });
  } else {
    await addDoc(collection(db, COL), { ...payload(p), createdAt: serverTimestamp(), updatedAt: null });
  }
  return "created";
}
const updateProfile = (id, p) => updateDoc(doc(db, COL, id), { ...payload(p), updatedAt: serverTimestamp() });
const deleteProfile = (id) => deleteDoc(doc(db, COL, id));

/* ---------- estado ---------- */
const PAGE = 12;
const state = { profiles: [], loading: true, error: null, limit: PAGE, editing: null, viewing: null, deleting: null, generated: [], selected: new Set() };

/* ---------- profile-list ---------- */
function filtered() {
  const t = $("#fSearch").value.trim().toLowerCase(), c = $("#fCountry").value, g = $("#fGender").value, s = $("#fSource").value, sort = $("#fSort").value;
  const list = state.profiles.filter((p) =>
    (!t || `${p.firstName} ${p.lastName} ${p.email}`.toLowerCase().includes(t)) &&
    (c === "all" || p.country === c) && (g === "all" || p.gender === g) &&
    (s === "all" || (s === "manual" ? p.source === "manual" : p.source !== "manual")));
  if (sort === "name") list.sort((a, b) => a.fullName.localeCompare(b.fullName, "pt-BR"));
  else if (sort === "oldest") list.reverse();
  return list;
}
function hasFilters() { return $("#fSearch").value || ["#fCountry", "#fGender", "#fSource"].some((s) => $(s).value !== "all"); }

function cardHTML(p) {
  return `<article class="card pcard" data-id="${esc(p.id)}">
    <button class="pcard__top" data-act="view">${imgTag(p.photoURL, p.fullName, "avatar")}
      <div><h3>${esc(p.fullName)}</h3><p class="muted">${esc(p.age)} anos · ${GENDER[p.gender] || esc(p.gender)}</p></div></button>
    <div class="pcard__info"><span>📍 ${esc(p.city)}, ${esc(p.country)}</span><span>✉️ ${esc(p.email)}</span></div>
    <div class="pcard__foot"><span class="badge">${p.source === "manual" ? "Manual" : "API"}</span>
      <div><button class="icon-btn" data-act="view" aria-label="Ver detalhes de ${esc(p.fullName)}">👁</button>
      <button class="icon-btn" data-act="edit" aria-label="Editar ${esc(p.fullName)}">✎</button>
      <button class="icon-btn icon-btn--danger" data-act="delete" aria-label="Excluir ${esc(p.fullName)}">🗑</button></div></div>
  </article>`;
}

function render() {
  const list = filtered();
  const recent = state.profiles.filter((p) => p.createdAt && Date.now() - p.createdAt < 864e5).length;
  $("#stTotal").textContent = state.loading ? "—" : state.profiles.length;
  $("#stShown").textContent = state.loading ? "—" : list.length;
  $("#stRecent").textContent = state.loading ? "—" : recent;
  $("#btnClear").hidden = !hasFilters();

  // filtro de países dinâmico
  const sel = $("#fCountry"), cur = sel.value;
  const countries = [...new Set(state.profiles.map((p) => p.country))].sort();
  sel.innerHTML = `<option value="all">Todos os países</option>` + countries.map((c) => `<option>${esc(c)}</option>`).join("");
  sel.value = countries.includes(cur) ? cur : "all";

  const st = $("#listState"), grid = $("#grid");
  grid.innerHTML = ""; $("#btnMore").hidden = true;
  if (state.loading) { st.className = "state"; st.innerHTML = `<div class="spinner"></div>Conectando ao Firestore…`; st.hidden = false; return; }
  if (state.error) { st.className = "state state--box state--error"; st.innerHTML = `<h2>⚠️ Não foi possível carregar os perfis</h2><p>${esc(state.error)}</p>`; st.hidden = false; return; }
  if (!list.length) {
    const empty = !state.profiles.length;
    st.className = "state state--box";
    st.innerHTML = `<h2>${empty ? "Nenhum perfil cadastrado ainda" : "Nenhum perfil encontrado"}</h2>
      <p>${empty ? "Gere perfis pela API ou cadastre o primeiro manualmente." : "Ajuste a busca ou os filtros."}</p>
      <div class="row">${empty ? `<button class="btn btn--outline" data-empty="new">＋ Cadastrar</button><button class="btn btn--primary" data-empty="gen">✦ Gerar perfis</button>` : `<button class="btn btn--outline" data-empty="clear">Limpar filtros</button>`}</div>`;
    st.hidden = false; return;
  }
  st.hidden = true;
  grid.innerHTML = list.slice(0, state.limit).map(cardHTML).join("");
  if (list.length > state.limit) { $("#btnMore").hidden = false; $("#btnMore").textContent = `Carregar mais (${list.length - state.limit} restantes)`; }
  if (state.viewing) renderDetails();
}

/* ---------- tempo real (listener único) ---------- */
let unsubscribe = null;
function listen() {
  unsubscribe?.();
  unsubscribe = onSnapshot(query(collection(db, COL), orderBy("createdAt", "desc")),
    (snap) => {
      state.profiles = snap.docs.map((d) => { const x = d.data(); return { ...x, id: d.id, createdAt: toDate(x.createdAt), updatedAt: toDate(x.updatedAt) }; });
      state.loading = false; state.error = null; render(); renderGenerated();
    },
    (e) => { state.loading = false; state.error = friendly(e); render(); });
}
window.addEventListener("beforeunload", () => unsubscribe?.());

/* ---------- eventos da listagem ---------- */
["#fSearch", "#fCountry", "#fGender", "#fSource", "#fSort"].forEach((s) => $(s).addEventListener("input", () => { state.limit = PAGE; render(); }));
const clearFilters = () => { $("#fSearch").value = ""; ["#fCountry", "#fGender", "#fSource"].forEach((s) => ($(s).value = "all")); render(); };
$("#btnClear").addEventListener("click", clearFilters);
$("#btnMore").addEventListener("click", () => { state.limit += PAGE; render(); });
$("#listState").addEventListener("click", (e) => {
  const a = e.target.closest("[data-empty]")?.dataset.empty;
  if (a === "new") openForm(); else if (a === "gen") openOverlay("#genOverlay"); else if (a === "clear") clearFilters();
});
$("#grid").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-act]"); if (!btn) return;
  const p = state.profiles.find((x) => x.id === btn.closest(".pcard").dataset.id); if (!p) return;
  if (btn.dataset.act === "view") { state.viewing = p.id; renderDetails(); openOverlay("#detailOverlay"); }
  if (btn.dataset.act === "edit") openForm(p);
  if (btn.dataset.act === "delete") askDelete(p);
});

/* ---------- profile-form ---------- */
const form = $("#profileForm");
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
function validate(d) {
  const e = {};
  if (!d.firstName.trim()) e.firstName = "Informe o nome.";
  if (!d.lastName.trim()) e.lastName = "Informe o sobrenome.";
  if (!d.email.trim()) e.email = "Informe o e-mail."; else if (!EMAIL_RE.test(d.email.trim())) e.email = "E-mail em formato inválido.";
  const age = Number(d.age); if (!Number.isInteger(age) || age < 1 || age > 120) e.age = "Idade entre 1 e 120.";
  if (!d.city.trim()) e.city = "Informe a cidade.";
  if (!d.country.trim()) e.country = "Informe o país.";
  if (d.photoURL && !/^https?:\/\//i.test(d.photoURL.trim())) e.photoURL = "A URL deve começar com http(s)://.";
  return e;
}
function openForm(p = null) {
  state.editing = p;
  form.reset();
  form.querySelectorAll(".err").forEach((el) => (el.textContent = ""));
  form.querySelectorAll(".input").forEach((el) => el.removeAttribute("aria-invalid"));
  $("#formTitle").textContent = p ? "Editar perfil" : "Cadastrar perfil";
  $("#btnSubmit").textContent = p ? "Salvar alterações" : "Salvar perfil";
  if (p) {
    for (const el of form.elements) if (el.name && p[el.name] != null) el.value = p[el.name];
  } else {
    form.age.value = 18;
  }
  openOverlay("#formOverlay");
}
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const d = Object.fromEntries(new FormData(form));
  const errs = validate(d);
  for (const el of form.elements) {
    if (!el.name) continue;
    el.closest("label").querySelector(".err").textContent = errs[el.name] || "";
    errs[el.name] ? el.setAttribute("aria-invalid", "true") : el.removeAttribute("aria-invalid");
  }
  if (Object.keys(errs).length) return;
  const btn = $("#btnSubmit"); btn.disabled = true;
  try {
    if (state.editing) {
      await updateProfile(state.editing.id, { ...d, externalId: state.editing.externalId, source: state.editing.source, cell: state.editing.cell, thumbnailURL: d.photoURL === state.editing.photoURL ? state.editing.thumbnailURL : d.photoURL });
      toast("Perfil atualizado com sucesso.", "success");
    } else {
      await createProfile({ ...d, source: "manual", externalId: null });
      toast("Perfil cadastrado com sucesso.", "success");
    }
    closeOverlay("#formOverlay");
  } catch (err) { toast(friendly(err), "error"); }
  finally { btn.disabled = false; }
});
$("#btnNew").addEventListener("click", () => openForm());

/* ---------- profile-details ---------- */
function renderDetails() {
  const p = state.profiles.find((x) => x.id === state.viewing);
  if (!p) { closeOverlay("#detailOverlay"); state.viewing = null; return; }
  const img = $("#detPhoto"); img.src = p.photoURL || FALLBACK; img.alt = `Foto de ${p.fullName}`; img.onerror = () => (img.src = FALLBACK);
  $("#detName").textContent = p.fullName;
  const rows = [["E-mail", p.email], ["Idade", `${p.age} anos`], ["Gênero", GENDER[p.gender] || p.gender],
    ["Localização", [p.city, p.state, p.country].filter(Boolean).join(", ")], ["Telefone", p.phone || "—"], ["Celular", p.cell || "—"],
    ["Cadastrado em", fmtDate(p.createdAt)], ["Atualizado em", fmtDate(p.updatedAt)], ["Origem", p.source === "manual" ? "Cadastro manual" : "randomuser.me"]];
  $("#detList").innerHTML = rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join("");
}
$("#detEdit").addEventListener("click", () => { const p = state.profiles.find((x) => x.id === state.viewing); closeOverlay("#detailOverlay"); if (p) openForm(p); });
$("#detDelete").addEventListener("click", () => { const p = state.profiles.find((x) => x.id === state.viewing); if (p) askDelete(p); });

/* ---------- exclusão com confirmação ---------- */
function askDelete(p) { state.deleting = p; $("#delTitle").textContent = `Excluir ${p.fullName}?`; openOverlay("#delOverlay"); }
$("#btnConfirmDel").addEventListener("click", async () => {
  const p = state.deleting; if (!p) return;
  const btn = $("#btnConfirmDel"); btn.disabled = true;
  try {
    await deleteProfile(p.id);
    toast(`${p.fullName} foi excluído(a).`, "success");
    closeOverlay("#delOverlay");
    if (state.viewing === p.id) { state.viewing = null; closeOverlay("#detailOverlay"); }
  } catch (err) { toast(friendly(err), "error"); } // o card permanece visível em caso de falha
  finally { btn.disabled = false; state.deleting = null; }
});

/* ---------- gerador ---------- */
const savedIds = () => new Set(state.profiles.map((p) => p.externalId).filter(Boolean));
function renderGenerated() {
  if (!state.generated.length) return;
  const saved = savedIds();
  $("#genList").innerHTML = state.generated.map((p) => {
    const name = `${p.firstName} ${p.lastName}`, isSaved = saved.has(p.externalId);
    return `<div class="gitem"><input type="checkbox" data-id="${p.externalId}" ${state.selected.has(p.externalId) ? "checked" : ""} ${isSaved ? "disabled" : ""} aria-label="Selecionar ${esc(name)}">
      ${imgTag(p.thumbnailURL, name, "avatar avatar--sm")}
      <div><p><b>${esc(name)}</b></p><p class="muted" style="font-size:.78rem">${p.age} anos · ${GENDER[p.gender]} · ${esc(p.city)}, ${esc(p.country)}</p></div>
      ${isSaved ? `<span class="saved">Salvo</span>` : `<button class="btn btn--outline btn--sm" data-save="${p.externalId}">Salvar</button>`}</div>`;
  }).join("");
  const n = state.generated.filter((p) => state.selected.has(p.externalId) && !saved.has(p.externalId)).length;
  $("#genFoot").hidden = false; $("#genSel").textContent = `${n} selecionado(s)`; $("#btnSaveSel").disabled = !n;
}
$("#btnGen").addEventListener("click", () => openOverlay("#genOverlay"));
$("#btnDoGen").addEventListener("click", async () => {
  const btn = $("#btnDoGen"); btn.disabled = true;
  $("#genList").innerHTML = `<div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div>`;
  try {
    state.generated = await fetchRandomProfiles(Number($("#genCount").value));
    const saved = savedIds();
    state.selected = new Set(state.generated.filter((p) => !saved.has(p.externalId)).map((p) => p.externalId));
    btn.textContent = "Gerar novamente"; renderGenerated();
  } catch (e) {
    $("#genList").innerHTML = `<p class="alert">${esc(e.message)}</p>`; $("#genFoot").hidden = true; toast(e.message, "error");
  } finally { btn.disabled = false; }
});
async function saveMany(list) {
  if (!list.length) return;
  $("#btnSaveSel").disabled = true;
  let ok = 0, dup = 0, fail = 0, last = "";
  for (const p of list) {
    try { (await createProfile(p)) === "created" ? ok++ : dup++; state.selected.delete(p.externalId); }
    catch (e) { fail++; last = friendly(e); }
  }
  if (ok) toast(`${ok} perfil(is) cadastrado(s) no Firestore.`, "success");
  if (dup) toast(`${dup} perfil(is) já existia(m) e foi(ram) ignorado(s).`);
  if (fail) toast(`${fail} falha(s): ${last}`, "error");
  renderGenerated();
}
$("#genList").addEventListener("change", (e) => {
  const id = e.target.dataset?.id; if (!id) return;
  e.target.checked ? state.selected.add(id) : state.selected.delete(id); renderGenerated();
});
$("#genList").addEventListener("click", (e) => {
  const id = e.target.closest("[data-save]")?.dataset.save; if (!id) return;
  saveMany(state.generated.filter((p) => p.externalId === id));
});
$("#btnSaveSel").addEventListener("click", () => {
  const saved = savedIds();
  saveMany(state.generated.filter((p) => state.selected.has(p.externalId) && !saved.has(p.externalId)));
});

/* ---------- início ---------- */
render();
listen();
