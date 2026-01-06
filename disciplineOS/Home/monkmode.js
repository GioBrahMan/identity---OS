// Home/monkmode.js (NoFap/NoSocial consistent + AM/PM + preserves newlines)
import { supabase, requireActiveSubscription } from "./home.js";

console.log("monkmode.js loaded");

// ===============================
// UI ELEMENTS
// ===============================
const monkInput = document.getElementById("monkInput");
const streakDayText = document.getElementById("streakDayText");
const savedScriptText = document.getElementById("savedScriptText");
const lastCheckInText = document.getElementById("lastCheckInText");
const messageEl = document.getElementById("message");

const checkInBtn = document.getElementById("checkInBtn");
const saveScriptBtn = document.getElementById("saveScriptBtn");
const resetStreakBtn = document.getElementById("resetStreakBtn");

const appShell = document.getElementById("appShell");
const authGuard = document.getElementById("authGuard");

const btnLogout = document.getElementById("btnLogout");
btnLogout?.addEventListener("click", async () => {
  try {
    await supabase.auth.signOut();
  } finally {
    window.location.href = "LoginPage.html";
  }
});

// ===============================
// CONSTANTS / LIMITS
// ===============================
const TABLE = "monk_mode";
const MAX_SCRIPT_LEN = 5000;
const RATE_LIMIT_MS = 900;

// ===============================
// STATE
// ===============================
let currentUserId = null;
let isProcessing = false;
let lastActionAt = 0;

// ===============================
// VISIBILITY (same pattern as NoFap)
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

// ===============================
// MESSAGE (same as NoFap)
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
  if (saveScriptBtn) saveScriptBtn.disabled = ds;
  if (resetStreakBtn) resetStreakBtn.disabled = ds;
  if (monkInput) monkInput.disabled = ds;
}

// Prevent placeholder flash
function revealLoadedUI() {
  savedScriptText?.classList.remove("is-loading");
  streakDayText?.classList.remove("is-loading");
  lastCheckInText?.classList.remove("is-loading");
}

// ===============================
// VALIDATION / NORMALIZATION (preserves newlines)
// ===============================
function normalize(s) {
  return String(s ?? "")
    .replace(/\r\n/g, "\n")
    .normalize("NFKC")
    .trimEnd();
}

function sanitizeForStorage(s, maxLen) {
  let out = normalize(s);

  // ✅ IMPORTANT: allow \n (0x0A) and \r (0x0D), same as your NoFap/NoSocial approach
  out = out.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
  out = out.replace(/[\u200B-\u200F\uFEFF]/g, "");

  if (out.length > maxLen) out = out.slice(0, maxLen);
  return out;
}

function isUUID(v) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v ?? "");
}

// ===============================
// DATE/TIME (client-side + AM/PM)
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
  // accepts "HH:MM" or "HH:MM:SS"
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
    console.warn(`${actionName} failed.`, err);
    showMessage("Operation failed. Please try again.", "error");
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
    .from(TABLE)
    .select("protocol_rules,current_streak,last_checkin_date,last_checkin_time")
    .eq("user_id", currentUserId)
    .maybeSingle();

  if (error && error.code !== "PGRST116") {
    console.warn("loadState error:", error);
    showMessage("Failed to load your Monk Mode streak.", "error");
    revealLoadedUI();
    return null;
  }

  if (data) {
    const scriptRaw = String(data.protocol_rules ?? "");
    const script = scriptRaw.trim()
      ? scriptRaw
      : "No Monk Mode script saved yet. Your first check-in will lock it in.";
    if (savedScriptText) savedScriptText.textContent = script;

    const cur = Number(data.current_streak || 0);
    if (streakDayText) streakDayText.textContent = `Day ${cur}`;

    if (lastCheckInText) {
      if (data.last_checkin_date) {
        const pretty = getPrettyDate(data.last_checkin_date);
        const timePretty = data.last_checkin_time ? formatTimeAmPm(data.last_checkin_time) : "--:--";
        lastCheckInText.textContent = `Last Check-In: ${pretty} · ${timePretty}`;
      } else {
        lastCheckInText.textContent = "Last Check-In: —";
      }
    }
  } else {
    if (savedScriptText)
      savedScriptText.textContent = "No Monk Mode script saved yet. Your first check-in will lock it in.";
    if (streakDayText) streakDayText.textContent = "Day 0";
    if (lastCheckInText) lastCheckInText.textContent = "Last Check-In: —";
  }

  revealLoadedUI();
  if (monkInput) monkInput.value = "";
  return data || null;
}

// ===============================
// ACTIONS
// ===============================
saveScriptBtn?.addEventListener("click", () =>
  guarded("saveScript", async () => {
    if (!currentUserId) throw new Error("AUTH_REQUIRED");

    const script = sanitizeForStorage(monkInput?.value ?? "", MAX_SCRIPT_LEN);
    if (!script.trim()) {
      showMessage("Type your Monk Mode script before saving.", "error");
      return;
    }

    const { data: current, error: readErr } = await supabase
      .from(TABLE)
      .select("user_id")
      .eq("user_id", currentUserId)
      .maybeSingle();

    if (readErr && readErr.code !== "PGRST116") throw readErr;

    if (!current) {
      const { error } = await supabase.from(TABLE).insert({
        user_id: currentUserId,
        protocol_rules: script,
        current_streak: 0,
        last_checkin_date: null,
        last_checkin_time: null,
        is_active: true,
      });
      if (error) throw error;

      await loadState();
      showMessage('Script saved. Now retype it exactly and press "Check In" to start Day 1.', "success");
      return;
    }

    const { error } = await supabase.from(TABLE).update({ protocol_rules: script }).eq("user_id", currentUserId);
    if (error) throw error;

    await loadState();
    showMessage("Script updated. Your streak stays the same — next check-in must match this script.", "success");
  })
);

checkInBtn?.addEventListener("click", () =>
  guarded("checkIn", async () => {
    if (!currentUserId) throw new Error("AUTH_REQUIRED");

    const input = sanitizeForStorage(monkInput?.value ?? "", MAX_SCRIPT_LEN);
    if (!input.trim()) {
      showMessage("Type your full Monk Mode script before checking in.", "error");
      return;
    }

    const todayKey = getTodayKey();
    const nowTime = getTimeString();

    const { data: current, error: readErr } = await supabase
      .from(TABLE)
      .select("protocol_rules,current_streak,last_checkin_date")
      .eq("user_id", currentUserId)
      .maybeSingle();

    if (readErr && readErr.code !== "PGRST116") throw readErr;

    if (!current) {
      const { error } = await supabase.from(TABLE).insert({
        user_id: currentUserId,
        protocol_rules: input,
        current_streak: 1,
        last_checkin_date: todayKey,
        last_checkin_time: nowTime,
        is_active: true,
      });
      if (error) throw error;

      await loadState();
      showMessage("Monk Mode script locked in. Day 1 has started.", "success");
      return;
    }

    // Already checked in today -> only update time
    if (current.last_checkin_date === todayKey) {
      const { error } = await supabase.from(TABLE).update({ last_checkin_time: nowTime }).eq("user_id", currentUserId);
      if (error) throw error;

      await loadState();
      showMessage("You already checked in today. Streak stays the same, time updated.", "success");
      return;
    }

    // Must match script exactly
    if (normalize(input) !== normalize(current.protocol_rules)) {
      showMessage('This doesn’t match your saved Monk Mode script exactly. Use "Save / Update Script" if you changed it.', "error");
      return;
    }

    const nextStreak = Number(current.current_streak || 0) + 1;

    const { error } = await supabase
      .from(TABLE)
      .update({ current_streak: nextStreak, last_checkin_date: todayKey, last_checkin_time: nowTime })
      .eq("user_id", currentUserId);

    if (error) throw error;

    await loadState();
    showMessage(`Check-in logged. You are now on Monk Mode Day ${nextStreak}.`, "success");
  })
);

resetStreakBtn?.addEventListener("click", () =>
  guarded("resetStreak", async () => {
    if (!currentUserId) throw new Error("AUTH_REQUIRED");

    const ok = confirm("Reset your Monk Mode streak back to Day 0? This keeps your script saved.");
    if (!ok) return;

    const { error, count } = await supabase
      .from(TABLE)
      .update({ current_streak: 0, last_checkin_date: null, last_checkin_time: null }, { count: "exact" })
      .eq("user_id", currentUserId);

    if (error) throw error;

    if (!count) {
      showMessage("No streak found to reset yet. Save your script or check in first.", "error");
      return;
    }

    await loadState();
    showMessage("Monk Mode streak reset to Day 0. Script still saved. Rebuild from zero.", "success");
  })
);

// ===============================
// INIT
// ===============================
async function init() {
  setButtonsDisabled(true);
  clearMessage();

  supabase.auth.onAuthStateChange((_event, session) => {
    if (!session?.user?.id) {
      currentUserId = null;
      window.location.href = "LoginPage.html";
    }
  });

  try {
    const user = await requireActiveSubscription({ returnTo: "MonkMode.html" });
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
    console.warn("MonkMode init failed:", e);
    showAuthGuard();
    window.location.href = "LoginPage.html";
  }
}

init();

// Auto-resize on focus (kept)
monkInput?.addEventListener("focus", () => {
  monkInput.style.height = "auto";
  monkInput.style.height = monkInput.scrollHeight + "px";
});
