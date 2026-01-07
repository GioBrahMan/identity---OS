// Home/monkmode.js (Consistent messaging + "already checked in" + AM/PM)
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
const btnLogout = document.getElementById("btnLogout");

// ===============================
// CONSTANTS / LIMITS
// ===============================
const TABLE = "monk_mode";
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

function revealLoadedUI() {
  savedIdentityText?.classList.remove("is-loading");
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
  resetStreakBtn && (resetStreakBtn.disabled = ds);
  setStartingDayBtn && (setStartingDayBtn.disabled = ds);
  identityInput && (identityInput.disabled = ds);
  startingDayInput && (startingDayInput.disabled = ds);
}

// ===============================
// HELPERS
// ===============================
function normalize(s) {
  return String(s ?? "").replace(/\r\n/g, "\n").normalize("NFKC").trimEnd();
}

function sanitizeForStorage(s) {
  let out = normalize(s);
  out = out.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
  if (out.length > MAX_IDENTITY_LEN) out = out.slice(0, MAX_IDENTITY_LEN);
  return out;
}

function clampInt(n, min, max) {
  const x = Number.parseInt(String(n), 10);
  if (Number.isNaN(x)) return null;
  return Math.min(max, Math.max(min, x));
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
    console.error(e);
    showMessage("Operation failed. Please try again.", "error");
  } finally {
    isProcessing = false;
    setButtonsDisabled(false);
  }
}

// ===============================
// UI: CHAR COUNT
// ===============================
function updateCharCount() {
  if (!charCountEl || !identityInput) return;
  const len = (identityInput.value || "").length;
  charCountEl.textContent = `${len}/${MAX_IDENTITY_LEN}`;
}
identityInput?.addEventListener("input", updateCharCount);

// ===============================
// DATA LOAD
// ===============================
async function loadState() {
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .eq("user_id", currentUserId)
    .maybeSingle();

  if (error) {
    console.error(error);
    showMessage("Could not load your data.", "error");
  }

  if (!data) {
    streakDayText && (streakDayText.textContent = "Day 0");
    savedIdentityText &&
      (savedIdentityText.textContent =
        "No script saved yet. Your first check-in will lock it in.");
    lastCheckInText && (lastCheckInText.textContent = "Last Check-In: —");
    revealLoadedUI();
    updateCharCount();
    return;
  }

  const base = data.starting_day || 0;
  const streak = data.current_streak || 0;

  savedIdentityText &&
    (savedIdentityText.textContent =
      data.identity_statement ||
      "No script saved yet. Your first check-in will lock it in.");

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
  updateCharCount();
}

// ===============================
// ACTIONS
// ===============================
checkInBtn?.addEventListener("click", () =>
  guarded("checkIn", async () => {
    const input = sanitizeForStorage(identityInput?.value);
    if (!input.trim()) {
      showMessage("Type your Monk Mode script first.", "error");
      return;
    }

    const today = getTodayKey();
    const now = getTimeString();

    const { data, error: readErr } = await supabase
      .from(TABLE)
      .select("*")
      .eq("user_id", currentUserId)
      .maybeSingle();

    if (readErr) {
      console.error(readErr);
      showMessage("Could not read streak status.", "error");
      return;
    }

    if (!data) {
      const { error: insErr } = await supabase.from(TABLE).insert({
        user_id: currentUserId,
        identity_statement: input,
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
      console.error(upErr);
      showMessage("Check-in failed.", "error");
      return;
    }

    showMessage(`✅ Checked in — ${formatTimeAmPm(now)}`, "success");
    await loadState();
  })
);

saveIdentityBtn?.addEventListener("click", () =>
  guarded("saveScript", async () => {
    const script = sanitizeForStorage(identityInput?.value);
    if (!script.trim()) {
      showMessage("Type your Monk Mode script first.", "error");
      return;
    }

    const { error } = await supabase.from(TABLE).upsert({
      user_id: currentUserId,
      identity_statement: script,
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

setStartingDayBtn?.addEventListener("click", () =>
  guarded("setStartingDay", async () => {
    const val = clampInt(startingDayInput?.value, 0, MAX_STARTING_DAY);
    if (val === null) {
      showMessage("Enter a valid starting day.", "error");
      return;
    }

    const { error } = await supabase.from(TABLE).upsert({
      user_id: currentUserId,
      starting_day: val,
    });

    if (error) {
      console.error(error);
      showMessage("Could not set starting day.", "error");
      return;
    }

    showMessage(`✅ Starting day set to ${val}.`, "success");
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
    updateCharCount();
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
    updateCharCount();
    return;
  }

  CAN_INTERACT = true;
  currentUserId = user.id;

  await loadState();
  setButtonsDisabled(false);
  showEl(appShell);
  updateCharCount();
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
