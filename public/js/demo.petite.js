import { auth, db } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

import {
  collection,
  getDocs,
  query,
  orderBy,
  limit,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

(() => {
  // storing local keys
  const PROFILE_KEY = "utm_profile";
  const NEXT_KEY = "utm_next";
  const PLACEHOLDER_IMG = "./img/tomato.png";

  // storing post availability values
  const POST_STATUS = {
    AVAILABLE: "Available",
    CLAIMED: "Claimed",
    DISCARDED: "Discarded",
    UNAVAILABLE: "Unavailable",
  };

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

  // getting signed in email
  function getSignedInEmail() {
    const authEmail = String(auth.currentUser?.email || "").trim().toLowerCase();
    if (authEmail) return authEmail;

    const profile = readProfile();
    return String(profile?.email || "").trim().toLowerCase();
  }

  // building cart key
  function getCartKey() {
    const email = getSignedInEmail();
    return email ? `utm_cart_${email}` : "utm_cart_guest";
  }

  // checking sign in and redirecting
  function requireSignInOrRedirect(nextPath = "./demo.html") {
    const email = getSignedInEmail();
    if (email) return email;

    try {
      localStorage.setItem(NEXT_KEY, nextPath);
    } catch {}

    alert("Please sign in to add items to your cart.");
    window.location.href = "./login.html";
    return "";
  }

  // reading raw cart
  function readCartRaw() {
    const raw = localStorage.getItem(getCartKey());
    const cart = raw ? safeJsonParse(raw, []) : [];
    return Array.isArray(cart) ? cart : [];
  }

  // writing raw cart
  function writeCartRaw(cart) {
    try {
      localStorage.setItem(getCartKey(), JSON.stringify(cart));
      return true;
    } catch (e) {
      console.error("Could not save cart:", e);
      alert("Could not update cart.");
      return false;
    }
  }

  // counting cart items
  function cartCount(cart) {
    let count = 0;

    for (const item of cart) {
      count += Number(item?.qty) || 0;
    }

    return count;
  }

  // setting cart count in ui
  function setCartCountUI(cart) {
    const el = document.getElementById("cartCount");
    if (!el) return;
    el.textContent = `(${cartCount(cart)})`;
  }

  // converting firestore date to string
  function toIsoString(value) {
    if (!value) return "";
    if (typeof value === "object" && typeof value.toDate === "function") {
      return value.toDate().toISOString();
    }
    return "";
  }

  // formatting expiry text
  function formatExpiry(exp) {
    const raw = String(exp || "").trim();
    if (!raw) return "—";

    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) return raw;

    return date.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "2-digit",
    });
  }

  // normalizing post
  function normalizePost(post) {
    const qty = Math.max(0, Number(post.qtyAvailable || 0));
    let status = String(post.status || "").trim();

    if (!status) {
      status = qty > 0 ? POST_STATUS.AVAILABLE : POST_STATUS.UNAVAILABLE;
    }

    if (qty <= 0 && status === POST_STATUS.AVAILABLE) {
      status = POST_STATUS.UNAVAILABLE;
    }

    return {
      id: String(post.id || ""),
      title: String(post.title || "Untitled"),
      desc: String(post.desc || ""),
      qty,
      expiryText: formatExpiry(post.exp),
      diets: Array.isArray(post.diets) ? post.diets : [],
      category: String(post.category || ""),
      location: String(post.loc || ""),
      img: String(post.img || "").trim() || PLACEHOLDER_IMG,
      imgUrl: String(post.imgUrl || "").trim(),
      status,
      claimedBy: post.claimedBy || null,
      donorUid: String(post.donorUid || ""),
      donorEmail: String(post.donorEmail || ""),
      createdAt: toIsoString(post.createdAt),
    };
  }

  // normalizing cart item
  function normalizeCartItemFromPost(post, qty) {
    return {
      id: String(post.id || ""),
      title: String(post.title || "Item"),
      desc: String(post.desc || ""),
      img: String(post.img || "").trim() || PLACEHOLDER_IMG,
      qty: Math.max(1, Number(qty) || 1),
      location: String(post.location || ""),
      expiryText: String(post.expiryText || ""),
      donorEmail: String(post.donorEmail || ""),
      status: String(post.status || ""),
    };
  }

  // converting firestore doc to post
  function postFromFirestoreDoc(docSnap) {
    const data = docSnap.data() || {};

    return normalizePost({
      id: docSnap.id,
      title: data.title,
      desc: data.desc,
      qtyAvailable: data.qtyAvailable,
      exp: data.exp,
      diets: data.diets,
      category: data.category,
      loc: data.loc,
      img: data.img,
      imgUrl: data.imgUrl,
      status: data.status,
      claimedBy: data.claimedBy,
      donorUid: data.donorUid,
      donorEmail: data.donorEmail,
      createdAt: data.createdAt,
    });
  }

  // loading posts from firestore
  async function loadPostsFromFirestore() {
    const postsQuery = query(
      collection(db, "posts"),
      orderBy("createdAt", "desc"),
      limit(200)
    );

    const snap = await getDocs(postsQuery);
    return snap.docs.map(postFromFirestoreDoc);
  }

  // making petite vue app
  function DemoApp() {
    return {
      // storing app data
      posts: [],
      cart: [],
      modalOpen: false,
      selected: null,
      activeFilter: "All",
      loading: false,

      // storing category filters
      categories: [
        "Fruits",
        "Vegetables",
        "Unopened And Unexpired Non-Perishables",
        "Unexpired Meat",
        "Unopened Fish",
        "Unopened Baked Goods",
        "Dairy",
      ],

      // checking sign in state
      get isSignedIn() {
        return !!getSignedInEmail();
      },

      // getting diet filters
      get diets() {
        const found = [];

        for (const post of this.posts) {
          for (const diet of post.diets) {
            if (!found.includes(diet)) {
              found.push(diet);
            }
          }
        }

        return found;
      },

      // getting filtered posts
      get filteredPosts() {
        if (this.activeFilter === "All") {
          return this.posts;
        }

        if (this.categories.includes(this.activeFilter)) {
          return this.posts.filter((post) => post.category === this.activeFilter);
        }

        return this.posts.filter((post) => post.diets.includes(this.activeFilter));
      },

      // starting app
      async init() {
        this.cart = readCartRaw();
        setCartCountUI(this.cart);

        this.loading = true;

        try {
          this.posts = await loadPostsFromFirestore();
        } catch (e) {
          console.error("Could not load posts:", e);
          this.posts = [];
        } finally {
          this.loading = false;
        }

        onAuthStateChanged(auth, () => {
          this.cart = readCartRaw();
          setCartCountUI(this.cart);
        });
      },

      // setting filter
      setFilter(label) {
        this.activeFilter = label;
      },

      // opening modal
      open(post) {
        this.selected = post;
        this.modalOpen = true;
        document.getElementById("postModal")?.classList.add("modal--open");
      },

      // closing modal
      close() {
        this.modalOpen = false;
        this.selected = null;
        document.getElementById("postModal")?.classList.remove("modal--open");
      },

      // getting available quantity
      availableQty(postId) {
        const post = this.posts.find((item) => item.id === String(postId));
        return Math.max(0, Number(post?.qty) || 0);
      },

      // getting in cart quantity
      inCartQty(postId) {
        const postIdText = String(postId);
        const item = this.cart.find((cartItem) => String(cartItem?.id) === postIdText);
        return Math.max(0, Number(item?.qty) || 0);
      },

      // getting remaining quantity
      remainingQty(postId) {
        const stock = this.availableQty(postId);
        const inCart = this.inCartQty(postId);
        return Math.max(0, stock - inCart);
      },

      // adding one item to cart
      addOne(e, post) {
        e?.stopPropagation?.();
        e?.preventDefault?.();

        const email = requireSignInOrRedirect("./demo.html");
        if (!email || !post) return;

        const postId = String(post.id);
        const status = String(post.status || "").trim();

        if (status === POST_STATUS.CLAIMED) {
          alert("This post is already claimed.");
          return;
        }

        if (status === POST_STATUS.DISCARDED) {
          alert("This item has been discarded.");
          return;
        }

        if (this.remainingQty(postId) <= 0) {
          alert("No quantity available.");
          return;
        }

        const cart = readCartRaw();
        const cartIndex = cart.findIndex((item) => String(item?.id) === postId);

        if (cartIndex >= 0) {
          const nextQty = (Number(cart[cartIndex].qty) || 0) + 1;
          cart[cartIndex] = normalizeCartItemFromPost(post, nextQty);
        } else {
          cart.push(normalizeCartItemFromPost(post, 1));
        }

        if (!writeCartRaw(cart)) return;

        this.cart = cart;
        setCartCountUI(this.cart);
      },
    };
  }

  // waiting for page load
  document.addEventListener("DOMContentLoaded", () => {
    if (!window.PetiteVue) {
      console.error("PetiteVue not loaded. Check the script order in demo.html.");
      return;
    }

    PetiteVue.createApp({ DemoApp }).mount();
  });
})();