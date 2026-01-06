// Home/nofap.js (MonkMode-style reveal logic; AM/PM display)
import { supabase, requireActiveSubscription } from "./home.js";

console.log("nofap.js loaded");

// ===============================
// UI ELEMENTS
// ===============================
const identityInput = document.getElementById("identityInput");
const streakDayText = document.getElementById("streakDayText");
const savedIdentityText = document.getElementById("savedIdentityText");
const lastCheckInText = document.getElementById("lastCheckInText");
const messageEl = document.getElementById("message");

const checkInBtn = document.getElementById("checkInBtn");
const saveIdentityBtn = document.getElementById("saveIdentityBtn");
const resetStreakBtn = document.getElementById("resetStreakBtn");

const startingDayInput = document.getElementById("startingDayInput");
const setStartingDayBtn = document.getElementById("setStartingDayBtn");

const charCountEl = document.getElementById("charCount");

const appShell = document.getElementById("appShell");
const authGuard = document.getElementById("authGuard");

const btnLogout = document.getElementById("btnLogout");

// Year
const yearNowEl = document.getElementById("yearNow");
try {
  if (yearNowEl) yearNowEl.textContent = String(new Date().getFullYear());
} catch {}

// ===============================
// CONSTANTS / LIMITS
// ===============================
const MAX_IDENTITY_LEN = 2000;
const MAX_STARTING_DAY = 5000;
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
function showEl(el) {
  if (!el) return;
  el.classList.remove("is-hidden");
}
function hideEl(el) {
  if (!el) return;
  el.classList.add("is-hidden");
}

function showAuthGuard() {
  if (authGuard) {
    authGuard.classList.remove("is-hidden");
    authGuard.classList.add("is-on");
  }
  hideEl(appShell);
}

function showAppShell() {
  if (authGuard) {
    authGuard.classList.remove("is-on");
    authGuard.classList.add("is-hidden");
  }
  showEl(appShell);
}

// ✅ MonkMode-style: reveal UI by removing is-loading
function revealLoadedUI() {
  savedIdentityText?.classList.remove("is-loading");
  streakDayText?.classList.remove("is-loading");
  lastCheckInText?.classList.remove("is-loading");
}

// ===============================
// MESSAGE
// ===============================
function showMessage(text, type = "success") {
  if (!messageEl) return;

  messageEl.textContent = String(text || "");
  messageEl.classList.remove("is-hidden", "success", "error");
  messageEl.classList.add(type === "error" ? "error" : "success");

  window.clearTimeout(showMessage._t);
  showMessage._t = window.setTimeout(() => {
    messageEl.classList.add("is-hidden");
  }, 5000);
}

function clearMessage() {
  if (!messageEl) return;
  messageEl.textContent = "";
  messageEl.classList.add("is-hidden");
  messageEl.classList.remove("success", "error");
}

function setButtonsDisabled(disabled) {
  const ds = !!disabled;
  if (checkInBtn) checkInBtn.disabled = ds;
  if (saveIdentityBtn) saveIdentityBtn.disabled = ds;
  if (resetStreakBtn) resetStreakBtn.disabled = ds;
  if (setStartingDayBtn) setStartingDayBtn.disabled = ds;
  if (identityInput) identityInput.disabled = ds;
  if (startingDayInput) startingDayInput.disabled = ds;
}

function updateCharCount() {
  if (!charCountEl || !identityInput) return;
  charCountEl.textContent = `${identityInput.value.length}/${MAX_IDENTITY_LEN}`;
}

// ===============================
// VALIDATION / NORMALIZATION
// ===============================
function normalize(s) {
  return String(s ?? "")
    .replace(/\r\n/g, "\n")
    .normalize("NFKC")
    .trimEnd();
}

function sanitizeForStorage(s) {
  let out = normalize(s);
  out = out.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
  out = out.replace(/[\u200B-\u200F\uFEFF]/g, "");
  if (out.length > MAX_IDENTITY_LEN) out = out.slice(0, MAX_IDENTITY_LEN);
  return out;
}

function isUUID(v) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v ?? "");
}

// ===============================
// DATE/TIME (client-side + AM/PM helper)
// ===============================
function getTodayKey() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function getTimeString() {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

function getPrettyDate(dateKey) {
  if (!dateKey) return "—";
  const [y, m, d] = String(dateKey).split("-").map(Number);
  const date = new Date(y, (m || 1) - 1, d || 1);
  return date.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

function formatTimeAmPm(timeStr) {
  if (!timeStr) return "—";
  const parts = String(timeStr).split(":");
  const hh = parseInt(parts[0], 10);
  const mm = parts[1] ?? "00";
  const ss = parts[2];
  if (Number.isNaN(hh)) return String(timeStr);

  const ampm = hh >= 12 ? "PM" : "AM";
  const hour12 = ((hh + 11) % 12) + 1;
  return ss ? `${hour12}:${mm}:${ss} ${ampm}` : `${hour12}:${mm} ${ampm}`;
}

// ===============================
// SINGLE-FLIGHT + SOFT RATE LIMIT
// ===============================
async function guarded(actionName, fn) {
  const now = Date.now();
  if (now - lastActionAt < RATE_LIMIT_MS) {
    showMessage("Slow down — one action at a time.", "error");
    return;
  }
  lastActionAt = now;

  if (isProcessing) {
    showMessage("Please wait — finishing the previous action.", "error");
    return;
  }

  isProcessing = true;
  clearMessage();
  setButtonsDisabled(true);

  try {
    await fn();
  } catch (err) {
    const msg =
      err?.message === "IDENTITY_MISMATCH"
        ? 'This doesn’t match your saved identity statement exactly. Use "Save / Update Identity" if you evolved it.'
        : err?.message === "AUTH_REQUIRED"
          ? "Session expired. Please log in again."
          : "Operation failed. Please try again.";

    console.warn(`${actionName} failed.`, err);
    showMessage(msg, "error");
  } finally {
    isProcessing = false;
    setButtonsDisabled(false);
  }
}

// ===============================
// AUTH (read session user_id)
// ===============================
async function getValidSessionUserId() {
  const { data, error } = await supabase.auth.getUser();
  if (error) return null;

  const userId = data?.user?.id;
  if (!userId || !isUUID(userId)) return null;
  return userId;
}

// ===============================
// DATA LOAD
// ===============================
async function loadState() {
  const { data, error } = await supabase
    .from("nofap_streaks")
    .select("identity_statement,current_streak,starting_day,last_checkin_date,last_checkin_time")
    .eq("user_id", currentUserId)
    .maybeSingle();

  if (error && error.code !== "PGRST116") {
    console.warn("loadState error:", error);
    showMessage("Failed to load your streak data.", "error");
    revealLoadedUI();
    return null;
  }

  if (data) {
    const stmtRaw = String(data.identity_statement ?? "");
    const stmt = stmtRaw.trim() ? stmtRaw : "No identity saved yet. Your first check-in will lock it in.";
    if (savedIdentityText) savedIdentityText.textContent = stmt;

    const base = Number(data.starting_day || 0);
    const cur = Number(data.current_streak || 0);
    if (streakDayText) streakDayText.textContent = `Day ${base + cur}`;

    if (lastCheckInText) {
      if (data.last_checkin_date) {
        const pretty = getPrettyDate(data.last_checkin_date);
        const timePretty = data.last_checkin_time ? formatTimeAmPm(data.last_checkin_time) : "--:--";
        lastCheckInText.textContent = `Last Check-In: ${pretty} · ${timePretty}`;
      } else {
        lastCheckInText.textContent = "Last Check-In: —";
      }
    }

    if (startingDayInput) startingDayInput.value = base ? String(base) : "";
  } else {
    if (savedIdentityText) savedIdentityText.textContent = "No identity saved yet. Your first check-in will lock it in.";
    if (streakDayText) streakDayText.textContent = "Day 0";
    if (lastCheckInText) lastCheckInText.textContent = "Last Check-In: —";
    if (startingDayInput) startingDayInput.value = "";
  }

  revealLoadedUI();
  return data || null;
}

// ===============================
// SET STREAK DAY
// ===============================
setStartingDayBtn?.addEventListener("click", () =>
  guarded("setStartingDay", async () => {
    if (!currentUserId) throw new Error("AUTH_REQUIRED");

    const raw = String(startingDayInput?.value ?? "").trim();
    const desiredTotal = parseInt(raw, 10);

    if (Number.isNaN(desiredTotal) || desiredTotal < 0 || desiredTotal > MAX_STARTING_DAY) {
      showMessage(`Enter a valid day (0–${MAX_STARTING_DAY}).`, "error");
      return;
    }

    const { data: current, error: readErr } = await supabase
      .from("nofap_streaks")
      .select("identity_statement,current_streak,starting_day")
      .eq("user_id", currentUserId)
      .maybeSingle();

    if (readErr && readErr.code !== "PGRST116") throw readErr;

    if (!current) {
      const { error } = await supabase.from("nofap_streaks").insert({
        user_id: currentUserId,
        identity_statement: "",
        current_streak: 0,
        starting_day: desiredTotal,
        last_checkin_date: null,
        last_checkin_time: null,
      });
      if (error) throw error;

      await loadState();
      showMessage(`Streak updated. Now displaying Day ${desiredTotal}.`, "success");
      return;
    }

    const curStreak = Number(current.current_streak || 0);
    const oldBase = Number(current.starting_day || 0);
    const oldTotal = oldBase + curStreak;

    if (desiredTotal < oldTotal) {
      const ok = confirm(`You’re lowering your displayed day from ${oldTotal} to ${desiredTotal}. Continue?`);
      if (!ok) return;
    }

    const newBase = Math.max(0, desiredTotal - curStreak);

    const { error } = await supabase.from("nofap_streaks").update({ starting_day: newBase }).eq("user_id", currentUserId);
    if (error) throw error;

    await loadState();
    showMessage(`Streak updated. Now displaying Day ${desiredTotal}.`, "success");
  })
);

// ===============================
// CHECK IN
// ===============================
checkInBtn?.addEventListener("click", () =>
  guarded("checkIn", async () => {
    if (!currentUserId) throw new Error("AUTH_REQUIRED");

    const input = sanitizeForStorage(identityInput?.value ?? "");
    if (!input.trim()) {
      showMessage("Type your identity statement before checking in.", "error");
      return;
    }

    const todayKey = getTodayKey();
    const nowTime = getTimeString();

    const { data: current, error: readErr } = await supabase
      .from("nofap_streaks")
      .select("identity_statement,current_streak,starting_day,last_checkin_date")
      .eq("user_id", currentUserId)
      .maybeSingle();

    if (readErr && readErr.code !== "PGRST116") throw readErr;

    if (!current) {
      const { error } = await supabase.from("nofap_streaks").insert({
        user_id: currentUserId,
        identity_statement: input,
        current_streak: 1,
        starting_day: 0,
        last_checkin_date: todayKey,
        last_checkin_time: nowTime,
      });
      if (error) throw error;

      if (savedIdentityText) savedIdentityText.textContent = input;
      revealLoadedUI();

      await loadState();
      showMessage("Identity locked in. Day 1 of your NoFap + NoCorn streak has started.", "success");
      return;
    }

    if (current.last_checkin_date === todayKey) {
      const { error } = await supabase.from("nofap_streaks").update({ last_checkin_time: nowTime }).eq("user_id", currentUserId);
      if (error) throw error;

      await loadState();
      showMessage("You’ve already checked in today. Streak stays the same, time updated.", "success");
      return;
    }

    if (normalize(input) !== normalize(current.identity_statement)) throw new Error("IDENTITY_MISMATCH");

    const nextStreak = Number(current.current_streak || 0) + 1;

    const { error } = await supabase
      .from("nofap_streaks")
      .update({ current_streak: nextStreak, last_checkin_date: todayKey, last_checkin_time: nowTime })
      .eq("user_id", currentUserId);

    if (error) throw error;

    await loadState();

    const base = Number(current.starting_day || 0);
    showMessage(`Check-in logged. You are now on Day ${base + nextStreak}.`, "success");
  })
);

// ===============================
// SAVE / UPDATE IDENTITY
// ===============================
saveIdentityBtn?.addEventListener("click", () =>
  guarded("saveIdentity", async () => {
    if (!currentUserId) throw new Error("AUTH_REQUIRED");

    const input = sanitizeForStorage(identityInput?.value ?? "");
    if (!input.trim()) {
      showMessage("Type an identity statement before saving.", "error");
      return;
    }

    const { data: current, error: readErr } = await supabase
      .from("nofap_streaks")
      .select("user_id")
      .eq("user_id", currentUserId)
      .maybeSingle();

    if (readErr && readErr.code !== "PGRST116") throw readErr;

    if (!current) {
      const { error } = await supabase.from("nofap_streaks").insert({
        user_id: currentUserId,
        identity_statement: input,
        current_streak: 0,
        starting_day: 0,
        last_checkin_date: null,
        last_checkin_time: null,
      });
      if (error) throw error;

      if (savedIdentityText) savedIdentityText.textContent = input;
      revealLoadedUI();

      await loadState();
      showMessage('Identity saved. Now retype it exactly and press "Check In" to start Day 1.', "success");
      return;
    }

    const { error } = await supabase.from("nofap_streaks").update({ identity_statement: input }).eq("user_id", currentUserId);
    if (error) throw error;

    if (savedIdentityText) savedIdentityText.textContent = input;
    revealLoadedUI();

    await loadState();
    showMessage("Identity updated. Your streak stays the same.", "success");
  })
);

// ===============================
// RESET STREAK
// ===============================
resetStreakBtn?.addEventListener("click", () =>
  guarded("resetStreak", async () => {
    if (!currentUserId) throw new Error("AUTH_REQUIRED");

    const ok = confirm(
      "Are you sure you want to reset your streak? This will set you back to Day 0, but will keep your identity statement."
    );
    if (!ok) return;

    const { error, count } = await supabase
      .from("nofap_streaks")
      .update({ current_streak: 0, starting_day: 0, last_checkin_date: null, last_checkin_time: null }, { count: "exact" })
      .eq("user_id", currentUserId);

    if (error) throw error;

    if (!count) {
      showMessage("No streak found to reset yet. Save an identity or check in first.", "error");
      return;
    }

    await loadState();
    showMessage("Streak reset to Day 0. Your identity statement is still saved.", "success");
  })
);

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

// ===============================
// INIT
// ===============================
async function init() {
  setButtonsDisabled(true);
  clearMessage();
  updateCharCount();
  identityInput?.addEventListener("input", updateCharCount);

  supabase.auth.onAuthStateChange((_event, session) => {
    if (!session?.user?.id) {
      currentUserId = null;
      window.location.href = "LoginPage.html";
    }
  });

  try {
    const user = await requireActiveSubscription({ returnTo: "NoCorn+NoFap.html" });
    if (!user?.id) return;

    const userId = await getValidSessionUserId();
    if (!userId) {
      window.location.href = "LoginPage.html";
      return;
    }

    currentUserId = userId;

    await loadState();
    setButtonsDisabled(false);
    showAppShell();
  } catch (e) {
    console.warn("NoFap init failed:", e);
    showAuthGuard();
    window.location.href = "LoginPage.html";
  }
}

init();
