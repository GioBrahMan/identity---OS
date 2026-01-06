// login.js (hardened, GitHub Pages + subfolder friendly)
import { supabase } from "./home.js";

/**
 * SECURITY NOTES
 * - SUPABASE_ANON_KEY is public by design. Real security = Supabase RLS policies.
 * - Avoid leaking raw auth error details to users.
 * - Redirect URLs must be correct for BOTH:
 *    - Netlify root hosting (https://site.netlify.app/LoginPage.html)
 *    - GitHub Pages repo path + subfolder (https://user.github.io/repo/Home/LoginPage.html)
 */

// Pages allowlist (FILENAMES ONLY)
const ALLOWED_PAGES = new Set([
  "LoginPage.html",
  "index.html",
  "Paywall.html",
  "NoCorn+NoFap.html",
  "MonkMode.html",
  "NoSocialMedia.html",
  "resetpassword.html",
]);

/**
 * ✅ Base path (directory) of the current page.
 * Works whether you’re on:
 * - /LoginPage.html
 * - /Home/LoginPage.html
 * - /identity---OS/Home/LoginPage.html (GitHub Pages)
 */
const BASE_PATH = window.location.pathname.replace(/[^/]*$/, ""); // keep trailing slash
const ORIGIN = window.location.origin;

// Supabase email redirect targets MUST be absolute URLs
const RESET_REDIRECT_URL = `${ORIGIN}${BASE_PATH}resetpassword.html`;
const CONFIRM_REDIRECT_URL = `${ORIGIN}${BASE_PATH}LoginPage.html`;

// Elements
const form = document.getElementById("authForm");
const emailEl = document.getElementById("email");
const passEl = document.getElementById("password");

const btnLogin = document.getElementById("btnLogin");
const btnSignup = document.getElementById("btnSignup");
const btnForgot = document.getElementById("btnForgot");

const msgEl = document.getElementById("msg");
const yearEl = document.getElementById("year");

// Helpers
function setMsg(text, variant = "warn") {
  if (!msgEl) return;
  msgEl.textContent = text;
  msgEl.classList.add("show");
  msgEl.classList.remove("ok", "warn", "bad");
  msgEl.classList.add(variant);
}

function clearMsg() {
  if (!msgEl) return;
  msgEl.textContent = "";
  msgEl.classList.remove("show", "ok", "warn", "bad");
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * ✅ Safe nav that respects GitHub Pages repo paths + your Home/ folder (or any folder)
 * Example:
 *   BASE_PATH = "/identity---OS/Home/"
 *   safeNav("index.html") -> "/identity---OS/Home/index.html"
 */
function safeNav(page) {
  const p = String(page || "").trim();
  if (!ALLOWED_PAGES.has(p)) return;
  const url = new URL(`${BASE_PATH}${p}`, ORIGIN);
  window.location.replace(url.toString());
}

/**
 * ✅ Return-to handling:
 * - Prefer URL ?return_to=...
 * - Fall back to sessionStorage "return_to"
 * - Must be allowlisted
 */
function getReturnTo() {
  const params = new URLSearchParams(window.location.search);
  const fromQuery = String(params.get("return_to") || "").trim();

  if (fromQuery && ALLOWED_PAGES.has(fromQuery)) {
    sessionStorage.setItem("return_to", fromQuery); // persist for reloads
    return fromQuery;
  }

  const fromStore = String(sessionStorage.getItem("return_to") || "").trim();
  if (fromStore && ALLOWED_PAGES.has(fromStore)) return fromStore;

  return "index.html"; // default
}

function clearReturnTo() {
  sessionStorage.removeItem("return_to");
}

function setButtonsDisabled(disabled) {
  if (btnLogin) btnLogin.disabled = disabled;
  if (btnSignup) btnSignup.disabled = disabled;
  if (btnForgot) btnForgot.disabled = disabled;
}

// Simple UX rate-limit (not a security boundary)
const RATE_LIMIT_MS = 900;
let lastActionAt = 0;

function canAct() {
  const now = Date.now();
  if (now - lastActionAt < RATE_LIMIT_MS) return false;
  lastActionAt = now;
  return true;
}

// Map errors to non-leaky user messages
function friendlyAuthError(err) {
  const msg = (err?.message || "").toLowerCase();
  if (msg.includes("invalid login credentials")) return "Incorrect email or password.";
  if (msg.includes("email not confirmed")) return "Check your email to confirm your account, then log in.";
  if (msg.includes("user already registered")) return "That email is already registered. Try logging in instead.";
  if (msg.includes("password should be at least")) return "Password is too short.";
  if (msg.includes("rate limit")) return "Too many attempts. Wait a moment and try again.";
  if (msg.includes("over email send rate limit")) return "Too many emails sent. Try again later.";
  return "Something went wrong. Please try again.";
}

// Session bootstrap (if already logged in, skip login page)
(async function bootstrapSession() {
  try {
    // Capture return_to ASAP (so reload keeps it)
    const returnTo = getReturnTo();

    const { data } = await supabase.auth.getSession();
    if (data?.session?.user?.id) {
      clearReturnTo();
      safeNav(returnTo);
    }
  } catch {
    // ignore
  }
})();

// Login
async function handleLogin(e) {
  e.preventDefault();
  clearMsg();
  if (!canAct()) return setMsg("Slow down — one action at a time.", "warn");

  const email = String(emailEl?.value || "").trim().toLowerCase();
  const password = String(passEl?.value || "");

  if (!isValidEmail(email)) return setMsg("Enter a valid email.", "bad");
  if (!password) return setMsg("Enter your password.", "bad");

  setButtonsDisabled(true);

  try {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;

    const { data: s } = await supabase.auth.getSession();
    if (!s?.session?.user?.id) throw new Error("SESSION_NOT_FOUND");

    const returnTo = getReturnTo();
    clearReturnTo();
    safeNav(returnTo);
  } catch (err) {
    if (passEl) passEl.value = "";
    console.warn("Login failed");
    setMsg(friendlyAuthError(err), "bad");
  } finally {
    setButtonsDisabled(false);
  }
}

// Signup
async function handleSignup() {
  clearMsg();
  if (!canAct()) return setMsg("Slow down — one action at a time.", "warn");

  const email = String(emailEl?.value || "").trim().toLowerCase();
  const password = String(passEl?.value || "");

  if (!isValidEmail(email)) return setMsg("Enter a valid email.", "bad");
  if (password.length < 10) return setMsg("Password must be at least 10 characters.", "bad");

  setButtonsDisabled(true);

  try {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: CONFIRM_REDIRECT_URL },
    });
    if (error) throw error;

    setMsg("Account created. Check your email to confirm, then log in.", "ok");
  } catch (err) {
    console.warn("Signup failed");
    setMsg(friendlyAuthError(err), "bad");
  } finally {
    setButtonsDisabled(false);
  }
}

// Forgot password
async function handleForgotPassword() {
  clearMsg();
  if (!canAct()) return setMsg("Slow down — one action at a time.", "warn");

  const email = String(emailEl?.value || "").trim().toLowerCase();
  if (!isValidEmail(email)) {
    return setMsg('Type your email first, then click "Forgot password?"', "warn");
  }

  setButtonsDisabled(true);

  try {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: RESET_REDIRECT_URL,
    });
    if (error) throw error;

    setMsg("Password reset email sent. Check your inbox (and spam).", "ok");
  } catch {
    // don’t reveal whether email exists
    setMsg("If that email exists, a reset link was sent. Check your inbox.", "ok");
  } finally {
    setButtonsDisabled(false);
  }
}

// Wire up events
form?.addEventListener("submit", handleLogin);
btnSignup?.addEventListener("click", handleSignup);
btnForgot?.addEventListener("click", handleForgotPassword);

// Year
if (yearEl) yearEl.textContent = String(new Date().getFullYear());
