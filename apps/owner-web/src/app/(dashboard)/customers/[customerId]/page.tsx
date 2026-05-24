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
const TIER_LABELS: Record<CustomerTier, string> = {
  retail: "Retail", ds: "DS", sc: "SC", sbQp: "SB-QP", spv: "SPV",
};

const TIER_BADGE: Record<CustomerTier, string> = {
  retail: "bg-slate-100 text-slate-700",
  ds:     "bg-green-100 text-green-700",
  sc:     "bg-blue-100 text-blue-700",
  sbQp:   "bg-amber-100 text-amber-800",
  spv:    "bg-purple-100 text-purple-800",
};

const TIER_AVATAR: Record<CustomerTier, string> = {
  retail: "bg-slate-600",
  ds:     "bg-green-600",
  sc:     "bg-blue-600",
  sbQp:   "bg-amber-500",
  spv:    "bg-purple-600",
};

const TIER_PILL_ACTIVE: Record<CustomerTier, string> = {
  retail: "bg-slate-800 text-white",
  ds:     "bg-green-600 text-white",
  sc:     "bg-blue-600 text-white",
  sbQp:   "bg-amber-500 text-white",
  spv:    "bg-purple-600 text-white",
};

interface Customer {
  id: string;
  displayName: string;
  phone: string | null;
  email: string | null;
  notes: string | null;
  tier: CustomerTier;
  activeMembershipId: string | null;
  competitionIds?: string[];  // denormalized — set by Cloud Functions when joining/leaving a competition
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
  visitsBefore?: number;
  visitsAfter?: number;
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

type Tab = "membership" | "transactions" | "visits" | "debts";

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmt = (n: number) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);

const PLAN_TIER_STYLE: Record<string, { bg: string; text: string }> = {
  basic:    { bg: "bg-slate-100",  text: "text-slate-600" },
  silver:   { bg: "bg-slate-200",  text: "text-slate-700" },
  gold:     { bg: "bg-yellow-100", text: "text-yellow-800" },
  platinum: { bg: "bg-blue-100",   text: "text-blue-800" },
  locker:   { bg: "bg-purple-100", text: "text-purple-800" },
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

  // Edit profile dialog
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

  // Locker top-up
  const [topUpSessions, setTopUpSessions] = useState("10");
  const [topUpLoading, setTopUpLoading]   = useState(false);
  const [topUpFeedback, setTopUpFeedback] = useState<{ type: "ok" | "err"; msg: string } | undefined>();

  const activeMembership = useMemo(
    () => memberships.find((m) => m.status === "active") ?? null,
    [memberships]
  );

  const pendingNext = useMemo(
    () => memberships.find((m) => m.status === "pending_next") ?? null,
    [memberships]
  );

  const activeDebts = useMemo(() => debts.filter((d) => d.status !== "paid"), [debts]);

  const totalSpend = useMemo(
    () => transactions.filter((t) => t.status === "completed").reduce((s, t) => s + t.total, 0),
    [transactions]
  );

  const isLocker = activeMembership?.planType === "locker";

  useEffect(() => {
    if (ownerId && clubId && customerId) loadAll();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownerId, clubId, customerId]);

  async function loadAll() {
    setLoading(true);
    try {
      const db = firebaseDb();
      const base = `owners/${ownerId}/clubs/${clubId}`;

      const [custSnap, memSnap, txSnap, visitSnap] = await Promise.all([
        getDoc(doc(db, `${base}/customers/${customerId}`)),
        getDocs(query(collection(db, `${base}/memberships`), where("customerId", "==", customerId), limit(20))),
        getDocs(query(collection(db, `${base}/transactions`), where("customerId", "==", customerId), limit(50))),
        getDocs(query(collection(db, `${base}/membershipVisits`), where("customerId", "==", customerId), limit(50))),
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
      try {
        const debtSnap = await getDocs(
          query(collection(db, `${base}/debts`), where("customerId", "==", customerId))
        );
        setDebts(
          debtSnap.docs
            .map((d) => ({ id: d.id, ...(d.data() as Omit<Debt, "id">) }))
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        );
      } catch { setDebts([]); }
    } finally { setLoading(false); }
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
    } finally { setDebtPaying(false); }
  }

  async function handleLockerTopUp() {
    if (!activeMembership || !ownerId || !clubId) return;
    const sessions = parseInt(topUpSessions);
    if (isNaN(sessions) || sessions < 1) {
      setTopUpFeedback({ type: "err", msg: "Masukkan jumlah sesi yang valid (min 1)" });
      return;
    }
    setTopUpLoading(true);
    setTopUpFeedback(undefined);
    try {
      const result = await callFunction("locker_topUp", {
        ownerId, clubId,
        requestId: uuidv4(), operationId: uuidv4(),
        membershipId: activeMembership.id,
        customerId,
        sessions,
      }) as { creditsAfter: number };
      setTopUpFeedback({ type: "ok", msg: `+${sessions} sesi ditambahkan. Saldo: ${result.creditsAfter} kredit` });
      setTopUpSessions("10");
      loadAll();
    } catch (err) {
      setTopUpFeedback({ type: "err", msg: err instanceof Error ? err.message : "Gagal top up" });
    } finally { setTopUpLoading(false); }
  }

  // ── Loading / not found states ────────────────────────────────────────────

  if (loading) {
    return (
      <div>
        <Link href="/customers" className="text-sm text-blue-600 hover:underline mb-6 inline-flex items-center gap-1">
          ← Daftar Pelanggan
        </Link>
        <div className="mt-8 flex flex-col items-center gap-3 text-slate-400">
          <div className="w-8 h-8 border-2 border-slate-200 border-t-blue-500 rounded-full animate-spin" />
          <p className="text-sm">Memuat data pelanggan…</p>
        </div>
      </div>
    );
  }

  if (!customer) {
    return (
      <div>
        <Link href="/customers" className="text-sm text-blue-600 hover:underline mb-6 inline-block">← Daftar Pelanggan</Link>
        <p className="text-slate-500 mt-4">Pelanggan tidak ditemukan.</p>
      </div>
    );
  }

  const tier = customer.tier as CustomerTier;

  const TABS: { key: Tab; label: string; count: number }[] = [
    { key: "membership",   label: "Membership",   count: memberships.length },
    { key: "transactions", label: "Transaksi",    count: transactions.length },
    { key: "visits",       label: "Kunjungan",    count: visits.length },
    { key: "debts",        label: "Utang",        count: activeDebts.length },
  ];

  return (
    <div className="max-w-5xl">

      {/* ── Debt payment dialog ──────────────────────────────────────────────── */}
      {debtPayDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold text-slate-900">Catat Pembayaran Utang</h3>
              <button onClick={() => { setDebtPayDialog(null); setDebtPayError(""); }} className="text-slate-400 hover:text-slate-600 text-xl leading-none">×</button>
            </div>
            <p className="text-sm text-slate-500 mb-4 bg-slate-50 rounded-xl px-3 py-2">{debtPayDialog.label}</p>
            <div className="bg-red-50 rounded-xl p-3 mb-4 flex justify-between text-sm">
              <span className="text-red-500 font-medium">Sisa utang</span>
              <span className="font-bold text-red-700">{fmt(debtPayDialog.remaining)}</span>
            </div>
            {debtPayError && (
              <div className="mb-3 text-sm text-red-600 bg-red-50 rounded-xl px-3 py-2">{debtPayError}</div>
            )}
            <div className="space-y-3">
              <label className="block">
                <span className="text-xs text-slate-500 font-medium">Jumlah Bayar</span>
                <input
                  type="number"
                  min="1"
                  max={debtPayDialog.remaining}
                  className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={debtPayAmount}
                  onChange={(e) => setDebtPayAmount(e.target.value)}
                />
              </label>
              <div>
                <span className="text-xs text-slate-500 font-medium block mb-1.5">Metode Bayar</span>
                <div className="flex gap-2">
                  {(["cash", "transfer"] as const).map((m) => (
                    <button
                      key={m}
                      onClick={() => setDebtPayMethod(m)}
                      className={`flex-1 py-2.5 rounded-xl text-sm font-semibold border-2 transition ${
                        debtPayMethod === m
                          ? "border-blue-500 bg-blue-50 text-blue-700"
                          : "border-slate-200 text-slate-500 hover:border-slate-300"
                      }`}
                    >
                      {m === "cash" ? "💵 Tunai" : "🏦 Transfer"}
                    </button>
                  ))}
                </div>
              </div>
              <label className="block">
                <span className="text-xs text-slate-500 font-medium">Catatan (opsional)</span>
                <input
                  className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Catatan pembayaran"
                  value={debtPayNotes}
                  onChange={(e) => setDebtPayNotes(e.target.value)}
                />
              </label>
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

      {/* ── Edit profile dialog ──────────────────────────────────────────────── */}
      {editOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold text-slate-900">Edit Profil</h3>
              <button onClick={() => setEditOpen(false)} className="text-slate-400 hover:text-slate-600 text-xl leading-none">×</button>
            </div>
            {editFeedback && (
              <div className={`mb-3 text-sm rounded-xl px-3 py-2 ${editFeedback.type === "ok" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"}`}>
                {editFeedback.msg}
              </div>
            )}
            <div className="space-y-3">
              <label className="block">
                <span className="text-xs text-slate-500 font-medium">Nama Lengkap *</span>
                <input
                  className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                />
              </label>
              <label className="block">
                <span className="text-xs text-slate-500 font-medium">No. HP</span>
                <input
                  className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={editPhone}
                  onChange={(e) => setEditPhone(e.target.value)}
                />
              </label>
              <label className="block">
                <span className="text-xs text-slate-500 font-medium">Email</span>
                <input
                  className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={editEmail}
                  onChange={(e) => setEditEmail(e.target.value)}
                />
              </label>
              <label className="block">
                <span className="text-xs text-slate-500 font-medium">Catatan</span>
                <textarea
                  rows={2}
                  className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
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

      {/* ── Breadcrumb ───────────────────────────────────────────────────────── */}
      <Link href="/customers" className="text-sm text-slate-500 hover:text-blue-600 mb-5 inline-flex items-center gap-1 transition">
        ← Daftar Pelanggan
      </Link>

      {/* ── Profile card ─────────────────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 mb-4">

        {/* Row 1: Avatar + name + contact + Edit button */}
        <div className="flex items-start gap-4">
          <div className={`w-16 h-16 rounded-2xl ${TIER_AVATAR[tier] ?? "bg-slate-600"} flex items-center justify-center shrink-0 shadow-sm`}>
            <span className="text-white text-2xl font-bold">
              {customer.displayName.charAt(0).toUpperCase()}
            </span>
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2.5 flex-wrap">
              <h2 className="text-xl font-bold text-slate-900">{customer.displayName}</h2>
              <span className={`text-xs font-bold px-2.5 py-0.5 rounded-full ${TIER_BADGE[tier] ?? "bg-slate-100 text-slate-700"}`}>
                {TIER_LABELS[tier] ?? tier}
              </span>
              {customer.competitionIds && customer.competitionIds.length > 0 && (
                <span className="text-xs font-bold px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-800">
                  🏆 Peserta Lomba
                </span>
              )}
            </div>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5">
              {customer.phone && <span className="text-sm text-slate-500">📞 {customer.phone}</span>}
              {customer.email && <span className="text-sm text-slate-500">✉ {customer.email}</span>}
              <span className="text-xs text-slate-400 mt-0.5">Bergabung {customer.createdAt?.slice(0, 10)}</span>
            </div>
            {customer.notes && (
              <p className="text-sm text-slate-400 italic mt-1.5">"{customer.notes}"</p>
            )}
          </div>

          <button
            onClick={() => setEditOpen(true)}
            className="shrink-0 text-sm text-slate-500 border border-slate-200 rounded-xl px-3.5 py-2 hover:bg-slate-50 hover:text-slate-700 transition font-medium"
          >
            ✏ Edit
          </button>
        </div>

        {/* Row 2: Stats strip */}
        <div className="mt-5 grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="bg-slate-50 rounded-xl p-3">
            <p className="text-xs text-slate-400 mb-0.5">Total Belanja</p>
            <p className="font-bold text-slate-900 text-sm truncate">{fmt(totalSpend)}</p>
            <p className="text-xs text-slate-400 mt-0.5">{transactions.filter(t => t.status === "completed").length} transaksi</p>
          </div>
          <div className="bg-slate-50 rounded-xl p-3">
            <p className="text-xs text-slate-400 mb-0.5">Kunjungan</p>
            <p className="font-bold text-slate-900 text-sm">{visits.length} kali</p>
            <p className="text-xs text-slate-400 mt-0.5">total tercatat</p>
          </div>
          <div className={`rounded-xl p-3 ${activeDebts.length > 0 ? "bg-red-50" : "bg-slate-50"}`}>
            <p className={`text-xs mb-0.5 ${activeDebts.length > 0 ? "text-red-400" : "text-slate-400"}`}>Utang Aktif</p>
            <p className={`font-bold text-sm ${activeDebts.length > 0 ? "text-red-700" : "text-slate-400"}`}>
              {activeDebts.length > 0 ? fmt(activeDebts.reduce((s, d) => s + d.remainingAmount, 0)) : "—"}
            </p>
            <p className={`text-xs mt-0.5 ${activeDebts.length > 0 ? "text-red-400" : "text-slate-400"}`}>
              {activeDebts.length > 0 ? `${activeDebts.length} tagihan` : "Lunas"}
            </p>
          </div>
          <div className={`rounded-xl p-3 ${activeMembership ? "bg-green-50" : "bg-amber-50"}`}>
            <p className={`text-xs mb-0.5 ${activeMembership ? "text-green-500" : "text-amber-500"}`}>Membership</p>
            <p className={`font-bold text-sm truncate ${activeMembership ? "text-green-800" : "text-amber-700"}`}>
              {activeMembership ? activeMembership.planName : "Tidak Aktif"}
            </p>
            {activeMembership && (
              <p className="text-xs text-green-600 mt-0.5">
                {isLocker
                  ? `${activeMembership.blendingCredits ?? 0} sesi`
                  : activeMembership.visitRemaining !== null
                    ? `${activeMembership.visitRemaining} kunjungan sisa`
                    : "Harian"
                }
              </p>
            )}
          </div>
        </div>

        {/* Row 3: Tier selector */}
        <div className="mt-4 pt-4 border-t border-slate-100">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-xs text-slate-400 font-medium shrink-0">Ubah Tier:</span>
            <div className="flex gap-1.5 flex-wrap">
              {(Object.keys(TIER_LABELS) as CustomerTier[]).map((t) => (
                <button
                  key={t}
                  onClick={() => { setChangeTier(t); setTierFeedback(undefined); }}
                  className={`px-3 py-1 rounded-lg text-xs font-semibold transition ${
                    changeTier === t
                      ? TIER_PILL_ACTIVE[t]
                      : "bg-slate-100 text-slate-500 hover:bg-slate-200"
                  }`}
                >
                  {TIER_LABELS[t]}
                </button>
              ))}
            </div>
            {changeTier !== customer.tier && (
              <button
                onClick={handleChangeTier}
                disabled={tierSaving}
                className="ml-auto shrink-0 bg-slate-800 text-white px-4 py-1.5 rounded-lg text-xs font-semibold hover:bg-slate-900 disabled:opacity-50 transition"
              >
                {tierSaving ? "Menyimpan…" : "Simpan Perubahan"}
              </button>
            )}
            {tierFeedback && (
              <span className={`text-xs font-medium ${tierFeedback.type === "ok" ? "text-green-600" : "text-red-600"}`}>
                {tierFeedback.msg}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* ── Pending next notice ──────────────────────────────────────────────── */}
      {pendingNext && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 mb-4 flex items-start gap-3">
          <span className="text-blue-500 text-lg shrink-0">⏳</span>
          <div>
            <p className="text-sm font-semibold text-blue-800">
              Membership Antrian: {pendingNext.planName}
            </p>
            <p className="text-xs text-blue-600 mt-0.5">
              Akan aktif otomatis setelah membership saat ini selesai
            </p>
          </div>
        </div>
      )}

      {/* ── Tabs ─────────────────────────────────────────────────────────────── */}
      <div className="flex gap-1 mb-4 bg-slate-100 p-1 rounded-xl w-fit">
        {TABS.map(({ key, label, count }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold transition ${
              tab === key
                ? "bg-white text-slate-900 shadow-sm"
                : "text-slate-500 hover:text-slate-700"
            }`}
          >
            {label}
            {count > 0 && (
              <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                tab === key ? "bg-slate-100 text-slate-600" : "bg-slate-200 text-slate-400"
              }`}>
                {count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── Membership tab ───────────────────────────────────────────────────── */}
      {tab === "membership" && (
        <div className="space-y-4">

          {/* Locker top-up card */}
          {isLocker && activeMembership && (
            <div className="bg-purple-50 border border-purple-200 rounded-2xl p-5">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h4 className="font-bold text-purple-900 text-sm">Top-up Kredit Loker</h4>
                  <p className="text-xs text-purple-600 mt-0.5">
                    Saldo saat ini:&nbsp;
                    <strong className="text-purple-800">{activeMembership.blendingCredits ?? 0} kredit</strong>
                  </p>
                </div>
                <div className="w-10 h-10 bg-purple-100 rounded-xl flex items-center justify-center text-purple-700 font-bold">
                  🔑
                </div>
              </div>
              {topUpFeedback && (
                <div className={`mb-3 text-sm rounded-xl px-3 py-2 ${topUpFeedback.type === "ok" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"}`}>
                  {topUpFeedback.msg}
                </div>
              )}
              <div className="flex gap-2">
                <input
                  type="number"
                  min={1}
                  className="flex-1 border border-purple-200 bg-white rounded-xl px-3 py-2.5 text-sm text-center focus:outline-none focus:ring-2 focus:ring-purple-400"
                  placeholder="Jumlah sesi"
                  value={topUpSessions}
                  onChange={(e) => setTopUpSessions(e.target.value)}
                />
                <button
                  onClick={handleLockerTopUp}
                  disabled={topUpLoading}
                  className="bg-purple-600 text-white px-5 rounded-xl text-sm font-bold hover:bg-purple-700 disabled:opacity-50 transition"
                >
                  {topUpLoading ? "…" : "+ Top Up"}
                </button>
              </div>
            </div>
          )}

          {/* Membership history table */}
          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100">
              <h3 className="font-semibold text-slate-800">Riwayat Membership</h3>
            </div>
            {memberships.length === 0 ? (
              <div className="px-5 py-10 text-center">
                <p className="text-2xl mb-2">🎫</p>
                <p className="text-sm text-slate-400">Belum pernah memiliki membership.</p>
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-500 text-xs">
                  <tr>
                    <th className="px-5 py-3 text-left font-semibold">Paket</th>
                    <th className="px-5 py-3 text-left font-semibold">Status</th>
                    <th className="px-5 py-3 text-left font-semibold">Diaktifkan</th>
                    <th className="px-5 py-3 text-left font-semibold">Kadaluarsa</th>
                    <th className="px-5 py-3 text-right font-semibold">Kunjungan / Kredit</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {memberships.map((m) => {
                    const ts = PLAN_TIER_STYLE[m.planType === "locker" ? "locker" : m.tier] ?? PLAN_TIER_STYLE.basic!;
                    const dl = daysLeft(m.expiresAt);
                    return (
                      <tr key={m.id} className="hover:bg-slate-50 transition">
                        <td className="px-5 py-3">
                          <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${ts.bg} ${ts.text}`}>
                            {m.planType === "locker" ? "LOKER" : m.tier.toUpperCase()}
                          </span>
                          <span className="ml-2 font-medium text-slate-800">{m.planName}</span>
                        </td>
                        <td className="px-5 py-3">
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_STYLE[m.status] ?? "bg-slate-100 text-slate-600"}`}>
                            {STATUS_LABEL[m.status] ?? m.status}
                          </span>
                        </td>
                        <td className="px-5 py-3 text-slate-500 text-xs">{m.activatedAt?.slice(0, 10) ?? "—"}</td>
                        <td className="px-5 py-3 text-slate-500 text-xs">
                          {m.expiresAt ? (
                            <>
                              {m.expiresAt.slice(0, 10)}
                              {m.status === "active" && dl !== null && (
                                <span className={`ml-1.5 font-semibold ${dl <= 7 ? "text-red-600" : "text-slate-400"}`}>
                                  ({dl}h lagi)
                                </span>
                              )}
                            </>
                          ) : (
                            <span className="text-green-600 font-medium">∞ Selamanya</span>
                          )}
                        </td>
                        <td className="px-5 py-3 text-right font-medium text-slate-700">
                          {m.planType === "locker" ? (
                            <span className="text-purple-700 font-bold">{m.blendingCredits ?? 0} kredit</span>
                          ) : (
                            <span>
                              {m.visitUsed} / {m.visitQuota ?? "—"}
                              <span className="text-slate-400 font-normal text-xs ml-1">({m.visitRemaining ?? 0} sisa)</span>
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* ── Transactions tab ──────────────────────────────────────────────────── */}
      {tab === "transactions" && (
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
            <h3 className="font-semibold text-slate-800">Riwayat Transaksi</h3>
            <span className="text-xs text-slate-400 font-medium">
              Total selesai: <span className="text-slate-700 font-bold">{fmt(totalSpend)}</span>
            </span>
          </div>
          {transactions.length === 0 ? (
            <div className="px-5 py-10 text-center">
              <p className="text-2xl mb-2">🛒</p>
              <p className="text-sm text-slate-400">Belum ada transaksi.</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 text-xs">
                <tr>
                  <th className="px-5 py-3 text-left font-semibold">Tanggal</th>
                  <th className="px-5 py-3 text-left font-semibold">Item</th>
                  <th className="px-5 py-3 text-left font-semibold">Bayar</th>
                  <th className="px-5 py-3 text-right font-semibold">Total</th>
                  <th className="px-5 py-3 text-left font-semibold">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {transactions.map((tx) => (
                  <tr key={tx.id} className="hover:bg-slate-50 transition">
                    <td className="px-5 py-3 text-slate-400 text-xs whitespace-nowrap">
                      {tx.createdAt?.slice(0, 16).replace("T", " ")}
                    </td>
                    <td className="px-5 py-3 text-slate-500 text-xs max-w-xs truncate">
                      {tx.items?.length > 0
                        ? tx.items.map((i) => `${i.productName} ×${i.quantity}`).join(", ")
                        : "—"}
                    </td>
                    <td className="px-5 py-3 text-slate-500 text-xs">
                      {tx.paymentMethod === "cash" ? "Tunai" : tx.paymentMethod === "transfer" ? "Transfer" : tx.paymentMethod}
                    </td>
                    <td className="px-5 py-3 text-right font-bold text-slate-800">{fmt(tx.total)}</td>
                    <td className="px-5 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_STYLE[tx.status] ?? "bg-slate-100 text-slate-500"}`}>
                        {STATUS_LABEL[tx.status] ?? tx.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t-2 border-slate-200 bg-slate-50">
                <tr>
                  <td colSpan={3} className="px-5 py-3 text-xs text-slate-500 font-semibold">
                    {transactions.filter(t => t.status === "completed").length} transaksi selesai
                  </td>
                  <td className="px-5 py-3 text-right font-bold text-slate-900">{fmt(totalSpend)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      )}

      {/* ── Visits tab ───────────────────────────────────────────────────────── */}
      {tab === "visits" && (
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100">
            <h3 className="font-semibold text-slate-800">Riwayat Kunjungan</h3>
          </div>
          {visits.length === 0 ? (
            <div className="px-5 py-10 text-center">
              <p className="text-2xl mb-2">📅</p>
              <p className="text-sm text-slate-400">Belum ada kunjungan tercatat.</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 text-xs">
                <tr>
                  <th className="px-5 py-3 text-left font-semibold">Tanggal</th>
                  <th className="px-5 py-3 text-left font-semibold">Tipe</th>
                  <th className="px-5 py-3 text-right font-semibold">Sebelum</th>
                  <th className="px-5 py-3 text-right font-semibold">Sesudah</th>
                  <th className="px-5 py-3 text-right font-semibold">Tamu / Biaya</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visits.map((v) => {
                  const isLockerVisit = v.visitType === "locker_blending";
                  return (
                    <tr key={v.id} className="hover:bg-slate-50 transition">
                      <td className="px-5 py-3 text-slate-500 text-xs whitespace-nowrap">
                        {v.createdAt?.slice(0, 16).replace("T", " ")}
                      </td>
                      <td className="px-5 py-3">
                        {isLockerVisit ? (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-purple-50 text-purple-700 font-semibold">
                            Loker · {v.paymentType === "cash" ? "Tunai" : "Kredit"}
                          </span>
                        ) : (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-green-50 text-green-700 font-semibold">
                            Kunjungan
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-right text-slate-600 font-medium">
                        {isLockerVisit ? v.creditsBefore : v.visitsBefore}
                      </td>
                      <td className="px-5 py-3 text-right font-bold text-green-700">
                        {isLockerVisit ? v.creditsAfter : v.visitsAfter}
                      </td>
                      <td className="px-5 py-3 text-right text-slate-500 text-xs">
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

      {/* ── Debts tab ────────────────────────────────────────────────────────── */}
      {tab === "debts" && (
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
            <h3 className="font-semibold text-slate-800">Utang Piutang</h3>
            {activeDebts.length > 0 && (
              <span className="text-xs font-bold text-red-600 bg-red-50 px-3 py-1 rounded-full">
                Sisa: {fmt(activeDebts.reduce((s, d) => s + d.remainingAmount, 0))}
              </span>
            )}
          </div>
          {debts.length === 0 ? (
            <div className="px-5 py-10 text-center">
              <p className="text-2xl mb-2">✅</p>
              <p className="text-sm text-slate-400">Tidak ada utang tercatat.</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 text-xs">
                <tr>
                  <th className="px-5 py-3 text-left font-semibold">Referensi</th>
                  <th className="px-5 py-3 text-right font-semibold">Total</th>
                  <th className="px-5 py-3 text-right font-semibold">Terbayar</th>
                  <th className="px-5 py-3 text-right font-semibold">Sisa</th>
                  <th className="px-5 py-3 text-center font-semibold">Status</th>
                  <th className="px-5 py-3 text-center font-semibold">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {debts.map((d) => (
                  <tr key={d.id} className="hover:bg-slate-50 transition">
                    <td className="px-5 py-3">
                      <p className="font-medium text-slate-800">{d.referenceLabel}</p>
                      <p className="text-xs text-slate-400 mt-0.5">{d.createdAt.slice(0, 10)}</p>
                    </td>
                    <td className="px-5 py-3 text-right font-mono text-slate-600 text-xs">{fmt(d.totalAmount)}</td>
                    <td className="px-5 py-3 text-right font-mono text-green-700 text-xs">{fmt(d.paidAmount)}</td>
                    <td className="px-5 py-3 text-right font-mono font-bold text-red-600 text-xs">
                      {d.status === "paid" ? <span className="text-green-600">—</span> : fmt(d.remainingAmount)}
                    </td>
                    <td className="px-5 py-3 text-center">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${
                        d.status === "paid"     ? "bg-green-50 text-green-700" :
                        d.status === "partial"  ? "bg-amber-50 text-amber-700" :
                                                  "bg-red-50 text-red-600"
                      }`}>
                        {d.status === "paid" ? "Lunas" : d.status === "partial" ? "Sebagian" : "Belum Bayar"}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-center">
                      {d.status !== "paid" && (
                        <button
                          onClick={() => {
                            setDebtPayDialog({ debtId: d.id, remaining: d.remainingAmount, label: d.referenceLabel });
                            setDebtPayAmount(String(d.remainingAmount));
                            setDebtPayMethod("cash");
                            setDebtPayNotes("");
                            setDebtPayError("");
                          }}
                          className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition font-semibold"
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

      {/* Refresh footer */}
      <div className="mt-6 text-center">
        <button onClick={loadAll} className="text-xs text-slate-400 hover:text-blue-600 transition">
          ↻ Refresh data
        </button>
      </div>
    </div>
  );
}
