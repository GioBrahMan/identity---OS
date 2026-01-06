// Home/nosocial.js (consistent + AM/PM display)
import { supabase, requireActiveSubscription } from "./home.js";

console.log("nosocial.js loaded");

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
// MESSAGE (same style as NoFap)
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
  if (slipBtn) slipBtn.disabled = ds;
  if (sitesInput) sitesInput.disabled = ds;
  if (identityInput) identityInput.disabled = ds;
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

function sanitizeForStorage(s, maxLen = MAX_IDENTITY_LEN) {
  let out = normalize(s);
  out = out.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
  out = out.replace(/[\u200B-\u200F\uFEFF]/g, "");
  if (out.length > maxLen) out = out.slice(0, maxLen);
  return out;
}

function isUUID(v) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v ?? "");
}

// TEXTAREA <-> TEXT[] (allowed_creators)
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
  const date = new Date(y, m - 1, d);
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
    const raw = String(err?.message || "").toLowerCase();

    if (raw.includes("auth_required")) showMessage("Session expired. Please log in again.", "error");
    else if (raw.includes("identity_mismatch"))
      showMessage('This doesn’t match your saved identity statement exactly. Use "Save / Update Identity" if you changed it.', "error");
    else showMessage("Operation failed. Please try again.", "error");

    console.warn(`${actionName} failed.`, err);
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
  // show loading while fetching
  savedIdentityText?.classList.add("is-loading");
  savedSitesText?.classList.add("is-loading");

  try {
    const { data, error } = await supabase
      .from(TABLE)
      .select("allowed_creators,identity_statement,current_streak,last_checkin_date,last_checkin_time")
      .eq("user_id", currentUserId)
      .maybeSingle();

    if (error && error.code !== "PGRST116") {
      showMessage("Failed to load your social media streak.", "error");
      return null;
    }

    if (data) {
      const identityRaw = String(data.identity_statement ?? "");
      const identity = identityRaw.trim()
        ? identityRaw
        : "No identity saved yet. Your first check-in will lock it in.";
      if (savedIdentityText) savedIdentityText.textContent = identity;

      const creatorsText = creatorsArrayToText(data.allowed_creators);
      const creators = creatorsText.trim()
        ? creatorsText
        : "No content creators listed yet. Start by naming the creators you enjoy watching or add value to your life.";
      if (savedSitesText) savedSitesText.textContent = creators;

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
      if (savedIdentityText)
        savedIdentityText.textContent = "No identity saved yet. Your first check-in will lock it in.";
      if (savedSitesText)
        savedSitesText.textContent =
          "No content creators listed yet. Start by naming the creators you enjoy watching or add value to your life.";
      if (streakDayText) streakDayText.textContent = "Day 0";
      if (lastCheckInText) lastCheckInText.textContent = "Last Check-In: —";
    }

    if (sitesInput) sitesInput.value = "";
    if (identityInput) identityInput.value = "";

    return data || null;
  } finally {
    // ALWAYS unhide, even if Supabase errors
    savedIdentityText?.classList.remove("is-loading");
    savedSitesText?.classList.remove("is-loading");
  }
}


// ===============================
// ACTIONS
// ===============================
saveIdentityBtn?.addEventListener("click", () =>
  guarded("saveIdentity", async () => {
    if (!currentUserId) throw new Error("AUTH_REQUIRED");

    const identityRaw = sanitizeForStorage(identityInput?.value ?? "", MAX_IDENTITY_LEN);
    if (!identityRaw.trim()) {
      showMessage("Type an identity statement before saving.", "error");
      return;
    }

    const allowedCreators = creatorsTextToArray(sitesInput?.value ?? "");

    const { data: current, error: readErr } = await supabase
      .from(TABLE)
      .select("user_id")
      .eq("user_id", currentUserId)
      .maybeSingle();

    if (readErr && readErr.code !== "PGRST116") throw readErr;

    if (!current) {
      const { error } = await supabase.from(TABLE).insert({
        user_id: currentUserId,
        allowed_creators: allowedCreators,
        identity_statement: identityRaw,
        current_streak: 0,
        last_checkin_date: null,
        last_checkin_time: null,
      });
      if (error) throw error;

      await loadState();
      showMessage('Identity + creators saved. Now retype it and press "Check In" to start Day 1.', "success");
      return;
    }

    const { error } = await supabase
      .from(TABLE)
      .update({ allowed_creators: allowedCreators, identity_statement: identityRaw })
      .eq("user_id", currentUserId);

    if (error) throw error;

    await loadState();
    showMessage("Identity updated. Your streak stays the same — next check-in will require this identity.", "success");
  })
);

checkInBtn?.addEventListener("click", () =>
  guarded("checkIn", async () => {
    if (!currentUserId) throw new Error("AUTH_REQUIRED");

    const input = sanitizeForStorage(identityInput?.value ?? "", MAX_IDENTITY_LEN);
    if (!input.trim()) {
      showMessage("Type your Healthy Social Media identity statement before checking in.", "error");
      return;
    }

    const todayKey = getTodayKey();
    const nowTime = getTimeString();

    const { data: current, error: readErr } = await supabase
      .from(TABLE)
      .select("identity_statement,current_streak,last_checkin_date")
      .eq("user_id", currentUserId)
      .maybeSingle();

    if (readErr && readErr.code !== "PGRST116") throw readErr;

    if (!current) {
      const allowedCreators = creatorsTextToArray(sitesInput?.value ?? "");
      const { error } = await supabase.from(TABLE).insert({
        user_id: currentUserId,
        allowed_creators: allowedCreators,
        identity_statement: input,
        current_streak: 1,
        last_checkin_date: todayKey,
        last_checkin_time: nowTime,
      });
      if (error) throw error;

      await loadState();
      showMessage("Identity locked in. Day 1 of your Healthy Social Media streak has started.", "success");
      return;
    }

    if (current.last_checkin_date === todayKey) {
      const { error } = await supabase.from(TABLE).update({ last_checkin_time: nowTime }).eq("user_id", currentUserId);
      if (error) throw error;

      await loadState();
      showMessage("You already checked in today. Streak stays the same, time updated.", "success");
      return;
    }

    if (normalize(input) !== normalize(current.identity_statement)) throw new Error("IDENTITY_MISMATCH");

    const nextStreak = Number(current.current_streak || 0) + 1;

    const { error } = await supabase
      .from(TABLE)
      .update({ current_streak: nextStreak, last_checkin_date: todayKey, last_checkin_time: nowTime })
      .eq("user_id", currentUserId);

    if (error) throw error;

    await loadState();
    showMessage(`Check-in logged. You are now on Day ${nextStreak}.`, "success");
  })
);

slipBtn?.addEventListener("click", () =>
  guarded("slip", async () => {
    if (!currentUserId) throw new Error("AUTH_REQUIRED");

    const ok = confirm("Mark today as a slip and reset your Healthy Social Media streak back to Day 0?");
    if (!ok) return;

    const { error, count } = await supabase
      .from(TABLE)
      .update({ current_streak: 0, last_checkin_date: null, last_checkin_time: null }, { count: "exact" })
      .eq("user_id", currentUserId);

    if (error) throw error;

    if (!count) {
      showMessage("No streak found to reset yet. Save an identity or check in first.", "error");
      return;
    }

    await loadState();
    showMessage("You marked a slip. Streak reset to Day 0. We rebuild from zero.", "success");
  })
);

// ===============================
// INIT
// ===============================
async function init() {
  const user = await requireActiveSubscription({ returnTo: "NoSocialMedia.html" });
  if (!user?.id) return;

  const userId = await getValidSessionUserId();
  if (!userId) {
    showMessage("Session expired. Please log in again.", "error");
    return;
  }

  currentUserId = userId;

  supabase.auth.onAuthStateChange((_event, session) => {
    if (!session?.user?.id) currentUserId = null;
  });

  await loadState();
}

init();
