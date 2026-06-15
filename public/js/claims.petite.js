// importing firebase services
import { auth, db } from "./firebase.js";

// importing auth state helper
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

// importing firestore helpers
import {
  collection,
  doc,
  getDocs,
  query,
  where,
  limit,
  serverTimestamp,
  runTransaction,
  increment,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// storing local profile key
const PROFILE_KEY = "utm_profile";

// storing local posts key
const POSTS_KEY = "utm_posts_v1";

// storing next page key
const NEXT_KEY = "utm_next";

// storing placeholder image path
const PLACEHOLDER_IMG = "./img/placeholder.png";

// storing claim status labels
const CLAIM_STATUS = {
  READY: "Ready for pickup",
  PICKED: "Picked up",
  CANCELLED: "Cancelled",
};

// storing post status labels
const POST_STATUS = {
  AVAILABLE: "Available",
  CLAIMED: "Claimed",
};

// reading json from localStorage safely
function jsonRead(key, fallback) {
  // reading raw string by key
  const raw = localStorage.getItem(key);

  // returning fallback when nothing is saved
  if (!raw) return fallback;

  try {
    // parsing saved json string
    return JSON.parse(raw);
  } catch {
    // returning fallback when parsing fails
    return fallback;
  }
}

// writing json into localStorage
function jsonWrite(key, value) {
  // converting value into json string and saving it
  localStorage.setItem(key, JSON.stringify(value));
}

// reading saved profile object
function readProfile() {
  // returning saved profile or null
  return jsonRead(PROFILE_KEY, null);
}

// reading saved posts array
function readPosts() {
  // reading posts from localStorage
  const posts = jsonRead(POSTS_KEY, []);

  // returning array only
  return Array.isArray(posts) ? posts : [];
}

// normalizing email text
function normEmail(email) {
  // trimming spaces and lowering letters
  return String(email || "").trim().toLowerCase();
}

// getting current user email
function getEmail() {
  // trying firebase auth email first
  const authEmail = normEmail(auth.currentUser?.email);
  if (authEmail) return authEmail;

  // falling back to saved profile email
  const profile = readProfile();
  return normEmail(profile?.email);
}

// building cart key for current user
function getCartKey() {
  // reading current email
  const email = getEmail();

  // returning user cart key or guest cart key
  return email ? `utm_cart_${email}` : "utm_cart_guest";
}

// reading cart array
function readCart() {
  // reading cart from localStorage
  const cart = jsonRead(getCartKey(), []);

  // returning array only
  return Array.isArray(cart) ? cart : [];
}

// updating cart count on the page
function setCartCountUI() {
  // finding cart count element
  const el = document.getElementById("cartCount");

  // stopping when element is missing
  if (!el) return;

  // reading current cart
  const cart = readCart();

  // starting total count
  let count = 0;

  // adding every item quantity
  for (const item of cart) {
    count += Number(item?.qty) || 0;
  }

  // showing total count in ui
  el.textContent = `(${count})`;
}

// normalizing claim status text
function normClaimStatus(status) {
  // making status easy to compare
  const value = String(status || "").trim().toLowerCase();

  // returning picked status
  if (value === "picked up" || value === "picked") return CLAIM_STATUS.PICKED;

  // returning cancelled status
  if (value === "cancelled" || value === "canceled") return CLAIM_STATUS.CANCELLED;

  // returning ready status by default
  return CLAIM_STATUS.READY;
}

// converting date-like value into iso string
function toIso(value) {
  // returning current time when empty
  if (!value) return new Date().toISOString();

  // converting firestore timestamp
  if (typeof value === "object" && typeof value.toDate === "function") {
    return value.toDate().toISOString();
  }

  // converting normal Date object
  if (value instanceof Date) {
    return value.toISOString();
  }

  // parsing normal string date
  const ms = Date.parse(String(value));

  // returning parsed iso or current time fallback
  return Number.isFinite(ms) ? new Date(ms).toISOString() : new Date().toISOString();
}

// formatting short date text
function fmtDateShort(iso) {
  // making Date object
  const d = new Date(iso);

  // returning short date like Mar 11
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// formatting relative time text
function fmtTimeAgo(iso) {
  // reading time difference from now
  const diff = Date.now() - new Date(iso).getTime();

  // converting into minutes
  const mins = Math.floor(diff / 60000);

  // returning minute text
  if (mins < 60) return `${mins}m ago`;

  // converting into hours
  const hrs = Math.floor(mins / 60);

  // returning hour text
  if (hrs < 24) return `${hrs}h ago`;

  // converting into days
  const days = Math.floor(hrs / 24);

  // returning day text
  return `${days}d ago`;
}

// converting firestore doc into claim object
function claimFromDoc(docSnap) {
  // reading raw firestore data
  const data = docSnap.data() || {};

  // reading items safely
  const items = Array.isArray(data.items) ? data.items : [];

  return {
    // storing claim id
    id: docSnap.id,

    // storing claimer email
    userEmail: normEmail(data.claimerEmail || ""),

    // storing claimer uid
    claimerUid: String(data.claimerUid || ""),

    // storing created time as iso text
    createdAt: toIso(data.createdAt),

    // storing normalized claim status
    status: normClaimStatus(data.status),

    // normalizing every claimed item
    items: items.map((item) => ({
      // storing linked post id
      postId: String(item?.postId || ""),

      // storing donor uid
      donorUid: String(item?.donorUid || ""),

      // storing donor email
      donorEmail: normEmail(item?.donorEmail || ""),

      // storing item title
      title: String(item?.title || "Item"),

      // storing safe quantity
      qty: Math.max(1, Number(item?.qty) || 1),

      // storing pickup location
      loc: String(item?.loc || ""),

      // storing pickup time
      time: String(item?.time || ""),

      // storing expiry text
      exp: String(item?.exp || ""),

      // storing image url
      imgUrl: String(item?.imgUrl || item?.img || ""),
    })),
  };
}

// building petite vue claims app
function ClaimsApp() {
  return {
    // storing signed in user email
    userEmail: "",

    // storing signed in user uid
    userUid: "",

    // storing all claims
    claims: [],

    // storing active ready claims
    activeClaims: [],

    // starting app logic
    init() {
      // setting cart badge first
      setCartCountUI();

      // listening for auth state
      onAuthStateChanged(auth, async (user) => {
        // redirecting when signed out
        if (!user) {
          localStorage.setItem(NEXT_KEY, "./claims.html");
          window.location.href = "./login.html";
          return;
        }

        // saving current user uid
        this.userUid = String(user.uid || "");

        // saving current user email
        this.userEmail = normEmail(user.email || "");

        // refreshing cart badge
        setCartCountUI();

        // loading claims after sign in
        await this.refresh();
      });

      // listening for localStorage updates from other tabs
      window.addEventListener("storage", (e) => {
        // updating cart badge when related keys change
        if (e.key === PROFILE_KEY || e.key === POSTS_KEY || e.key === getCartKey()) {
          setCartCountUI();
        }
      });
    },

    // loading user claims from firestore
    async refresh() {
      // building firestore query for this user's claims
      const claimsQuery = query(
        collection(db, "claims"),
        where("claimerUid", "==", this.userUid),
        limit(200)
      );

      // reading query results
      const snap = await getDocs(claimsQuery);

      // converting docs into claim objects
      const myClaims = snap.docs.map(claimFromDoc);

      // sorting newest claims first
      myClaims.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

      // storing all claims
      this.claims = myClaims;

      // storing only ready claims
      this.activeClaims = myClaims.filter((claim) => claim.status === CLAIM_STATUS.READY);
    },

    // getting history claims
    get history() {
      // returning non-ready claims only
      return this.claims.filter((claim) => claim.status !== CLAIM_STATUS.READY);
    },

    // getting best image for one claim
    claimImg(claim) {
      // reading first claimed item
      const firstItem = claim?.items?.[0];

      // returning placeholder when empty
      if (!firstItem) return PLACEHOLDER_IMG;

      // using direct item image first
      const directImg = String(firstItem.imgUrl || "").trim();
      if (directImg) return directImg;

      // reading saved local posts
      const posts = readPosts();

      // finding related post by id
      const post = posts.find((item) => String(item?.id) === String(firstItem.postId));

      // returning best fallback image
      return String(post?.imgDataUrl || post?.imgUrl || post?.img || PLACEHOLDER_IMG).trim();
    },

    // getting claim title
    claimTitle(claim) {
      // returning first item title or fallback
      return claim?.items?.[0]?.title || "Claim";
    },

    // summing total quantity in one claim
    claimQtyTotal(claim) {
      // reading claim items
      const items = claim?.items || [];

      // starting total
      let total = 0;

      // adding every item quantity
      for (const item of items) {
        total += Number(item?.qty) || 1;
      }

      // returning quantity total
      return total;
    },

    // building short time text for active claim
    claimTimeText(claim) {
      // returning placeholder when missing
      if (!claim) return "—";

      // combining relative time and short date
      return `${fmtTimeAgo(claim.createdAt)} · ${fmtDateShort(claim.createdAt)}`;
    },

    // building short item names text
    claimItemsText(claim) {
      // reading items safely
      const items = claim?.items || [];

      // taking first 4 titles
      const names = items.map((item) => item.title).slice(0, 4);

      // adding extra count text when needed
      const more = items.length > 4 ? ` +${items.length - 4} more` : "";

      // returning joined names text
      return names.length ? names.join(", ") + more : "";
    },

    // building short history title
    historyTitle(claim) {
      // reading first item title
      const firstTitle = claim?.items?.[0]?.title;

      // returning title with extra count when multiple items exist
      if (claim?.items?.length > 1) {
        return `${firstTitle || "Claim"} + ${claim.items.length - 1} more`;
      }

      // returning single title fallback
      return firstTitle || "Claim";
    },

    // building short history details
    historyDetails(claim) {
      // reading items safely
      const items = claim?.items || [];

      // starting quantity total
      let total = 0;

      // summing item quantities
      for (const item of items) {
        total += Number(item?.qty) || 1;
      }

      // returning combined details text
      return `${claim.status} · Qty ${total} · ${fmtDateShort(claim.createdAt)}`;
    },

    // choosing pill css class
    pillClass(claim) {
      // returning picked style
      if (claim.status === CLAIM_STATUS.PICKED) return "pill--picked";

      // returning cancelled style
      if (claim.status === CLAIM_STATUS.CANCELLED) return "pill--cancel";

      // returning empty style by default
      return "";
    },

    // handling picked up click
    markPickedUp(claim) {
      // forwarding claim id
      this.confirmPickup(claim?.id);
    },

    // handling cancel click
    cancel(claim) {
      // forwarding claim id
      this.cancelAndReturn(claim?.id);
    },

   // confirming pickup for one claim
async confirmPickup(claimId) {
  // normalizing claim id
  const id = String(claimId || "").trim();

  // stopping when id is empty
  if (!id) return;

  // starting firestore transaction
  await runTransaction(db, async (tx) => {
    // reading claim doc inside transaction
    const claimRef = doc(db, "claims", id);
    const claimSnap = await tx.get(claimRef);

    // stopping when claim is missing
    if (!claimSnap.exists()) return;

    // reading claim data
    const data = claimSnap.data() || {};

    // reading owner uid
    const ownerUid = String(data.claimerUid || "");

    // reading normalized status
    const status = normClaimStatus(data.status);

    // stopping when claim belongs to someone else
    if (ownerUid !== this.userUid) return;

    // stopping when claim is no longer ready
    if (status !== CLAIM_STATUS.READY) {
      throw new Error("This claim is not in a pickup-ready state.");
    }

    // reading claim items safely
    const items = Array.isArray(data.items) ? data.items : [];

    // adding points and saves to each donor
    const donorMap = new Map();

    // looping through every claimed item
    for (const item of items) {
      // reading donor uid
      const donorUid = String(item?.donorUid || "").trim();

      // reading donor email
      const donorEmail = normEmail(item?.donorEmail);

      // reading item quantity
      const qty = Math.max(1, Number(item?.qty) || 1);

      // skipping empty donor uid
      if (!donorUid) continue;

      // skipping self pickup by uid
      if (donorUid === this.userUid) continue;

      // skipping self pickup by email
      if (donorEmail && donorEmail === this.userEmail) continue;

      // creating donor totals when missing
      if (!donorMap.has(donorUid)) {
        donorMap.set(donorUid, {
          email: donorEmail,
          pointsToAdd: 0,
          savesToAdd: 0,
        });
      }

      // adding quantity to donor totals
      donorMap.get(donorUid).pointsToAdd += qty;
      donorMap.get(donorUid).savesToAdd += qty;
    }

    // marking claim as picked up
    tx.update(claimRef, {
      status: CLAIM_STATUS.PICKED,
      updatedAt: serverTimestamp(),
      pickedUpAt: serverTimestamp(),
    });

    // looping through every donor again
    for (const [donorUid, donorInfo] of donorMap) {
      // reading donor ref
      const userRef = doc(db, "users", donorUid);

      // updating donor totals
      tx.set(userRef, {
        email: donorInfo.email || "",
        points: increment(donorInfo.pointsToAdd),
        saves: increment(donorInfo.savesToAdd),
        updatedAt: serverTimestamp(),
      }, { merge: true });
    }
  }).catch((err) => {
    // reading error message safely
    const message = String(err?.message || "");

    // showing alert when message exists
    if (message) alert(message);
  });

  // refreshing page data
  await this.refresh();
},

    // cancelling claim and returning quantity
    async cancelAndReturn(claimId) {
      // normalizing claim id
      const id = String(claimId || "").trim();

      // stopping when id is empty
      if (!id) return;

      // starting firestore transaction
      await runTransaction(db, async (tx) => {
        // reading claim doc inside transaction
        const claimRef = doc(db, "claims", id);
        const claimSnap = await tx.get(claimRef);

        // stopping when claim is missing
        if (!claimSnap.exists()) return;

        // reading claim data
        const claim = claimSnap.data() || {};

        // reading owner uid
        const ownerUid = String(claim.claimerUid || "");

        // reading normalized claim status
        const status = normClaimStatus(claim.status);

        // reading items safely
        const items = Array.isArray(claim.items) ? claim.items : [];

        // stopping when claim belongs to someone else
        if (ownerUid !== this.userUid) return;

        // stopping when claim is no longer ready
        if (status !== CLAIM_STATUS.READY) return;

        // looping through every claimed item
        for (const item of items) {
          // reading linked post id
          const postId = String(item?.postId || "").trim();

          // skipping empty post id
          if (!postId) continue;

          // reading post doc inside transaction
          const postRef = doc(db, "posts", postId);
          const postSnap = await tx.get(postRef);

          // skipping missing post
          if (!postSnap.exists()) continue;

          // reading post data
          const post = postSnap.data() || {};

          // reading current available quantity
          const currentQty = Math.max(0, Number(post.qtyAvailable) || 0);

          // reading quantity to return
          const addQty = Math.max(1, Number(item?.qty) || 1);

          // calculating new quantity
          const newQty = currentQty + addQty;

          // updating post quantity and status
          tx.update(postRef, {
            qtyAvailable: newQty,
            status: newQty > 0 ? POST_STATUS.AVAILABLE : POST_STATUS.CLAIMED,
            updatedAt: serverTimestamp(),
          });
        }

        // marking claim as cancelled
        tx.update(claimRef, {
          status: CLAIM_STATUS.CANCELLED,
          updatedAt: serverTimestamp(),
          cancelledAt: serverTimestamp(),
        });
      });

      // refreshing page data after cancel
      await this.refresh();
    },
  };
}

// mounting app after page load
document.addEventListener("DOMContentLoaded", () => {
  // checking petite vue first
  if (!window.PetiteVue) {
    console.error("PetiteVue not loaded. Check script order in claims.html.");
    return;
  }

  // creating and mounting app
  PetiteVue.createApp({ ClaimsApp }).mount();
});