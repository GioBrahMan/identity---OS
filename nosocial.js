// Home/nosocial.js (Consistent messaging + "already checked in" + AM/PM)
import { supabase } from "./home.js";

console.log("nosocial.js loaded");

const DEV = window.location.hostname === "localhost";
const logError = (...args) => {
  if (DEV) console.error(...args);
};



// ===============================
// DEMO / PREVIEW MODE
// ===============================
let CAN_INTERACT = false;

function enableDemoMode() {
  const demoGate = document.getElementById("demoGate");
  const appShell = document.getElementById("appShell");

  demoGate?.classList.remove("is-hidden");
  demoGate?.classList.add("is-on");
  appShell?.classList.add("demo-locked");

  CAN_INTERACT = false;
}

// ===============================
// UI ELEMENTS
// ===============================
const sitesInput = document.getElementById("sitesInput");
const identityInput = document.getElementById("identityInput");

const streakDayText = document.getElementById("streakDayText");
const savedIdentityText = document.getElementById("savedIdentityText");
const savedSitesText = document.getElementById("savedSitesText");
const lastCheckInText = document.getElementById("lastCheckInText");
const messageEl = document.getElementById("message");

const checkInBtn = document.getElementById("checkInBtn");
const saveIdentityBtn = document.getElementById("saveIdentityBtn");
const slipBtn = document.getElementById("slipBtn");

const appShell = document.getElementById("appShell");
const btnLogout = document.getElementById("btnLogout");

// ===============================
// CONSTANTS / LIMITS
// ===============================
const TABLE = "no_social_media";
const MAX_IDENTITY_LEN = 2000;
const MAX_CREATORS = 50;
const RATE_LIMIT_MS = 900;

// ===============================
// STATE
// ===============================
let currentUserId = null;
let isProcessing = false;
let lastActionAt = 0;

// ===============================
// VISIBILITY
// ===============================
function revealLoadedUI() {
  savedIdentityText?.classList.remove("is-loading");
  savedSitesText?.classList.remove("is-loading");
  streakDayText?.classList.remove("is-loading");
  lastCheckInText?.classList.remove("is-loading");
}

// ===============================
// MESSAGE
// ===============================
function showMessage(text, type = "success", ms = 4500) {
  if (!messageEl) return;

  messageEl.textContent = String(text || "");
  messageEl.classList.remove("is-hidden", "success", "error");
  messageEl.classList.add(type === "error" ? "error" : "success");

  clearTimeout(showMessage._t);
  showMessage._t = setTimeout(() => {
    messageEl.textContent = "";
    messageEl.classList.add("is-hidden");
    messageEl.classList.remove("success", "error");
  }, ms);
}

function clearMessage() {
  if (!messageEl) return;
  messageEl.textContent = "";
  messageEl.classList.add("is-hidden");
  messageEl.classList.remove("success", "error");
}

function setButtonsDisabled(disabled) {
  const ds = !!disabled;
  checkInBtn && (checkInBtn.disabled = ds);
  saveIdentityBtn && (saveIdentityBtn.disabled = ds);
  slipBtn && (slipBtn.disabled = ds);
  sitesInput && (sitesInput.disabled = ds);
  identityInput && (identityInput.disabled = ds);
}

// ===============================
// HELPERS
// ===============================
function normalize(s) {
  return String(s ?? "").replace(/\r\n/g, "\n").normalize("NFKC").trimEnd();
}

function sanitizeForStorage(s, maxLen = MAX_IDENTITY_LEN) {
  let out = normalize(s);
  out = out.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
  out = out.replace(/[\u200B-\u200F\uFEFF]/g, "");
  if (out.length > maxLen) out = out.slice(0, maxLen);
  return out;
}

function creatorsTextToArray(text) {
  return String(text || "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, MAX_CREATORS);
}

function creatorsArrayToText(arr) {
  return Array.isArray(arr) ? arr.join("\n") : "";
}

function getTodayKey() {
  return new Date().toISOString().slice(0, 10);
}

function getTimeString() {
  return new Date().toTimeString().slice(0, 8);
}

function formatTimeAmPm(t) {
  if (!t) return "—";
  const [h, m, s] = String(t).split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return "—";
  const ampm = h >= 12 ? "PM" : "AM";
  const hh = ((h + 11) % 12) + 1;
  const mm = String(m).padStart(2, "0");
  const ss = Number.isFinite(s) ? String(s).padStart(2, "0") : null;
  return ss ? `${hh}:${mm}:${ss} ${ampm}` : `${hh}:${mm} ${ampm}`;
}

// ===============================
// GUARD
// ===============================
async function guarded(_name, fn) {
  if (!CAN_INTERACT) {
    showMessage("Demo mode is locked. Subscribe to enable actions.", "error");
    return;
  }

  const now = Date.now();
  if (now - lastActionAt < RATE_LIMIT_MS) return;
  lastActionAt = now;

  if (isProcessing) return;
  isProcessing = true;
  setButtonsDisabled(true);

  try {
    await fn();
  } catch (e) {
    logError(e);
    showMessage("Operation failed. Please try again.", "error");
  } finally {
    isProcessing = false;
    setButtonsDisabled(false);
  }
}

// ===============================
// DATA LOAD
// ===============================
async function loadState() {
  const { data, error } = await supabase
    .from(TABLE)
    .select("allowed_creators,identity_statement,current_streak,last_checkin_date,last_checkin_time")
    .eq("user_id", currentUserId)
    .maybeSingle();

  if (error) {
    logError(error);
    showMessage("Could not load your data.", "error");
  }

  if (!data) {
    savedIdentityText &&
      (savedIdentityText.textContent =
        "No identity saved yet. Your first check-in will lock it in.");
    savedSitesText &&
      (savedSitesText.textContent =
        "No content creators listed yet. Add creators that actually help you learn or improve.");
    streakDayText && (streakDayText.textContent = "Day 0");
    lastCheckInText && (lastCheckInText.textContent = "Last Check-In: —");
    revealLoadedUI();
    return;
  }

  savedIdentityText &&
    (savedIdentityText.textContent =
      data.identity_statement || "No identity saved yet. Your first check-in will lock it in.");

  savedSitesText &&
    (savedSitesText.textContent =
      creatorsArrayToText(data.allowed_creators) ||
      "No content creators listed yet. Add creators that actually help you learn or improve.");

  streakDayText && (streakDayText.textContent = `Day ${data.current_streak || 0}`);

  if (data.last_checkin_date) {
    lastCheckInText &&
      (lastCheckInText.textContent = `Last Check-In: ${data.last_checkin_date} · ${formatTimeAmPm(
        data.last_checkin_time
      )}`);
  } else {
    lastCheckInText && (lastCheckInText.textContent = "Last Check-In: —");
  }

  revealLoadedUI();
}

// ===============================
// ACTIONS
// ===============================
checkInBtn?.addEventListener("click", () =>
  guarded("checkIn", async () => {
    const identity = sanitizeForStorage(identityInput?.value);
    if (!identity.trim()) {
      showMessage("Type your identity statement first.", "error");
      return;
    }

    const today = getTodayKey();
    const now = getTimeString();
    const creators = creatorsTextToArray(sitesInput?.value);

    const { data, error: readErr } = await supabase
      .from(TABLE)
      .select("*")
      .eq("user_id", currentUserId)
      .maybeSingle();

    if (readErr) {
      logError(readErr);
      showMessage("Could not read streak status.", "error");
      return;
    }

    if (!data) {
      const { error: insErr } = await supabase.from(TABLE).insert({
        user_id: currentUserId,
        allowed_creators: creators,
        identity_statement: identity,
        current_streak: 1,
        last_checkin_date: today,
        last_checkin_time: now,
      });
      if (insErr) {
        logError(insErr);
        showMessage("Check-in failed.", "error");
        return;
      }
      showMessage(`✅ Checked in — ${formatTimeAmPm(now)}`, "success");
      await loadState();
      return;
    }

    if (data.last_checkin_date === today) {
      showMessage(`Already checked in today — ${formatTimeAmPm(data.last_checkin_time)}`, "success");
      return;
    }

    const { error: upErr } = await supabase
      .from(TABLE)
      .update({
        current_streak: (data.current_streak || 0) + 1,
        last_checkin_date: today,
        last_checkin_time: now,
      })
      .eq("user_id", currentUserId);

    if (upErr) {
      logError(upErr);
      showMessage("Check-in failed.", "error");
      return;
    }

    showMessage(`✅ Checked in — ${formatTimeAmPm(now)}`, "success");
    await loadState();
  })
);

saveIdentityBtn?.addEventListener("click", () =>
  guarded("save", async () => {
    const identity = sanitizeForStorage(identityInput?.value);
    if (!identity.trim()) {
      showMessage("Type your identity statement first.", "error");
      return;
    }

    const creators = creatorsTextToArray(sitesInput?.value);

    const { error } = await supabase.from(TABLE).upsert({
      user_id: currentUserId,
      allowed_creators: creators,
      identity_statement: identity,
    });

    if (error) {
      logError(error);
      showMessage("Save failed.", "error");
      return;
    }

    showMessage("✅ Saved.", "success");
    await loadState();
  })
);

slipBtn?.addEventListener("click", () =>
  guarded("slip", async () => {
    const ok = confirm("Reset your Healthy Social Media streak back to Day 0?");
    if (!ok) return;

    const { error } = await supabase
      .from(TABLE)
      .update({
        current_streak: 0,
        last_checkin_date: null,
        last_checkin_time: null,
      })
      .eq("user_id", currentUserId);

    if (error) {
      logError(error);
      showMessage("Reset failed.", "error");
      return;
    }

    showMessage("✅ Reset to Day 0.", "success");
    await loadState();
  })
);

// ===============================
// INIT
// ===============================
async function init() {
  setButtonsDisabled(true);
  clearMessage();

  const { data } = await supabase.auth.getSession();
  const user = data?.session?.user;

  if (!user) {
    enableDemoMode();
    revealLoadedUI();
    appShell?.classList.remove("is-hidden");
    return;
  }

  const { data: sub, error: subErr } = await supabase
    .from("user_subscriptions")
    .select("is_active")
    .eq("user_id", user.id)
    .maybeSingle();

  if (subErr) logError(subErr);

  if (!sub?.is_active) {
    enableDemoMode();
    revealLoadedUI();
    appShell?.classList.remove("is-hidden");
    return;
  }

  CAN_INTERACT = true;
  currentUserId = user.id;

  await loadState();
  setButtonsDisabled(false);
  appShell?.classList.remove("is-hidden");
}

init();

// ===============================
// LOGOUT
// ===============================
btnLogout?.addEventListener("click", async () => {
  try {
    await supabase.auth.signOut();
  } finally {
    window.location.href = "LoginPage.html";
  }
});
