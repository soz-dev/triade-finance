const STORAGE_KEY = "triade-registre-hebdo-v2";
const WEEKLY_TARGET_PER_MEMBER = 70000;
const ASSET_VERSION = "20260507h";
const cfg = window.TRIADE_CONFIG || {};
const SUPABASE_URL = String(cfg.supabaseUrl || "").trim();
const SUPABASE_ANON_KEY = String(cfg.supabaseAnonKey || "").trim();
const SUPABASE_STATE_ID = "global";

const membreForm = document.getElementById("membreForm");
const cotisationForm = document.getElementById("cotisationForm");
const memberSelect = document.getElementById("memberSelect");
const membreTableBody = document.getElementById("membreTableBody");
const historyTableBody = document.getElementById("historyTableBody");
const topBonusBody = document.getElementById("topBonusBody");
const badPayersBody = document.getElementById("badPayersBody");
const weekLabel = document.getElementById("weekLabel");
const weeklyTotalEl = document.getElementById("weeklyTotal");
const weeklyTargetEl = document.getElementById("weeklyTarget");
const lateCountEl = document.getElementById("lateCount");
const progressTotalEl = document.getElementById("progressTotal");
const progressTargetEl = document.getElementById("progressTarget");
const progressPercentEl = document.getElementById("progressPercent");
const progressFillEl = document.getElementById("progressFill");
const progressStatusEl = document.getElementById("progressStatus");
const stepLowEl = document.getElementById("stepLow");
const stepMidEl = document.getElementById("stepMid");
const stepHighEl = document.getElementById("stepHigh");
const adminForm = document.getElementById("adminForm");
const adminOffBtn = document.getElementById("adminOffBtn");
const adminStatus = document.getElementById("adminStatus");
const heroLogo = document.getElementById("heroLogo");
const tabButtons = document.querySelectorAll(".tab-btn");
const tabPages = document.querySelectorAll("[data-tab-page]");

/**
 * @typedef {{id:string,nom:string,prenom:string,pseudo:string,vip:"Oui"|"Non"}} Member
 * @typedef {{members: Member[], payments: Record<string, Record<string, number>>, selectedWeek: string}} State
 */

/** @type {State} */
let state = {
  members: [],
  payments: {},
  selectedWeek: currentWeek(),
};

let isAdmin = false;
/** @type {string} Mot de passe admin en mémoire uniquement (jamais stocké ni versionné). */
let adminPassword = "";
let activeTab = "cotiz-famille";
let saveTimer = null;
let cloudSaveInFlight = false;
let cloudSaveQueued = false;
let lastSyncedSnapshot = "";

function supabaseHeaders(extra = {}) {
  return {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

function formatNombre(value) {
  return new Intl.NumberFormat("fr-FR").format(value);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function capitalizeWord(word) {
  if (!word) return "";
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

function formatPersonName(value) {
  return String(value || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.split("-").map(capitalizeWord).join("-"))
    .join(" ");
}

function formatPseudo(value) {
  const cleaned = String(value || "").trim();
  if (!cleaned) return "";
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

function currentWeek() {
  const now = new Date();
  const d = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  queueCloudSave();
}

function applyLoadedState(raw) {
  if (!raw || typeof raw !== "object") return;
  if (Array.isArray(raw.members)) {
    state.members = raw.members;
  }
  if (raw.payments && typeof raw.payments === "object") {
    state.payments = raw.payments;
  }
  if (typeof raw.selectedWeek === "string") {
    state.selectedWeek = raw.selectedWeek;
  }
}

async function fetchCloudState() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
  try {
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/app_state?id=eq.${SUPABASE_STATE_ID}&select=state&limit=1`,
      {
        cache: "no-store",
        headers: supabaseHeaders(),
      }
    );
    if (!response.ok) return null;
    const data = await response.json();
    if (!Array.isArray(data) || !data.length) return null;
    const rawState = data[0]?.state;
    if (!rawState || typeof rawState !== "object") return null;
    return rawState;
  } catch {
    return null;
  }
}

function queueCloudSave() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !isAdmin || !adminPassword) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    pushCloudState();
  }, 250);
}

async function verifyAdminPassword(password) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !password) return false;
  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/verify_admin`, {
      method: "POST",
      headers: supabaseHeaders(),
      body: JSON.stringify({ p_password: password }),
    });
    if (!response.ok) return false;
    return (await response.json()) === true;
  } catch {
    return false;
  }
}

async function pushCloudState() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !isAdmin || !adminPassword) return;
  if (cloudSaveInFlight) {
    cloudSaveQueued = true;
    return;
  }
  cloudSaveInFlight = true;
  const snapshot = JSON.stringify(state);
  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/save_app_state`, {
      method: "POST",
      headers: supabaseHeaders(),
      body: JSON.stringify({
        p_state: state,
        p_password: adminPassword,
      }),
    });
    if (response.ok) {
      lastSyncedSnapshot = snapshot;
    }
  } catch {
    // Ignore transient cloud sync failures; local state stays usable.
  } finally {
    cloudSaveInFlight = false;
    if (cloudSaveQueued) {
      cloudSaveQueued = false;
      pushCloudState();
    }
  }
}

async function load() {
  try {
    const localRaw = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    applyLoadedState(localRaw);
  } catch {
    state = { members: [], payments: {}, selectedWeek: currentWeek() };
  }

  const cloudRaw = await fetchCloudState();
  if (cloudRaw) {
    applyLoadedState(cloudRaw);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }
  state.selectedWeek = currentWeek();
  lastSyncedSnapshot = JSON.stringify(state);
}

function startCloudPolling() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return;
  setInterval(async () => {
    const cloudRaw = await fetchCloudState();
    if (!cloudRaw) return;
    const snapshot = JSON.stringify(cloudRaw);
    if (!snapshot || snapshot === lastSyncedSnapshot) return;
    applyLoadedState(cloudRaw);
    state.selectedWeek = currentWeek();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    lastSyncedSnapshot = JSON.stringify(state);
    refreshAll();
  }, 8000);
}

function getPayment(memberId, week) {
  return Number(state.payments?.[week]?.[memberId] || 0);
}

function setPayment(memberId, week, amount) {
  if (!state.payments[week]) {
    state.payments[week] = {};
  }
  state.payments[week][memberId] = Math.max(0, Number(amount) || 0);
}

function removeMemberEverywhere(memberId) {
  state.members = state.members.filter((m) => m.id !== memberId);
  for (const week of Object.keys(state.payments)) {
    if (state.payments[week][memberId] !== undefined) {
      delete state.payments[week][memberId];
    }
  }
}

function allWeeks() {
  const set = new Set(Object.keys(state.payments));
  set.add(state.selectedWeek);
  return [...set].sort((a, b) => b.localeCompare(a));
}

function getStatusForPayment(amount, week) {
  if (amount >= WEEKLY_TARGET_PER_MEMBER) {
    return { label: "Payé", className: "status-paid" };
  }

  if (amount > 0) {
    return { label: "En cours", className: "status-in-progress" };
  }

  const nowWeek = currentWeek();
  if (week.localeCompare(nowWeek) < 0) {
    return { label: "Warning", className: "status-warning" };
  }

  return { label: "Pas payé", className: "status-unpaid" };
}

function renderMemberSelect() {
  memberSelect.innerHTML = "";
  if (!state.members.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "Aucun membre";
    memberSelect.appendChild(option);
    return;
  }

  for (const m of state.members) {
    const option = document.createElement("option");
    option.value = m.id;
    option.textContent = `${m.pseudo} (${m.nom} ${m.prenom})`;
    memberSelect.appendChild(option);
  }
}

function renderMainTable() {
  membreTableBody.innerHTML = "";
  const week = state.selectedWeek;

  for (const m of state.members) {
    const montant = getPayment(m.id, week);
    const restant = Math.max(0, WEEKLY_TARGET_PER_MEMBER - montant);
    const bonus = Math.max(0, montant - WEEKLY_TARGET_PER_MEMBER);
    const status = getStatusForPayment(montant, week);
    const nom = formatPersonName(m.nom);
    const prenom = formatPersonName(m.prenom);
    const pseudo = formatPseudo(m.pseudo);

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${nom}</td>
      <td>${prenom}</td>
      <td>${pseudo}</td>
      <td class="${m.vip === "Oui" ? "vip-oui" : "vip-non"}">${m.vip}</td>
      <td>${formatNombre(montant)}</td>
      <td>${formatNombre(restant)}</td>
      <td class="${status.className}">${status.label}</td>
      <td class="${bonus > 0 ? "bonus-positive" : "bonus-none"}">${bonus > 0 ? `+ ${formatNombre(bonus)}` : "-"}</td>
      <td class="hidden-admin">
        <div class="admin-actions">
          <button type="button" class="small-btn" data-action="edit-payment" data-id="${m.id}">Montant</button>
          <button type="button" class="small-btn" data-action="edit-member" data-id="${m.id}">Membre</button>
          <button type="button" class="small-btn danger" data-action="delete-member" data-id="${m.id}">Suppr</button>
        </div>
      </td>
    `;
    membreTableBody.appendChild(tr);
  }
}

function renderStats() {
  const week = state.selectedWeek;
  const total = state.members.reduce((sum, m) => sum + getPayment(m.id, week), 0);
  const target = state.members.length * WEEKLY_TARGET_PER_MEMBER;
  const late = state.members.filter((m) => getPayment(m.id, week) < WEEKLY_TARGET_PER_MEMBER).length;

  weeklyTotalEl.textContent = formatNombre(total);
  weeklyTargetEl.textContent = formatNombre(target);
  lateCountEl.textContent = String(late);
  weekLabel.textContent = week;

  const ratio = target > 0 ? total / target : 0;
  const percent = Math.max(0, Math.min(100, Math.round(ratio * 100)));
  progressTotalEl.textContent = formatNombre(total);
  progressTargetEl.textContent = formatNombre(target);
  progressPercentEl.textContent = `${percent}%`;
  progressFillEl.style.width = `${percent}%`;
  progressFillEl.classList.remove("level-low", "level-mid", "level-high");
  stepLowEl.classList.remove("active");
  stepMidEl.classList.remove("active");
  stepHighEl.classList.remove("active");

  if (ratio >= 1) {
    progressFillEl.classList.add("level-high");
    stepLowEl.classList.add("active");
    stepMidEl.classList.add("active");
    stepHighEl.classList.add("active");
    progressStatusEl.textContent = "Objectif atteint";
  } else if (ratio >= 0.5) {
    progressFillEl.classList.add("level-mid");
    stepLowEl.classList.add("active");
    stepMidEl.classList.add("active");
    progressStatusEl.textContent = "Progression moyenne";
  } else {
    progressFillEl.classList.add("level-low");
    stepLowEl.classList.add("active");
    progressStatusEl.textContent = "Niveau faible";
  }
}

function renderHistory() {
  historyTableBody.innerHTML = "";
  for (const week of allWeeks()) {
    const total = state.members.reduce((sum, m) => sum + getPayment(m.id, week), 0);
    const target = state.members.length * WEEKLY_TARGET_PER_MEMBER;
    const pct = target > 0 ? ((total / target) * 100).toFixed(1) : "0.0";
    const paidOrStartedEntries = state.members
      .map((m) => ({ pseudo: formatPseudo(m.pseudo), amount: getPayment(m.id, week) }))
      .filter((entry) => entry.amount > 0)
      .map((entry) => {
        const remaining = Math.max(0, WEEKLY_TARGET_PER_MEMBER - entry.amount);
        if (remaining > 0) {
          return `${escapeHtml(entry.pseudo)}: payé ${formatNombre(entry.amount)} / reste ${formatNombre(remaining)}`;
        }
        return `${escapeHtml(entry.pseudo)}: payé ${formatNombre(entry.amount)} / reste 0`;
      });
    const unpaidEntries = state.members
      .map((m) => ({ pseudo: formatPseudo(m.pseudo), amount: getPayment(m.id, week) }))
      .filter((entry) => entry.amount <= 0)
      .map((entry) => escapeHtml(entry.pseudo));

    const paidOrStarted = paidOrStartedEntries.length
      ? `<select class="history-select" aria-label="Payés ou en cours ${week}">
          <option selected>Voir (${paidOrStartedEntries.length})</option>
          ${paidOrStartedEntries.map((line) => `<option>${line}</option>`).join("")}
        </select>`
      : "-";

    const unpaid = unpaidEntries.length
      ? `<select class="history-select" aria-label="Pas payés ${week}">
          <option selected>Voir (${unpaidEntries.length})</option>
          ${unpaidEntries.map((line) => `<option>${line}</option>`).join("")}
        </select>`
      : "-";
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${week}</td>
      <td>${formatNombre(total)}</td>
      <td>${formatNombre(target)}</td>
      <td>${pct} %</td>
      <td>${paidOrStarted || "-"}</td>
      <td>${unpaid || "-"}</td>
    `;
    historyTableBody.appendChild(tr);
  }
}

function renderTopBonus() {
  topBonusBody.innerHTML = "";
  const weeks = allWeeks();
  const ranking = state.members.map((m) => {
    let bonusTotal = 0;
    let bonusWeeks = 0;
    for (const week of weeks) {
      const amount = getPayment(m.id, week);
      const weekBonus = Math.max(0, amount - WEEKLY_TARGET_PER_MEMBER);
      if (weekBonus > 0) {
        bonusWeeks += 1;
      }
      bonusTotal += weekBonus;
    }
    return {
      pseudo: formatPseudo(m.pseudo),
      bonusTotal,
      bonusWeeks,
    };
  });

  ranking.sort((a, b) => b.bonusTotal - a.bonusTotal || a.pseudo.localeCompare(b.pseudo));
  const top = ranking.slice(0, 10);

  if (!top.length) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="4">Aucun membre</td>`;
    topBonusBody.appendChild(tr);
    return;
  }

  top.forEach((entry, index) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${index + 1}</td>
      <td>${entry.pseudo}</td>
      <td>${entry.bonusTotal > 0 ? `+ ${formatNombre(entry.bonusTotal)}` : "-"}</td>
      <td>${entry.bonusWeeks}</td>
    `;
    topBonusBody.appendChild(tr);
  });
}

function renderBadPayers() {
  badPayersBody.innerHTML = "";
  const weeks = allWeeks();
  const nowWeek = currentWeek();
  const ranking = state.members
    .map((m) => {
      let unpaidWeeks = 0;
      let debt = 0;

      for (const week of weeks) {
        const amount = getPayment(m.id, week);
        const missing = Math.max(0, WEEKLY_TARGET_PER_MEMBER - amount);
        if (missing > 0) {
          debt += missing;
        }
        if (week.localeCompare(nowWeek) < 0 && amount <= 0) {
          unpaidWeeks += 1;
        }
      }

      const currentAmount = getPayment(m.id, nowWeek);
      let currentStatus = "Payé";
      if (currentAmount <= 0) {
        currentStatus = "Pas payé";
      } else if (currentAmount < WEEKLY_TARGET_PER_MEMBER) {
        currentStatus = "En cours";
      }

      return {
        pseudo: formatPseudo(m.pseudo),
        unpaidWeeks,
        debt,
        currentStatus,
      };
    })
    .filter((entry) => entry.unpaidWeeks > 0 || entry.debt > 0);

  ranking.sort((a, b) => b.unpaidWeeks - a.unpaidWeeks || b.debt - a.debt || a.pseudo.localeCompare(b.pseudo));

  if (!ranking.length) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="5">Aucun mauvais payeur</td>`;
    badPayersBody.appendChild(tr);
    return;
  }

  ranking.forEach((entry, index) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${index + 1}</td>
      <td>${entry.pseudo}</td>
      <td>${entry.unpaidWeeks}</td>
      <td>${formatNombre(entry.debt)}</td>
      <td>${entry.currentStatus}</td>
    `;
    badPayersBody.appendChild(tr);
  });
}

function refreshAll() {
  state.selectedWeek = currentWeek();
  renderMemberSelect();
  renderMainTable();
  renderStats();
  renderHistory();
  renderTopBonus();
  renderBadPayers();
  document.body.classList.toggle("admin-enabled", isAdmin);
  adminStatus.textContent = isAdmin ? "Mode admin actif" : "Mode lecture (consultation uniquement)";
}

function setActiveTab(tabName) {
  activeTab = tabName;
  tabButtons.forEach((btn) => {
    const isCurrent = btn.dataset.tab === tabName;
    btn.classList.toggle("active", isCurrent);
    btn.setAttribute("aria-selected", String(isCurrent));
  });
  tabPages.forEach((page) => {
    const isCurrent = page.dataset.tabPage === tabName;
    page.classList.toggle("active", isCurrent);
    page.hidden = !isCurrent;
  });
}

function loadLogoWithFallbacks() {
  const candidates = [
    `./assets/dragon.png?v=${ASSET_VERSION}`,
    `./assets/dragon.jpg?v=${ASSET_VERSION}`,
    `./assets/dragon.jpeg?v=${ASSET_VERSION}`,
    `./assets/dragon.webp?v=${ASSET_VERSION}`,
    `./dragon.png?v=${ASSET_VERSION}`,
  ];
  let i = 0;
  heroLogo.onerror = () => {
    i += 1;
    if (i < candidates.length) {
      heroLogo.src = candidates[i];
      return;
    }
    heroLogo.style.display = "none";
    document.querySelector(".hero-fallback").style.display = "grid";
  };
  heroLogo.src = candidates[0];
}

function ensureAdmin() {
  if (isAdmin) return true;
  alert("Action admin requise. Active d'abord le mode admin.");
  return false;
}

membreForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!ensureAdmin()) return;
  const formData = new FormData(membreForm);
  const nom = formatPersonName(formData.get("nom"));
  const prenom = formatPersonName(formData.get("prenom"));
  const pseudo = formatPseudo(formData.get("pseudo"));
  const vip = String(formData.get("vip") || "Non") === "Oui" ? "Oui" : "Non";
  if (!nom || !prenom || !pseudo) return;

  state.members.push({ id: crypto.randomUUID(), nom, prenom, pseudo, vip });
  membreForm.reset();
  save();
  refreshAll();
});

cotisationForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!ensureAdmin()) return;
  const formData = new FormData(cotisationForm);
  const memberId = String(formData.get("memberId") || "");
  const montant = Number(formData.get("montant") || 0);
  if (!memberId || Number.isNaN(montant) || montant < 0) return;

  setPayment(memberId, state.selectedWeek, montant);
  cotisationForm.reset();
  save();
  refreshAll();
});

adminForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const code = String(new FormData(adminForm).get("adminCode") || "").trim();
  if (!code) return;

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    alert("Configuration Supabase manquante (config.js).");
    return;
  }

  const ok = await verifyAdminPassword(code);
  if (!ok) {
    alert("Code admin incorrect.");
    return;
  }

  isAdmin = true;
  adminPassword = code;
  adminForm.reset();
  refreshAll();
});

adminOffBtn.addEventListener("click", () => {
  isAdmin = false;
  adminPassword = "";
  refreshAll();
});

membreTableBody.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  const action = target.dataset.action;
  const id = target.dataset.id;
  if (!action || !id) return;
  if (!ensureAdmin()) return;

  const member = state.members.find((m) => m.id === id);
  if (!member) return;

  if (action === "edit-payment") {
    const currentAmount = getPayment(id, state.selectedWeek);
    const next = prompt(`Montant semaine ${state.selectedWeek}`, String(currentAmount));
    if (next === null) return;
    const parsed = Number(next);
    if (Number.isNaN(parsed) || parsed < 0) return;
    setPayment(id, state.selectedWeek, parsed);
  }

  if (action === "edit-member") {
    const nomRaw = prompt("Nom", member.nom);
    if (nomRaw === null || !nomRaw.trim()) return;
    const prenomRaw = prompt("Prénom", member.prenom);
    if (prenomRaw === null || !prenomRaw.trim()) return;
    const pseudoRaw = prompt("Pseudo", member.pseudo);
    if (pseudoRaw === null || !pseudoRaw.trim()) return;
    const vipRaw = prompt("VIP (Oui/Non)", member.vip);
    if (vipRaw === null) return;
    member.nom = formatPersonName(nomRaw);
    member.prenom = formatPersonName(prenomRaw);
    member.pseudo = formatPseudo(pseudoRaw);
    member.vip = vipRaw.trim().toLowerCase() === "oui" ? "Oui" : "Non";
  }

  if (action === "delete-member") {
    const ok = confirm(`Supprimer ${member.pseudo} et tout son historique ?`);
    if (!ok) return;
    removeMemberEverywhere(id);
  }

  save();
  refreshAll();
});

function assertConfigReady() {
  if (SUPABASE_URL && SUPABASE_ANON_KEY) return;
  console.warn(
    "TRIADE_CONFIG manquant : copie config.example.js vers config.js ou configure les secrets GitHub Actions."
  );
}

async function initApp() {
  assertConfigReady();
  await load();
  loadLogoWithFallbacks();
  refreshAll();
  setActiveTab(activeTab);
  startCloudPolling();
}

tabButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    const nextTab = btn.dataset.tab;
    if (!nextTab) return;
    setActiveTab(nextTab);
  });
});

initApp();
