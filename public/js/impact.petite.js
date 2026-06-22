import { auth, db } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

import {
  doc,
  getDoc,
  collection,
  getDocs,
  query,
  where,
  limit,
  runTransaction,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

(() => {
  // storing local keys
  const PROFILE_KEY = "utm_profile";
  const CLAIMS_KEY = "utm_claims_v1";
  const NEXT_KEY = "utm_next";

  // parsing json safely
  function JsonParse(raw, fallback) {
    try { return JSON.parse(raw); }
    catch { return fallback; }
  }

  // reading object from local storage
  function readObject(key) {
    const raw = localStorage.getItem(key);
    const parsed = raw ? JsonParse(raw, null) : null;
    return (parsed && typeof parsed === "object" && !Array.isArray(parsed)) ? parsed : null;
  }

  // reading array from local storage
  function readArray(key) {
    const raw = localStorage.getItem(key);
    const parsed = raw ? JsonParse(raw, []) : [];
    return Array.isArray(parsed) ? parsed : [];
  }

  // getting current user email
  function currentUserEmail() {
    const authEmail = String(auth.currentUser?.email || "").trim().toLowerCase();
    if (authEmail) return authEmail;
    return String(readObject(PROFILE_KEY)?.email || "").trim().toLowerCase();
  }

  // building cart key
  function getCartKey() {
    const email = currentUserEmail();
    return email ? `utm_cart_${email}` : "utm_cart_guest";
  }

  // reading raw cart
  function readCartRaw() {
    const raw = localStorage.getItem(getCartKey());
    const parsed = raw ? JsonParse(raw, []) : [];
    return Array.isArray(parsed) ? parsed : [];
  }

  // setting cart count in ui
  function setCartCountUI() {
    const el = document.getElementById("cartCount");
    if (!el) return;

    const cart = readCartRaw();
    const count = cart.reduce((sum, it) => sum + (Number(it?.qty) || 0), 0);
    el.textContent = `(${count})`;
  }

  // getting current time of day
  function timeOfDayNow() {
    const h = new Date().getHours();
    if (h < 12) return "Morning";
    if (h < 18) return "Afternoon";
    return "Evening";
  }

  // converting value to iso string
  function toIsoString(v) {
    if (!v) return "";
    if (typeof v === "object" && typeof v.toDate === "function") return v.toDate().toISOString();
    if (v instanceof Date) return v.toISOString();

    const ms = Date.parse(String(v));
    return Number.isFinite(ms) ? new Date(ms).toISOString() : "";
  }

  // counting picked up saves from local claims
  function computePickedUpSavesForUser(claims, email) {
    if (!email) return 0;

    const picked = claims.filter((c) =>
      String(c?.userEmail || "").trim().toLowerCase() === String(email || "").trim().toLowerCase() &&
      String(c?.status || "").trim() === "Picked up"
    );

    return picked.reduce((sum, c) => {
      const items = Array.isArray(c?.items) ? c.items : [];
      const qtySum = items.reduce((s, it) => s + (Number(it?.qty) || 1), 0);
      return sum + qtySum;
    }, 0);
  }

  // counting picked up quantity from firestore claims
  function computePickedUpQtyFromClaimDocs(claimDocs) {
    return (claimDocs || []).reduce((sum, c) => {
      const items = Array.isArray(c?.items) ? c.items : [];
      const qtySum = items.reduce((s, it) => s + (Number(it?.qty) || 1), 0);
      return sum + qtySum;
    }, 0);
  }

  // reading user doc from firestore
  async function readUserDoc(uid) {
    const ref = doc(db, "users", String(uid || ""));
    const snap = await getDoc(ref);
    return snap.exists() ? (snap.data() || {}) : null;
  }

  // reading picked up claims for user
  async function readPickedUpClaimsForUser(uid) {
    const qy = query(
      collection(db, "claims"),
      where("claimerUid", "==", String(uid || "")),
      where("status", "==", "Picked up"),
      limit(200)
    );

    const snap = await getDocs(qy);
    return snap.docs.map((d) => {
      const data = d.data() || {};
      return {
        id: d.id,
        ...data,
        createdAt: toIsoString(data.createdAt) || "",
      };
    });
  }

  // making petite vue app
  function ImpactApp() {
    return {
      // storing user info
      userEmail: "",
      userUid: "",
      firstName: "User",
      timeOfDay: timeOfDayNow(),

      // storing impact values
      saves: 0,
      points: 0,

      // storing reward state
      rewardToken: "",
      rewardOpen: false,

      // storing ui state
      loading: false,
      error: "",

      // starting app
      init() {
        setCartCountUI();

        onAuthStateChanged(auth, async () => {
          const user = auth.currentUser;
          const email = String(user?.email || "").trim().toLowerCase();

          if (!user || !email) {
            try { localStorage.setItem(NEXT_KEY, "./impact.html"); } catch {}
            window.location.href = "./login.html";
            return;
          }

          this.userUid = String(user.uid || "");
          this.userEmail = email;

          const p = readObject(PROFILE_KEY) || {};
          const name = String(p.first || "User").trim();
          this.firstName = name.split(/\s+/)[0] || "User";

          setCartCountUI();
          await this.refresh();
        });

        window.addEventListener("storage", (e) => {
          if (e.key === PROFILE_KEY || e.key === CLAIMS_KEY || e.key === getCartKey()) {
            setCartCountUI();
          }
        });
      },

      // opening reward popup
      openReward() {
        this.rewardOpen = true;
        document.body.style.overflow = "hidden";
      },

      // closing reward popup
      closeReward() {
        this.rewardOpen = false;
        document.body.style.overflow = "";
      },

      // refreshing impact data
      async refresh() {
        this.loading = true;
        this.error = "";
        this.rewardToken = "";
        this.rewardOpen = false;
        document.body.style.overflow = "";

        try {
          const userDoc = await readUserDoc(this.userUid);

          const pts = Number(userDoc?.points);
          this.points = Number.isFinite(pts) ? pts : 0;

          const sv = Number(userDoc?.saves);
          this.saves = Number.isFinite(sv) ? sv : 0;

          const first = String(userDoc?.first || "").trim();
          if (first) this.firstName = first.split(/\s+/)[0] || this.firstName;
        } catch (e) {
          console.error("Impact refresh failed:", e);
          this.error = "Could not load impact data.";

          const claims = readArray(CLAIMS_KEY);
          this.saves = computePickedUpSavesForUser(claims, this.userEmail);
        } finally {
          this.loading = false;
        }
      },

      // redeeming coffee reward
      async redeemCoffee() {
        if (this.loading) return;

        this.loading = true;
        this.error = "";
        this.rewardToken = "";
        this.rewardOpen = false;

        try {
          const uid = String(this.userUid || "");
          if (!uid) throw new Error("no uid");

          const cost = 20;
          const token = `UTMCT|COFFEE|${uid}|${Date.now()}`;

          await runTransaction(db, async (tx) => {
            const userRef = doc(db, "users", uid);
            const snap = await tx.get(userRef);

            const data = snap.exists() ? (snap.data() || {}) : {};
            const pts = Number(data.points) || 0;

            if (pts < cost) throw new Error("not enough points");

            tx.set(userRef, { points: pts - cost }, { merge: true });

            const rewardRef = doc(collection(db, "rewards"));
            tx.set(rewardRef, {
              uid,
              cost,
              token,
              status: "issued",
              createdAt: serverTimestamp(),
            });
          });

          const userDoc = await readUserDoc(uid);
          const ptsNow = Number(userDoc?.points);
          this.points = Number.isFinite(ptsNow) ? ptsNow : this.points;

          this.rewardToken = token;
          this.openReward();
        } catch (e) {
          console.error("redeemCoffee failed:", e);
          this.error = "Could not redeem points.";
        } finally {
          this.loading = false;
        }
      },
    };
  }

  // waiting for page load
  document.addEventListener("DOMContentLoaded", () => {
    if (!window.PetiteVue) {
      console.error("PetiteVue not loaded. Check the script order in impact.html.");
      return;
    }

    // mounting app
    PetiteVue.createApp({ ImpactApp }).mount();
  });
})();