// ./js/submit.petite.js

// importing firebase services
import { auth, db, storage } from "./firebase.js";

// importing auth helpers
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

// importing firestore helpers
import {
  collection,
  addDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// importing storage helpers
import {
  ref as sRef,
  uploadBytes,
  getDownloadURL,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

// starting script
(() => {
  // storing local keys
  const PROFILE_KEY = "utm_profile";
  const NEXT_KEY = "utm_next";

  // storing placeholder image
  const PLACEHOLDER_IMG = "./img/tomato.png";

  // parsing json safely
  function jparse(raw, fallback) {
    try {
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
  }

  // reading saved profile
  function rProf() {
    const raw = localStorage.getItem(PROFILE_KEY);
    return raw ? jparse(raw, null) : null;
  }

  // normalizing email
  function nEmail(email) {
    return String(email || "").trim().toLowerCase();
  }

  // getting signed in email
  function gEmail() {
    const authEmail = nEmail(auth.currentUser?.email || "");
    if (authEmail) return authEmail;

    const p = rProf();
    return nEmail(p?.email || "");
  }

  // setting cart badge
  function setCart() {
    const el = document.getElementById("cartCount");
    if (!el) return;

    const email = gEmail();
    const key = email ? `utm_cart_${email}` : "utm_cart_guest";
    const raw = localStorage.getItem(key);
    const cart = raw ? jparse(raw, []) : [];

    let count = 0;

    if (Array.isArray(cart)) {
      for (const it of cart) {
        count += Number(it?.qty) || 0;
      }
    }

    el.textContent = `(${count})`;
  }

  // making simple id
  function mkId() {
    return globalThis.crypto?.randomUUID?.()
      ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  // normalizing expiry
  function nExp(expStr) {
    const str = String(expStr || "").trim();
    if (!str) return "";
    return str;
  }

  // uploading image
  async function upImg(user, file) {
    if (!user || !file) return "";

    const clean = String(file.name || "photo.jpg").replace(/[^\w.\-]+/g, "_");
    const path = `posts/${user.uid}/${Date.now()}-${clean}`;
    const ref = sRef(storage, path);

    await uploadBytes(ref, file);

    return await getDownloadURL(ref);
  }

  // making petite vue app
  function SubmitApp() {
    return {
      // storing form fields
      title: "",
      desc: "",
      qty: 1,
      exp: "",
      loc: "",
      time: "",
      diets: [],
      today: new Date().toISOString().split("T")[0],

      // storing image state
      imgFile: null,
      imgPreviewDataUrl: "",

      // storing ui state
      submitting: false,
      ready: false,

      // starting app
      init() {
        setCart();

        onAuthStateChanged(auth, (user) => {
          setCart();

          if (!user) {
            localStorage.setItem(NEXT_KEY, "./submit.html");
            window.location.href = "./login.html";
            return;
          }

          this.ready = true;
        });
      },

      // picking image
      onPickImage(e) {
        const file = e?.target?.files?.[0] || null;
        this.imgFile = file;

        if (!file) {
          this.imgPreviewDataUrl = "";
          return;
        }

        const reader = new FileReader();

        reader.onload = () => {
          this.imgPreviewDataUrl = String(reader.result || "");
        };

        reader.onerror = () => {
          this.imgPreviewDataUrl = "";
        };

        reader.readAsDataURL(file);
      },

      // submitting post
      async submitPost() {
        if (this.submitting) return;

        const user = auth.currentUser;

        if (!user) {
          localStorage.setItem(NEXT_KEY, "./submit.html");
          window.location.href = "./login.html";
          return;
        }

        const title = String(this.title || "").trim();
        const desc = String(this.desc || "").trim();
        const qty = Math.max(1, Number(this.qty) || 1);
        const expRaw = String(this.exp || "").trim();
        const loc = String(this.loc || "").trim();
        const time = String(this.time || "").trim();
        const diets = Array.isArray(this.diets) ? this.diets.slice() : [];
        const donorEmail = nEmail(user.email || "");

        if (!title) {
          alert("Title is required.");
          return;
        }

        if (!desc) {
          alert("Description is required.");
          return;
        }

        if (!qty) {
          alert("Quantity is required.");
          return;
        }

        if (!expRaw) {
          alert("Expiry is required.");
          return;
        }

        if (!loc) {
          alert("Pick up location is required.");
          return;
        }

        this.submitting = true;

        try {
          // uploading image
          let imgUrl = "";

          if (this.imgFile) {
            imgUrl = await upImg(user, this.imgFile);
          }

          // building post
          const post = {
            postId: mkId(),
            donorUid: String(user.uid || ""),
            donorEmail,
            title,
            desc,
            qty,
            qtyAvailable: qty,
            exp: nExp(expRaw),
            loc,
            time,
            diets,
            imgUrl,
            img: imgUrl || PLACEHOLDER_IMG,
            status: "Available",
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          };

          // saving post
          await addDoc(collection(db, "posts"), post);

          // moving page
          window.location.href = "./demo.html";
        } catch (err) {
          console.error("Could not submit post:", err);
          alert("Could not submit post.");
        } finally {
          this.submitting = false;
        }
      },
    };
  }

  // waiting for load
  document.addEventListener("DOMContentLoaded", () => {
    // checking petite vue
    if (!window.PetiteVue) {
      console.error("PetiteVue not loaded. Check script order in submit.html.");
      return;
    }

    // mounting app
    PetiteVue.createApp({ SubmitApp }).mount();
  });
})();