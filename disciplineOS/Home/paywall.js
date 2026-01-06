// paywall.js (production-safe, debug toggle, GitHub Pages + subfolder friendly)

import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";

// Supabase
const SUPABASE_URL = "https://ehwajpgvlzeojdmvloxw.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVod2FqcGd2bHplb2pkbXZsb3h3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc0ODcyMDMsImV4cCI6MjA4MzA2MzIwM30.7jW1k4SFUT8Cj5pB1QJ3vLqd3MEjw1EA2FESuJ9H8Yk";

const ALLOWED_PAGES = new Set([
  "LoginPage.html",
  "index.html",
  "Paywall.html",
  "NoCorn+NoFap.html",
  "resetpassword.html",
]);

// Debug toggle: show JSON only when URL has ?debug=1
const DEBUG_ENABLED = new URLSearchParams(window.location.search).get("debug") === "1";

// Works for:
// - /Paywall.html
// - /Home/Paywall.html
// - /identity---OS/Home/Paywall.html (GitHub Pages)
const BASE_PATH = window.location.pathname.replace(/[^/]*$/, ""); // keep trailing slash
const ORIGIN = window.location.origin;

function safeNav(page) {
  const p = String(page || "").trim();
  if (!ALLOWED_PAGES.has(p)) return;
  const url = new URL(`${BASE_PATH}${p}`, ORIGIN);
  window.location.replace(url.toString());
}

function navToLoginPreserveReturn() {
  const returnTo = sessionStorage.getItem("return_to") || "NoCorn+NoFap.html";
  const url = new URL(`${BASE_PATH}LoginPage.html`, ORIGIN);
  url.searchParams.set("return_to", returnTo);
  window.location.replace(url.toString());
}

function setHint(msg) {
  const el = document.getElementById("hint");
  if (el) el.textContent = msg;
}

function setDebug(obj) {
  const el = document.getElementById("debug");
  if (!el) return;
  if (!DEBUG_ENABLED) {
    el.textContent = ""; // hide in prod by default
    return;
  }
  el.textContent = typeof obj === "string" ? obj : JSON.stringify(obj, null, 2);
}

// optional: preserve where they were trying to go (module page)
function rememberReturnTo() {
  const params = new URLSearchParams(window.location.search);
  const returnTo = params.get("return_to");
  if (returnTo && ALLOWED_PAGES.has(returnTo)) {
    sessionStorage.setItem("return_to", returnTo);
  } else {
    sessionStorage.setItem("return_to", "NoCorn+NoFap.html");
  }
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
});

(async function init() {
  try {
    rememberReturnTo();
    setHint("Checking login…");
    setDebug("");

    const { data: userData, error: userErr } = await supabase.auth.getUser();

    // ✅ If auth is broken/expired -> send to login AND preserve return_to
    if (userErr) {
      setHint("Not logged in. Sending you to Login…");
      setDebug({ step: "auth.getUser", error: userErr });
      navToLoginPreserveReturn();
      return;
    }

    const user = userData?.user || null;
    const userId = user?.id || null;
    const email = user?.email || null;

    // ✅ If no user -> same behavior, preserve return_to
    if (!userId) {
      setHint("Not logged in. Sending you to Login…");
      setDebug({ step: "no user in session", user: null });
      navToLoginPreserveReturn();
      return;
    }

    setHint(`Logged in as ${email || userId}. Checking subscription…`);

    const { data, error } = await supabase
      .from("user_subscriptions")
      .select("is_active,current_period_end")
      .eq("user_id", userId)
      .maybeSingle();

    if (error) {
      setHint("Could not read subscription (RLS/table/query issue).");
      setDebug({ step: "select user_subscriptions", user_id: userId, error });
      return;
    }

    if (!data) {
      setHint("No subscription found for this account.");
      setDebug({ step: "subscription row missing", user_id: userId });
      return;
    }

    setDebug({ user_id: userId, email, subscription: data });

    // 1) Must be active
    if (data.is_active !== true) {
      setHint("Subscription found, but NOT active.");
      return;
    }

    // 2) If period end exists, enforce expiry. If null, allow.
    if (data.current_period_end) {
      const expiry = new Date(data.current_period_end);
      if (!Number.isNaN(expiry.getTime()) && expiry < new Date()) {
        setHint("Subscription is active but expired by date.");
        return;
      }
    }

    setHint("✅ Subscription ACTIVE. Redirecting…");

    const returnTo = sessionStorage.getItem("return_to") || "NoCorn+NoFap.html";
    safeNav(returnTo);
  } catch (e) {
    setHint("Unexpected error.");
    setDebug({ step: "catch", message: e?.message || String(e) });
  }
})();
