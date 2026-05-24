"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { collection, getDocs, query, where } from "firebase/firestore";
import { v4 as uuidv4 } from "uuid";
import { useOwnerAuthStore } from "@/store/auth.store";
import { callFunction, firebaseDb } from "@/firebase/firebase";

// ── Types ─────────────────────────────────────────────────────────────────────

type CustomerTier = "retail" | "ds" | "sc" | "sbQp" | "spv";
const TIER_LABELS: Record<CustomerTier, string> = {
  retail: "Retail", ds: "DS", sc: "SC", sbQp: "SB-QP", spv: "SPV",
};
const TIER_PILL: Record<CustomerTier, string> = {
  retail: "bg-slate-700 text-white",
  ds:     "bg-blue-600 text-white",
  sc:     "bg-violet-600 text-white",
  sbQp:   "bg-amber-500 text-white",
  spv:    "bg-rose-600 text-white",
};
const TIER_PILL_INACTIVE: Record<CustomerTier, string> = {
  retail: "bg-slate-100 text-slate-600 hover:bg-slate-200",
  ds:     "bg-blue-50 text-blue-600 hover:bg-blue-100",
  sc:     "bg-violet-50 text-violet-600 hover:bg-violet-100",
  sbQp:   "bg-amber-50 text-amber-600 hover:bg-amber-100",
  spv:    "bg-rose-50 text-rose-600 hover:bg-rose-100",
};

interface PriceTiers { retail: number; ds: number; sc: number; sbQp: number; spv: number; }

interface Product {
  id: string;
  name: string;
  category: string;
  prices: PriceTiers;
  currentStock: number;
}

interface Customer {
  id: string;
  displayName: string;
  phone: string | null;
  email: string | null;
  tier: CustomerTier;
}

interface CartItem {
  productId: string;
  productName: string;
  qty: number;
  unitPrice: number;
}

type PaymentMethod = "cash" | "transfer";

interface Plan {
  id: string;
  name: string;
  planType?: "regular" | "locker";
  tier: string;
  price: number;
  visitQuota: number;
  durationDays: number | null;
  hasExpiry: boolean;
  blendingFeePerSession?: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmtIdr = (n: number) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);

const CATEGORIES = ["Semua", "Inner Nutrition", "Outer Nutrition", "Accessories"];
const CAT_SHORT: Record<string, string> = {
  "Inner Nutrition": "Inner", "Outer Nutrition": "Outer", "Accessories": "Akses",
};

type ActiveTab = "pos" | "pos_membership";

// ── Component ─────────────────────────────────────────────────────────────────

export default function OwnerPosPage() {
  const { ownerId, clubId } = useOwnerAuthStore();

  const [activeTab, setActiveTab] = useState<ActiveTab>(() => {
    if (typeof window === "undefined") return "pos";
    return (sessionStorage.getItem("pos_activeTab") as ActiveTab) ?? "pos";
  });
  function switchTab(tab: ActiveTab) {
    sessionStorage.setItem("pos_activeTab", tab);
    setActiveTab(tab);
  }

  // ── Data ───────────────────────────────────────────────────────────────────
  const [products, setProducts]     = useState<Product[]>([]);
  const [customers, setCustomers]   = useState<Customer[]>([]);
  const [plans, setPlans]           = useState<Plan[]>([]);
  const [loadingData, setLoadingData] = useState(true);

  const loadData = useCallback(async () => {
    if (!ownerId || !clubId) return;
    setLoadingData(true);
    try {
      const db = firebaseDb();
      const base = `owners/${ownerId}/clubs/${clubId}`;
      const [prodSnap, custSnap, planSnap] = await Promise.all([
        getDocs(query(collection(db, `owners/${ownerId}/inventoryItems`), where("isActive", "==", true))),
        getDocs(collection(db, `${base}/customers`)),
        getDocs(query(collection(db, `${base}/membershipPlans`), where("isActive", "==", true))),
      ]);
      setProducts(prodSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Product)));
      setCustomers(custSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Customer)));
      setPlans(planSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Plan)));
    } finally {
      setLoadingData(false);
    }
  }, [ownerId, clubId]);

  useEffect(() => { loadData(); }, [loadData]);

  // ── POS state ──────────────────────────────────────────────────────────────
  const [cart, setCart]                 = useState<CartItem[]>([]);
  const [activeTier, setActiveTier]     = useState<CustomerTier>("retail");
  const [categoryFilter, setCategoryFilter] = useState("Semua");
  const [productSearch, setProductSearch]   = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [customerSearch, setCustomerSearch]     = useState("");
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [amountPaid, setAmountPaid]       = useState("");
  const [notes, setNotes]                 = useState("");
  const [walkInMode, setWalkInMode]       = useState(false);
  const [walkInName, setWalkInName]       = useState("");
  const [submitting, setSubmitting]       = useState(false);
  const [receipt, setReceipt] = useState<{
    transactionId: string; total: number; change: number;
    items: CartItem[]; customer: Customer | null;
    paymentMethod: PaymentMethod; amountPaid: number;
    timestamp: string; debtId: string | null; remainingDebt: number;
  } | null>(null);

  // ── Membership state ───────────────────────────────────────────────────────
  const [memCustomerSearch, setMemCustomerSearch]   = useState("");
  const [memSelectedCustomer, setMemSelectedCustomer] = useState<Customer | null>(null);
  const [memShowCustomerDropdown, setMemShowCustomerDropdown] = useState(false);
  const [memSelectedPlanId, setMemSelectedPlanId]   = useState("");
  const [memPaymentMethod, setMemPaymentMethod]     = useState<PaymentMethod>("cash");
  const [memAmountPaid, setMemAmountPaid]           = useState("");
  const [memNotes, setMemNotes]                     = useState("");
  const [memActivating, setMemActivating]           = useState(false);
  const [memConfirmOpen, setMemConfirmOpen]         = useState(false);
  const [memFeedback, setMemFeedback] = useState<{ type: "ok" | "err" | "info"; msg: string } | undefined>();

  // ── Derived ────────────────────────────────────────────────────────────────
  const subtotal = cart.reduce((s, i) => s + i.qty * i.unitPrice, 0);
  const paid     = parseFloat(amountPaid) || 0;
  const change   = paid - subtotal;
  const remainingDebt = paymentMethod === "cash" && amountPaid !== "" && paid < subtotal && subtotal > 0
    ? subtotal - paid : 0;

  function tierPrice(p: Product) {
    return p.prices?.[activeTier] ?? p.prices?.retail ?? 0;
  }

  const filteredProducts = products.filter((p) => {
    if (!p.prices) return false;
    const matchCat = categoryFilter === "Semua" || p.category === categoryFilter;
    const matchSearch = !productSearch || p.name.toLowerCase().includes(productSearch.toLowerCase());
    return matchCat && matchSearch;
  });

  const filteredCustomers = useMemo(() => {
    const base = customerSearch.length >= 1
      ? customers.filter((c) =>
          c.displayName.toLowerCase().includes(customerSearch.toLowerCase()) ||
          (c.phone ?? "").includes(customerSearch))
      : [...customers];
    return base.sort((a, b) => a.displayName.localeCompare(b.displayName, "id")).slice(0, 10);
  }, [customers, customerSearch]);

  const memFilteredCustomers = useMemo(() => {
    const base = memCustomerSearch.length >= 1
      ? customers.filter((c) => c.displayName.toLowerCase().includes(memCustomerSearch.toLowerCase()))
      : [...customers];
    return base.sort((a, b) => a.displayName.localeCompare(b.displayName, "id")).slice(0, 10);
  }, [customers, memCustomerSearch]);

  const memSelectedPlan  = plans.find((p) => p.id === memSelectedPlanId) ?? null;
  const memPlanPrice     = memSelectedPlan?.price ?? 0;
  const memPaid          = parseFloat(memAmountPaid) || 0;
  const memChange        = memPaid - memPlanPrice;
  const memRemainingDebt = memAmountPaid !== "" && memPaid < memPlanPrice && memPlanPrice > 0
    ? memPlanPrice - memPaid : 0;

  // ── Cart actions ───────────────────────────────────────────────────────────
  function reprice(tier: CustomerTier, currentCart: CartItem[]): CartItem[] {
    return currentCart.map((item) => {
      const prod = products.find((p) => p.id === item.productId);
      if (!prod) return item;
      return { ...item, unitPrice: prod.prices[tier] ?? prod.prices.retail };
    });
  }

  function changeTier(tier: CustomerTier) {
    setActiveTier(tier);
    setCart((prev) => reprice(tier, prev));
  }

  function selectCustomer(c: Customer) {
    setSelectedCustomer(c);
    setCustomerSearch(c.displayName);
    setShowCustomerDropdown(false);
    setActiveTier(c.tier);
    setCart((prev) => reprice(c.tier, prev));
  }

  function clearCustomer() {
    setSelectedCustomer(null);
    setCustomerSearch("");
    setWalkInMode(false);
    setWalkInName("");
    setActiveTier("retail");
    setCart((prev) => reprice("retail", prev));
  }

  function activateWalkIn() {
    setSelectedCustomer(null);
    setCustomerSearch("");
    setWalkInMode(true);
    setActiveTier("retail");
    setCart((prev) => reprice("retail", prev));
  }

  function addProduct(p: Product) {
    const unitPrice = tierPrice(p);
    const maxStock  = p.currentStock ?? 0;
    setCart((prev) => {
      const idx = prev.findIndex((i) => i.productId === p.id);
      if (idx >= 0) {
        if (prev[idx]!.qty >= maxStock) return prev;
        return prev.map((i, n) => n === idx ? { ...i, qty: i.qty + 1 } : i);
      }
      return [...prev, { productId: p.id, productName: p.name, qty: 1, unitPrice }];
    });
  }

  function setQty(productId: string, qty: number) {
    if (qty <= 0) {
      setCart((prev) => prev.filter((i) => i.productId !== productId));
    } else {
      const max = products.find((p) => p.id === productId)?.currentStock ?? 0;
      setCart((prev) => prev.map((i) => i.productId === productId ? { ...i, qty: Math.min(qty, max) } : i));
    }
  }

  function setPrice(productId: string, price: string) {
    const n = parseFloat(price);
    if (!isNaN(n) && n >= 0)
      setCart((prev) => prev.map((i) => i.productId === productId ? { ...i, unitPrice: n } : i));
  }

  function clearCart() {
    setCart([]); setSelectedCustomer(null); setCustomerSearch("");
    setWalkInMode(false); setWalkInName("");
    setActiveTier("retail");
    setAmountPaid(""); setNotes(""); setPaymentMethod("cash");
  }

  // ── Submit ─────────────────────────────────────────────────────────────────
  async function handleSubmit() {
    if (!ownerId || !clubId || cart.length === 0) return;
    if (paymentMethod === "cash" && paid === 0) return;
    if (paymentMethod === "cash" && remainingDebt > 0 && !selectedCustomer) return;
    setSubmitting(true);
    try {
      const resolvedNotes = [
        walkInMode ? (walkInName.trim() ? `Walk-in: ${walkInName.trim()}` : "Walk-in") : "",
        notes.trim(),
      ].filter(Boolean).join(" · ") || undefined;

      const result = await callFunction<{
        transactionId: string; total: number; change: number;
        debtId: string | null; remainingDebt: number;
      }>("pos_ownerSale", {
        ownerId: ownerId!, clubId: clubId!,
        requestId: uuidv4(), operationId: uuidv4(),
        paymentMethod,
        amountPaid: paymentMethod === "cash" ? paid : subtotal,
        ...(selectedCustomer?.id ? { customerId: selectedCustomer.id } : {}),
        discount: 0,
        ...(resolvedNotes ? { notes: resolvedNotes } : {}),
        items: cart.map((i) => ({
          productId: i.productId, productName: i.productName ?? "",
          modifierIds: [], modifierNames: [],
          quantity: i.qty, unitPrice: i.unitPrice, subtotal: i.qty * i.unitPrice,
        })),
      });
      setReceipt({
        transactionId: result.transactionId, total: result.total, change: result.change,
        items: [...cart], customer: selectedCustomer, paymentMethod,
        amountPaid: paymentMethod === "cash" ? paid : subtotal,
        timestamp: new Date().toLocaleString("id-ID"),
        debtId: result.debtId ?? null, remainingDebt: result.remainingDebt ?? 0,
      });
      clearCart();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Transaksi gagal");
    } finally {
      setSubmitting(false);
    }
  }

  // ── Membership actions ─────────────────────────────────────────────────────
  function handleMemActivate() {
    if (!memSelectedCustomer || !memSelectedPlanId) return;
    setMemFeedback(undefined);
    setMemConfirmOpen(true);
  }

  async function executeMemActivate() {
    if (!memSelectedCustomer || !memSelectedPlanId || !ownerId || !clubId) {
      setMemConfirmOpen(false);
      setMemFeedback({ type: "err", msg: "Sesi belum siap, coba refresh halaman." });
      return;
    }
    setMemConfirmOpen(false);
    setMemActivating(true);
    setMemFeedback(undefined);
    try {
      const result = await callFunction<{ membershipId: string; debtId?: string; remainingDebt?: number }>(
        "membership_activate", {
          ownerId, clubId,
          requestId: uuidv4(), operationId: uuidv4(),
          customerId: memSelectedCustomer.id, planId: memSelectedPlanId,
          transactionId: uuidv4(),
          ...(memAmountPaid !== "" ? { amountPaid: parseFloat(memAmountPaid) } : {}),
          paymentMethod: memPaymentMethod,
        }
      );
      const debtMsg = (result.remainingDebt ?? 0) > 0 ? ` · Utang: ${fmtIdr(result.remainingDebt!)}` : "";
      setMemFeedback({ type: "ok", msg: `✓ ${memSelectedPlan?.name} aktif untuk ${memSelectedCustomer.displayName}${debtMsg}` });
      setMemSelectedCustomer(null); setMemCustomerSearch(""); setMemSelectedPlanId("");
      setMemAmountPaid(""); setMemNotes("");
    } catch (err) {
      setMemFeedback({ type: "err", msg: err instanceof Error ? err.message : "Gagal mengaktifkan" });
    } finally {
      setMemActivating(false);
    }
  }

  // Quick-pay amounts for cash
  const quickAmounts = [50000, 100000, 150000, 200000, 300000, 500000]
    .filter((v) => v > subtotal)
    .slice(0, 3);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full min-h-0 gap-3">

      {/* ── Receipt modal ── */}
      {receipt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
            <div className="bg-green-500 px-6 py-5 text-center">
              <div className="text-4xl mb-1">✅</div>
              <p className="text-white font-bold text-lg">Transaksi Berhasil</p>
              <p className="text-green-100 text-xs font-mono mt-0.5">
                #{receipt.transactionId.slice(0, 12).toUpperCase()}
              </p>
            </div>
            <div className="px-6 py-4 space-y-1.5 text-sm max-h-56 overflow-y-auto">
              {receipt.customer && (
                <p className="text-slate-400 text-xs mb-2">👤 {receipt.customer.displayName}</p>
              )}
              {receipt.items.map((i) => (
                <div key={i.productId} className="flex justify-between text-slate-700">
                  <span className="flex-1 mr-2">{i.qty}× {i.productName}</span>
                  <span className="font-semibold shrink-0">{fmtIdr(i.qty * i.unitPrice)}</span>
                </div>
              ))}
            </div>
            <div className="px-6 pt-2 pb-2 space-y-1.5 border-t border-slate-100 text-sm">
              <div className="flex justify-between font-bold text-slate-900 text-base">
                <span>Total</span>
                <span>{fmtIdr(receipt.total)}</span>
              </div>
              {receipt.remainingDebt > 0 ? (
                <div className="flex justify-between text-amber-600 font-semibold">
                  <span>Utang tercatat</span>
                  <span>{fmtIdr(receipt.remainingDebt)}</span>
                </div>
              ) : receipt.paymentMethod === "cash" ? (
                <div className="flex justify-between text-green-600">
                  <span>Kembalian</span>
                  <span className="font-semibold">{fmtIdr(receipt.change)}</span>
                </div>
              ) : null}
              <p className="text-xs text-slate-400">{receipt.timestamp}</p>
            </div>
            <div className="px-6 pb-5 pt-3">
              <button
                onClick={() => setReceipt(null)}
                className="w-full bg-green-600 text-white rounded-xl py-3 font-bold hover:bg-green-700 transition"
              >
                Tutup &amp; Transaksi Baru
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Membership confirm modal ── */}
      {memConfirmOpen && memSelectedCustomer && memSelectedPlan && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm mx-4">
            <div className="flex items-start gap-3 mb-5">
              <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center shrink-0 text-xl">🎫</div>
              <div>
                <h3 className="text-base font-bold text-slate-900">Konfirmasi Aktivasi</h3>
                <p className="text-sm text-slate-500 mt-0.5">Periksa sebelum melanjutkan</p>
              </div>
            </div>
            <div className="bg-slate-50 rounded-xl px-4 py-3 space-y-2 mb-5 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-500">Pelanggan</span>
                <span className="font-semibold">{memSelectedCustomer.displayName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Paket</span>
                <span className="font-semibold">{memSelectedPlan.name}</span>
              </div>
              {memSelectedPlan.planType !== "locker" && (
                <div className="flex justify-between border-t border-slate-200 pt-2">
                  <span className="font-medium text-slate-600">Total</span>
                  <span className="font-bold">{fmtIdr(memSelectedPlan.price)}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-slate-500">Metode</span>
                <span className="font-medium">{memPaymentMethod === "cash" ? "Tunai" : "Transfer"}</span>
              </div>
              {memAmountPaid && memRemainingDebt > 0 && (
                <div className="flex justify-between text-amber-600">
                  <span>Utang tercatat</span>
                  <span className="font-bold">{fmtIdr(memRemainingDebt)}</span>
                </div>
              )}
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => { setMemConfirmOpen(false); }}
                className="flex-1 border border-slate-200 text-slate-600 rounded-xl py-2.5 text-sm font-semibold hover:bg-slate-50 transition"
              >
                Batal
              </button>
              <button
                onClick={executeMemActivate}
                className="flex-1 bg-blue-600 text-white rounded-xl py-2.5 text-sm font-semibold hover:bg-blue-700 transition"
              >
                Ya, Aktifkan
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Tab switcher ── */}
      <div className="flex items-center gap-1 shrink-0">
        {([
          { key: "pos",            label: "🛒 Kasir" },
          { key: "pos_membership", label: "🎫 Membership" },
        ] as { key: ActiveTab; label: string }[]).map(({ key, label }) => (
          <button
            key={key}
            onClick={() => switchTab(key)}
            className={`px-5 py-2 rounded-xl text-sm font-semibold transition ${
              activeTab === key
                ? "bg-slate-900 text-white shadow-sm"
                : "text-slate-500 hover:text-slate-700 hover:bg-slate-100"
            }`}
          >
            {label}
          </button>
        ))}
        {loadingData && <span className="ml-2 text-xs text-slate-400 animate-pulse">Memuat…</span>}
      </div>

      {/* ── POS tab ── */}
      {activeTab === "pos" && (
        <div className="flex gap-4 flex-1 min-h-0">

          {/* ── Left: catalog ── */}
          <div className="flex-1 min-w-0 flex flex-col gap-3 min-h-0">

            {/* Tier selector row */}
            <div className="flex items-center gap-1.5 flex-wrap shrink-0">
              <span className="text-xs font-semibold text-slate-400 mr-0.5">Tier:</span>
              {(Object.keys(TIER_LABELS) as CustomerTier[]).map((tier) => (
                <button
                  key={tier}
                  onClick={() => changeTier(tier)}
                  className={`px-3 py-1 rounded-full text-xs font-bold transition ${
                    activeTier === tier ? TIER_PILL[tier] : TIER_PILL_INACTIVE[tier]
                  }`}
                >
                  {TIER_LABELS[tier]}
                </button>
              ))}
            </div>

            {/* Search + categories */}
            <div className="flex items-center gap-2 shrink-0">
              <div className="relative flex-1">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none">🔍</span>
                <input
                  className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-xl bg-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Cari produk…"
                  value={productSearch}
                  onChange={(e) => setProductSearch(e.target.value)}
                />
              </div>
              {CATEGORIES.map((c) => (
                <button
                  key={c}
                  onClick={() => setCategoryFilter(c)}
                  className={`px-3 py-2 rounded-xl text-xs font-semibold border transition whitespace-nowrap ${
                    categoryFilter === c
                      ? "bg-slate-800 text-white border-slate-800"
                      : "border-slate-200 text-slate-500 hover:border-slate-400 bg-white"
                  }`}
                >
                  {CAT_SHORT[c] ?? c}
                </button>
              ))}
            </div>

            {/* Product grid — scrollable */}
            {filteredProducts.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center text-slate-400 gap-2">
                <span className="text-4xl">📦</span>
                <p className="text-sm">
                  {products.length === 0 ? "Belum ada item. Tambahkan di halaman Inventaris." : "Tidak ada produk yang cocok."}
                </p>
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto">
                <div className="grid grid-cols-3 gap-2.5 content-start pb-4">
                  {filteredProducts.map((p) => {
                    const inCart    = cart.find((i) => i.productId === p.id);
                    const stock     = p.currentStock ?? 0;
                    const outOfStock = stock === 0;
                    const price     = tierPrice(p);
                    return (
                      <div
                        key={p.id}
                        onClick={() => !outOfStock && !inCart && addProduct(p)}
                        className={`relative rounded-2xl border-2 p-3 transition select-none ${
                          outOfStock   ? "border-slate-200 bg-slate-50 opacity-40 cursor-not-allowed"
                          : inCart     ? "border-green-400 bg-green-50 shadow-sm"
                          : "border-slate-200 bg-white hover:border-slate-300 hover:shadow-md cursor-pointer"
                        }`}
                      >
                        {/* Stock chip */}
                        <span className={`absolute top-2.5 right-2.5 text-xs font-bold px-1.5 py-0.5 rounded-full leading-none ${
                          outOfStock ? "bg-red-100 text-red-500"
                          : stock <= 5 ? "bg-amber-100 text-amber-600"
                          : "bg-slate-100 text-slate-400"
                        }`}>
                          {outOfStock ? "Habis" : stock}
                        </span>

                        {/* Category */}
                        <p className="text-xs text-slate-400 pr-10 mb-1 leading-tight truncate">
                          {CAT_SHORT[p.category] ?? p.category}
                        </p>

                        {/* Name */}
                        <p className="text-sm font-bold text-slate-800 leading-snug mb-2 line-clamp-2 min-h-[2.5rem]">
                          {p.name}
                        </p>

                        {/* Price */}
                        <p className="text-base font-bold text-green-700 mb-2">{fmtIdr(price)}</p>

                        {/* Qty controls if in cart, else hint */}
                        {inCart ? (
                          <div
                            className="flex items-center gap-1.5"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <button
                              onClick={() => setQty(p.id, inCart.qty - 1)}
                              className="w-7 h-7 rounded-full bg-white border border-slate-200 text-slate-600 text-sm font-bold flex items-center justify-center hover:bg-red-50 hover:text-red-500 hover:border-red-200 transition"
                            >−</button>
                            <span className="flex-1 text-center text-sm font-bold text-slate-800">{inCart.qty}</span>
                            <button
                              onClick={() => setQty(p.id, inCart.qty + 1)}
                              disabled={inCart.qty >= stock}
                              className="w-7 h-7 rounded-full bg-green-600 text-white text-sm font-bold flex items-center justify-center hover:bg-green-700 disabled:opacity-30 transition"
                            >+</button>
                          </div>
                        ) : (
                          !outOfStock && (
                            <p className="text-xs text-slate-300 text-center">tap untuk tambah</p>
                          )
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* ── Right: order panel ── */}
          <div className="w-80 shrink-0 flex flex-col min-h-0 bg-white rounded-2xl border border-slate-200 overflow-hidden">

            {/* Customer selector */}
            <div className="px-4 pt-4 pb-3 border-b border-slate-100 shrink-0 relative">
              <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">👤 Pelanggan</p>

              {/* ── Registered customer selected ── */}
              {selectedCustomer ? (
                <div className="flex items-center gap-2 bg-blue-50 rounded-xl px-3 py-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-blue-900 truncate">{selectedCustomer.displayName}</p>
                    <p className="text-xs text-blue-500">
                      {TIER_LABELS[selectedCustomer.tier]}{selectedCustomer.phone ? ` · ${selectedCustomer.phone}` : ""}
                    </p>
                  </div>
                  <button onClick={clearCustomer} className="text-blue-300 hover:text-blue-500 text-xl leading-none shrink-0">×</button>
                </div>

              /* ── Walk-in mode ── */
              ) : walkInMode ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 bg-slate-100 rounded-xl px-3 py-2">
                    <span className="text-base shrink-0">🚶</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-slate-700">Walk-in</p>
                      <p className="text-xs text-slate-400">Harga {TIER_LABELS[activeTier]} · tanpa akun</p>
                    </div>
                    <button onClick={clearCustomer} className="text-slate-300 hover:text-slate-500 text-xl leading-none shrink-0">×</button>
                  </div>
                  <input
                    className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm bg-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-400"
                    placeholder="Nama tamu (opsional, untuk catatan)"
                    value={walkInName}
                    onChange={(e) => setWalkInName(e.target.value)}
                  />
                </div>

              /* ── Nothing selected yet ── */
              ) : (
                <div className="space-y-2">
                  <div className="relative">
                    <input
                      className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm bg-slate-50 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white"
                      placeholder="Cari nama / HP pelanggan…"
                      value={customerSearch}
                      onChange={(e) => { setCustomerSearch(e.target.value); setShowCustomerDropdown(true); }}
                      onFocus={() => setShowCustomerDropdown(true)}
                      onBlur={() => setTimeout(() => setShowCustomerDropdown(false), 150)}
                    />
                    {showCustomerDropdown && filteredCustomers.length > 0 && (
                      <div className="absolute left-0 right-0 top-full z-20 bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden mt-1">
                        {filteredCustomers.map((c) => (
                          <button
                            key={c.id}
                            type="button"
                            className="w-full text-left px-3 py-2.5 hover:bg-slate-50 border-b border-slate-100 last:border-0"
                            onMouseDown={(e) => { e.preventDefault(); selectCustomer(c); }}
                          >
                            <p className="text-sm font-semibold text-slate-800">{c.displayName}</p>
                            <p className="text-xs text-slate-400">{TIER_LABELS[c.tier]}{c.phone ? ` · ${c.phone}` : ""}</p>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <button
                    onClick={activateWalkIn}
                    className="w-full flex items-center justify-center gap-2 py-2 rounded-xl border border-dashed border-slate-300 text-sm text-slate-500 hover:bg-slate-50 hover:border-slate-400 hover:text-slate-700 transition font-medium"
                  >
                    <span>🚶</span> Walk-in (harga Retail)
                  </button>
                </div>
              )}
            </div>

            {/* Cart items — scrollable */}
            <div className="flex-1 overflow-y-auto min-h-0">
              {cart.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-slate-300 gap-2 p-6">
                  <span className="text-5xl">🛒</span>
                  <p className="text-sm font-semibold">Keranjang kosong</p>
                  <p className="text-xs text-center text-slate-400 leading-relaxed">
                    Tap produk di sebelah kiri untuk menambahkan ke pesanan
                  </p>
                </div>
              ) : (
                <div className="p-3 space-y-1.5">
                  <div className="flex items-center justify-between mb-1 px-1">
                    <p className="text-xs font-bold text-slate-400 uppercase tracking-wide">
                      {cart.length} produk
                    </p>
                    <button onClick={clearCart} className="text-xs text-red-400 hover:text-red-600 font-semibold">
                      Kosongkan
                    </button>
                  </div>
                  {cart.map((item) => (
                    <div key={item.productId} className="flex items-center gap-2 bg-slate-50 rounded-xl px-3 py-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-slate-800 truncate">{item.productName}</p>
                        <input
                          type="number"
                          className="mt-0.5 w-full border-0 bg-transparent text-xs text-slate-400 p-0 focus:outline-none focus:text-slate-700"
                          value={item.unitPrice}
                          onChange={(e) => setPrice(item.productId, e.target.value)}
                          title="Tap untuk edit harga"
                        />
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={() => setQty(item.productId, item.qty - 1)}
                          className="w-6 h-6 rounded-full bg-white border border-slate-200 text-slate-600 text-sm font-bold flex items-center justify-center hover:bg-red-50 hover:text-red-500 hover:border-red-200 transition"
                        >−</button>
                        <span className="w-5 text-center text-sm font-bold text-slate-800">{item.qty}</span>
                        <button
                          onClick={() => setQty(item.productId, item.qty + 1)}
                          disabled={item.qty >= (products.find((p) => p.id === item.productId)?.currentStock ?? 0)}
                          className="w-6 h-6 rounded-full bg-slate-700 text-white text-sm font-bold flex items-center justify-center hover:bg-slate-900 disabled:opacity-30 transition"
                        >+</button>
                      </div>
                      <p className="text-xs font-bold text-slate-800 w-16 text-right shrink-0">
                        {fmtIdr(item.qty * item.unitPrice)}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Checkout section — only when cart has items */}
            {cart.length > 0 && (
              <div className="border-t border-slate-100 shrink-0">

                {/* Subtotal bar */}
                <div className="px-4 py-2.5 flex justify-between items-center bg-slate-50">
                  <span className="text-sm font-semibold text-slate-500">Subtotal</span>
                  <span className="text-xl font-bold text-slate-900">{fmtIdr(subtotal)}</span>
                </div>

                <div className="px-4 py-3 space-y-2.5">
                  {/* Payment method */}
                  <div className="flex gap-2">
                    {(["cash", "transfer"] as PaymentMethod[]).map((m) => (
                      <button
                        key={m}
                        onClick={() => { setPaymentMethod(m); setAmountPaid(""); }}
                        className={`flex-1 py-2 rounded-xl text-sm font-semibold border transition ${
                          paymentMethod === m
                            ? "border-slate-800 bg-slate-900 text-white"
                            : "border-slate-200 text-slate-500 hover:border-slate-400 bg-white"
                        }`}
                      >
                        {m === "cash" ? "💵 Tunai" : "🏦 Transfer"}
                      </button>
                    ))}
                  </div>

                  {/* Cash: amount input + quick amounts + change/debt */}
                  {paymentMethod === "cash" && (
                    <div className="space-y-2">
                      <input
                        type="number"
                        className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-semibold bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="Jumlah uang diterima"
                        value={amountPaid}
                        onChange={(e) => setAmountPaid(e.target.value)}
                      />
                      {/* Quick-pay buttons */}
                      <div className="flex gap-1.5">
                        <button
                          onClick={() => setAmountPaid(String(subtotal))}
                          className="flex-1 py-1.5 bg-green-50 hover:bg-green-100 text-green-700 text-xs font-bold rounded-lg border border-green-200 transition"
                        >
                          Pas
                        </button>
                        {quickAmounts.map((v) => (
                          <button
                            key={v}
                            onClick={() => setAmountPaid(String(v))}
                            className="flex-1 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-lg transition"
                          >
                            {v >= 1000000 ? `${v / 1000000}jt` : `${v / 1000}rb`}
                          </button>
                        ))}
                      </div>
                      {/* Change / debt feedback */}
                      {amountPaid !== "" && paid > 0 && (
                        remainingDebt > 0 ? (
                          walkInMode ? (
                            <div className="text-sm px-3 py-2 rounded-xl bg-red-50 border border-red-200 text-red-600">
                              🚶 Walk-in tidak bisa berutang — bayar lunas
                            </div>
                          ) : selectedCustomer ? (
                            <div className="flex justify-between text-sm px-3 py-2 rounded-xl bg-amber-50 border border-amber-200 text-amber-700">
                              <span>Utang tercatat</span>
                              <span className="font-bold">{fmtIdr(remainingDebt)}</span>
                            </div>
                          ) : (
                            <div className="text-sm px-3 py-2 rounded-xl bg-red-50 border border-red-200 text-red-600">
                              ⚠ Pilih pelanggan untuk mencatat utang
                            </div>
                          )
                        ) : change >= 0 ? (
                          <div className="flex justify-between text-sm px-3 py-2 rounded-xl bg-green-50 border border-green-200 text-green-700">
                            <span>Kembalian</span>
                            <span className="font-bold">{fmtIdr(change)}</span>
                          </div>
                        ) : null
                      )}
                    </div>
                  )}

                  {/* Notes */}
                  <input
                    className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm bg-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Catatan (opsional)"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                  />
                </div>

                {/* Submit */}
                <div className="px-4 pb-4">
                  <button
                    onClick={handleSubmit}
                    disabled={
                      submitting || cart.length === 0 ||
                      (paymentMethod === "cash" && paid === 0) ||
                      (paymentMethod === "cash" && remainingDebt > 0 && !selectedCustomer)
                    }
                    className="w-full bg-green-600 text-white rounded-xl py-3.5 text-base font-bold hover:bg-green-700 active:bg-green-800 disabled:opacity-40 disabled:cursor-not-allowed transition shadow-sm"
                  >
                    {submitting
                      ? "⏳ Memproses…"
                      : remainingDebt > 0 && walkInMode
                      ? "🚶 Walk-in harus bayar lunas"
                      : remainingDebt > 0 && !selectedCustomer
                      ? "Pilih pelanggan untuk catat utang"
                      : remainingDebt > 0
                      ? `✓ Bayar ${fmtIdr(paid)} + Utang ${fmtIdr(remainingDebt)}`
                      : `✓ Bayar ${fmtIdr(paymentMethod === "cash" ? (paid || subtotal) : subtotal)}`}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Membership tab ── */}
      {activeTab === "pos_membership" && (
        <div className="flex gap-4 flex-1 min-h-0">

          {/* Left: customer + plan */}
          <div className="flex-1 min-w-0 flex flex-col gap-3 min-h-0">

            {/* Customer */}
            <div className="bg-white rounded-2xl border border-slate-200 p-4 relative shrink-0">
              <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">👤 Pilih Pelanggan</p>
              {memSelectedCustomer ? (
                <div className="flex items-center justify-between bg-blue-50 rounded-xl px-3 py-2.5">
                  <div>
                    <p className="text-sm font-bold text-blue-900">{memSelectedCustomer.displayName}</p>
                    <p className="text-xs text-blue-500">
                      {TIER_LABELS[memSelectedCustomer.tier]}{memSelectedCustomer.phone ? ` · ${memSelectedCustomer.phone}` : ""}
                    </p>
                  </div>
                  <button
                    onClick={() => { setMemSelectedCustomer(null); setMemCustomerSearch(""); }}
                    className="text-blue-300 hover:text-blue-500 text-xl leading-none"
                  >×</button>
                </div>
              ) : (
                <>
                  <input
                    className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white"
                    placeholder="Cari nama pelanggan"
                    value={memCustomerSearch}
                    onChange={(e) => { setMemCustomerSearch(e.target.value); setMemShowCustomerDropdown(true); }}
                    onFocus={() => setMemShowCustomerDropdown(true)}
                    onBlur={() => setTimeout(() => setMemShowCustomerDropdown(false), 150)}
                  />
                  {memShowCustomerDropdown && memFilteredCustomers.length > 0 && (
                    <div className="absolute left-4 right-4 top-full z-10 bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden mt-1">
                      {memFilteredCustomers.slice(0, 10).map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          className="w-full text-left px-3 py-2.5 hover:bg-slate-50 border-b border-slate-100 last:border-0"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            setMemSelectedCustomer(c);
                            setMemCustomerSearch(c.displayName);
                            setMemShowCustomerDropdown(false);
                          }}
                        >
                          <p className="text-sm font-semibold text-slate-800">{c.displayName}</p>
                          <p className="text-xs text-slate-400">{TIER_LABELS[c.tier]}{c.phone ? ` · ${c.phone}` : ""}</p>
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Plan grid */}
            <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden flex-1 min-h-0 flex flex-col">
              <div className="px-4 py-3 border-b border-slate-100 shrink-0">
                <p className="font-bold text-slate-800">Pilih Paket Membership</p>
              </div>
              {plans.length === 0 ? (
                <p className="text-sm text-slate-400 p-4">Belum ada paket membership aktif.</p>
              ) : (
                <div className="flex-1 overflow-y-auto p-3">
                  <div className="grid grid-cols-2 gap-2">
                    {plans.map((p) => {
                      const isLocker   = p.planType === "locker";
                      const isSelected = memSelectedPlanId === p.id;
                      return (
                        <button
                          key={p.id}
                          onClick={() => setMemSelectedPlanId(isSelected ? "" : p.id)}
                          className={`text-left rounded-2xl border-2 p-3 transition ${
                            isSelected
                              ? isLocker ? "border-purple-400 bg-purple-50" : "border-blue-500 bg-blue-50"
                              : "border-slate-200 hover:border-slate-300 bg-white"
                          }`}
                        >
                          <div className="flex items-center justify-between mb-1.5">
                            <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                              isLocker ? "bg-purple-100 text-purple-700" :
                              p.tier === "gold"     ? "bg-yellow-100 text-yellow-800" :
                              p.tier === "platinum" ? "bg-blue-100 text-blue-800" :
                              p.tier === "silver"   ? "bg-slate-200 text-slate-700" :
                              "bg-slate-100 text-slate-600"
                            }`}>
                              {isLocker ? "LOKER" : p.tier.toUpperCase()}
                            </span>
                            {isSelected && (
                              <span className={`text-sm font-bold ${isLocker ? "text-purple-600" : "text-blue-600"}`}>✓</span>
                            )}
                          </div>
                          <p className="text-sm font-bold text-slate-800 leading-tight mb-1">{p.name}</p>
                          <p className="text-xs text-slate-500">
                            {isLocker
                              ? `${p.visitQuota > 0 ? `${p.visitQuota}× · ` : "Harian · "}${fmtIdr(p.blendingFeePerSession ?? 0)}/sesi`
                              : `${fmtIdr(p.price)} · ${p.visitQuota}× · ${p.hasExpiry && p.durationDays ? `${p.durationDays}h` : "∞"}`}
                          </p>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Right: summary + payment */}
          <div className="w-80 shrink-0 flex flex-col gap-3">
            <div className="bg-white rounded-2xl border border-slate-200 p-4 flex-1 space-y-4">
              <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Ringkasan</p>

              {memSelectedPlan ? (
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Paket</span>
                    <span className="font-bold text-slate-800 text-right max-w-[60%]">{memSelectedPlan.name}</span>
                  </div>
                  {memSelectedPlan.planType !== "locker" && (
                    <>
                      <div className="flex justify-between">
                        <span className="text-slate-500">Kuota</span>
                        <span className="font-medium">{memSelectedPlan.visitQuota}× kunjungan</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500">Durasi</span>
                        <span className="font-medium">
                          {memSelectedPlan.hasExpiry && memSelectedPlan.durationDays
                            ? `${memSelectedPlan.durationDays} hari` : "Tanpa expired"}
                        </span>
                      </div>
                      <div className="flex justify-between border-t border-slate-100 pt-2">
                        <span className="font-semibold text-slate-700">Harga</span>
                        <span className="text-lg font-bold text-slate-900">{fmtIdr(memSelectedPlan.price)}</span>
                      </div>
                    </>
                  )}
                  {memSelectedPlan.planType === "locker" && (
                    <div className="flex justify-between">
                      <span className="text-slate-500">Biaya/sesi</span>
                      <span className="font-medium">{fmtIdr(memSelectedPlan.blendingFeePerSession ?? 0)}</span>
                    </div>
                  )}
                </div>
              ) : (
                <div className="py-8 text-center text-slate-300">
                  <p className="text-4xl mb-2">🎫</p>
                  <p className="text-sm font-medium">Pilih paket membership</p>
                </div>
              )}

              {/* Payment */}
              {memSelectedPlan && memSelectedPlan.planType !== "locker" && memSelectedPlan.price > 0 && (
                <div className="border-t border-slate-100 pt-4 space-y-2.5">
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Pembayaran</p>
                  <div className="flex gap-2">
                    {(["cash", "transfer"] as PaymentMethod[]).map((m) => (
                      <button
                        key={m}
                        onClick={() => setMemPaymentMethod(m)}
                        className={`flex-1 py-2 rounded-xl text-sm font-semibold border transition ${
                          memPaymentMethod === m
                            ? "border-slate-800 bg-slate-900 text-white"
                            : "border-slate-200 text-slate-500 hover:border-slate-400"
                        }`}
                      >
                        {m === "cash" ? "💵 Tunai" : "🏦 Transfer"}
                      </button>
                    ))}
                  </div>
                  {memPaymentMethod === "cash" && (
                    <div>
                      <input
                        type="number"
                        className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder={`Bayar (kosongkan = lunas ${fmtIdr(memPlanPrice)})`}
                        value={memAmountPaid}
                        onChange={(e) => setMemAmountPaid(e.target.value)}
                      />
                      {memAmountPaid !== "" && memPaid >= 0 && (
                        memRemainingDebt > 0 ? (
                          <div className="mt-2 flex justify-between text-sm px-3 py-2 rounded-xl bg-amber-50 border border-amber-200 text-amber-700">
                            <span>Utang akan tercatat</span>
                            <span className="font-bold">{fmtIdr(memRemainingDebt)}</span>
                          </div>
                        ) : memChange >= 0 ? (
                          <div className="mt-2 flex justify-between text-sm px-3 py-2 rounded-xl bg-green-50 border border-green-200 text-green-700">
                            <span>Kembalian</span>
                            <span className="font-bold">{fmtIdr(memChange)}</span>
                          </div>
                        ) : null
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            <input
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm bg-white placeholder:text-slate-400"
              placeholder="Catatan (opsional)"
              value={memNotes}
              onChange={(e) => setMemNotes(e.target.value)}
            />

            {memFeedback && (
              <div className={`rounded-xl px-4 py-3 text-sm font-medium ${
                memFeedback.type === "ok"   ? "bg-green-50 border border-green-200 text-green-700" :
                memFeedback.type === "info" ? "bg-slate-50 border border-slate-200 text-slate-600" :
                                             "bg-red-50 border border-red-200 text-red-600"
              }`}>
                {memFeedback.msg}
              </div>
            )}

            <button
              onClick={handleMemActivate}
              disabled={memActivating || !memSelectedCustomer || !memSelectedPlanId}
              className="w-full bg-blue-600 text-white rounded-xl py-3.5 text-base font-bold hover:bg-blue-700 disabled:opacity-40 transition"
            >
              {memActivating
                ? "⏳ Mengaktifkan…"
                : !memSelectedCustomer
                ? "Pilih pelanggan dulu"
                : !memSelectedPlanId
                ? "Pilih paket dulu"
                : `✓ Aktifkan — ${memSelectedPlan?.planType !== "locker" ? fmtIdr(memPlanPrice) : memSelectedPlan?.name}`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
