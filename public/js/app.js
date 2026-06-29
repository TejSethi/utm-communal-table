// importing firebase services
import { auth, db } from "./firebase.js";

// importing auth helpers
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

// importing firestore helpers
import {
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// starting script
(() => {
  // storing local keys
  const PROFILE_KEY = "utm_profile";
  const NEXT_KEY = "utm_next";

  // parsing json safely
  function safeJsonParse(raw, fallback) {
    try {
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
  }

  // reading saved profile
  function readProfile() {
    const raw = localStorage.getItem(PROFILE_KEY);
    return raw ? safeJsonParse(raw, null) : null;
  }

  // writing saved profile
  function writeProfile(profile) {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  }

  // normalizing email
  function normEmail(email) {
    return String(email || "").trim().toLowerCase();
  }

  // normalizing postal
  function normPostal(postal) {
    return String(postal || "")
      .trim()
      .toUpperCase()
      .replace(/\s+/g, "");
  }

  // reading current email
  function getEmail() {
    const authEmail = normEmail(auth.currentUser?.email || "");
    if (authEmail) return authEmail;

    const savedEmail = normEmail(readProfile()?.email || "");
    return savedEmail || "";
  }

  // getting cart key
  function getCartKey() {
    const email = getEmail();
    return email ? `utm_cart_${email}` : "utm_cart_guest";
  }

  // reading cart
  function readCart() {
    const raw = localStorage.getItem(getCartKey());
    const parsed = raw ? safeJsonParse(raw, []) : [];
    return Array.isArray(parsed) ? parsed : [];
  }

  // counting cart items
  function countCart(cart) {
    return cart.reduce((sum, it) => sum + (Number(it?.qty) || 0), 0);
  }

  // updating cart badge
  function updateCartBadge() {
    const el = document.getElementById("cartCount");
    if (!el) return;
    el.textContent = `(${countCart(readCart())})`;
  }

  // wiring cart button
  function wireCartBtn() {
    const btn = document.getElementById("cartBtn");
    if (!btn) return;

    if (btn.tagName === "BUTTON") {
      btn.addEventListener("click", () => {
        window.location.href = "./cart.html";
      });
    }
  }

  // checking allowed email
  function okEmail(email) {
    const e = normEmail(email);
    return (
      e.endsWith("@mail.utoronto.ca") ||
      e.endsWith("@utoronto.ca") ||
      e.endsWith("@cs.toronto.edu")
    );
  }

  // getting role
  function getRole(email) {
    const e = normEmail(email);
    if (e.endsWith("@mail.utoronto.ca")) return "Student";
    return "Professor";
  }

  // checking canadian postal
  function okPostal(postal) {
    const p = normPostal(postal);
    return /^[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z]\d[ABCEGHJ-NPRSTV-Z]\d$/.test(p);
  }

  // checking gta postal
  function okGta(postal) {
    const p = normPostal(postal);
    if (!p) return false;
    const first = p.slice(0, 1);
    return first === "M" || first === "L";
  }

  // building initials
  function getInit(first, last) {
    const a = String(first || "").trim().slice(0, 1).toUpperCase();
    const b = String(last || "").trim().slice(0, 1).toUpperCase();
    return (a + b).trim() || "U";
  }

  // formatting postal
  function showPostal(postal) {
    const p = normPostal(postal);
    if (p.length !== 6) return p || "—";
    return `${p.slice(0, 3)} ${p.slice(3)}`;
  }

  // updating header
  function fillHead() {
    const first = document.getElementById("first")?.value ?? "";
    const last = document.getElementById("last")?.value ?? "";
    const email = document.getElementById("email")?.value ?? "";
    const postal = document.getElementById("postal")?.value ?? "";

    const avatar = document.getElementById("avatar");
    const nameEl = document.getElementById("profileName");
    const emailEl = document.getElementById("profileEmail");
    const locEl = document.getElementById("profileLocation");

    if (avatar) avatar.textContent = getInit(first, last);
    if (nameEl) nameEl.textContent = `${first} ${last}`.trim() || "User";
    if (emailEl) emailEl.textContent = email || "—";
    if (locEl) locEl.textContent = postal ? showPostal(postal) : "—";
  }

  // filling form from profile
  function fillFormFromProfile(profile) {
    const first = document.getElementById("first");
    const last = document.getElementById("last");
    const email = document.getElementById("email");
    const postal = document.getElementById("postal");
    const role = document.getElementById("role");

    const legacyName = String(profile?.name ?? "").trim();
    const parts = legacyName ? legacyName.split(/\s+/) : [];
    const pEmail = normEmail(profile?.email ?? "");

    if (first) first.value = String(profile?.first ?? parts[0] ?? "");
    if (last) last.value = String(profile?.last ?? (parts.length > 1 ? parts.slice(1).join(" ") : "") ?? "");
    if (email) email.value = pEmail;
    if (postal) postal.value = String(profile?.postal ?? "");
    if (role) role.value = pEmail ? getRole(pEmail) : "Student";

    fillHead();
  }

  // filling form
  function fillForm() {
    const profile = readProfile();
    if (!profile) {
      fillHead();
      return;
    }

    fillFormFromProfile(profile);
  }

  // reading next path
  function readNext() {
    return String(localStorage.getItem(NEXT_KEY) || "").trim();
  }

  // clearing next path
  function clearNext() {
    try {
      localStorage.removeItem(NEXT_KEY);
    } catch {}
  }

  // saving profile
  async function saveProf() {
    const user = auth.currentUser;

    if (!user) {
      try {
        localStorage.setItem(NEXT_KEY, "./account.html");
      } catch {}

      window.location.href = "./login.html";
      return;
    }

    const email = normEmail(user.email || "");

    if (!email || !email.includes("@")) {
      alert("Your session email is missing. Please log in again.");
      return;
    }

    if (!okEmail(email)) {
      alert("Please use a UofT email: @mail.utoronto.ca, @utoronto.ca, or @cs.toronto.edu.");
      return;
    }

    const first = String(document.getElementById("first")?.value ?? "").trim();
    const last = String(document.getElementById("last")?.value ?? "").trim();
    const postalRaw = String(document.getElementById("postal")?.value ?? "").trim();
    const postal = normPostal(postalRaw);
    const role = getRole(email);

    if (!postal) {
      alert("Postal code is required (GTA).");
      return;
    }

    if (!okPostal(postal)) {
      alert("Please enter a valid Canadian postal code (e.g., M5S 1A1).");
      return;
    }

    if (!okGta(postal)) {
      alert("Please use a GTA postal code (Toronto-area).");
      return;
    }

    const payload = {
      email,
      first,
      last,
      postal,
      role,
      updatedAt: serverTimestamp(),
    };

    try {
      await setDoc(doc(db, "users", user.uid), payload, { merge: true });

      const oldProfile = readProfile() || {};
      writeProfile({
        ...oldProfile,
        ...payload,
        email,
        first,
        last,
        postal,
        role,
      });
    } catch (err) {
      console.error("Could not save profile:", err);
      alert("Could not save profile.");
      return;
    }

    const roleEl = document.getElementById("role");
    if (roleEl) roleEl.value = role;

    fillHead();
    updateCartBadge();
    alert("Saved.");

    const next = readNext();
    if (next) {
      clearNext();
      window.location.href = next;
    }
  }

  // showing password demo
  function pwdDemo() {
    const ok = confirm("Demo only: This would open a password reset flow. Continue?");
    if (!ok) return;
    alert("Password reset link sent (demo).");
  }

  // ensuring user doc
  async function ensureUser(user) {
    if (!user) return;

    const ref = doc(db, "users", user.uid);
    const snap = await getDoc(ref);

    const email = normEmail(user.email || "");
    const saved = readProfile() || {};

    if (email && !okEmail(email)) return;

    const role = email ? getRole(email) : String(saved.role || "Student");

    if (!snap.exists()) {
      const base = {
        email: email || normEmail(saved.email || ""),
        first: String(saved.first || "").trim(),
        last: String(saved.last || "").trim(),
        postal: normPostal(saved.postal || ""),
        role,
        points: 0,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };

      await setDoc(ref, base);

      writeProfile({
        email: base.email,
        first: base.first,
        last: base.last,
        postal: base.postal,
        role: base.role,
        points: 0,
      });

      return;
    }

    const data = snap.data() || {};
    const points = Number.isFinite(Number(data.points)) ? Number(data.points) : 0;

    const merged = {
      email: normEmail(data.email || email || saved.email || ""),
      first: String(data.first || saved.first || "").trim(),
      last: String(data.last || saved.last || "").trim(),
      postal: normPostal(data.postal || saved.postal || ""),
      role: String(data.role || role || "Student").trim(),
      points,
    };

    await setDoc(
      ref,
      {
        email: merged.email,
        first: merged.first,
        last: merged.last,
        postal: merged.postal,
        role: merged.role,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );

    writeProfile(merged);
  }

  // logging out
async function logOut(e) {
  e?.preventDefault?.();

  const sure = confirm("Are you sure you want to log out?");
  if (!sure) return;

  try {
    await signOut(auth);
  } catch {}

  try {
    localStorage.removeItem(PROFILE_KEY);
  } catch {}

  try {
    localStorage.removeItem(NEXT_KEY);
  } catch {}

  updateCartBadge();
  alert("Logged out");
  window.location.href = "./";
}

  // wiring logout
  function wireOut() {
    const fn = (e) => {
      logOut(e);
    };

    document.querySelectorAll("[data-logout], .js-logout").forEach((el) => {
      el.addEventListener("click", fn);
    });

    document.getElementById("logoutBtn")?.addEventListener("click", fn);
  }

  // starting account page
  function initPage() {
    const hasFirst = !!document.getElementById("first");
    const hasEmail = !!document.getElementById("email");
    if (!hasFirst && !hasEmail) return;

    fillForm();

    ["first", "last", "postal"].forEach((id) => {
      document.getElementById(id)?.addEventListener("input", fillHead);
    });

    document.getElementById("saveBtn")?.addEventListener("click", saveProf);
    document.getElementById("pwdBtn")?.addEventListener("click", pwdDemo);
  }

  // waiting for load
  document.addEventListener("DOMContentLoaded", () => {
    updateCartBadge();

    onAuthStateChanged(auth, async (user) => {
      if (!user) {
        updateCartBadge();
        return;
      }

      try {
        await ensureUser(user);
      } catch (err) {
        console.error("Could not bootstrap user:", err);
      } finally {
        if (document.getElementById("first") || document.getElementById("email")) {
          fillForm();
        }

        updateCartBadge();
      }
    });

    window.addEventListener("storage", (e) => {
      if (
        e.key === PROFILE_KEY ||
        e.key === getCartKey() ||
        e.key?.startsWith("utm_cart_")
      ) {
        updateCartBadge();
      }
    });

    wireCartBtn();
    wireOut();
    initPage();
  });
})();