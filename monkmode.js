// monkmode.js (Fix preview overlay + enforce script match + consistent messaging + AM/PM)
// ✅ Uses monk_mode.protocol_rules (not identity_statement)
import { supabase } from "./home.js";

console.log("monkmode.js loaded");

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

function disableDemoMode() {
  const demoGate = document.getElementById("demoGate");
  const appShell = document.getElementById("appShell");

  demoGate?.classList.add("is-hidden");
  demoGate?.classList.remove("is-on");
  appShell?.classList.remove("demo-locked");
}

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
const btnLogout = document.getElementById("btnLogout");

// ===============================
// CONSTANTS
// ===============================
const TABLE = "monk_mode";
const MAX_RULES_LEN = 2000;
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

function revealLoadedUI() {
  savedScriptText?.classList.remove("is-loading");
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
  saveScriptBtn && (saveScriptBtn.disabled = ds);
  resetStreakBtn && (resetStreakBtn.disabled = ds);
  monkInput && (monkInput.disabled = ds);
}

// ===============================
// HELPERS
// ===============================
function normalize(s) {
  return String(s ?? "")
    .replace(/\r\n/g, "\n")
    .normalize("NFKC")
    .trimEnd();
}

function sanitizeForStorage(s) {
  let out = normalize(s);
  // remove control chars but KEEP \n and \t
  out = out.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
  if (out.length > MAX_RULES_LEN) out = out.slice(0, MAX_RULES_LEN);
  return out;
}

// strict but resilient to Windows newlines / trailing spaces
function normalizeForCompare(s) {
  return normalize(s).trim();
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
  const ss2 = Number.isFinite(s) ? String(s).padStart(2, "0") : null;
  return ss2 ? `${hh}:${mm}:${ss2} ${ampm}` : `${hh}:${mm} ${ampm}`;
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
    console.error(e);
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
    .select("protocol_rules,current_streak,starting_day,last_checkin_date,last_checkin_time")
    .eq("user_id", currentUserId)
    .maybeSingle();

  if (error) {
    console.error(error);
    showMessage("Could not load your data.", "error");
  }

  if (!data) {
    streakDayText && (streakDayText.textContent = "Day 0");
    savedScriptText &&
      (savedScriptText.textContent =
        "No Monk Mode script saved yet. Your first check-in will lock it in.");
    lastCheckInText && (lastCheckInText.textContent = "Last Check-In: —");
    revealLoadedUI();
    return;
  }

  savedScriptText &&
    (savedScriptText.textContent =
      data.protocol_rules ||
      "No Monk Mode script saved yet. Your first check-in will lock it in.");

  const base = data.starting_day || 0;
  const streak = data.current_streak || 0;
  streakDayText && (streakDayText.textContent = `Day ${base + streak}`);

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
    const input = sanitizeForStorage(monkInput?.value);
    if (!input.trim()) {
      showMessage("Type your Monk Mode script first.", "error");
      return;
    }

    const today = getTodayKey();
    const now = getTimeString();

    const { data, error: readErr } = await supabase
      .from(TABLE)
      .select("protocol_rules,current_streak,starting_day,last_checkin_date,last_checkin_time")
      .eq("user_id", currentUserId)
      .maybeSingle();

    if (readErr) {
      console.error(readErr);
      showMessage("Could not read streak status.", "error");
      return;
    }

    // First ever check-in: lock rules + start streak
    if (!data) {
      const { error: insErr } = await supabase.from(TABLE).insert({
        user_id: currentUserId,
        protocol_rules: input,
        current_streak: 1,
        starting_day: 0,
        last_checkin_date: today,
        last_checkin_time: now,
      });

      if (insErr) {
        console.error(insErr);
        showMessage("Check-in failed.", "error");
        return;
      }

      showMessage(`✅ Checked in — ${formatTimeAmPm(now)}`, "success");
      await loadState();
      return;
    }

    if (data.last_checkin_date === today) {
      showMessage(
        `Already checked in today — ${formatTimeAmPm(data.last_checkin_time)}`,
        "success"
      );
      return;
    }

    // Enforce exact rules match (after locked)
    const saved = normalizeForCompare(data.protocol_rules || "");
    const typed = normalizeForCompare(input);

    if (saved && typed !== saved) {
      showMessage("Script must match your saved Monk Mode script exactly.", "error");
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
      console.error(upErr);
      showMessage("Check-in failed.", "error");
      return;
    }

    showMessage(`✅ Checked in — ${formatTimeAmPm(now)}`, "success");
    await loadState();
  })
);

saveScriptBtn?.addEventListener("click", () =>
  guarded("saveScript", async () => {
    const script = sanitizeForStorage(monkInput?.value);
    if (!script.trim()) {
      showMessage("Type your Monk Mode script first.", "error");
      return;
    }

    const { error } = await supabase.from(TABLE).upsert({
      user_id: currentUserId,
      protocol_rules: script,
    });

    if (error) {
      console.error(error);
      showMessage("Save failed.", "error");
      return;
    }

    showMessage("✅ Saved.", "success");
    await loadState();
  })
);

resetStreakBtn?.addEventListener("click", () =>
  guarded("reset", async () => {
    const ok = confirm("Reset your Monk Mode streak back to Day 0?");
    if (!ok) return;

    const { error } = await supabase
      .from(TABLE)
      .update({
        current_streak: 0,
        starting_day: 0,
        last_checkin_date: null,
        last_checkin_time: null,
      })
      .eq("user_id", currentUserId);

    if (error) {
      console.error(error);
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
    showEl(appShell);
    return;
  }

  const { data: sub, error: subErr } = await supabase
    .from("user_subscriptions")
    .select("is_active")
    .eq("user_id", user.id)
    .maybeSingle();

  if (subErr) console.error(subErr);

  if (!sub?.is_active) {
    enableDemoMode();
    revealLoadedUI();
    showEl(appShell);
    return;
  }

  // ✅ subscribed
  CAN_INTERACT = true;
  currentUserId = user.id;

  disableDemoMode();
  await loadState();

  setButtonsDisabled(false);
  showEl(appShell);
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
