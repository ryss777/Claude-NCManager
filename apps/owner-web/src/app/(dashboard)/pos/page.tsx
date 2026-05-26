"use client";

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { useSearchParams } from "next/navigation";
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

interface ActiveLockerMember {
  membershipId: string;
  customerId: string;
  customerName: string;
  customerPhone: string | null;
  planName: string;
  blendingCredits: number;
  blendingFeePerSession: number;
  expiresAt: string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmtIdr = (n: number) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);

// Escape user-controlled strings before interpolating into the printable
// receipt HTML below — product names and customer names come from Firestore
// records that operators type in by hand.
const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

const CATEGORIES = ["Semua", "Inner Nutrition", "Outer Nutrition", "Accessories"];
const CAT_SHORT: Record<string, string> = {
  "Inner Nutrition": "Inner", "Outer Nutrition": "Outer", "Accessories": "Akses",
};

type ActiveTab = "pos" | "pos_membership" | "pos_locker";

// ── Component ─────────────────────────────────────────────────────────────────

export default function OwnerPosPage() {
  const { ownerId, clubId } = useOwnerAuthStore();
  const searchParams = useSearchParams();
  const prefillApplied = useRef(false);

  const [activeTab, setActiveTab] = useState<ActiveTab>(() => {
    if (typeof window === "undefined") return "pos";
    return (sessionStorage.getItem("pos_activeTab") as ActiveTab) ?? "pos";
  });
  function switchTab(tab: ActiveTab) {
    sessionStorage.setItem("pos_activeTab", tab);
    setActiveTab(tab);
  }

  // ── Data ───────────────────────────────────────────────────────────────────
  const [products, setProducts]       = useState<Product[]>([]);
  const [customers, setCustomers]     = useState<Customer[]>([]);
  const [plans, setPlans]             = useState<Plan[]>([]);
  // customerId → { planName, planType } for active memberships
  const [activeMems, setActiveMems]   = useState<Map<string, { planName: string; planType?: string }>>(new Map());
  // active locker members for locker check-in tab
  const [lockerMembers, setLockerMembers] = useState<ActiveLockerMember[]>([]);
  const [loadingData, setLoadingData] = useState(true);

  const loadData = useCallback(async () => {
    if (!ownerId || !clubId) return;
    setLoadingData(true);
    try {
      const db = firebaseDb();
      const base = `owners/${ownerId}/clubs/${clubId}`;
      const [prodSnap, custSnap, planSnap, memSnap] = await Promise.all([
        getDocs(query(collection(db, `owners/${ownerId}/inventoryItems`), where("isActive", "==", true))),
        getDocs(collection(db, `${base}/customers`)),
        getDocs(query(collection(db, `${base}/membershipPlans`), where("isActive", "==", true))),
        getDocs(query(collection(db, `${base}/memberships`), where("status", "==", "active"))),
      ]);
      const custList = custSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Customer));
      setProducts(prodSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Product)));
      setCustomers(custList);
      setPlans(planSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Plan)));

      const custById = new Map(custList.map((c) => [c.id, c]));
      const memMap = new Map<string, { planName: string; planType?: string }>();
      const lockerList: ActiveLockerMember[] = [];
      memSnap.docs.forEach((d) => {
        const data = d.data();
        const cId = data["customerId"] as string;
        const pType = data["planType"] as string | undefined;
        memMap.set(cId, {
          planName: data["planName"] as string,
          ...(pType !== undefined ? { planType: pType } : {}),
        });
        if (pType === "locker") {
          const cust = custById.get(cId);
          lockerList.push({
            membershipId: d.id,
            customerId: cId,
            customerName: cust?.displayName ?? cId,
            customerPhone: cust?.phone ?? null,
            planName: data["planName"] as string,
            blendingCredits: (data["blendingCredits"] as number) ?? 0,
            blendingFeePerSession: (data["blendingFeePerSession"] as number) ?? 0,
            expiresAt: (data["expiresAt"] as string | null) ?? null,
          });
        }
      });
      setActiveMems(memMap);
      setLockerMembers(lockerList.sort((a, b) => a.customerName.localeCompare(b.customerName, "id")));
    } finally {
      setLoadingData(false);
    }
  }, [ownerId, clubId]);

  useEffect(() => { loadData(); }, [loadData]);

  // ── Query-param prefill (e.g. from customer detail → activate membership) ──
  useEffect(() => {
    const prefillId  = searchParams.get("customerId");
    const prefillTab = searchParams.get("tab");
    if (prefillApplied.current || !prefillId || prefillTab !== "membership" || customers.length === 0) return;
    prefillApplied.current = true;
    const found = customers.find((c) => c.id === prefillId);
    if (found) {
      setMemSelectedCustomer(found);
      setMemCustomerSearch(found.displayName);
      switchTab("pos_membership");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customers]);

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
  const amountPaidRef = useRef<HTMLInputElement>(null);

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
  const memAmountRef = useRef<HTMLInputElement>(null);

  // Locker-specific: number of sessions to purchase upfront
  const [memLockerSessions, setMemLockerSessions] = useState("10");

  // ── Quick-create customer ──────────────────────────────────────────────────
  const [createCustOpen, setCreateCustOpen]   = useState<"pos" | "membership" | null>(null);
  const [createCustName, setCreateCustName]   = useState("");
  const [createCustPhone, setCreateCustPhone] = useState("");
  const [createCustTier, setCreateCustTier]   = useState<CustomerTier>("retail");
  const [createCustSaving, setCreateCustSaving] = useState(false);
  const [createCustError, setCreateCustError]   = useState("");

  // ── Locker check-in state ──────────────────────────────────────────────────
  const [lockSearch, setLockSearch]               = useState("");
  const [lockShowDropdown, setLockShowDropdown]   = useState(false);
  const [lockSelectedMember, setLockSelectedMember] = useState<ActiveLockerMember | null>(null);
  const [lockGuestCount, setLockGuestCount]       = useState(1);
  const [lockPaymentType, setLockPaymentType]     = useState<"credits" | "cash">("credits");
  const [lockChecking, setLockChecking]           = useState(false);
  const [lockFeedback, setLockFeedback]           = useState<{ type: "ok" | "err"; msg: string } | undefined>();

  // Auto-focus membership amount input once both customer + plan are selected
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (memSelectedCustomer && memSelectedPlanId) {
      setTimeout(() => memAmountRef.current?.focus(), 80);
    }
  }, [memSelectedPlanId]);

  // Auto-focus POS amount input when cart becomes non-empty or method switches to cash
  useEffect(() => {
    if (cart.length > 0 && paymentMethod === "cash") {
      setTimeout(() => amountPaidRef.current?.focus(), 80);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cart.length, paymentMethod]);

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
  const isLockerPlan     = memSelectedPlan?.planType === "locker";
  // For locker: price = sessions × fee; for regular: plan price
  const memLockerSessionsNum = Math.max(1, parseInt(memLockerSessions, 10) || 1);
  const memPlanPrice = isLockerPlan
    ? memLockerSessionsNum * (memSelectedPlan?.blendingFeePerSession ?? 0)
    : (memSelectedPlan?.price ?? 0);
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
          // Locker: pass session count so the CF calculates the total and records a transaction
          ...(isLockerPlan && memLockerSessionsNum > 0 ? { lockerSessions: memLockerSessionsNum } : {}),
        }
      );
      const debtMsg = (result.remainingDebt ?? 0) > 0 ? ` · Utang: ${fmtIdr(result.remainingDebt!)}` : "";
      const sessMsg = isLockerPlan ? ` · ${memLockerSessionsNum} sesi` : "";
      setMemFeedback({ type: "ok", msg: `✓ ${memSelectedPlan?.name} aktif untuk ${memSelectedCustomer.displayName}${sessMsg}${debtMsg}` });
      setMemSelectedCustomer(null); setMemCustomerSearch(""); setMemSelectedPlanId("");
      setMemAmountPaid(""); setMemNotes(""); setMemLockerSessions("10");
    } catch (err) {
      setMemFeedback({ type: "err", msg: err instanceof Error ? err.message : "Gagal mengaktifkan" });
    } finally {
      setMemActivating(false);
    }
  }

  // ── Locker check-in handler ────────────────────────────────────────────────
  const lockFilteredMembers = lockSearch.trim()
    ? lockerMembers.filter((m) =>
        m.customerName.toLowerCase().includes(lockSearch.toLowerCase()) ||
        (m.customerPhone ?? "").includes(lockSearch))
    : lockerMembers;

  async function handleLockCheckIn() {
    if (!lockSelectedMember || !ownerId || !clubId) return;
    if (lockPaymentType === "credits" && lockSelectedMember.blendingCredits < lockGuestCount) {
      setLockFeedback({ type: "err", msg: `Kredit tidak cukup (tersisa: ${lockSelectedMember.blendingCredits})` });
      return;
    }
    setLockChecking(true); setLockFeedback(undefined);
    try {
      await callFunction("locker_recordVisit", {
        ownerId, clubId,
        requestId: uuidv4(), operationId: uuidv4(),
        membershipId: lockSelectedMember.membershipId,
        customerId: lockSelectedMember.customerId,
        guestCount: lockGuestCount,
        paymentType: lockPaymentType,
      });
      const credMsg = lockPaymentType === "credits"
        ? ` · Sisa kredit: ${lockSelectedMember.blendingCredits - lockGuestCount}`
        : ` · Dibayar tunai (${fmtIdr(lockGuestCount * lockSelectedMember.blendingFeePerSession)})`;
      setLockFeedback({
        type: "ok",
        msg: `✓ ${lockSelectedMember.customerName} check-in ${lockGuestCount} tamu${credMsg}`,
      });
      setLockSelectedMember(null); setLockSearch(""); setLockGuestCount(1);
      loadData(); // refresh locker member list
    } catch (err) {
      setLockFeedback({ type: "err", msg: err instanceof Error ? err.message : "Check-in gagal" });
    } finally { setLockChecking(false); }
  }

  // ── Quick-create customer handler ──────────────────────────────────────────
  function openCreateCust(ctx: "pos" | "membership") {
    setCreateCustName(ctx === "pos" ? customerSearch : memCustomerSearch);
    setCreateCustPhone(""); setCreateCustTier("retail"); setCreateCustError("");
    setCreateCustOpen(ctx);
  }

  async function handleCreateCust() {
    if (!createCustName.trim() || !ownerId || !clubId) return;
    setCreateCustSaving(true); setCreateCustError("");
    try {
      const result = await callFunction<{ customerId: string }>("customer_create", {
        ownerId, clubId,
        displayName: createCustName.trim(),
        phone: createCustPhone.trim() || null,
        tier: createCustTier,
      });
      // Build the new customer object and add to list
      const newCust: Customer = {
        id: result.customerId,
        displayName: createCustName.trim(),
        phone: createCustPhone.trim() || null,
        email: null,
        tier: createCustTier,
      };
      setCustomers((prev) => [...prev, newCust]);
      if (createCustOpen === "pos") {
        selectCustomer(newCust);
      } else {
        setMemSelectedCustomer(newCust);
        setMemCustomerSearch(newCust.displayName);
      }
      setCreateCustOpen(null);
    } catch (err) {
      setCreateCustError(err instanceof Error ? err.message : "Gagal membuat pelanggan");
    } finally { setCreateCustSaving(false); }
  }

  // Quick-pay amounts for cash
  const quickAmounts = [50000, 100000, 150000, 200000];

  // ── Print receipt ──────────────────────────────────────────────────────────
  function printReceipt(r: NonNullable<typeof receipt>) {
    const lines = r.items.map((i) =>
      `<tr><td style="padding:2px 8px 2px 0;word-break:break-word">${i.qty}× ${escapeHtml(i.productName)}</td>` +
      `<td style="text-align:right;white-space:nowrap">${fmtIdr(i.qty * i.unitPrice)}</td></tr>`
    ).join("");
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
      body{font-family:monospace;font-size:13px;width:280px;margin:0 auto;padding:10px}
      h3{text-align:center;margin:4px 0}
      .sub{text-align:center;font-size:11px;color:#555;margin:2px 0}
      hr{border:none;border-top:1px dashed #999;margin:8px 0}
      table{width:100%;border-collapse:collapse}
      .total td{font-weight:bold;font-size:15px;padding-top:4px}
      .debt td{color:#d97706}
      .change td{color:#16a34a}
      @media print{body{width:100%}}
    </style></head><body>
      <h3>NC Manager</h3>
      <p class="sub">${r.timestamp}</p>
      <p class="sub">#${r.transactionId.slice(0, 12).toUpperCase()}</p>
      ${r.customer ? `<p class="sub">Pelanggan: ${escapeHtml(r.customer.displayName)}</p>` : ""}
      <hr>
      <table>${lines}</table>
      <hr>
      <table>
        <tr class="total"><td>TOTAL</td><td style="text-align:right">${fmtIdr(r.total)}</td></tr>
        ${r.remainingDebt > 0 ? `<tr class="debt"><td>Utang</td><td style="text-align:right">${fmtIdr(r.remainingDebt)}</td></tr>` : ""}
        ${r.paymentMethod === "cash" && r.remainingDebt === 0 ? `<tr class="change"><td>Kembalian</td><td style="text-align:right">${fmtIdr(r.change)}</td></tr>` : ""}
      </table>
      <hr>
      <p class="sub" style="text-align:center">Terima kasih sudah berbelanja!</p>
      <script>window.onload=function(){window.print();}</script>
    </body></html>`;
    const w = window.open("", "_blank", "width=360,height=600,toolbar=no,menubar=no");
    if (w) { w.document.write(html); w.document.close(); }
  }

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
            <div className="px-6 pb-5 pt-3 flex gap-2">
              <button
                onClick={() => printReceipt(receipt)}
                className="flex-1 border border-slate-200 text-slate-600 rounded-xl py-3 text-sm font-bold hover:bg-slate-50 transition"
              >
                🖨️ Cetak
              </button>
              <button
                onClick={() => setReceipt(null)}
                className="flex-1 bg-green-600 text-white rounded-xl py-3 text-sm font-bold hover:bg-green-700 transition"
              >
                Tutup &amp; Baru
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
              {memSelectedPlan.planType === "locker" ? (
                <>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Jumlah Sesi</span>
                    <span className="font-semibold">{memLockerSessionsNum} sesi</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Harga / Sesi</span>
                    <span className="font-medium">{fmtIdr(memSelectedPlan.blendingFeePerSession ?? 0)}</span>
                  </div>
                  <div className="flex justify-between border-t border-slate-200 pt-2">
                    <span className="font-medium text-slate-600">Total</span>
                    <span className="font-bold">{fmtIdr(memPlanPrice)}</span>
                  </div>
                </>
              ) : (
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

      {/* ── Quick-create customer dialog ── */}
      {createCustOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
              <h3 className="font-bold text-slate-900">➕ Buat Pelanggan Baru</h3>
              <button onClick={() => setCreateCustOpen(null)} className="text-slate-400 hover:text-slate-700 text-xl leading-none">×</button>
            </div>
            <div className="px-6 py-5 space-y-4 text-sm">
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">Nama Lengkap *</label>
                <input autoFocus type="text" className="input" placeholder="Nama pelanggan"
                  value={createCustName} onChange={(e) => setCreateCustName(e.target.value)} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">No. HP (opsional)</label>
                <input type="tel" className="input" placeholder="08xx"
                  value={createCustPhone} onChange={(e) => setCreateCustPhone(e.target.value)} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">Tier</label>
                <div className="flex gap-1.5 flex-wrap">
                  {(Object.keys(TIER_LABELS) as CustomerTier[]).map((t) => (
                    <button key={t} onClick={() => setCreateCustTier(t)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition ${
                        createCustTier === t ? TIER_PILL[t] : "border-slate-200 text-slate-500 hover:border-slate-400"
                      }`}>
                      {TIER_LABELS[t]}
                    </button>
                  ))}
                </div>
              </div>
              {createCustError && <div className="text-red-600 text-xs bg-red-50 rounded-lg px-3 py-2">{createCustError}</div>}
            </div>
            <div className="px-6 pb-5 flex gap-3">
              <button onClick={() => setCreateCustOpen(null)} className="flex-1 btn-secondary">Batal</button>
              <button onClick={handleCreateCust} disabled={createCustSaving || !createCustName.trim()} className="flex-1 btn-primary">
                {createCustSaving ? "Menyimpan…" : "Buat & Pilih"}
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
          { key: "pos_locker",     label: "🔑 Loker" },
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
                    {showCustomerDropdown && (filteredCustomers.length > 0 || customerSearch.trim().length >= 2) && (
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
                        {customerSearch.trim().length >= 2 && (
                          <button
                            type="button"
                            className="w-full text-left px-3 py-2.5 hover:bg-blue-50 text-blue-600 font-semibold text-sm flex items-center gap-2"
                            onMouseDown={(e) => { e.preventDefault(); openCreateCust("pos"); setShowCustomerDropdown(false); }}
                          >
                            ➕ Buat pelanggan &ldquo;{customerSearch.trim()}&rdquo;
                          </button>
                        )}
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
                      {/* Stepper row */}
                      <div className="flex items-stretch gap-2">
                        <button
                          onClick={() => setAmountPaid(String(Math.max(0, (parseFloat(amountPaid) || 0) - 50000)))}
                          className="w-11 shrink-0 rounded-xl bg-rose-50 border border-rose-200 text-rose-600 text-2xl font-bold hover:bg-rose-100 active:scale-95 transition flex items-center justify-center"
                        >
                          −
                        </button>
                        <input
                          ref={amountPaidRef}
                          type="number"
                          className="flex-1 min-w-0 border-2 border-blue-300 rounded-xl px-3 py-3 text-2xl font-bold text-blue-700 text-center bg-blue-50 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-blue-400 placeholder:text-blue-200"
                          placeholder="0"
                          value={amountPaid}
                          onChange={(e) => setAmountPaid(e.target.value)}
                        />
                        <button
                          onClick={() => setAmountPaid(String((parseFloat(amountPaid) || 0) + 50000))}
                          className="w-11 shrink-0 rounded-xl bg-blue-50 border border-blue-200 text-blue-600 text-2xl font-bold hover:bg-blue-100 active:scale-95 transition flex items-center justify-center"
                        >
                          +
                        </button>
                      </div>
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
                  {memShowCustomerDropdown && (memFilteredCustomers.length > 0 || memCustomerSearch.trim().length >= 2) && (
                    <div className="absolute left-4 right-4 top-full z-10 bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden mt-1 max-h-72 overflow-y-auto">
                      {memFilteredCustomers.slice(0, 10).map((c) => {
                        const mem = activeMems.get(c.id);
                        return (
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
                            <div className="flex items-center justify-between gap-2">
                              <p className="text-sm font-semibold text-slate-800 truncate">{c.displayName}</p>
                              {mem ? (
                                <span className={`shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none ${
                                  mem.planType === "locker"
                                    ? "bg-purple-100 text-purple-700"
                                    : "bg-green-100 text-green-700"
                                }`}>
                                  {mem.planType === "locker" ? "🔑" : "✓"} {mem.planName}
                                </span>
                              ) : (
                                <span className="shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-400 leading-none">
                                  Tidak aktif
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-slate-400 mt-0.5">
                              {TIER_LABELS[c.tier]}{c.phone ? ` · ${c.phone}` : ""}
                            </p>
                          </button>
                        );
                      })}
                      {memCustomerSearch.trim().length >= 2 && (
                        <button
                          type="button"
                          className="w-full text-left px-3 py-2.5 hover:bg-blue-50 text-blue-600 font-semibold text-sm flex items-center gap-2"
                          onMouseDown={(e) => { e.preventDefault(); openCreateCust("membership"); setMemShowCustomerDropdown(false); }}
                        >
                          ➕ Buat pelanggan &ldquo;{memCustomerSearch.trim()}&rdquo;
                        </button>
                      )}
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
                    <>
                      <div className="flex justify-between">
                        <span className="text-slate-500">Harga / Sesi</span>
                        <span className="font-medium">{fmtIdr(memSelectedPlan.blendingFeePerSession ?? 0)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500">Sesi dibeli</span>
                        <span className="font-semibold text-purple-700">{memLockerSessionsNum}×</span>
                      </div>
                      <div className="flex justify-between border-t border-slate-100 pt-2">
                        <span className="font-semibold text-slate-700">Total</span>
                        <span className="text-lg font-bold text-purple-700">{fmtIdr(memPlanPrice)}</span>
                      </div>
                    </>
                  )}
                </div>
              ) : (
                <div className="py-8 text-center text-slate-300">
                  <p className="text-4xl mb-2">🎫</p>
                  <p className="text-sm font-medium">Pilih paket membership</p>
                </div>
              )}

              {/* ── Locker: sessions input ── */}
              {memSelectedPlan && memSelectedPlan.planType === "locker" && (
                <div className="border-t border-slate-100 pt-4 space-y-3">
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Pembelian Sesi Loker</p>

                  {/* Sessions stepper */}
                  <div>
                    <p className="text-xs text-slate-500 mb-1.5">
                      Harga: <strong>{fmtIdr(memSelectedPlan.blendingFeePerSession ?? 0)}</strong> / sesi
                    </p>
                    <div className="flex items-stretch gap-2">
                      <button
                        onClick={() => setMemLockerSessions(String(Math.max(1, memLockerSessionsNum - 1)))}
                        className="w-10 shrink-0 rounded-xl bg-rose-50 border border-rose-200 text-rose-600 text-xl font-bold hover:bg-rose-100 transition flex items-center justify-center"
                      >−</button>
                      <input
                        type="number"
                        min={1}
                        className="flex-1 min-w-0 border-2 border-purple-300 rounded-xl px-3 py-2.5 text-xl font-bold text-purple-700 text-center bg-purple-50 focus:outline-none focus:ring-2 focus:ring-purple-400 placeholder:text-purple-200"
                        value={memLockerSessions}
                        onChange={(e) => setMemLockerSessions(e.target.value)}
                      />
                      <button
                        onClick={() => setMemLockerSessions(String(memLockerSessionsNum + 1))}
                        className="w-10 shrink-0 rounded-xl bg-purple-50 border border-purple-200 text-purple-600 text-xl font-bold hover:bg-purple-100 transition flex items-center justify-center"
                      >+</button>
                    </div>
                    <div className="flex justify-between text-sm font-bold mt-2 px-1">
                      <span className="text-slate-500">Total</span>
                      <span className="text-purple-700">{fmtIdr(memPlanPrice)}</span>
                    </div>
                  </div>

                  {/* Quick-session chips */}
                  <div className="flex gap-1.5">
                    {[5, 10, 20, 30].map((n) => (
                      <button
                        key={n}
                        onClick={() => setMemLockerSessions(String(n))}
                        className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition border ${
                          memLockerSessionsNum === n
                            ? "bg-purple-600 text-white border-purple-600"
                            : "bg-slate-100 text-slate-600 border-slate-200 hover:bg-slate-200"
                        }`}
                      >
                        {n}×
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Payment */}
              {memSelectedPlan && (memSelectedPlan.planType !== "locker" ? memSelectedPlan.price > 0 : memPlanPrice > 0) && (
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
                    <div className="space-y-2">
                      {/* Stepper row */}
                      <div className="flex items-stretch gap-2">
                        <button
                          onClick={() => setMemAmountPaid(String(Math.max(0, (parseFloat(memAmountPaid) || 0) - 50000)))}
                          className="w-11 shrink-0 rounded-xl bg-rose-50 border border-rose-200 text-rose-600 text-2xl font-bold hover:bg-rose-100 active:scale-95 transition flex items-center justify-center"
                        >
                          −
                        </button>
                        <input
                          ref={memAmountRef}
                          type="number"
                          className="flex-1 min-w-0 border-2 border-blue-300 rounded-xl px-3 py-3 text-2xl font-bold text-blue-700 text-center bg-blue-50 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-blue-400 placeholder:text-blue-200"
                          placeholder="0"
                          value={memAmountPaid}
                          onChange={(e) => setMemAmountPaid(e.target.value)}
                        />
                        <button
                          onClick={() => setMemAmountPaid(String((parseFloat(memAmountPaid) || 0) + 50000))}
                          className="w-11 shrink-0 rounded-xl bg-blue-50 border border-blue-200 text-blue-600 text-2xl font-bold hover:bg-blue-100 active:scale-95 transition flex items-center justify-center"
                        >
                          +
                        </button>
                      </div>
                      {/* Quick-amount chips */}
                      <div className="flex gap-1.5">
                        <button
                          onClick={() => setMemAmountPaid(String(memPlanPrice))}
                          className="flex-1 py-1.5 bg-green-50 hover:bg-green-100 text-green-700 text-xs font-bold rounded-lg border border-green-200 transition"
                        >
                          Pas
                        </button>
                        {[50000, 100000, 150000, 200000].map((v) => (
                          <button
                            key={v}
                            onClick={() => setMemAmountPaid(String(v))}
                            className="flex-1 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-lg transition"
                          >
                            {v >= 1_000_000 ? `${v / 1_000_000}jt` : `${v / 1000}rb`}
                          </button>
                        ))}
                      </div>
                      {/* Change / debt feedback */}
                      {memAmountPaid !== "" && memPaid >= 0 && (
                        memRemainingDebt > 0 ? (
                          <div className="flex justify-between text-sm px-3 py-2 rounded-xl bg-amber-50 border border-amber-200 text-amber-700">
                            <span>Utang akan tercatat</span>
                            <span className="font-bold">{fmtIdr(memRemainingDebt)}</span>
                          </div>
                        ) : memChange >= 0 ? (
                          <div className="flex justify-between text-sm px-3 py-2 rounded-xl bg-green-50 border border-green-200 text-green-700">
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
                : isLockerPlan
                ? `✓ Aktifkan — ${memLockerSessionsNum} sesi · ${fmtIdr(memPlanPrice)}`
                : `✓ Aktifkan — ${fmtIdr(memPlanPrice)}`}
            </button>
          </div>
        </div>
      )}

      {/* ── Locker check-in tab ── */}
      {activeTab === "pos_locker" && (
        <div className="flex gap-4 flex-1 min-h-0">

          {/* Left: member list */}
          <div className="flex-1 min-w-0 flex flex-col gap-3">
            <div className="bg-white rounded-2xl border border-slate-200 p-4 shrink-0">
              <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">🔑 Pilih Member Loker</p>
              {lockSelectedMember ? (
                <div className="flex items-center justify-between bg-purple-50 rounded-xl px-3 py-2.5">
                  <div>
                    <p className="text-sm font-bold text-purple-900">{lockSelectedMember.customerName}</p>
                    <p className="text-xs text-purple-500">
                      {lockSelectedMember.planName} · {lockSelectedMember.blendingCredits} kredit tersisa
                      {lockSelectedMember.expiresAt ? ` · exp ${new Date(lockSelectedMember.expiresAt).toLocaleDateString("id-ID", { day: "numeric", month: "short" })}` : ""}
                    </p>
                  </div>
                  <button onClick={() => { setLockSelectedMember(null); setLockSearch(""); }} className="text-purple-300 hover:text-purple-500 text-xl leading-none">×</button>
                </div>
              ) : (
                <div className="relative">
                  <input
                    className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm bg-slate-50 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:bg-white"
                    placeholder="Cari nama / HP member loker…"
                    value={lockSearch}
                    onChange={(e) => { setLockSearch(e.target.value); setLockShowDropdown(true); }}
                    onFocus={() => setLockShowDropdown(true)}
                    onBlur={() => setTimeout(() => setLockShowDropdown(false), 150)}
                  />
                  {lockShowDropdown && lockFilteredMembers.length > 0 && (
                    <div className="absolute left-0 right-0 top-full z-10 bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden mt-1 max-h-64 overflow-y-auto">
                      {lockFilteredMembers.map((m) => {
                        const lowCredit = m.blendingCredits <= 3;
                        return (
                          <button
                            key={m.membershipId}
                            type="button"
                            className="w-full text-left px-3 py-2.5 hover:bg-slate-50 border-b border-slate-100 last:border-0"
                            onMouseDown={(e) => { e.preventDefault(); setLockSelectedMember(m); setLockSearch(m.customerName); setLockShowDropdown(false); }}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <p className="text-sm font-semibold text-slate-800 truncate">{m.customerName}</p>
                              <span className={`shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none ${
                                lowCredit ? "bg-red-100 text-red-600" : "bg-purple-100 text-purple-700"
                              }`}>
                                {m.blendingCredits} kredit
                              </span>
                            </div>
                            <p className="text-xs text-slate-400 mt-0.5">{m.planName}{m.customerPhone ? ` · ${m.customerPhone}` : ""}</p>
                          </button>
                        );
                      })}
                    </div>
                  )}
                  {lockFilteredMembers.length === 0 && lockerMembers.length === 0 && (
                    <p className="mt-2 text-xs text-slate-400">Belum ada member dengan paket loker aktif.</p>
                  )}
                </div>
              )}
            </div>

            {/* Member cards grid */}
            {!lockSelectedMember && lockerMembers.length > 0 && (
              <div className="flex-1 overflow-y-auto">
                <div className="grid grid-cols-2 xl:grid-cols-3 gap-3 pb-4">
                  {lockerMembers.map((m) => {
                    const lowCredit = m.blendingCredits <= 3;
                    return (
                      <button
                        key={m.membershipId}
                        onClick={() => { setLockSelectedMember(m); setLockSearch(m.customerName); setLockFeedback(undefined); }}
                        className="text-left bg-white border-2 border-slate-200 hover:border-purple-300 rounded-2xl p-4 transition"
                      >
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <p className="text-sm font-bold text-slate-800 leading-snug">{m.customerName}</p>
                          <span className={`shrink-0 text-xs font-bold px-2 py-0.5 rounded-full ${
                            lowCredit ? "bg-red-100 text-red-600" : "bg-purple-100 text-purple-700"
                          }`}>
                            {m.blendingCredits}×
                          </span>
                        </div>
                        <p className="text-xs text-slate-400">{m.planName}</p>
                        {m.expiresAt && (
                          <p className="text-xs text-slate-300 mt-0.5">exp {new Date(m.expiresAt).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "2-digit" })}</p>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Right: check-in form */}
          <div className="w-80 shrink-0 flex flex-col gap-3">
            <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-4">
              <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Catat Kunjungan</p>

              {lockSelectedMember ? (
                <>
                  {/* Credit bar */}
                  <div className="bg-purple-50 rounded-xl px-4 py-3">
                    <p className="text-xs text-purple-400 mb-1">Kredit tersisa</p>
                    <p className="text-2xl font-bold text-purple-700">{lockSelectedMember.blendingCredits}<span className="text-sm font-normal text-purple-400 ml-1">sesi</span></p>
                    <p className="text-xs text-purple-400 mt-0.5">{fmtIdr(lockSelectedMember.blendingFeePerSession)} / sesi</p>
                  </div>

                  {/* Guest count */}
                  <div>
                    <p className="text-xs font-semibold text-slate-500 mb-2">Jumlah Tamu</p>
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => setLockGuestCount(Math.max(1, lockGuestCount - 1))}
                        className="w-10 h-10 rounded-full border-2 border-slate-200 text-slate-600 text-xl font-bold hover:border-purple-300 hover:text-purple-600 transition flex items-center justify-center"
                      >−</button>
                      <span className="flex-1 text-center text-3xl font-bold text-slate-900">{lockGuestCount}</span>
                      <button
                        onClick={() => setLockGuestCount(Math.min(20, lockGuestCount + 1))}
                        className="w-10 h-10 rounded-full border-2 border-purple-300 bg-purple-50 text-purple-600 text-xl font-bold hover:bg-purple-100 transition flex items-center justify-center"
                      >+</button>
                    </div>
                    {lockPaymentType === "credits" && lockSelectedMember.blendingCredits < lockGuestCount && (
                      <p className="text-xs text-red-500 mt-2 text-center">⚠ Kredit tidak cukup</p>
                    )}
                  </div>

                  {/* Payment type */}
                  <div>
                    <p className="text-xs font-semibold text-slate-500 mb-2">Tipe Pembayaran</p>
                    <div className="flex gap-2">
                      {(["credits", "cash"] as const).map((t) => (
                        <button
                          key={t}
                          onClick={() => setLockPaymentType(t)}
                          className={`flex-1 py-2 rounded-xl text-sm font-semibold border transition ${
                            lockPaymentType === t
                              ? t === "credits" ? "border-purple-600 bg-purple-600 text-white" : "border-slate-800 bg-slate-900 text-white"
                              : "border-slate-200 text-slate-500 hover:border-slate-400"
                          }`}
                        >
                          {t === "credits" ? "🎫 Kredit" : "💵 Cash"}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Summary */}
                  <div className="bg-slate-50 rounded-xl px-4 py-3 space-y-1.5 text-sm">
                    <div className="flex justify-between text-slate-600">
                      <span>Tamu</span>
                      <span className="font-semibold">{lockGuestCount} orang</span>
                    </div>
                    {lockPaymentType === "credits" ? (
                      <div className="flex justify-between text-purple-700">
                        <span>Kredit terpakai</span>
                        <span className="font-bold">{lockGuestCount} kredit</span>
                      </div>
                    ) : (
                      <div className="flex justify-between text-green-700">
                        <span>Dibayar tunai</span>
                        <span className="font-bold">{fmtIdr(lockGuestCount * lockSelectedMember.blendingFeePerSession)}</span>
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <div className="py-12 text-center text-slate-300">
                  <p className="text-4xl mb-2">🔑</p>
                  <p className="text-sm font-medium">Pilih member loker</p>
                </div>
              )}
            </div>

            {lockFeedback && (
              <div className={`rounded-xl px-4 py-3 text-sm font-medium ${
                lockFeedback.type === "ok" ? "bg-green-50 border border-green-200 text-green-700" : "bg-red-50 border border-red-200 text-red-600"
              }`}>
                {lockFeedback.msg}
              </div>
            )}

            <button
              onClick={handleLockCheckIn}
              disabled={
                lockChecking || !lockSelectedMember ||
                (lockPaymentType === "credits" && (lockSelectedMember?.blendingCredits ?? 0) < lockGuestCount)
              }
              className="w-full bg-purple-600 text-white rounded-xl py-3.5 text-base font-bold hover:bg-purple-700 disabled:opacity-40 transition"
            >
              {lockChecking
                ? "⏳ Memproses…"
                : !lockSelectedMember
                ? "Pilih member dulu"
                : `✓ Check-in ${lockGuestCount} tamu — ${lockPaymentType === "credits" ? `${lockGuestCount} kredit` : fmtIdr(lockGuestCount * (lockSelectedMember.blendingFeePerSession))}`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
