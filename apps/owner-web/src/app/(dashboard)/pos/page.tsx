"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { collection, getDocs, query, where } from "firebase/firestore";
import { v4 as uuidv4 } from "uuid";
import { useOwnerAuthStore } from "@/store/auth.store";
import { callFunction, firebaseDb } from "@/firebase/firebase";

interface ClubOption { id: string; name: string; }

// ── Types ─────────────────────────────────────────────────────────────────────

type CustomerTier = "retail" | "ds" | "sc" | "sbQp" | "spv";
const TIER_LABELS: Record<CustomerTier, string> = { retail: "Retail", ds: "DS", sc: "SC", sbQp: "SB-QP", spv: "SPV" };

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

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmtIdr = (n: number) =>
  new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(n);

const CATEGORIES = ["Semua", "Inner Nutrition", "Outer Nutrition", "Accessories"];

type ActiveTab = "pos" | "pos_membership" | "transfer";

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

  // POS Membership state
  const [plans, setPlans] = useState<Plan[]>([]);
  const [memCustomerSearch, setMemCustomerSearch] = useState("");
  const [memSelectedCustomer, setMemSelectedCustomer] = useState<Customer | null>(null);
  const [memShowCustomerDropdown, setMemShowCustomerDropdown] = useState(false);
  const [memSelectedPlanId, setMemSelectedPlanId] = useState("");
  const [memPaymentMethod, setMemPaymentMethod] = useState<PaymentMethod>("cash");
  const [memAmountPaid, setMemAmountPaid] = useState("");
  const [memNotes, setMemNotes] = useState("");
  const [memActivating, setMemActivating] = useState(false);
  const [memFeedback, setMemFeedback] = useState<{ type: "ok" | "err"; msg: string } | undefined>();

  // Transfer state
  const [clubs, setClubs] = useState<ClubOption[]>([]);
  const [transferDestType, setTransferDestType] = useState<"club" | "owner">("club");
  const [transferDestClubId, setTransferDestClubId] = useState("");
  const [transferDestOwnerId, setTransferDestOwnerId] = useState("");
  const [transferPaymentType, setTransferPaymentType] = useState<"bayar" | "pinjam">("bayar");
  const [transferTier, setTransferTier] = useState<CustomerTier>("retail");
  const [transferQty, setTransferQty] = useState<Record<string, string>>({});
  const [transferNotes, setTransferNotes] = useState("");
  const [transferring, setTransferring] = useState(false);

  interface TransferReceipt {
    transferId: string;
    total: number;
    status: string;
    items: Array<{ productId: string; productName: string; quantity: number; unitPrice: number; subtotal: number }>;
    destType: "club" | "owner";
    destId: string;
    paymentType: "bayar" | "pinjam";
    tier: CustomerTier;
    timestamp: string;
  }
  const [transferResult, setTransferResult] = useState<TransferReceipt | null>(null);

  const [products, setProducts] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loadingData, setLoadingData] = useState(true);

  // Cart
  const [cart, setCart] = useState<CartItem[]>([]);

  // Filters
  const [categoryFilter, setCategoryFilter] = useState("Semua");
  const [productSearch, setProductSearch] = useState("");

  // Customer
  const [customerSearch, setCustomerSearch] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false);

  // Payment
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [amountPaid, setAmountPaid] = useState("");
  const [notes, setNotes] = useState("");

  // Submit
  const [submitting, setSubmitting] = useState(false);
  const [lastReceipt, setLastReceipt] = useState<{
    transactionId: string;
    total: number;
    change: number;
    items: CartItem[];
    customer: Customer | null;
    paymentMethod: PaymentMethod;
    amountPaid: number;
    timestamp: string;
    debtId: string | null;
    remainingDebt: number;
  } | null>(null);

  const subtotal = cart.reduce((s, i) => s + i.qty * i.unitPrice, 0);
  const paid = parseFloat(amountPaid) || 0;
  const change = paid - subtotal;
  const posRemainingDebt = paymentMethod === "cash" && amountPaid !== "" && paid < subtotal && subtotal > 0 ? subtotal - paid : 0;

  const filteredProducts = products.filter((p) => {
    if (!p.prices) return false;
    const matchCat = categoryFilter === "Semua" || p.category === categoryFilter;
    const matchSearch =
      !productSearch || p.name.toLowerCase().includes(productSearch.toLowerCase());
    return matchCat && matchSearch;
  });

  function tierPrice(p: Product): number {
    if (!p.prices) return 0;
    return p.prices[activeTier] ?? p.prices.retail ?? 0;
  }

  const filteredCustomers = useMemo(() => {
    const base = customerSearch.length >= 1
      ? customers.filter((c) =>
          c.displayName.toLowerCase().includes(customerSearch.toLowerCase()) ||
          (c.phone ?? "").includes(customerSearch)
        )
      : [...customers];
    return base
      .sort((a, b) => a.displayName.localeCompare(b.displayName, "id"))
      .slice(0, 10);
  }, [customers, customerSearch]);

  const memFilteredCustomers = useMemo(() => {
    const base = memCustomerSearch.length >= 1
      ? customers.filter((c) =>
          c.displayName.toLowerCase().includes(memCustomerSearch.toLowerCase())
        )
      : [...customers];
    return base
      .sort((a, b) => a.displayName.localeCompare(b.displayName, "id"))
      .slice(0, 10);
  }, [customers, memCustomerSearch]);

  const memSelectedPlan = plans.find((p) => p.id === memSelectedPlanId) ?? null;
  const memPlanPrice = memSelectedPlan?.price ?? 0;
  const memPaid = parseFloat(memAmountPaid) || 0;
  const memChange = memPaid - memPlanPrice;
  const memRemainingDebt = memAmountPaid !== "" && memPaid < memPlanPrice && memPlanPrice > 0 ? memPlanPrice - memPaid : 0;

  const loadData = useCallback(async () => {
    if (!ownerId || !clubId) return;
    setLoadingData(true);
    try {
      const db = firebaseDb();
      const base = `owners/${ownerId}/clubs/${clubId}`;
      const [prodSnap, custSnap, clubsSnap, planSnap] = await Promise.all([
        getDocs(query(collection(db, `${base}/inventoryItems`), where("isActive", "==", true))),
        getDocs(collection(db, `${base}/customers`)),
        getDocs(collection(db, `owners/${ownerId}/clubs`)),
        getDocs(query(collection(db, `${base}/membershipPlans`), where("isActive", "==", true))),
      ]);
      setProducts(prodSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Product)));
      setCustomers(custSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Customer)));
      setClubs(
        clubsSnap.docs
          .filter((d) => d.id !== clubId)
          .map((d) => ({ id: d.id, name: d.data()["name"] as string }))
      );
      setPlans(planSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Plan)));
    } finally {
      setLoadingData(false);
    }
  }, [ownerId, clubId]);

  async function handleMemActivate() {
    if (!ownerId || !clubId || !memSelectedCustomer || !memSelectedPlanId) return;
    setMemActivating(true);
    setMemFeedback(undefined);
    try {
      const result = await callFunction<{ membershipId: string; debtId?: string; remainingDebt?: number }>(
        "membership_activate", {
          ownerId, clubId,
          requestId: uuidv4(), operationId: uuidv4(),
          customerId: memSelectedCustomer.id,
          planId: memSelectedPlanId,
          transactionId: uuidv4(),
          ...(memAmountPaid !== "" ? { amountPaid: parseFloat(memAmountPaid) } : {}),
          paymentMethod: memPaymentMethod,
        }
      );
      const debtMsg = (result.remainingDebt ?? 0) > 0 ? ` · Utang: ${fmtIdr(result.remainingDebt!)}` : "";
      setMemFeedback({ type: "ok", msg: `${memSelectedPlan?.name} berhasil diaktifkan untuk ${memSelectedCustomer.displayName}${debtMsg}` });
      setMemSelectedCustomer(null);
      setMemCustomerSearch("");
      setMemSelectedPlanId("");
      setMemAmountPaid("");
      setMemNotes("");
    } catch (err) {
      setMemFeedback({ type: "err", msg: err instanceof Error ? err.message : "Gagal mengaktifkan" });
    } finally {
      setMemActivating(false);
    }
  }

  useEffect(() => { loadData(); }, [loadData]);

  // ── Cart actions ────────────────────────────────────────────────────────────

  const activeTier: CustomerTier = selectedCustomer?.tier ?? "retail";

  function addProduct(p: Product) {
    const unitPrice = tierPrice(p);
    const maxStock = p.currentStock ?? 0;
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
      const maxStock = products.find((p) => p.id === productId)?.currentStock ?? 0;
      setCart((prev) => prev.map((i) => i.productId === productId ? { ...i, qty: Math.min(qty, maxStock) } : i));
    }
  }

  function setPrice(productId: string, price: string) {
    const n = parseFloat(price);
    if (!isNaN(n) && n >= 0)
      setCart((prev) => prev.map((i) => i.productId === productId ? { ...i, unitPrice: n } : i));
  }

  function clearCart() {
    setCart([]);
    setSelectedCustomer(null);
    setCustomerSearch("");
    setAmountPaid("");
    setNotes("");
    setPaymentMethod("cash");
  }

  // ── Submit ──────────────────────────────────────────────────────────────────

  async function handleSubmit() {
    if (!ownerId || !clubId || cart.length === 0) return;
    if (paymentMethod === "cash" && paid === 0) return;
    if (paymentMethod === "cash" && posRemainingDebt > 0 && !selectedCustomer) return;

    setSubmitting(true);
    try {
      const result = await callFunction<{ transactionId: string; total: number; change: number; debtId: string | null; remainingDebt: number }>(
        "pos_ownerSale",
        {
          ownerId: ownerId!,
          clubId: clubId!,
          requestId: uuidv4(),
          operationId: uuidv4(),
          paymentMethod,
          amountPaid: paymentMethod === "cash" ? paid : subtotal,
          ...(selectedCustomer?.id ? { customerId: selectedCustomer.id } : {}),
          discount: 0,
          ...(notes.trim() ? { notes: notes.trim() } : {}),
          items: cart.map((i) => ({
            productId: i.productId,
            productName: i.productName ?? "",
            modifierIds: [],
            modifierNames: [],
            quantity: i.qty,
            unitPrice: i.unitPrice,
            subtotal: i.qty * i.unitPrice,
          })),
        }
      );

      setLastReceipt({
        transactionId: result.transactionId,
        total: result.total,
        change: result.change,
        items: [...cart],
        customer: selectedCustomer,
        paymentMethod,
        amountPaid: paymentMethod === "cash" ? paid : subtotal,
        timestamp: new Date().toLocaleString("id-ID"),
        debtId: result.debtId ?? null,
        remainingDebt: result.remainingDebt ?? 0,
      });
      clearCart();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Transaksi gagal");
    } finally {
      setSubmitting(false);
    }
  }

  // ── Transfer submit ─────────────────────────────────────────────────────────

  const transferItems = products
    .map((p) => {
      const qty = parseInt(transferQty[p.id] ?? "0", 10);
      if (!qty || qty <= 0) return null;
      const unitPrice = p.prices?.[transferTier] ?? p.prices?.retail ?? 0;
      const catalogId = (p as unknown as { productCatalogId?: string }).productCatalogId ?? null;
      return {
        productId: p.id,
        productCatalogId: catalogId,
        productName: p.name,
        quantity: qty,
        unitPrice,
        subtotal: qty * unitPrice,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  const transferTotal = transferItems.reduce((s, i) => s + i.subtotal, 0);

  async function handleTransfer() {
    if (!ownerId || !clubId || transferItems.length === 0) return;
    if (transferDestType === "club" && !transferDestClubId) {
      alert("Pilih club tujuan");
      return;
    }
    if (transferDestType === "owner" && !transferDestOwnerId.trim()) {
      alert("Masukkan ID owner tujuan");
      return;
    }
    setTransferring(true);
    setTransferResult(null);
    try {
      const result = await callFunction<{ transferId: string; total: number; status: string }>(
        "productTransfer_create",
        {
          ownerId,
          sourceClubId: clubId,
          requestId: uuidv4(),
          operationId: uuidv4(),
          destinationType: transferDestType,
          ...(transferDestType === "club"
            ? { destinationClubId: transferDestClubId }
            : { destinationOwnerId: transferDestOwnerId.trim() }),
          paymentType: transferPaymentType,
          priceTier: transferTier,
          items: transferItems,
          notes: transferNotes.trim() || undefined,
        }
      );
      setTransferResult({
        transferId: result.transferId,
        total: result.total,
        status: result.status,
        items: transferItems,
        destType: transferDestType,
        destId: transferDestType === "club" ? transferDestClubId : transferDestOwnerId.trim(),
        paymentType: transferPaymentType,
        tier: transferTier,
        timestamp: new Date().toLocaleString("id-ID"),
      });
      setTransferQty({});
      setTransferNotes("");
      loadData();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Transfer gagal");
    } finally {
      setTransferring(false);
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-4 h-full">

      {/* ── Tab switcher ── */}
      <div className="flex items-center gap-1 border-b border-slate-200 pb-0">
        {([
          { key: "pos",           label: "POS" },
          { key: "pos_membership", label: "POS Membership" },
          { key: "transfer",      label: "Transfer Produk" },
        ] as { key: ActiveTab; label: string }[]).map(({ key, label }) => (
          <button
            key={key}
            onClick={() => switchTab(key)}
            className={`px-5 py-2.5 text-sm font-semibold rounded-t-lg border-b-2 transition ${
              activeTab === key
                ? "border-blue-600 text-blue-700 bg-blue-50"
                : "border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-50"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── Transfer Produk ── */}
      {activeTab === "transfer" && (
        <div className="flex-1 flex gap-6 min-h-0">

          {/* Left: product list with qty inputs */}
          <div className="flex-1 min-w-0 flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h2 className="text-2xl font-bold text-slate-900">Transfer Produk</h2>
              {loadingData && <span className="text-xs text-slate-400">Memuat…</span>}
            </div>

            {/* Tier selector */}
            <div className="flex items-center gap-3">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">Harga Tier</span>
              <div className="flex gap-1.5">
                {(Object.keys(TIER_LABELS) as CustomerTier[]).map((tier) => (
                  <button
                    key={tier}
                    onClick={() => setTransferTier(tier)}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium border transition ${
                      transferTier === tier
                        ? "bg-slate-800 text-white border-slate-800"
                        : "border-slate-200 text-slate-500 hover:border-slate-400"
                    }`}
                  >
                    {TIER_LABELS[tier]}
                  </button>
                ))}
              </div>
            </div>

            {/* Product rows */}
            {products.length === 0 ? (
              <div className="flex-1 flex items-center justify-center text-slate-400 text-sm">
                Belum ada produk di inventaris.
              </div>
            ) : (
              <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-slate-500 text-xs">
                    <tr>
                      <th className="px-4 py-2 text-left">Produk</th>
                      <th className="px-4 py-2 text-right">Stok</th>
                      <th className="px-4 py-2 text-right">Harga ({TIER_LABELS[transferTier]})</th>
                      <th className="px-4 py-2 text-right w-32">Jumlah Kirim</th>
                      <th className="px-4 py-2 text-right">Subtotal</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {products.map((p) => {
                      const unitPrice = p.prices?.[transferTier] ?? p.prices?.retail ?? 0;
                      const qty = parseInt(transferQty[p.id] ?? "0", 10) || 0;
                      const currentStock = p.currentStock ?? 0;
                      return (
                        <tr key={p.id} className={`hover:bg-slate-50 ${qty > 0 ? "bg-orange-50/40" : ""}`}>
                          <td className="px-4 py-2">
                            <p className="font-medium text-slate-800">{p.name}</p>
                            <p className="text-xs text-slate-400">{p.category}</p>
                          </td>
                          <td className={`px-4 py-2 text-right text-sm font-semibold ${qty > currentStock ? "text-red-500" : "text-slate-600"}`}>
                            {currentStock}
                          </td>
                          <td className="px-4 py-2 text-right font-mono text-slate-600 text-xs">{fmtIdr(unitPrice)}</td>
                          <td className="px-4 py-2 text-right">
                            <input
                              type="number"
                              min="0"
                              className="w-20 border border-slate-200 rounded-lg px-2 py-1 text-sm text-right focus:border-orange-400 focus:outline-none"
                              placeholder="0"
                              value={transferQty[p.id] ?? ""}
                              onChange={(e) =>
                                setTransferQty((prev) => ({ ...prev, [p.id]: e.target.value }))
                              }
                            />
                          </td>
                          <td className="px-4 py-2 text-right font-semibold text-slate-700 text-xs">
                            {qty > 0 ? fmtIdr(qty * unitPrice) : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Right: destination + payment + summary */}
          <div className="w-80 shrink-0 flex flex-col gap-3">

            {/* Transfer receipt */}
            {transferResult && (
              <div className="bg-white border border-green-300 rounded-xl overflow-hidden shadow-sm">
                <div className={`px-4 py-3 ${transferResult.status === "completed" ? "bg-green-600" : "bg-amber-500"}`}>
                  <p className="text-sm font-bold text-white">
                    {transferResult.status === "completed" ? "Transfer Selesai" : "Menunggu Konfirmasi Penerima"}
                  </p>
                  <p className="text-xs text-white/80 mt-0.5">{transferResult.timestamp}</p>
                </div>
                <div className="p-4 space-y-3 text-sm">
                  <div className="space-y-1 text-xs text-slate-500">
                    <div className="flex justify-between">
                      <span>Tujuan</span>
                      <span className="font-medium text-slate-700">
                        {transferResult.destType === "club" ? `Club: ${transferResult.destId}` : `Owner: ${transferResult.destId}`}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span>Jenis</span>
                      <span className={`font-semibold ${transferResult.paymentType === "pinjam" ? "text-amber-600" : "text-blue-600"}`}>
                        {transferResult.paymentType === "bayar" ? "Bayar" : "Pinjam"}
                        {transferResult.paymentType === "pinjam" && transferResult.destType === "owner" && " — Gratis"}
                      </span>
                    </div>
                  </div>
                  <div className="border-t border-slate-100 pt-2 space-y-1">
                    {transferResult.items.map((item) => (
                      <div key={item.productId} className="flex justify-between text-xs text-slate-600">
                        <span className="truncate mr-2">{item.quantity}× {item.productName}</span>
                        <span className="shrink-0">{fmtIdr(item.subtotal)}</span>
                      </div>
                    ))}
                  </div>
                  <div className="border-t border-slate-100 pt-2 flex justify-between font-bold">
                    <span className="text-slate-700">Total</span>
                    <span className={transferResult.paymentType === "pinjam" && transferResult.destType === "owner" ? "text-amber-600" : "text-slate-900"}>
                      {transferResult.paymentType === "pinjam" && transferResult.destType === "owner"
                        ? "Rp 0 (Gratis)"
                        : fmtIdr(transferResult.total)}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 font-mono">Ref: {transferResult.transferId.slice(0, 8).toUpperCase()}</p>
                  <div className="flex gap-2 pt-1">
                    <button
                      onClick={() => {
                        const isFree = transferResult.paymentType === "pinjam" && transferResult.destType === "owner";
                        const lines = [
                          "*TRANSFER PRODUK - NC Manager*",
                          `Tanggal: ${transferResult.timestamp}`,
                          transferResult.destType === "club"
                            ? `Ke Club: ${transferResult.destId}`
                            : `Ke Owner: ${transferResult.destId}`,
                          `Jenis: ${transferResult.paymentType === "bayar" ? "Bayar" : `Pinjam${isFree ? " (Gratis)" : ""}`}`,
                          `Harga Tier: ${TIER_LABELS[transferResult.tier]}`,
                          "───────────────────────",
                          ...transferResult.items.map((i) => `- ${i.productName} ×${i.quantity}${isFree ? "" : ` = ${fmtIdr(i.subtotal)}`}`),
                          "───────────────────────",
                          `Total: ${isFree ? "Rp 0 (Gratis)" : fmtIdr(transferResult.total)}`,
                          `Ref: ${transferResult.transferId.slice(0, 8).toUpperCase()}`,
                          transferResult.status === "pending_acceptance"
                            ? "Status: Menunggu konfirmasi penerima"
                            : "Status: Selesai",
                        ];
                        window.open(`https://wa.me/?text=${encodeURIComponent(lines.join("\n"))}`, "_blank");
                      }}
                      className="flex-1 bg-green-500 hover:bg-green-600 text-white rounded-lg py-2 text-xs font-semibold transition"
                    >
                      Kirim ke WhatsApp
                    </button>
                    <button
                      onClick={() => setTransferResult(null)}
                      className="px-3 text-xs text-slate-400 hover:text-slate-600"
                    >
                      Tutup
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Destination type */}
            <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Tujuan</p>
              <div className="flex gap-2">
                {(["club", "owner"] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => { setTransferDestType(t); setTransferDestClubId(""); setTransferDestOwnerId(""); }}
                    className={`flex-1 py-2 rounded-lg text-sm font-medium border transition ${
                      transferDestType === t
                        ? "border-orange-500 bg-orange-50 text-orange-700"
                        : "border-slate-200 text-slate-500 hover:border-slate-300"
                    }`}
                  >
                    {t === "club" ? "Ke Club" : "Ke Owner Lain"}
                  </button>
                ))}
              </div>

              {transferDestType === "club" ? (
                clubs.length === 0 ? (
                  <p className="text-xs text-slate-400">Tidak ada club lain.</p>
                ) : (
                  <select
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white"
                    value={transferDestClubId}
                    onChange={(e) => setTransferDestClubId(e.target.value)}
                  >
                    <option value="">— Pilih Club —</option>
                    {clubs.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                )
              ) : (
                <input
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
                  placeholder="ID Owner tujuan"
                  value={transferDestOwnerId}
                  onChange={(e) => setTransferDestOwnerId(e.target.value)}
                />
              )}
            </div>

            {/* Payment type */}
            <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Pembayaran</p>
              <div className="flex gap-2">
                {(["bayar", "pinjam"] as const).map((pt) => (
                  <button
                    key={pt}
                    onClick={() => setTransferPaymentType(pt)}
                    className={`flex-1 py-2 rounded-lg text-sm font-medium border transition ${
                      transferPaymentType === pt
                        ? "border-blue-500 bg-blue-50 text-blue-700"
                        : "border-slate-200 text-slate-500 hover:border-slate-300"
                    }`}
                  >
                    {pt === "bayar" ? "Bayar" : "Pinjam"}
                  </button>
                ))}
              </div>
              {transferPaymentType === "pinjam" && (
                <p className="text-xs text-amber-600 bg-amber-50 rounded-lg px-3 py-2">
                  {transferDestType === "owner"
                    ? "Pinjam ke owner lain — tidak ada biaya sama sekali."
                    : "Stok dikirim sekarang, pembayaran dicatat sebagai piutang."}
                </p>
              )}
            </div>

            {/* Summary */}
            <div className="bg-white rounded-xl border border-slate-200 p-4 flex-1 flex flex-col gap-2">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Ringkasan</p>
              {transferItems.length === 0 ? (
                <p className="text-sm text-slate-400 flex-1 flex items-center justify-center text-center">
                  Isi jumlah produk<br />yang akan dikirim
                </p>
              ) : (
                <div className="space-y-1 flex-1 overflow-y-auto">
                  {transferItems.map((item) => (
                    <div key={item.productId} className="flex justify-between text-xs text-slate-600">
                      <span className="truncate mr-2">{item.quantity}× {item.productName}</span>
                      <span className="shrink-0 font-medium">{fmtIdr(item.subtotal)}</span>
                    </div>
                  ))}
                </div>
              )}
              {transferItems.length > 0 && (
                <div className="border-t border-slate-100 pt-2 flex justify-between">
                  <span className="text-sm text-slate-500">Total</span>
                  <span className="text-base font-bold text-slate-900">{fmtIdr(transferTotal)}</span>
                </div>
              )}
            </div>

            {/* Notes */}
            <input
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm"
              placeholder="Catatan (opsional)"
              value={transferNotes}
              onChange={(e) => setTransferNotes(e.target.value)}
            />

            {/* Submit */}
            <button
              onClick={handleTransfer}
              disabled={transferring || transferItems.length === 0}
              className="w-full bg-orange-600 text-white rounded-xl py-4 text-base font-bold hover:bg-orange-700 disabled:opacity-40 transition"
            >
              {transferring
                ? "Memproses…"
                : transferItems.length === 0
                ? "Pilih produk dulu"
                : `Kirim Transfer — ${fmtIdr(transferTotal)}`}
            </button>
          </div>
        </div>
      )}

      {/* ── Kasir tab ── */}
      {/* ── POS Membership tab ── */}
      {activeTab === "pos_membership" && (
        <div className="flex gap-6 flex-1 min-h-0">

          {/* Left: customer + plan selection */}
          <div className="flex-1 min-w-0 flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h2 className="text-2xl font-bold text-slate-900">POS Membership</h2>
              {loadingData && <span className="text-xs text-slate-400">Memuat…</span>}
            </div>

            {/* Customer search */}
            <div className="bg-white rounded-xl border border-slate-200 p-4 relative">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Pelanggan</p>
              {memSelectedCustomer ? (
                <div className="flex items-center justify-between bg-blue-50 rounded-lg px-3 py-2.5">
                  <div>
                    <p className="text-sm font-semibold text-blue-800">{memSelectedCustomer.displayName}</p>
                    <p className="text-xs text-blue-600">{TIER_LABELS[memSelectedCustomer.tier]}{memSelectedCustomer.phone ? ` · ${memSelectedCustomer.phone}` : ""}</p>
                  </div>
                  <button
                    onClick={() => { setMemSelectedCustomer(null); setMemCustomerSearch(""); }}
                    className="text-blue-300 hover:text-blue-500 text-xl leading-none"
                  >×</button>
                </div>
              ) : (
                <>
                  <input
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
                    placeholder="Cari nama pelanggan"
                    value={memCustomerSearch}
                    onChange={(e) => { setMemCustomerSearch(e.target.value); setMemShowCustomerDropdown(true); }}
                    onFocus={() => setMemShowCustomerDropdown(true)}
                    onBlur={() => setTimeout(() => setMemShowCustomerDropdown(false), 150)}
                  />
                  {memShowCustomerDropdown && memFilteredCustomers.length > 0 && (
                    <div className="absolute left-4 right-4 top-full z-10 bg-white border border-slate-200 rounded-lg shadow-lg overflow-hidden mt-1">
                      {memFilteredCustomers.slice(0, 10).map((c) => (
                        <button
                          key={c.id}
                          className="w-full text-left px-3 py-2 hover:bg-slate-50 border-b border-slate-100 last:border-0"
                          onClick={() => { setMemSelectedCustomer(c); setMemCustomerSearch(c.displayName); setMemShowCustomerDropdown(false); }}
                        >
                          <p className="text-sm text-slate-800 font-medium">{c.displayName}</p>
                          <p className="text-xs text-slate-400">{TIER_LABELS[c.tier]}{c.phone ? ` · ${c.phone}` : ""}</p>
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Plan selection */}
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-100">
                <p className="font-semibold text-slate-800 text-sm">Pilih Paket Membership</p>
              </div>
              {plans.length === 0 ? (
                <p className="text-sm text-slate-400 p-4">Belum ada paket membership aktif.</p>
              ) : (
                <div className="p-3 grid grid-cols-2 gap-2">
                  {plans.map((p) => {
                    const isLocker = p.planType === "locker";
                    const isSelected = memSelectedPlanId === p.id;
                    return (
                      <button
                        key={p.id}
                        onClick={() => setMemSelectedPlanId(isSelected ? "" : p.id)}
                        className={`text-left rounded-xl border-2 p-3 transition ${
                          isSelected
                            ? isLocker ? "border-purple-400 bg-purple-50" : "border-blue-500 bg-blue-50"
                            : "border-slate-200 hover:border-slate-300"
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                            isLocker ? "bg-purple-100 text-purple-700" :
                            p.tier === "gold" ? "bg-yellow-100 text-yellow-800" :
                            p.tier === "platinum" ? "bg-blue-100 text-blue-800" :
                            p.tier === "silver" ? "bg-slate-200 text-slate-700" :
                            "bg-slate-100 text-slate-600"
                          }`}>
                            {isLocker ? "LOKER" : p.tier.toUpperCase()}
                          </span>
                          {isSelected && <span className={`text-xs font-bold ${isLocker ? "text-purple-600" : "text-blue-600"}`}>✓</span>}
                        </div>
                        <p className="text-sm font-semibold text-slate-800 leading-tight">{p.name}</p>
                        <p className="text-xs text-slate-500 mt-0.5">
                          {isLocker
                            ? `${p.visitQuota > 0 ? `${p.visitQuota}× · ` : "Harian · "}${fmtIdr(p.blendingFeePerSession ?? 0)}/sesi`
                            : `${fmtIdr(p.price)} · ${p.visitQuota}× · ${p.hasExpiry && p.durationDays ? `${p.durationDays}h` : "∞"}`}
                        </p>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Right: payment + confirm */}
          <div className="w-80 shrink-0 flex flex-col gap-3">

            {/* Feedback */}
            {memFeedback && (
              <div className={`rounded-xl px-4 py-3 text-sm font-medium ${memFeedback.type === "ok" ? "bg-green-50 border border-green-200 text-green-700" : "bg-red-50 border border-red-200 text-red-600"}`}>
                {memFeedback.msg}
              </div>
            )}

            {/* Plan summary */}
            <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Ringkasan</p>
              {memSelectedPlan ? (
                <div className="space-y-1.5 text-sm">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Paket</span>
                    <span className="font-semibold text-slate-800">{memSelectedPlan.name}</span>
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
                          {memSelectedPlan.hasExpiry && memSelectedPlan.durationDays ? `${memSelectedPlan.durationDays} hari` : "Tidak ada expired"}
                        </span>
                      </div>
                      <div className="flex justify-between border-t border-slate-100 pt-2">
                        <span className="text-slate-700 font-semibold">Harga</span>
                        <span className="text-base font-bold text-slate-900">{fmtIdr(memSelectedPlan.price)}</span>
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
                <p className="text-sm text-slate-400 text-center py-2">Pilih paket terlebih dahulu</p>
              )}
            </div>

            {/* Payment (only for non-locker with a price) */}
            {memSelectedPlan && memSelectedPlan.planType !== "locker" && memSelectedPlan.price > 0 && (
              <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Pembayaran</p>
                <div className="flex gap-2">
                  {(["cash", "transfer"] as PaymentMethod[]).map((m) => (
                    <button
                      key={m}
                      onClick={() => setMemPaymentMethod(m)}
                      className={`flex-1 py-2 rounded-lg text-sm font-medium border transition ${
                        memPaymentMethod === m
                          ? "border-blue-500 bg-blue-50 text-blue-700"
                          : "border-slate-200 text-slate-500 hover:border-slate-300"
                      }`}
                    >
                      {m === "cash" ? "Tunai" : "Transfer"}
                    </button>
                  ))}
                </div>
                {memPaymentMethod === "cash" && (
                  <div>
                    <input
                      type="number"
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
                      placeholder={`Jumlah bayar (kosongkan = lunas ${fmtIdr(memPlanPrice)})`}
                      value={memAmountPaid}
                      onChange={(e) => setMemAmountPaid(e.target.value)}
                    />
                    {memAmountPaid !== "" && memPaid >= 0 && (
                      memRemainingDebt > 0 ? (
                        <div className="mt-2 flex justify-between text-sm px-3 py-2 rounded-lg bg-amber-50 text-amber-700">
                          <span>Utang akan tercatat</span>
                          <span className="font-bold">{fmtIdr(memRemainingDebt)}</span>
                        </div>
                      ) : memChange >= 0 ? (
                        <div className="mt-2 flex justify-between text-sm px-3 py-2 rounded-lg bg-green-50 text-green-700">
                          <span>Kembalian</span>
                          <span className="font-bold">{fmtIdr(memChange)}</span>
                        </div>
                      ) : null
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Notes */}
            <input
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm"
              placeholder="Catatan (opsional)"
              value={memNotes}
              onChange={(e) => setMemNotes(e.target.value)}
            />

            {/* Submit */}
            <button
              onClick={handleMemActivate}
              disabled={
                memActivating ||
                !memSelectedCustomer ||
                !memSelectedPlanId
              }
              className="w-full bg-blue-600 text-white rounded-xl py-4 text-base font-bold hover:bg-blue-700 disabled:opacity-40 transition"
            >
              {memActivating
                ? "Mengaktifkan…"
                : !memSelectedCustomer
                ? "Pilih pelanggan dulu"
                : !memSelectedPlanId
                ? "Pilih paket dulu"
                : `Aktifkan — ${memSelectedPlan?.planType !== "locker" ? fmtIdr(memPlanPrice) : memSelectedPlan?.name}`}
            </button>
          </div>
        </div>
      )}

      {/* ── POS tab ── */}
      {activeTab === "pos" && (
      <div className="flex gap-6 flex-1 min-h-0">

      {/* ── Left: product catalog ── */}
      <div className="flex-1 min-w-0 flex flex-col gap-4">

        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold text-slate-900">Kasir Owner</h2>
          {loadingData && <span className="text-xs text-slate-400">Memuat…</span>}
        </div>

        {/* Step 1: Customer selection */}
        <div className="bg-white rounded-xl border-2 border-slate-200 p-3 relative">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">1. Pilih Pelanggan</p>
          {selectedCustomer ? (
            <div className="flex items-center justify-between bg-blue-50 rounded-lg px-3 py-2.5">
              <div>
                <p className="text-sm font-semibold text-blue-800">{selectedCustomer.displayName}</p>
                <p className="text-xs text-blue-600 font-semibold">
                  {TIER_LABELS[selectedCustomer.tier]}
                  {selectedCustomer.phone ? ` · ${selectedCustomer.phone}` : ""}
                </p>
              </div>
              <button
                onClick={() => { setSelectedCustomer(null); setCustomerSearch(""); }}
                className="text-blue-300 hover:text-blue-500 text-xl leading-none"
              >×</button>
            </div>
          ) : (
            <>
              <input
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
                placeholder="Cari nama / HP pelanggan (opsional)"
                value={customerSearch}
                onChange={(e) => { setCustomerSearch(e.target.value); setShowCustomerDropdown(true); }}
                onFocus={() => setShowCustomerDropdown(true)}
                onBlur={() => setTimeout(() => setShowCustomerDropdown(false), 150)}
              />
              {showCustomerDropdown && filteredCustomers.length > 0 && (
                <div className="absolute left-4 right-4 top-full z-10 bg-white border border-slate-200 rounded-lg shadow-lg overflow-hidden mt-1">
                  {filteredCustomers.slice(0, 10).map((c) => (
                    <button
                      key={c.id}
                      className="w-full text-left px-3 py-2 hover:bg-slate-50 border-b border-slate-100 last:border-0"
                      onClick={() => { setSelectedCustomer(c); setCustomerSearch(c.displayName); setShowCustomerDropdown(false); }}
                    >
                      <p className="text-sm text-slate-800 font-medium">{c.displayName}</p>
                      <p className="text-xs text-slate-400">{TIER_LABELS[c.tier]}{c.phone ? ` · ${c.phone}` : ""}</p>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {/* Step 2: Search + category filter */}
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide -mb-2">2. Pilih Produk</p>
        <div className="flex gap-3">
          <input
            className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm"
            placeholder="Cari produk…"
            value={productSearch}
            onChange={(e) => setProductSearch(e.target.value)}
          />
          <div className="flex gap-1.5 flex-wrap">
            {CATEGORIES.map((c) => (
              <button
                key={c}
                onClick={() => setCategoryFilter(c)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium border transition ${
                  categoryFilter === c
                    ? "bg-slate-800 text-white border-slate-800"
                    : "border-slate-200 text-slate-500 hover:border-slate-400"
                }`}
              >
                {c}
              </button>
            ))}
          </div>
        </div>

        {/* Product grid */}
        {filteredProducts.length === 0 ? (
          <div className="flex-1 flex items-center justify-center text-slate-400 text-sm">
            {products.length === 0
              ? "Belum ada item. Tambahkan di halaman Inventaris."
              : "Tidak ada produk yang cocok."}
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-3 content-start">
            {filteredProducts.map((p) => {
              const inCart = cart.find((i) => i.productId === p.id);
              const stock = p.currentStock ?? 0;
              const outOfStock = stock === 0;
              return (
                <button
                  key={p.id}
                  onClick={() => !outOfStock && addProduct(p)}
                  disabled={outOfStock}
                  className={`relative text-left rounded-xl border-2 p-4 transition ${
                    outOfStock
                      ? "border-slate-200 bg-slate-50 opacity-50 cursor-not-allowed"
                      : inCart
                      ? "border-blue-500 bg-blue-50 hover:shadow-md"
                      : "border-slate-200 bg-white hover:border-slate-300 hover:shadow-md"
                  }`}
                >
                  {inCart && !outOfStock && (
                    <span className="absolute top-2 right-2 w-5 h-5 bg-blue-600 text-white text-xs rounded-full flex items-center justify-center font-bold">
                      {inCart.qty}
                    </span>
                  )}
                  <p className="text-xs text-slate-400 mb-1">{p.category}</p>
                  <p className="text-sm font-semibold text-slate-800 leading-tight mb-2">{p.name}</p>
                  <p className="text-base font-bold text-blue-700">{fmtIdr(tierPrice(p))}</p>
                  <div className="flex items-center justify-between mt-1">
                    {activeTier !== "retail" && (
                      <p className="text-xs text-slate-400">{TIER_LABELS[activeTier]}</p>
                    )}
                    <p className={`text-xs font-semibold ml-auto ${outOfStock ? "text-red-500" : stock <= 5 ? "text-amber-500" : "text-slate-400"}`}>
                      {outOfStock ? "Habis" : `Stok: ${stock}`}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Right: cart + checkout ── */}
      <div className="w-80 shrink-0 flex flex-col gap-3">

        {/* Receipt after successful transaction */}
        {lastReceipt && (
          <div className="bg-green-50 border border-green-200 rounded-xl p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-semibold text-green-800">Transaksi Berhasil ✓</p>
              <button
                onClick={() => setLastReceipt(null)}
                className="text-green-400 hover:text-green-600 text-lg leading-none"
              >
                ×
              </button>
            </div>
            <p className="text-xs text-green-600 font-mono mb-2">#{lastReceipt.transactionId.slice(0, 8)}</p>
            <div className="space-y-0.5 mb-2">
              {lastReceipt.items.map((i) => (
                <p key={i.productId} className="text-xs text-green-700">
                  {i.qty}× {i.productName} — {fmtIdr(i.qty * i.unitPrice)}
                </p>
              ))}
            </div>
            <div className="border-t border-green-200 pt-2 space-y-0.5">
              <p className="text-sm font-bold text-green-800">Total: {fmtIdr(lastReceipt.total)}</p>
              {lastReceipt.remainingDebt > 0 ? (
                <p className="text-xs font-semibold text-amber-600">Utang tercatat: {fmtIdr(lastReceipt.remainingDebt)}</p>
              ) : lastReceipt.paymentMethod === "cash" && (
                <p className="text-xs text-green-600">Kembalian: {fmtIdr(lastReceipt.change)}</p>
              )}
              {lastReceipt.customer && (
                <p className="text-xs text-green-600">Pelanggan: {lastReceipt.customer.displayName}</p>
              )}
              <p className="text-xs text-green-500">{lastReceipt.timestamp}</p>
            </div>
          </div>
        )}

        {/* Cart */}
        <div className="bg-white rounded-xl border border-slate-200 flex-1 flex flex-col overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
            <div>
              <p className="font-semibold text-slate-800">Keranjang ({cart.length})</p>
              {selectedCustomer && (
                <p className="text-xs text-blue-600 font-medium">{selectedCustomer.displayName} · {TIER_LABELS[selectedCustomer.tier]}</p>
              )}
            </div>
            {cart.length > 0 && (
              <button onClick={clearCart} className="text-xs text-red-400 hover:text-red-600">
                Kosongkan
              </button>
            )}
          </div>

          {cart.length === 0 ? (
            <div className="flex-1 flex items-center justify-center text-slate-400 text-sm p-8 text-center">
              Tap produk untuk ditambahkan
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {cart.map((item) => (
                <div key={item.productId} className="flex items-center gap-2 p-2 bg-slate-50 rounded-lg">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-slate-700 truncate">{item.productName}</p>
                    <input
                      type="number"
                      className="mt-0.5 w-full border-0 bg-transparent text-xs text-slate-500 p-0 focus:outline-none"
                      value={item.unitPrice}
                      onChange={(e) => setPrice(item.productId, e.target.value)}
                      title="Edit harga"
                    />
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => setQty(item.productId, item.qty - 1)}
                      className="w-6 h-6 rounded-full bg-slate-200 text-slate-600 text-sm font-bold flex items-center justify-center hover:bg-slate-300"
                    >
                      −
                    </button>
                    <span className="w-5 text-center text-sm font-bold text-slate-800">{item.qty}</span>
                    <button
                      onClick={() => setQty(item.productId, item.qty + 1)}
                      disabled={item.qty >= (products.find((p) => p.id === item.productId)?.currentStock ?? 0)}
                      className="w-6 h-6 rounded-full bg-slate-200 text-slate-600 text-sm font-bold flex items-center justify-center hover:bg-slate-300 disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      +
                    </button>
                  </div>
                  <p className="text-xs font-bold text-slate-800 w-16 text-right shrink-0">
                    {fmtIdr(item.qty * item.unitPrice)}
                  </p>
                </div>
              ))}
            </div>
          )}

          {/* Subtotal */}
          {cart.length > 0 && (
            <div className="px-4 py-2.5 border-t border-slate-100 flex justify-between items-center">
              <span className="text-sm text-slate-500">Subtotal</span>
              <span className="text-base font-bold text-slate-900">{fmtIdr(subtotal)}</span>
            </div>
          )}
        </div>

        {/* Payment */}
        <div className="bg-white rounded-xl border border-slate-200 p-3 space-y-3">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
            Pembayaran
          </p>

          {/* Method toggle */}
          <div className="flex gap-2">
            {(["cash", "transfer"] as PaymentMethod[]).map((m) => (
              <button
                key={m}
                onClick={() => setPaymentMethod(m)}
                className={`flex-1 py-2 rounded-lg text-sm font-medium border transition ${
                  paymentMethod === m
                    ? "border-blue-500 bg-blue-50 text-blue-700"
                    : "border-slate-200 text-slate-500 hover:border-slate-300"
                }`}
              >
                {m === "cash" ? "Tunai" : "Transfer"}
              </button>
            ))}
          </div>

          {/* Amount paid (cash only) */}
          {paymentMethod === "cash" && (
            <div>
              <input
                type="number"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
                placeholder="Jumlah bayar"
                value={amountPaid}
                onChange={(e) => setAmountPaid(e.target.value)}
              />
              {amountPaid !== "" && paid > 0 && (
                posRemainingDebt > 0 ? (
                  selectedCustomer ? (
                    <div className="mt-2 flex justify-between text-sm px-3 py-2 rounded-lg bg-amber-50 text-amber-700">
                      <span>Utang akan tercatat</span>
                      <span className="font-bold">{fmtIdr(posRemainingDebt)}</span>
                    </div>
                  ) : (
                    <div className="mt-2 text-sm px-3 py-2 rounded-lg bg-red-50 text-red-600">
                      Pilih pelanggan untuk mencatat utang
                    </div>
                  )
                ) : change >= 0 ? (
                  <div className="mt-2 flex justify-between text-sm px-3 py-2 rounded-lg bg-green-50 text-green-700">
                    <span>Kembalian</span>
                    <span className="font-bold">{fmtIdr(change)}</span>
                  </div>
                ) : null
              )}
            </div>
          )}

          {/* Notes */}
          <input
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
            placeholder="Catatan (opsional)"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>

        {/* Submit button */}
        <button
          onClick={handleSubmit}
          disabled={
            submitting ||
            cart.length === 0 ||
            (paymentMethod === "cash" && paid === 0) ||
            (paymentMethod === "cash" && posRemainingDebt > 0 && !selectedCustomer)
          }
          className="w-full bg-blue-600 text-white rounded-xl py-4 text-base font-bold hover:bg-blue-700 disabled:opacity-40 transition"
        >
          {submitting
            ? "Memproses…"
            : cart.length === 0
            ? "Pilih produk dulu"
            : posRemainingDebt > 0 && !selectedCustomer
            ? "Pilih pelanggan untuk catat utang"
            : posRemainingDebt > 0
            ? `Bayar ${fmtIdr(paid)} · Utang ${fmtIdr(posRemainingDebt)}`
            : `Bayar ${fmtIdr(subtotal)}`}
        </button>
      </div>
      </div>
      )}
    </div>
  );
}
