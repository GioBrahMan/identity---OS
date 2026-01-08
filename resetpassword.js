import { supabase } from "./home.js";

// Keep consistent with your current HTML + signup rule (login.js uses 10)
const MIN_PASSWORD_LEN = 10;

// --------------------
// Cloudflare Pages-safe redirect helpers (root-based)
// --------------------
function safeRedirect(fileName) {
  const allow = new Set(["LoginPage.html", "index.html"]);
  const f = String(fileName || "").trim();
  if (!allow.has(f)) return;

  const url = new URL(`/${f}`, window.location.origin);
  window.location.assign(url.toString());
}


// Prevent double submits
let lastSubmitAt = 0;
const SUBMIT_COOLDOWN_MS = 900;
function canSubmit() {
  const now = Date.now();
  if (now - lastSubmitAt < SUBMIT_COOLDOWN_MS) return false;
  lastSubmitAt = now;
  return true;
}

// --------------------
// Elements (must exist in resetpassword.html)
// --------------------
const tokenErrorEl = document.getElementById("tokenError");
const resetForm = document.getElementById("resetForm");
const newPassEl = document.getElementById("newPass");
const confirmEl = document.getElementById("confirmPass");
const btnUpdate = document.getElementById("btnUpdate");
const msgEl = document.getElementById("msg");
const reqListEl = document.getElementById("reqList");
const strengthBar = document.getElementById("strengthBar");

// --------------------
// UI helpers
// --------------------
function showTokenError(text) {
  if (!tokenErrorEl) return;
  tokenErrorEl.textContent = String(text || "");
  tokenErrorEl.classList.remove("hidden");
}

function hideTokenError() {
  if (!tokenErrorEl) return;
  tokenErrorEl.textContent = "";
  tokenErrorEl.classList.add("hidden");
}

function showForm() {
  resetForm?.classList.remove("hidden");
}

function setMsg(text, type = "success") {
  if (!msgEl) return;
  msgEl.textContent = String(text || "");
  msgEl.classList.remove("hidden");
  msgEl.classList.remove("error", "success");
  msgEl.classList.add(type === "error" ? "error" : "success");
}

function clearMsg() {
  if (!msgEl) return;
  msgEl.textContent = "";
  msgEl.classList.add("hidden");
  msgEl.classList.remove("error", "success");
}

function setDisabled(disabled) {
  const d = !!disabled;
  if (btnUpdate) btnUpdate.disabled = d;
  if (newPassEl) newPassEl.disabled = d;
  if (confirmEl) confirmEl.disabled = d;
}

// --------------------
// Password policy + strength (client-side UX)
// --------------------
function evaluatePassword(pw) {
  const p = String(pw || "");

  const rules = [
    { id: "len", label: `At least ${MIN_PASSWORD_LEN} characters`, ok: p.length >= MIN_PASSWORD_LEN },
    { id: "lower", label: "1 lowercase letter", ok: /[a-z]/.test(p) },
    { id: "upper", label: "1 uppercase letter", ok: /[A-Z]/.test(p) },
    { id: "num", label: "1 number", ok: /\d/.test(p) },
    { id: "sym", label: "1 symbol", ok: /[^A-Za-z0-9]/.test(p) },
  ];

  const score = rules.reduce((acc, r) => acc + (r.ok ? 1 : 0), 0);
  return { rules, score };
}

// ✅ No innerHTML
function renderReqList(rules) {
  if (!reqListEl) return;
  reqListEl.replaceChildren();

  for (const r of rules) {
    const row = document.createElement("div");
    row.className = r.ok ? "ok" : "no";
    row.textContent = `${r.ok ? "✓" : "•"} ${r.label}`;
    reqListEl.appendChild(row);
  }
}

function renderPasswordUX() {
  const pw = newPassEl?.value || "";
  const { rules, score } = evaluatePassword(pw);

  renderReqList(rules);

  if (strengthBar) {
    const pct = Math.round((score / 5) * 100);
    strengthBar.style.width = `${pct}%`;

    if (pct <= 20) strengthBar.style.background = "var(--bad)";
    else if (pct <= 60) strengthBar.style.background = "var(--warn)";
    else strengthBar.style.background = "var(--good)";
  }

  const confirm = confirmEl?.value || "";
  const match = confirm === pw && pw.length > 0;
  const minOk = rules.find((r) => r.id === "len")?.ok;
  const decent = score >= 3;

  if (btnUpdate) btnUpdate.disabled = !(match && minOk && decent);
}

newPassEl?.addEventListener("input", renderPasswordUX);
confirmEl?.addEventListener("input", renderPasswordUX);

// --------------------
// Token/session bootstrap
// --------------------
function hasRecoveryParams() {
  const url = new URL(window.location.href);
  const code = url.searchParams.get("code");

  const hash = new URLSearchParams((window.location.hash || "").replace(/^#/, ""));
  const access_token = hash.get("access_token");
  const refresh_token = hash.get("refresh_token");
  const type = hash.get("type");

  // Also accept Supabase’s error params so we can show a friendly message
  const error = url.searchParams.get("error");
  const error_code = url.searchParams.get("error_code");

  return !!code || (!!access_token && !!refresh_token) || type === "recovery" || !!error || !!error_code;
}

// Clean URL after we consume tokens / exchange code (also removes ?error=... stuff)
function cleanUrl() {
  const url = new URL(window.location.href);
  url.searchParams.delete("code");
  url.searchParams.delete("error");
  url.searchParams.delete("error_code");
  url.searchParams.delete("error_description");
  url.hash = "";
  window.history.replaceState({}, document.title, url.toString());
}

async function establishRecoverySession() {
  // 0) If Supabase redirected with error params, fail early with a friendly error
  const url0 = new URL(window.location.href);
  const error = url0.searchParams.get("error");
  const error_code = url0.searchParams.get("error_code");

  if (error || error_code) {
    // keep URL as-is for now; caller will show error
    return false;
  }

  // 1) If PKCE code exists, exchange it
  const url = new URL(window.location.href);
  const code = url.searchParams.get("code");

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) throw error;
    cleanUrl();
    return true;
  }

  // 2) If hash tokens exist, set session directly
  const hash = new URLSearchParams((window.location.hash || "").replace(/^#/, ""));
  const access_token = hash.get("access_token");
  const refresh_token = hash.get("refresh_token");

  if (access_token && refresh_token) {
    const { error } = await supabase.auth.setSession({ access_token, refresh_token });
    if (error) throw error;
    cleanUrl();
    return true;
  }

  // 3) detectSessionInUrl may have already handled it; check user
  const { data } = await supabase.auth.getUser();
  return !!data?.user?.id;
}

// --------------------
// Errors
// --------------------
function friendlyError(err) {
  const msg = String(err?.message || "").toLowerCase();

  if (msg.includes("expired") || msg.includes("invalid") || msg.includes("token")) {
    return "This reset link is invalid or expired. Request a new reset email from the login page.";
  }

  if (err?.code === "weak_password" && err?.message) return err.message;

  if (msg.includes("password")) {
    const safe = [
      "password should be at least",
      "password is too weak",
      "password is too common",
      "new password should be different",
    ];
    if (safe.some((s) => msg.includes(s))) return err.message;
    return "Password doesn’t meet requirements. Try a stronger password.";
  }

  if (msg.includes("rate limit")) {
    return "Too many attempts. Wait a moment and try again.";
  }

  return "Could not update password. Please try again.";
}

function friendlyUrlError() {
  const url = new URL(window.location.href);
  const error_code = (url.searchParams.get("error_code") || "").toLowerCase();
  const error_desc = url.searchParams.get("error_description");

  if (error_code.includes("otp_expired")) {
    return "This reset link expired. Go back to login and request a new reset email.";
  }

  if (error_desc) {
    // keep it short/safe
    return "Reset link error. Go back to login and request a new reset email.";
  }

  return "Missing or invalid reset link. Go back to login and request a new reset email.";
}

// --------------------
// Update password (submit handler)
// --------------------
async function handleSubmit(e) {
  e?.preventDefault?.();

  if (!canSubmit()) return;

  clearMsg();
  hideTokenError();

  const pw = String(newPassEl?.value || "");
  const confirm = String(confirmEl?.value || "");

  if (!pw || pw.length < MIN_PASSWORD_LEN) {
    setMsg(`Password must be at least ${MIN_PASSWORD_LEN} characters.`, "error");
    return;
  }
  if (pw !== confirm) {
    setMsg("Passwords do not match.", "error");
    return;
  }

  const { score } = evaluatePassword(pw);
  if (score < 3) {
    setMsg("Make the password a bit stronger (hit 3+ checks).", "error");
    return;
  }

  setDisabled(true);

  try {
    const { data: userData } = await supabase.auth.getUser();
    if (!userData?.user?.id) throw new Error("AUTH_REQUIRED");

    const { error } = await supabase.auth.updateUser({ password: pw });
    if (error) throw error;

    setMsg("Password updated. Redirecting to login…", "success");

    try {
      await supabase.auth.signOut();
    } catch {}

    setTimeout(() => safeRedirect("LoginPage.html"), 900);
  } catch (err) {
    setMsg(
      err?.message === "AUTH_REQUIRED"
        ? "Session missing. Please open the reset link from your email again."
        : friendlyError(err),
      "error"
    );
    setDisabled(false);
  }
}

resetForm?.addEventListener("submit", handleSubmit);
btnUpdate?.addEventListener("click", (e) => handleSubmit(e));

// --------------------
// Init
// --------------------
(async function init() {
  clearMsg();
  hideTokenError();
  setDisabled(true);

  if (!resetForm || !newPassEl || !confirmEl || !btnUpdate) {
    showTokenError("Reset page is missing required elements. Please refresh or redeploy.");
    return;
  }

  if (!hasRecoveryParams()) {
    showTokenError("Missing reset token. Please use the reset link from your email (request a new one if needed).");
    return;
  }

  // If Supabase landed you here with error params, show a friendly message right away.
  const url = new URL(window.location.href);
  if (url.searchParams.get("error") || url.searchParams.get("error_code")) {
    showTokenError(friendlyUrlError());
    return;
  }

  try {
    const ok = await establishRecoverySession();
    if (!ok) {
      showTokenError(friendlyUrlError());
      return;
    }

    const { data } = await supabase.auth.getUser();
    if (!data?.user?.id) throw new Error("AUTH_REQUIRED");

    setDisabled(false);
    showForm();
    renderPasswordUX();
  } catch (err) {
    showTokenError(
      err?.message === "AUTH_REQUIRED"
        ? "Session missing. Please open the reset link from your email again."
        : friendlyError(err)
    );
  }
})();
