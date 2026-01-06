// home.js (hardened + shared guards + GitHub Pages compatible)
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.1/+esm";

const SUPABASE_URL = "https://ehwajpgvlzeojdmvloxw.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVod2FqcGd2bHplb2pkbXZsb3h3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc0ODcyMDMsImV4cCI6MjA4MzA2MzIwM30.7jW1k4SFUT8Cj5pB1QJ3vLqd3MEjw1EA2FESuJ9H8Yk";

// Allowlist navigation (same origin only)
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
 * Hosting-aware base path:
 * - GitHub Pages => /identity---OS/
 * - Netlify / localhost => /
 *
 * Your actual app files are inside /Home/ in the repo,
 * so final root becomes: <base>/Home/
 */
function getBasePath() {
  const isGithubPages = window.location.hostname.endsWith("github.io");
  if (!isGithubPages) return "/";
  const repo = window.location.pathname.split("/")[1] || "";
  return repo ? `/${repo}/` : "/";
}


const APP_ROOT = `${getBasePath()}disciplineOS/`;

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

export { supabase };

// UI
const btnLogout = document.getElementById("btnLogout");
const loginLink = document.getElementById("loginLink");

function safeNav(page) {
  const p = String(page || "").trim();
  if (!ALLOWED_PAGES.has(p)) return;

  // Always navigate within the app root (/Home/) so it works on GitHub Pages too
  const url = new URL(`${APP_ROOT}${p}`, window.location.origin);
  window.location.replace(url.toString());
}

function safeNavWithQuery(page, params = {}) {
  const p = String(page || "").trim();
  if (!ALLOWED_PAGES.has(p)) return;

  const url = new URL(`${APP_ROOT}${p}`, window.location.origin);

  // only allow safe keys/values
  for (const [k, v] of Object.entries(params)) {
    const key = String(k).trim();
    const val = String(v ?? "").trim();
    if (!key || !val) continue;

    // for return_to we only allow internal allowlisted pages
    if (key === "return_to" && !ALLOWED_PAGES.has(val)) continue;

    url.searchParams.set(key, val);
  }

  window.location.replace(url.toString());
}

function updateLogoutVisibility(isAuthed) {
  if (btnLogout) btnLogout.classList.toggle("hidden", !isAuthed);
  if (loginLink) loginLink.classList.toggle("hidden", isAuthed);
}

// ✅ Use this on ANY protected page (call it on page load)
export async function requireAuth({ redirectTo = "LoginPage.html", returnTo = null } = {}) {
  try {
    const { data } = await supabase.auth.getSession();
    const user = data?.session?.user || null;

    if (!user) {
      if (returnTo && ALLOWED_PAGES.has(returnTo)) {
        safeNavWithQuery(redirectTo, { return_to: returnTo });
      } else {
        safeNav(redirectTo);
      }
      return null;
    }

    return user;
  } catch {
    if (returnTo && ALLOWED_PAGES.has(returnTo)) {
      safeNavWithQuery(redirectTo, { return_to: returnTo });
    } else {
      safeNav(redirectTo);
    }
    return null;
  }
}

// ✅ Subscription guard: require active subscription
export async function requireActiveSubscription({
  paywall = "Paywall.html",
  login = "LoginPage.html",
  returnTo = null,
} = {}) {
  const user = await requireAuth({ redirectTo: login, returnTo });
  if (!user) return null;

  const { data, error } = await supabase
    .from("user_subscriptions")
    .select("is_active")
    .eq("user_id", user.id)
    .maybeSingle();

  // Fail closed -> paywall (with return_to)
  if (error || !data || data.is_active !== true) {
    const target = returnTo && ALLOWED_PAGES.has(returnTo) ? returnTo : null;

    if (target) safeNavWithQuery(paywall, { return_to: target });
    else safeNav(paywall);

    return null;
  }

  return user;
}

async function initAuthUI() {
  try {
    const { data } = await supabase.auth.getSession();
    updateLogoutVisibility(!!data?.session?.user);
  } catch {
    updateLogoutVisibility(false);
  }
}

const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
  updateLogoutVisibility(!!session?.user);
});

btnLogout?.addEventListener("click", async () => {
  try {
    await supabase.auth.signOut();
  } catch {
    // ignore
  }
  safeNav("LoginPage.html");
});

// Clean up listener (prevents duplicates)
window.addEventListener("pagehide", () => {
  authListener?.subscription?.unsubscribe?.();
});

initAuthUI();
