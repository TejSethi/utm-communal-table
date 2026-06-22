// importing firebase services
import { auth, db } from "./firebase.js";

// importing firestore helpers
import {
  doc,
  collection,
  serverTimestamp,
  runTransaction,
  getDoc,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// storing local keys
const PROFILE_KEY = "utm_profile";
const NEXT_KEY = "utm_next";
const PLACEHOLDER_IMG = "./img/placeholder.png";

// storing status values
const CLAIM_STATUS = { READY: "Ready for pickup" };
const POST_STATUS = { AVAILABLE: "Available", CLAIMED: "Claimed" };

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

// reading current user email
function getEmail() {
  const authEmail = String(auth.currentUser?.email ?? "").trim().toLowerCase();
  if (authEmail) return authEmail;

  const savedEmail = String(readProfile()?.email ?? "").trim().toLowerCase();
  return savedEmail || "";
}

// reading current user uid
function getUid() {
  return String(auth.currentUser?.uid ?? "").trim();
}

// getting cart key
function getCartKey() {
  const email = getEmail();
  return email ? `utm_cart_${email}` : "utm_cart_guest";
}

// reading raw cart
function readCart() {
  const raw = localStorage.getItem(getCartKey());
  const parsed = raw ? safeJsonParse(raw, []) : [];
  return Array.isArray(parsed) ? parsed : [];
}

// writing cart
function writeCart(cart) {
  try {
    localStorage.setItem(getCartKey(), JSON.stringify(cart));
    return true;
  } catch (err) {
    console.error("writeCart failed:", err);
    alert("Storage is full. Could not update cart.");
    return false;
  }
}

// counting cart items
function countCart(cart) {
  return cart.reduce((sum, it) => sum + (Number(it.qty) || 0), 0);
}

// setting cart badge
function setCartCountUI(cart) {
  const el = document.getElementById("cartCount");
  if (!el) return;
  el.textContent = `(${countCart(cart)})`;
}

// normalizing cart item
function normItem(it) {
  const id = it?.postId ?? it?.id;

  return {
    id: String(id ?? ""),
    title: String(it?.title ?? "Item"),
    desc: String(it?.desc ?? ""),
    img: String(it?.img ?? "").trim() || PLACEHOLDER_IMG,
    qty: Math.max(1, Number(it?.qty) || 1),
    location: String(it?.location ?? ""),
    expiryText: String(it?.expiryText ?? ""),
    donorEmail: String(it?.donorEmail ?? ""),
    status: String(it?.status ?? ""),
  };
}

// building claim items
function makeClaimItems(cart, postsById) {
  return cart.map((it) => {
    const post = postsById[String(it.id)] || {};

    const title = String(post.title ?? it.title ?? "Item");
    const desc = String(post.desc ?? it.desc ?? "");
    const imgUrl =
      String(post.imgUrl ?? "").trim() ||
      String(post.img ?? "").trim() ||
      PLACEHOLDER_IMG;

    return {
      postId: String(it.id),
      donorUid: String(post.donorUid ?? ""),
      donorEmail: String(post.donorEmail ?? ""),
      title,
      qty: Math.max(1, Number(it.qty) || 1),
      loc: String(post.loc ?? post.location ?? ""),
      time: String(post.time ?? ""),
      exp: String(post.exp ?? ""),
      imgUrl,
      desc,
    };
  });
}

// fetching one post
async function getPost(postId) {
  const snap = await getDoc(doc(db, "posts", String(postId)));
  if (!snap.exists()) return null;
  return { id: snap.id, ...(snap.data() || {}) };
}

// starting cart app
function CartApp() {
  return {
    // storing local state
    cart: [],
    postsById: {},

    // counting total items
    get totalItems() {
      return countCart(this.cart);
    },

    // starting app
    async init() {
      this.cart = readCart().map(normItem);
      setCartCountUI(this.cart);
      await this.loadPosts();
      this.fixCart();
    },

    // saving cart only
    saveCart() {
      writeCart(this.cart);
      setCartCountUI(this.cart);
    },

    // loading cart posts
    async loadPosts() {
      const ids = [...new Set(this.cart.map((it) => String(it.id)).filter(Boolean))];

      const pairs = await Promise.all(
        ids.map(async (id) => {
          try {
            const post = await getPost(id);
            return [id, post];
          } catch (err) {
            console.error("getPost failed:", id, err);
            return [id, null];
          }
        })
      );

      this.postsById = Object.fromEntries(pairs);
    },

    // reading one post
    postFor(it) {
      return this.postsById[String(it.id)] || null;
    },

    // showing item image
    displayImg(it) {
      if (it.img) return it.img;

      const post = this.postFor(it);
      const url =
        String(post?.imgUrl || "").trim() ||
        String(post?.img || "").trim();

      return url || PLACEHOLDER_IMG;
    },

    // showing item description
    displayDesc(it) {
      if (it.desc) return it.desc;
      const post = this.postFor(it);
      return String(post?.desc ?? "");
    },

    // reading available amount
    available(it) {
      const post = this.postFor(it);
      const qty = Number(post?.qtyAvailable ?? post?.qty ?? 0);
      return Math.max(0, qty);
    },

    // fixing cart quantities
    fixCart() {
      const next = [];

      for (const it of this.cart) {
        const avail = this.available(it);
        if (avail <= 0) continue;

        const qty = Math.min(Math.max(1, Number(it.qty) || 1), avail);
        const post = this.postFor(it);

        next.push({
          ...it,
          qty,
          title: String(post?.title ?? it.title ?? "Item"),
          desc: String(post?.desc ?? it.desc ?? ""),
          img: String(post?.imgUrl ?? it.img ?? "").trim() || PLACEHOLDER_IMG,
          location: String(post?.loc ?? post?.location ?? it.location ?? ""),
          expiryText: String(post?.exp ?? it.expiryText ?? ""),
          donorEmail: String(post?.donorEmail ?? it.donorEmail ?? ""),
          status: String(post?.status ?? it.status ?? ""),
        });
      }

      this.cart = next;
      this.saveCart();
    },

    // increasing quantity
    inc(it) {
      const idx = this.cart.findIndex((x) => x.id === it.id);
      if (idx < 0) return;

      const avail = this.available(it);
      const cur = Number(this.cart[idx].qty) || 1;

      if (cur >= avail) {
        alert(`Only ${avail} available for this item.`);
        return;
      }

      this.cart[idx].qty = cur + 1;
      this.saveCart();
    },

    // decreasing quantity
    dec(it) {
      const idx = this.cart.findIndex((x) => x.id === it.id);
      if (idx < 0) return;

      const cur = Number(this.cart[idx].qty) || 1;
      const next = cur - 1;

      if (next <= 0) {
        this.cart.splice(idx, 1);
      } else {
        this.cart[idx].qty = next;
      }

      this.saveCart();
    },

    // removing item
    remove(it) {
      const idx = this.cart.findIndex((x) => x.id === it.id);
      if (idx < 0) return;

      this.cart.splice(idx, 1);
      this.saveCart();
    },

    // clearing cart
    clearCart() {
      this.cart = [];
      this.saveCart();
    },

    // creating claim
    async claimNow() {
      if (!auth.currentUser) {
        try {
          localStorage.setItem(NEXT_KEY, "./cart.html");
        } catch {}

        window.location.href = "./login.html";
        return;
      }

      if (this.cart.length === 0) {
        alert("Your cart is empty.");
        return;
      }

      const userEmail = getEmail();
      const userUid = getUid();

      if (!userEmail || !userUid) {
        alert("Please log in again.");
        return;
      }

      try {
        await this.loadPosts();
        this.fixCart();

        if (this.cart.length === 0) {
          alert("Your cart is empty.");
          return;
        }

        await runTransaction(db, async (tx) => {
          // reading current posts
          const postRefs = this.cart.map((it) => doc(db, "posts", String(it.id)));
          const postSnaps = await Promise.all(postRefs.map((ref) => tx.get(ref)));

          const postsById = {};

          for (let i = 0; i < postSnaps.length; i++) {
            const snap = postSnaps[i];
            const id = String(this.cart[i].id);

            if (!snap.exists()) {
              throw new Error(`Post missing: ${id}`);
            }

            postsById[id] = snap.data() || {};
          }

          // checking availability
          for (const it of this.cart) {
            const id = String(it.id);
            const post = postsById[id] || {};
            const avail = Math.max(0, Number(post.qtyAvailable ?? post.qty ?? 0) || 0);
            const want = Math.max(1, Number(it.qty) || 1);
            const status = String(post.status || "").toLowerCase();

            if (status === "discarded") {
              throw new Error(`"${it.title}" has been discarded.`);
            }

            if (avail <= 0) {
              throw new Error(`"${it.title}" is no longer available.`);
            }

            if (want > avail) {
              throw new Error(`"${it.title}" only has ${avail} available.`);
            }
          }

          // creating claim doc
          const items = makeClaimItems(this.cart, postsById);
          const claimRef = doc(collection(db, "claims"));

          tx.set(claimRef, {
            claimerUid: userUid,
            claimerEmail: userEmail,
            status: CLAIM_STATUS.READY,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
            items,
          });

          // updating post quantities
          for (const it of this.cart) {
            const id = String(it.id);
            const post = postsById[id] || {};
            const avail = Math.max(0, Number(post.qtyAvailable ?? post.qty ?? 0) || 0);
            const want = Math.max(1, Number(it.qty) || 1);
            const left = Math.max(0, avail - want);

            tx.update(doc(db, "posts", id), {
              qtyAvailable: left,
              status: left > 0 ? POST_STATUS.AVAILABLE : POST_STATUS.CLAIMED,
              updatedAt: serverTimestamp(),
            });
          }
        });
      } catch (err) {
        console.error("claimNow failed:", err);
        alert(String(err?.message || "Could not create claim."));
        return;
      }

      writeCart([]);
      this.cart = [];
      setCartCountUI(this.cart);
      window.location.href = "./claims.html";
    },
  };
}

// waiting for page load
document.addEventListener("DOMContentLoaded", () => {
  // checking petite vue
  if (!window.PetiteVue) {
    console.error("PetiteVue not loaded. Check script order in cart.html.");
    return;
  }

  // mounting app
  PetiteVue.createApp({ CartApp }).mount();
});