"use client";

import { useEffect, useState, useMemo } from "react";
import { doc, getDoc, getDocs, collection, query, where, limit, updateDoc } from "firebase/firestore";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useOwnerAuthStore } from "@/store/auth.store";
import { callFunction, firebaseDb } from "@/firebase/firebase";
import { v4 as uuidv4 } from "uuid";

// ── Types ────────────────────────────────────────────────────────────────────

type CustomerTier = "retail" | "ds" | "sc" | "sbQp" | "spv";
const TIER_LABELS: Record<CustomerTier, string> = { retail: "Retail", ds: "DS", sc: "SC", sbQp: "SB-QP", spv: "SPV" };
const TIER_BADGE: Record<CustomerTier, string> = {
  retail: "bg-slate-100 text-slate-600",
  ds:     "bg-green-100 text-green-700",
  sc:     "bg-blue-100 text-blue-700",
  sbQp:   "bg-yellow-100 text-yellow-800",
  spv:    "bg-purple-100 text-purple-800",
};

interface Customer {
  id: string;
  displayName: string;
  phone: string | null;
  email: string | null;
  notes: string | null;
  tier: CustomerTier;
  activeMembershipId: string | null;
  createdAt: string;
  updatedAt: string;
}

interface Membership {
  id: string;
  planName: string;
  planId: string;
  planType?: "regular" | "locker";
  tier: string;
  status: "active" | "expired" | "cancelled" | "pending_next";
  visitQuota: number | null;
  visitUsed: number;
  visitRemaining: number | null;
  blendingCredits?: number | null;
  blendingFeePerSession?: number | null;
  hasExpiry?: boolean;
  durationDays?: number | null;
  activatedAt: string | null;
  expiresAt: string | null;
}

interface Transaction {
  id: string;
  total: number;
  paymentMethod: string;
  status: string;
  createdAt: string;
  items: { productName: string; quantity: number; subtotal: number }[];
}

interface Visit {
  id: string;
  membershipId: string;
  visitType?: string;
  createdAt: string;
  // regular
  visitsBefore?: number;
  visitsAfter?: number;
  // locker
  guestCount?: number;
  paymentType?: "credits" | "cash";
  creditsBefore?: number;
  creditsAfter?: number;
  totalCharge?: number;
}

interface Debt {
  id: string;
  source: string;
  referenceLabel: string;
  totalAmount: number;
  paidAmount: number;
  remainingAmount: number;
  status: "outstanding" | "partial" | "paid";
  payments: { amount: number; paymentMethod: string; notes: string | null; paidAt: string }[];
  createdAt: string;
  updatedAt: string;
}

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

type Tab = "membership" | "transactions" | "visits" | "debts";

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmt = (n: number) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);

const TIER_STYLE: Record<string, { bg: string; text: string }> = {
  basic:    { bg: "bg-slate-100",    text: "text-slate-600" },
  silver:   { bg: "bg-slate-200",    text: "text-slate-700" },
  gold:     { bg: "bg-yellow-100",   text: "text-yellow-800" },
  platinum: { bg: "bg-blue-100",     text: "text-blue-800" },
  locker:   { bg: "bg-purple-100",   text: "text-purple-800" },
};

const STATUS_STYLE: Record<string, string> = {
  active:       "bg-green-50 text-green-700",
  expired:      "bg-red-50 text-red-500",
  cancelled:    "bg-slate-100 text-slate-500",
  pending_next: "bg-blue-50 text-blue-600",
  completed:    "bg-green-50 text-green-700",
  pending:      "bg-yellow-50 text-yellow-700",
  reversed:     "bg-red-50 text-red-600",
};

const STATUS_LABEL: Record<string, string> = {
  active: "Aktif", expired: "Kadaluarsa", cancelled: "Dibatalkan",
  pending_next: "Antrian", completed: "Selesai", pending: "Proses", reversed: "Dibatalkan",
};

function daysLeft(iso: string | null) {
  if (!iso) return null;
  return Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000));
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function CustomerDetailPage() {
  const { customerId } = useParams<{ customerId: string }>();
  const { ownerId, clubId } = useOwnerAuthStore();

  const [customer, setCustomer]         = useState<Customer | null>(null);
  const [memberships, setMemberships]   = useState<Membership[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [visits, setVisits]             = useState<Visit[]>([]);
  const [plans, setPlans]               = useState<Plan[]>([]);
  const [debts, setDebts]               = useState<Debt[]>([]);
  const [loading, setLoading]           = useState(true);
  const [tab, setTab]                   = useState<Tab>("membership");

  // Debt payment dialog
  const [debtPayDialog, setDebtPayDialog] = useState<{
    debtId: string; remaining: number; label: string;
  } | null>(null);
  const [debtPayAmount, setDebtPayAmount] = useState("");
  const [debtPayMethod, setDebtPayMethod] = useState<"cash" | "transfer">("cash");
  const [debtPayNotes, setDebtPayNotes]   = useState("");
  const [debtPaying, setDebtPaying]       = useState(false);
  const [debtPayError, setDebtPayError]   = useState("");

  const pendingNext = useMemo(
    () => memberships.find((m) => m.status === "pending_next") ?? null,
    [memberships]
  );

  // Activate / upgrade form
  const [selectedPlanId, setSelectedPlanId] = useState("");
  const [activating, setActivating]         = useState(false);
  const [activateFeedback, setActivateFeedback] = useState<{ type: "ok" | "err"; msg: string } | undefined>();

  // Confirmation dialog for plan switch
  const [switchConfirm, setSwitchConfirm] = useState<{
    newPlan: Plan;
    blocked: boolean;   // true = masih ada sisa kunjungan, hanya tampil info
    remaining: number;
  } | null>(null);

  // Edit profile
  const [editOpen, setEditOpen]     = useState(false);
  const [editName, setEditName]     = useState("");
  const [editPhone, setEditPhone]   = useState("");
  const [editEmail, setEditEmail]   = useState("");
  const [editNotes, setEditNotes]   = useState("");
  const [editSaving, setEditSaving] = useState(false);
  const [editFeedback, setEditFeedback] = useState<{ type: "ok" | "err"; msg: string } | undefined>();

  // Change tier
  const [changeTier, setChangeTier] = useState<CustomerTier>("retail");
  const [tierSaving, setTierSaving] = useState(false);
  const [tierFeedback, setTierFeedback] = useState<{ type: "ok" | "err"; msg: string } | undefined>();

  const activeMembership = useMemo(
    () => memberships.find((m) => m.status === "active") ?? null,
    [memberships]
  );

  useEffect(() => {
    if (ownerId && clubId && customerId) loadAll();
  }, [ownerId, clubId, customerId]);

  async function loadAll() {
    setLoading(true);
    try {
      const db = firebaseDb();
      const base = `owners/${ownerId}/clubs/${clubId}`;

      const [custSnap, memSnap, txSnap, visitSnap, planSnap] = await Promise.all([
        getDoc(doc(db, `${base}/customers/${customerId}`)),
        getDocs(query(collection(db, `${base}/memberships`), where("customerId", "==", customerId), limit(20))),
        getDocs(query(collection(db, `${base}/transactions`), where("customerId", "==", customerId), limit(50))),
        getDocs(query(collection(db, `${base}/membershipVisits`), where("customerId", "==", customerId), limit(50))),
        getDocs(query(collection(db, `${base}/membershipPlans`), where("isActive", "==", true))),
      ]);

      if (!custSnap.exists()) return;
      const cust = { id: custSnap.id, ...(custSnap.data() as Omit<Customer, "id">) };
      setCustomer(cust);
      setEditName(cust.displayName);
      setEditPhone(cust.phone ?? "");
      setEditEmail(cust.email ?? "");
      setEditNotes(cust.notes ?? "");
      setChangeTier((cust.tier as CustomerTier) ?? "retail");

      setMemberships(
        memSnap.docs
          .map((d) => ({ id: d.id, ...(d.data() as Omit<Membership, "id">) }))
          .sort((a, b) => (b.activatedAt ?? "").localeCompare(a.activatedAt ?? ""))
      );
      setTransactions(
        txSnap.docs
          .map((d) => ({ id: d.id, ...(d.data() as Omit<Transaction, "id">) }))
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      );
      setVisits(
        visitSnap.docs
          .map((d) => ({ id: d.id, ...(d.data() as Omit<Visit, "id">) }))
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      );
      setPlans(planSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Plan, "id">) })));

      // Debts loaded separately — a missing rules entry won't block the page
      try {
        const debtSnap = await getDocs(
          query(collection(db, `${base}/debts`), where("customerId", "==", customerId))
        );
        setDebts(
          debtSnap.docs
            .map((d) => ({ id: d.id, ...(d.data() as Omit<Debt, "id">) }))
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        );
      } catch {
        setDebts([]);
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveEdit() {
    if (!customer || !editName.trim()) return;
    setEditSaving(true);
    setEditFeedback(undefined);
    try {
      await updateDoc(
        doc(firebaseDb(), `owners/${ownerId}/clubs/${clubId}/customers/${customerId}`),
        {
          displayName: editName.trim(),
          phone: editPhone.trim() || null,
          email: editEmail.trim() || null,
          notes: editNotes.trim() || null,
          updatedAt: new Date().toISOString(),
        }
      );
      setEditFeedback({ type: "ok", msg: "Profil berhasil disimpan" });
      setEditOpen(false);
      loadAll();
    } catch (err) {
      setEditFeedback({ type: "err", msg: err instanceof Error ? err.message : "Gagal menyimpan" });
    } finally { setEditSaving(false); }
  }

  async function handleChangeTier() {
    if (!customer || changeTier === customer.tier) return;
    setTierSaving(true);
    setTierFeedback(undefined);
    try {
      await updateDoc(
        doc(firebaseDb(), `owners/${ownerId}/clubs/${clubId}/customers/${customerId}`),
        { tier: changeTier, updatedAt: new Date().toISOString() }
      );
      setTierFeedback({ type: "ok", msg: `Tier diubah ke ${TIER_LABELS[changeTier]}` });
      loadAll();
    } catch (err) {
      setTierFeedback({ type: "err", msg: err instanceof Error ? err.message : "Gagal" });
    } finally { setTierSaving(false); }
  }

  async function handleDebtPay() {
    if (!debtPayDialog) return;
    const amount = parseFloat(debtPayAmount);
    if (isNaN(amount) || amount <= 0 || amount > debtPayDialog.remaining) return;
    setDebtPaying(true);
    setDebtPayError("");
    try {
      await callFunction("debt_recordPayment", {
        ownerId, clubId,
        requestId: uuidv4(), operationId: uuidv4(),
        debtId: debtPayDialog.debtId,
        amount,
        paymentMethod: debtPayMethod,
        notes: debtPayNotes.trim() || undefined,
      });
      setDebtPayDialog(null);
      setDebtPayAmount("");
      setDebtPayNotes("");
      loadAll();
    } catch (err) {
      setDebtPayError(err instanceof Error ? err.message : "Gagal mencatat pembayaran");
    } finally {
      setDebtPaying(false);
    }
  }

  function handleActivateClick() {
    if (!selectedPlanId) {
      setActivateFeedback({ type: "err", msg: "Pilih paket terlebih dahulu" });
      return;
    }
    const plan = plans.find((p) => p.id === selectedPlanId)!;

    if (pendingNext) {
      // Already has a queued plan — block
      setSwitchConfirm({ newPlan: plan, blocked: true, remaining: -1 });
      return;
    }

    const remaining = activeMembership
      ? (activeMembership.planType === "locker"
          ? (activeMembership.blendingCredits ?? 0)
          : (activeMembership.visitRemaining ?? 0))
      : 0;
    setSwitchConfirm({ newPlan: plan, blocked: false, remaining });
  }

  async function confirmSwitch() {
    if (!switchConfirm || switchConfirm.blocked) return;
    const plan = switchConfirm.newPlan;
    const willQueue = switchConfirm.remaining > 0;
    setSwitchConfirm(null);
    setActivating(true);
    setActivateFeedback(undefined);
    try {
      await callFunction("membership_activate", {
        ownerId, clubId,
        requestId: uuidv4(), operationId: uuidv4(),
        customerId, planId: plan.id, transactionId: uuidv4(),
      });
      setActivateFeedback({
        type: "ok",
        msg: willQueue
          ? `${plan.name} dijadwalkan — akan aktif otomatis setelah kuota habis`
          : `${plan.name} berhasil diaktifkan`,
      });
      setSelectedPlanId("");
      loadAll();
    } catch (err) {
      setActivateFeedback({ type: "err", msg: err instanceof Error ? err.message : "Gagal" });
    } finally { setActivating(false); }
  }

  if (loading) {
    return (
      <div>
        <Link href="/customers" className="text-sm text-blue-600 hover:underline mb-6 inline-block">← Pelanggan</Link>
        <p className="text-slate-400 text-sm mt-4">Memuat data pelanggan…</p>
      </div>
    );
  }

  if (!customer) {
    return (
      <div>
        <Link href="/customers" className="text-sm text-blue-600 hover:underline mb-6 inline-block">← Pelanggan</Link>
        <p className="text-slate-500 mt-4">Pelanggan tidak ditemukan.</p>
      </div>
    );
  }

  const activeDebts = debts.filter((d) => d.status !== "paid");

  const TABS: { key: Tab; label: string; count: number }[] = [
    { key: "membership",   label: "Membership",   count: memberships.length },
    { key: "transactions", label: "Transaksi",    count: transactions.length },
    { key: "visits",       label: "Kunjungan",    count: visits.length },
    { key: "debts",        label: "Utang",        count: activeDebts.length },
  ];

  const isLocker = activeMembership?.planType === "locker";

  return (
    <div>
      {/* Edit profile dialog */}
      {/* Switch confirmation / blocked dialog */}
      {switchConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm mx-4">
            {switchConfirm.blocked ? (
              /* Already has a pending_next — block */
              <>
                <div className="flex items-start gap-3 mb-4">
                  <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center shrink-0">
                    <span className="text-lg">⚠️</span>
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-slate-900">Sudah Ada Paket Antrian</h3>
                    <p className="text-sm text-slate-500 mt-0.5">{customer?.displayName}</p>
                  </div>
                </div>
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-5">
                  <p className="text-sm font-semibold text-amber-800 mb-1">{pendingNext?.planName}</p>
                  <p className="text-sm text-amber-700">
                    Paket di atas sudah menunggu giliran. Hanya boleh ada satu antrian paket.
                  </p>
                </div>
                <button
                  onClick={() => setSwitchConfirm(null)}
                  className="w-full bg-slate-700 text-white rounded-xl py-2.5 text-sm font-semibold hover:bg-slate-800 transition"
                >
                  Mengerti
                </button>
              </>
            ) : switchConfirm.remaining > 0 ? (
              /* Active membership still has quota — will be queued */
              <>
                <div className="flex items-start gap-3 mb-4">
                  <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center shrink-0">
                    <span className="text-lg">📋</span>
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-slate-900">Jadwalkan Paket Berikutnya</h3>
                    <p className="text-sm text-slate-500 mt-0.5">{customer?.displayName}</p>
                  </div>
                </div>
                <div className="bg-slate-50 rounded-xl p-3 mb-3 text-sm">
                  <div className="flex justify-between text-slate-500 mb-1">
                    <span>Paket aktif sekarang</span>
                    <span className="font-medium text-slate-700">{activeMembership?.planName}</span>
                  </div>
                  <div className="flex justify-between text-slate-500">
                    <span>Sisa kuota</span>
                    <span className="font-semibold text-orange-600">
                      {activeMembership?.planType === "locker"
                        ? `${switchConfirm.remaining} kredit`
                        : `${switchConfirm.remaining} kunjungan`}
                    </span>
                  </div>
                </div>
                <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 mb-2 text-sm">
                  <div className="flex justify-between text-slate-500 mb-1">
                    <span>Paket berikutnya</span>
                    <span className="font-semibold text-slate-800">{switchConfirm.newPlan.name}</span>
                  </div>
                  <div className="flex justify-between text-slate-500">
                    <span>Kuota</span>
                    <span className="font-medium">
                      {switchConfirm.newPlan.planType === "locker"
                        ? `${switchConfirm.newPlan.visitQuota > 0 ? switchConfirm.newPlan.visitQuota + " kredit" : "Harian"}`
                        : `${switchConfirm.newPlan.visitQuota} kunjungan`}
                    </span>
                  </div>
                </div>
                <p className="text-xs text-blue-600 mb-5">
                  Paket ini akan otomatis aktif setelah kuota <strong>{activeMembership?.planName}</strong> habis.
                </p>
                <div className="flex gap-3">
                  <button
                    onClick={() => setSwitchConfirm(null)}
                    className="flex-1 border border-slate-200 text-slate-600 rounded-xl py-2.5 text-sm font-semibold hover:bg-slate-50 transition"
                  >
                    Batal
                  </button>
                  <button
                    onClick={confirmSwitch}
                    className="flex-1 bg-blue-600 text-white rounded-xl py-2.5 text-sm font-semibold hover:bg-blue-700 transition"
                  >
                    Ya, Jadwalkan
                  </button>
                </div>
              </>
            ) : (
              /* No active or quota = 0 — activate now */
              <>
                <div className="flex items-start gap-3 mb-4">
                  <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center shrink-0">
                    <span className="text-lg">✅</span>
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-slate-900">
                      {activeMembership ? "Ganti Paket" : "Aktifkan Membership"}
                    </h3>
                    <p className="text-sm text-slate-500 mt-0.5">{customer?.displayName}</p>
                  </div>
                </div>
                <div className="bg-green-50 border border-green-200 rounded-xl p-3 mb-5 text-sm">
                  <div className="flex justify-between text-slate-500 mb-1">
                    <span>Paket</span>
                    <span className="font-semibold text-slate-800">{switchConfirm.newPlan.name}</span>
                  </div>
                  <div className="flex justify-between text-slate-500">
                    <span>Kuota</span>
                    <span className="font-medium">
                      {switchConfirm.newPlan.planType === "locker"
                        ? `${switchConfirm.newPlan.visitQuota > 0 ? switchConfirm.newPlan.visitQuota + " kredit" : "Harian"}`
                        : `${switchConfirm.newPlan.visitQuota} kunjungan`}
                    </span>
                  </div>
                </div>
                <div className="flex gap-3">
                  <button
                    onClick={() => setSwitchConfirm(null)}
                    className="flex-1 border border-slate-200 text-slate-600 rounded-xl py-2.5 text-sm font-semibold hover:bg-slate-50 transition"
                  >
                    Batal
                  </button>
                  <button
                    onClick={confirmSwitch}
                    className="flex-1 bg-green-600 text-white rounded-xl py-2.5 text-sm font-semibold hover:bg-green-700 transition"
                  >
                    {activeMembership ? "Ya, Ganti" : "Ya, Aktifkan"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {debtPayDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm mx-4">
            <h3 className="text-base font-bold text-slate-900 mb-1">Catat Pembayaran Utang</h3>
            <p className="text-sm text-slate-500 mb-4">{debtPayDialog.label}</p>
            <div className="bg-slate-50 rounded-xl p-3 mb-4 flex justify-between text-sm">
              <span className="text-slate-500">Sisa utang</span>
              <span className="font-bold text-red-600">
                {new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(debtPayDialog.remaining)}
              </span>
            </div>
            {debtPayError && (
              <div className="mb-3 text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{debtPayError}</div>
            )}
            <div className="space-y-3">
              <div>
                <label className="text-xs text-slate-500 block mb-1">Jumlah Bayar</label>
                <input
                  type="number"
                  min="1"
                  max={debtPayDialog.remaining}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
                  value={debtPayAmount}
                  onChange={(e) => setDebtPayAmount(e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs text-slate-500 block mb-1">Metode</label>
                <div className="flex gap-2">
                  {(["cash", "transfer"] as const).map((m) => (
                    <button
                      key={m}
                      onClick={() => setDebtPayMethod(m)}
                      className={`flex-1 py-2 rounded-lg text-sm font-medium border transition ${
                        debtPayMethod === m ? "border-blue-500 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-500"
                      }`}
                    >
                      {m === "cash" ? "Tunai" : "Transfer"}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs text-slate-500 block mb-1">Catatan (opsional)</label>
                <input
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
                  placeholder="Catatan pembayaran"
                  value={debtPayNotes}
                  onChange={(e) => setDebtPayNotes(e.target.value)}
                />
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              <button
                onClick={() => { setDebtPayDialog(null); setDebtPayError(""); }}
                className="flex-1 border border-slate-200 text-slate-600 rounded-xl py-2.5 text-sm font-semibold hover:bg-slate-50 transition"
              >
                Batal
              </button>
              <button
                onClick={handleDebtPay}
                disabled={debtPaying || !debtPayAmount || parseFloat(debtPayAmount) <= 0}
                className="flex-1 bg-blue-600 text-white rounded-xl py-2.5 text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition"
              >
                {debtPaying ? "Menyimpan…" : "Simpan"}
              </button>
            </div>
          </div>
        </div>
      )}

      {editOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm mx-4">
            <h3 className="text-base font-bold text-slate-900 mb-4">Edit Profil Pelanggan</h3>
            {editFeedback && (
              <div className={`mb-3 text-sm rounded-lg px-3 py-2 ${editFeedback.type === "ok" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"}`}>
                {editFeedback.msg}
              </div>
            )}
            <div className="space-y-3">
              <label className="block">
                <span className="text-xs text-slate-500">Nama Lengkap *</span>
                <input
                  className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                />
              </label>
              <label className="block">
                <span className="text-xs text-slate-500">No. HP</span>
                <input
                  className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
                  value={editPhone}
                  onChange={(e) => setEditPhone(e.target.value)}
                />
              </label>
              <label className="block">
                <span className="text-xs text-slate-500">Email</span>
                <input
                  className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
                  value={editEmail}
                  onChange={(e) => setEditEmail(e.target.value)}
                />
              </label>
              <label className="block">
                <span className="text-xs text-slate-500">Catatan</span>
                <textarea
                  rows={2}
                  className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm resize-none"
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                />
              </label>
            </div>
            <div className="flex gap-3 mt-5">
              <button
                onClick={() => setEditOpen(false)}
                className="flex-1 border border-slate-200 text-slate-600 rounded-xl py-2.5 text-sm font-semibold hover:bg-slate-50 transition"
              >
                Batal
              </button>
              <button
                onClick={handleSaveEdit}
                disabled={editSaving || !editName.trim()}
                className="flex-1 bg-blue-600 text-white rounded-xl py-2.5 text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition"
              >
                {editSaving ? "Menyimpan…" : "Simpan"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Breadcrumb */}
      <Link href="/customers" className="text-sm text-blue-600 hover:underline mb-4 inline-block">
        ← Daftar Pelanggan
      </Link>

      {/* ── Customer header ── */}
      <div className="bg-white rounded-xl border border-slate-200 p-6 mb-6">
        <div className="flex items-start gap-5">
          <div className="w-16 h-16 rounded-full bg-blue-600 flex items-center justify-center shrink-0">
            <span className="text-white text-2xl font-bold">
              {customer.displayName.charAt(0).toUpperCase()}
            </span>
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <h2 className="text-2xl font-bold text-slate-900">{customer.displayName}</h2>
              <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${TIER_BADGE[customer.tier as CustomerTier] ?? "bg-slate-100 text-slate-600"}`}>
                {TIER_LABELS[customer.tier as CustomerTier] ?? customer.tier}
              </span>
              <button
                onClick={() => setEditOpen(true)}
                className="text-xs text-slate-400 hover:text-blue-600 border border-slate-200 rounded-lg px-2.5 py-1 transition"
              >
                Edit
              </button>
            </div>
            <div className="flex flex-col gap-y-0.5 mt-1.5">
              {customer.phone && <span className="text-sm text-slate-500">📞 {customer.phone}</span>}
              {customer.email && <span className="text-sm text-slate-500">✉ {customer.email}</span>}
              <span className="text-sm text-slate-400">Bergabung: {customer.createdAt?.slice(0, 10)}</span>
              <span className="text-xs text-slate-400 font-mono select-all">ID: {customer.id}</span>
            </div>
            {customer.notes && (
              <p className="text-sm text-slate-400 mt-1.5 italic">"{customer.notes}"</p>
            )}
          </div>

          {/* Active membership badge */}
          {pendingNext && (
            <div className="shrink-0 px-4 py-3 rounded-xl border border-blue-200 bg-blue-50 text-center">
              <p className="text-xs font-bold text-blue-600 uppercase tracking-wide">Antrian</p>
              <p className="text-sm font-semibold text-slate-800 mt-0.5">{pendingNext.planName}</p>
              <p className="text-xs text-blue-500 mt-1">
                {pendingNext.visitQuota
                  ? (pendingNext.planType === "locker" ? `${pendingNext.visitQuota} kredit` : `${pendingNext.visitQuota} kunjungan`)
                  : "Harian"}
              </p>
              <p className="text-xs text-slate-400">Aktif setelah kuota habis</p>
            </div>
          )}
          {activeMembership ? (
            isLocker ? (
              <div className="shrink-0 px-4 py-3 rounded-xl border border-purple-200 bg-purple-50 text-center">
                <p className="text-xs font-bold text-purple-700 uppercase tracking-wide">LOKER</p>
                <p className="text-sm font-semibold text-slate-800 mt-0.5">{activeMembership.planName}</p>
                <p className="text-lg font-bold text-purple-700 mt-1">
                  {activeMembership.blendingCredits ?? 0}
                  <span className="text-xs font-normal text-slate-500"> sesi</span>
                </p>
                <p className="text-xs text-slate-400">
                  {activeMembership.expiresAt ? `s/d ${activeMembership.expiresAt.slice(0, 10)}` : "Tidak ada expired"}
                </p>
              </div>
            ) : (
              <div className={`shrink-0 px-4 py-3 rounded-xl border text-center ${TIER_STYLE[activeMembership.tier]?.bg ?? "bg-slate-100"}`}>
                <p className={`text-xs font-bold uppercase tracking-wide ${TIER_STYLE[activeMembership.tier]?.text ?? "text-slate-600"}`}>
                  {activeMembership.tier}
                </p>
                <p className="text-sm font-semibold text-slate-800 mt-0.5">{activeMembership.planName}</p>
                <p className={`text-xs mt-1 font-medium ${(daysLeft(activeMembership.expiresAt) ?? 99) <= 7 ? "text-red-600" : "text-slate-500"}`}>
                  {activeMembership.visitRemaining ?? 0}/{activeMembership.visitQuota ?? 0} kunjungan
                </p>
                <p className="text-xs text-slate-400">
                  {activeMembership.expiresAt ? `s/d ${activeMembership.expiresAt.slice(0, 10)}` : "Tidak ada expired"}
                </p>
              </div>
            )
          ) : (
            <div className="shrink-0 px-4 py-3 rounded-xl border border-amber-200 bg-amber-50 text-center">
              <p className="text-xs font-bold text-amber-700">TIDAK AKTIF</p>
              <p className="text-xs text-amber-600 mt-1">Belum ada membership</p>
            </div>
          )}
        </div>
      </div>

      <div className="flex gap-6 items-start">
        {/* ── Main content ── */}
        <div className="flex-1 min-w-0">
          <div className="flex gap-1 mb-4 border-b border-slate-200">
            {TABS.map(({ key, label, count }) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`px-4 py-2.5 text-sm font-medium transition border-b-2 -mb-px ${
                  tab === key
                    ? "border-blue-600 text-blue-600"
                    : "border-transparent text-slate-500 hover:text-slate-700"
                }`}
              >
                {label}
                <span className={`ml-1.5 text-xs px-1.5 py-0.5 rounded-full ${tab === key ? "bg-blue-100 text-blue-700" : "bg-slate-100 text-slate-400"}`}>
                  {count}
                </span>
              </button>
            ))}
          </div>

          {/* ── Membership history ── */}
          {tab === "membership" && (
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-100">
                <h3 className="font-semibold text-slate-800">Riwayat Membership</h3>
              </div>
              {memberships.length === 0 ? (
                <p className="text-sm text-slate-400 p-4">Belum pernah memiliki membership.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-slate-500 text-xs">
                    <tr>
                      <th className="px-4 py-2 text-left">Paket</th>
                      <th className="px-4 py-2 text-left">Status</th>
                      <th className="px-4 py-2 text-left">Diaktifkan</th>
                      <th className="px-4 py-2 text-left">Kadaluarsa</th>
                      <th className="px-4 py-2 text-right">Kunjungan / Kredit</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {memberships.map((m) => {
                      const ts = TIER_STYLE[m.planType === "locker" ? "locker" : m.tier] ?? TIER_STYLE.basic!;
                      const dl = daysLeft(m.expiresAt);
                      return (
                        <tr key={m.id} className="hover:bg-slate-50">
                          <td className="px-4 py-2.5">
                            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${ts.bg} ${ts.text}`}>
                              {m.planType === "locker" ? "LOKER" : m.tier.toUpperCase()}
                            </span>
                            <span className="ml-2 font-medium text-slate-800">{m.planName}</span>
                          </td>
                          <td className="px-4 py-2.5">
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_STYLE[m.status] ?? "bg-slate-100 text-slate-600"}`}>
                              {STATUS_LABEL[m.status] ?? m.status}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-slate-500 text-xs">{m.activatedAt?.slice(0, 10)}</td>
                          <td className="px-4 py-2.5 text-slate-500 text-xs">
                            {m.expiresAt ? m.expiresAt.slice(0, 10) : <span className="text-green-600">∞</span>}
                            {m.status === "active" && dl !== null && (
                              <span className={`ml-1 font-medium ${dl <= 7 ? "text-red-600" : "text-slate-400"}`}>
                                ({dl}h)
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-2.5 text-right font-medium text-slate-700">
                            {m.planType === "locker"
                              ? <span className="text-purple-700">{m.blendingCredits ?? 0} kredit</span>
                              : <>{m.visitUsed} / {m.visitQuota ?? "—"} <span className="text-slate-400 font-normal">({m.visitRemaining ?? 0} sisa)</span></>
                            }
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* ── Transaction history ── */}
          {tab === "transactions" && (
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
                <h3 className="font-semibold text-slate-800">Riwayat Transaksi</h3>
                <span className="text-xs text-slate-400">
                  Total: {fmt(transactions.filter((t) => t.status === "completed").reduce((s, t) => s + t.total, 0))}
                </span>
              </div>
              {transactions.length === 0 ? (
                <p className="text-sm text-slate-400 p-4">Belum ada transaksi.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-slate-500 text-xs">
                    <tr>
                      <th className="px-4 py-2 text-left">Tanggal</th>
                      <th className="px-4 py-2 text-left">Item</th>
                      <th className="px-4 py-2 text-left">Pembayaran</th>
                      <th className="px-4 py-2 text-right">Total</th>
                      <th className="px-4 py-2 text-left">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {transactions.map((tx) => (
                      <tr key={tx.id} className="hover:bg-slate-50">
                        <td className="px-4 py-2.5 text-slate-400 text-xs whitespace-nowrap">
                          {tx.createdAt?.slice(0, 16).replace("T", " ")}
                        </td>
                        <td className="px-4 py-2.5 text-slate-500 text-xs max-w-xs">
                          {tx.items?.length > 0
                            ? tx.items.map((i) => `${i.productName} ×${i.quantity}`).join(", ")
                            : "—"}
                        </td>
                        <td className="px-4 py-2.5 text-slate-500 text-xs uppercase">{tx.paymentMethod}</td>
                        <td className="px-4 py-2.5 text-right font-semibold text-slate-800">{fmt(tx.total)}</td>
                        <td className="px-4 py-2.5">
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_STYLE[tx.status] ?? "bg-slate-100 text-slate-500"}`}>
                            {STATUS_LABEL[tx.status] ?? tx.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="border-t-2 border-slate-200 bg-slate-50">
                    <tr>
                      <td colSpan={3} className="px-4 py-2.5 text-xs text-slate-500 text-right font-semibold">
                        Selesai ({transactions.filter((t) => t.status === "completed").length})
                      </td>
                      <td className="px-4 py-2.5 text-right font-bold text-slate-900">
                        {fmt(transactions.filter((t) => t.status === "completed").reduce((s, t) => s + t.total, 0))}
                      </td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              )}
            </div>
          )}

          {/* ── Visit history ── */}
          {tab === "visits" && (
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-100">
                <h3 className="font-semibold text-slate-800">Riwayat Kunjungan</h3>
              </div>
              {visits.length === 0 ? (
                <p className="text-sm text-slate-400 p-4">Belum ada kunjungan tercatat.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-slate-500 text-xs">
                    <tr>
                      <th className="px-4 py-2 text-left">Tanggal</th>
                      <th className="px-4 py-2 text-left">Tipe</th>
                      <th className="px-4 py-2 text-right">Sebelum</th>
                      <th className="px-4 py-2 text-right">Sesudah</th>
                      <th className="px-4 py-2 text-right">Tamu / Biaya</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {visits.map((v) => {
                      const isLockerVisit = v.visitType === "locker_blending";
                      return (
                        <tr key={v.id} className="hover:bg-slate-50">
                          <td className="px-4 py-2.5 text-slate-500 text-xs whitespace-nowrap">
                            {v.createdAt?.slice(0, 16).replace("T", " ")}
                          </td>
                          <td className="px-4 py-2.5">
                            {isLockerVisit ? (
                              <span className="text-xs px-2 py-0.5 rounded-full bg-purple-50 text-purple-700 font-medium">
                                Loker · {v.paymentType === "cash" ? "Tunai" : "Kredit"}
                              </span>
                            ) : (
                              <span className="text-xs px-2 py-0.5 rounded-full bg-green-50 text-green-700 font-medium">
                                Kunjungan
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-2.5 text-right text-slate-600 font-medium">
                            {isLockerVisit ? v.creditsBefore : v.visitsBefore}
                          </td>
                          <td className="px-4 py-2.5 text-right font-bold text-green-700">
                            {isLockerVisit ? v.creditsAfter : v.visitsAfter}
                          </td>
                          <td className="px-4 py-2.5 text-right text-slate-500 text-xs">
                            {isLockerVisit
                              ? <>{v.guestCount} tamu{v.totalCharge ? ` · ${fmt(v.totalCharge)}` : ""}</>
                              : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          )}
          {/* ── Debts ── */}
          {tab === "debts" && (
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
                <h3 className="font-semibold text-slate-800">Utang Piutang</h3>
                {activeDebts.length > 0 && (
                  <span className="text-xs font-semibold text-red-600">
                    Sisa: {fmt(activeDebts.reduce((s, d) => s + d.remainingAmount, 0))}
                  </span>
                )}
              </div>
              {debts.length === 0 ? (
                <p className="text-sm text-slate-400 p-4">Tidak ada utang tercatat.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-slate-500 text-xs">
                    <tr>
                      <th className="px-4 py-2 text-left">Paket</th>
                      <th className="px-4 py-2 text-right">Total</th>
                      <th className="px-4 py-2 text-right">Terbayar</th>
                      <th className="px-4 py-2 text-right">Sisa</th>
                      <th className="px-4 py-2 text-center">Status</th>
                      <th className="px-4 py-2 text-center">Aksi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {debts.map((d) => (
                      <tr key={d.id} className="hover:bg-slate-50">
                        <td className="px-4 py-2.5">
                          <p className="font-medium text-slate-800">{d.referenceLabel}</p>
                          <p className="text-xs text-slate-400">{d.createdAt.slice(0, 10)}</p>
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono text-slate-600 text-xs">{fmt(d.totalAmount)}</td>
                        <td className="px-4 py-2.5 text-right font-mono text-green-700 text-xs">{fmt(d.paidAmount)}</td>
                        <td className="px-4 py-2.5 text-right font-mono font-bold text-red-600 text-xs">{fmt(d.remainingAmount)}</td>
                        <td className="px-4 py-2.5 text-center">
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                            d.status === "paid" ? "bg-green-50 text-green-700" :
                            d.status === "partial" ? "bg-amber-50 text-amber-700" :
                            "bg-red-50 text-red-600"
                          }`}>
                            {d.status === "paid" ? "Lunas" : d.status === "partial" ? "Sebagian" : "Belum Bayar"}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-center">
                          {d.status !== "paid" && (
                            <button
                              onClick={() => {
                                setDebtPayDialog({ debtId: d.id, remaining: d.remainingAmount, label: d.referenceLabel });
                                setDebtPayAmount(String(d.remainingAmount));
                                setDebtPayMethod("cash");
                                setDebtPayNotes("");
                                setDebtPayError("");
                              }}
                              className="px-3 py-1 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition font-medium"
                            >
                              Bayar
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>

        {/* ── Sidebar ── */}
        <div className="w-72 shrink-0">
          <div className="bg-white rounded-xl border border-slate-200 p-5 sticky top-6 space-y-4">
            <h3 className="font-semibold text-slate-800">
              {activeMembership ? "Ganti Paket" : "Aktifkan Membership"}
            </h3>

            {activeMembership && (
              <div className={`rounded-lg p-3 text-xs ${isLocker ? "bg-purple-50" : "bg-green-50"}`}>
                <p className={`font-semibold mb-0.5 ${isLocker ? "text-purple-800" : "text-green-800"}`}>
                  Aktif: {activeMembership.planName}
                </p>
                {isLocker ? (
                  <p className="text-purple-700">{activeMembership.blendingCredits ?? 0} kredit tersisa</p>
                ) : (
                  <p className="text-green-700">
                    {activeMembership.visitRemaining ?? 0} kunjungan ·{" "}
                    {activeMembership.expiresAt ? `s/d ${activeMembership.expiresAt.slice(0, 10)}` : "∞"}
                  </p>
                )}
              </div>
            )}

            {activateFeedback && (
              <div className={`text-xs rounded-lg px-3 py-2 ${activateFeedback.type === "ok" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"}`}>
                {activateFeedback.msg}
              </div>
            )}

            <div className="space-y-2">
              {plans.map((p) => {
                const isLockerPlan = p.planType === "locker";
                const ts = TIER_STYLE[isLockerPlan ? "locker" : p.tier] ?? TIER_STYLE.basic!;
                const isSelected = selectedPlanId === p.id;
                return (
                  <button
                    key={p.id}
                    onClick={() => setSelectedPlanId(isSelected ? "" : p.id)}
                    className={`w-full text-left rounded-lg border p-3 transition ${
                      isSelected
                        ? isLockerPlan ? "border-purple-400 bg-purple-50" : "border-blue-500 bg-blue-50"
                        : "border-slate-200 hover:border-slate-300"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${ts.bg} ${ts.text}`}>
                        {isLockerPlan ? "LOKER" : p.tier.toUpperCase()}
                      </span>
                      {isSelected && <span className={`text-xs font-bold ${isLockerPlan ? "text-purple-600" : "text-blue-600"}`}>✓ Dipilih</span>}
                    </div>
                    <p className="text-sm font-semibold text-slate-800 mt-1.5">{p.name}</p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {isLockerPlan
                        ? `${p.visitQuota > 0 ? `${p.visitQuota}× · ` : "Harian · "}${fmt(p.blendingFeePerSession ?? 0)}/sesi`
                        : `${fmt(p.price)} · ${p.visitQuota}× · ${p.hasExpiry && p.durationDays ? `${p.durationDays} hari` : "∞"}`
                      }
                    </p>
                  </button>
                );
              })}
            </div>

            <button
              onClick={handleActivateClick}
              disabled={activating || !selectedPlanId}
              className="w-full bg-green-600 text-white rounded-lg py-2.5 text-sm font-semibold hover:bg-green-700 disabled:opacity-50 transition"
            >
              {activating ? "Mengaktifkan…" : activeMembership ? "Ganti Paket" : "Aktifkan Membership"}
            </button>

            {/* ── Ganti tier ── */}
            <div className="border-t border-slate-100 pt-4">
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-sm font-semibold text-slate-700">Level / Tier</h4>
                <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${TIER_BADGE[customer.tier as CustomerTier] ?? "bg-slate-100 text-slate-600"}`}>
                  {TIER_LABELS[customer.tier as CustomerTier] ?? customer.tier}
                </span>
              </div>
              {tierFeedback && (
                <div className={`mb-2 text-xs rounded-lg px-3 py-2 ${tierFeedback.type === "ok" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"}`}>
                  {tierFeedback.msg}
                </div>
              )}
              <div className="flex gap-2">
                <select
                  className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm"
                  value={changeTier}
                  onChange={(e) => setChangeTier(e.target.value as CustomerTier)}
                >
                  {(Object.entries(TIER_LABELS) as [CustomerTier, string][]).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
                <button
                  onClick={handleChangeTier}
                  disabled={tierSaving || changeTier === customer.tier}
                  className="bg-slate-700 text-white px-4 rounded-lg text-sm font-semibold hover:bg-slate-800 disabled:opacity-40 transition"
                >
                  {tierSaving ? "…" : "Ubah"}
                </button>
              </div>
            </div>

            <button onClick={loadAll} className="text-xs text-blue-600 hover:underline w-full text-center">
              Refresh data
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
