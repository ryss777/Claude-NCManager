"use client";

import { useEffect, useState, useMemo } from "react";
import { doc, getDoc, getDocs, collection, query, where, limit } from "firebase/firestore";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useOwnerAuthStore } from "@/store/auth.store";
import { callFunction, firebaseDb } from "@/firebase/firebase";
import { v4 as uuidv4 } from "uuid";

// ── Types ────────────────────────────────────────────────────────────────────

interface Customer {
  id: string;
  displayName: string;
  phone: string | null;
  email: string | null;
  notes: string | null;
  activeMembershipId: string | null;
  createdAt: string;
  updatedAt: string;
}

interface Membership {
  id: string;
  planName: string;
  planId: string;
  tier: string;
  status: "active" | "expired" | "cancelled";
  visitQuota: number;
  visitUsed: number;
  visitRemaining: number;
  activatedAt: string;
  expiresAt: string;
}

interface Transaction {
  id: string;
  total: number;
  subtotal: number;
  paymentMethod: string;
  status: string;
  createdAt: string;
  operatorId: string;
  items: { productName: string; quantity: number; subtotal: number }[];
  amountPaid: number;
  change: number;
}

interface Visit {
  id: string;
  membershipId: string;
  createdAt: string;
  visitsBefore: number;
  visitsAfter: number;
}

interface Plan {
  id: string;
  name: string;
  tier: string;
  price: number;
  visitQuota: number;
  durationDays: number;
}

type Tab = "membership" | "transactions" | "visits";

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmt = (n: number) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);

const TIER_STYLE: Record<string, { bg: string; text: string }> = {
  basic:    { bg: "bg-slate-100",  text: "text-slate-600" },
  silver:   { bg: "bg-slate-200",  text: "text-slate-700" },
  gold:     { bg: "bg-yellow-100", text: "text-yellow-800" },
  platinum: { bg: "bg-blue-100",   text: "text-blue-800" },
};

const STATUS_STYLE: Record<string, string> = {
  active:    "bg-green-50 text-green-700",
  expired:   "bg-red-50 text-red-500",
  cancelled: "bg-slate-100 text-slate-500",
  completed: "bg-green-50 text-green-700",
  pending:   "bg-yellow-50 text-yellow-700",
  reversed:  "bg-red-50 text-red-600",
};

const STATUS_LABEL: Record<string, string> = {
  active: "Aktif", expired: "Kadaluarsa", cancelled: "Dibatalkan",
  completed: "Selesai", pending: "Proses", reversed: "Dibatalkan",
};

function daysLeft(iso: string) {
  return Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000));
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function CustomerDetailPage() {
  const { customerId } = useParams<{ customerId: string }>();
  const { ownerId, clubId } = useOwnerAuthStore();

  const [customer, setCustomer]       = useState<Customer | null>(null);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [visits, setVisits]           = useState<Visit[]>([]);
  const [plans, setPlans]             = useState<Plan[]>([]);
  const [loading, setLoading]         = useState(true);
  const [tab, setTab]                 = useState<Tab>("membership");

  // Activate form
  const [selectedPlanId, setSelectedPlanId] = useState("");
  const [activating, setActivating]         = useState(false);
  const [feedback, setFeedback]             = useState<{ type: "ok" | "err"; msg: string } | undefined>();

  const activeMembership = useMemo(
    () => memberships.find((m) => m.status === "active") ?? null,
    [memberships]
  );

  useEffect(() => {
    if (ownerId && clubId && customerId) loadAll();
  }, [ownerId, clubId, customerId]);

  async function loadAll() {
    setLoading(true);
    const db = firebaseDb();
    const base = `owners/${ownerId}/clubs/${clubId}`;

    const [custSnap, memSnap, txSnap, visitSnap, planSnap] = await Promise.all([
      getDoc(doc(db, `${base}/customers/${customerId}`)),
      getDocs(query(collection(db, `${base}/memberships`), where("customerId", "==", customerId), limit(20))),
      getDocs(query(collection(db, `${base}/transactions`), where("customerId", "==", customerId), limit(50))),
      getDocs(query(collection(db, `${base}/membershipVisits`), where("customerId", "==", customerId), limit(50))),
      getDocs(query(collection(db, `${base}/membershipPlans`), where("isActive", "==", true))),
    ]);

    if (!custSnap.exists()) { setLoading(false); return; }
    setCustomer({ id: custSnap.id, ...(custSnap.data() as Omit<Customer, "id">) });

    setMemberships(
      memSnap.docs
        .map((d) => ({ id: d.id, ...(d.data() as Omit<Membership, "id">) }))
        .sort((a, b) => b.activatedAt.localeCompare(a.activatedAt))
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
    setLoading(false);
  }

  async function handleActivate() {
    if (!selectedPlanId) {
      setFeedback({ type: "err", msg: "Pilih paket terlebih dahulu" });
      return;
    }
    setActivating(true);
    setFeedback(undefined);
    try {
      const plan = plans.find((p) => p.id === selectedPlanId)!;
      await callFunction("membership_activate", {
        ownerId, clubId,
        requestId: uuidv4(),
        operationId: uuidv4(),
        customerId,
        planId: selectedPlanId,
        transactionId: uuidv4(),
      });
      setFeedback({ type: "ok", msg: `${plan.name} berhasil diaktifkan` });
      setSelectedPlanId("");
      loadAll();
    } catch (err) {
      setFeedback({ type: "err", msg: err instanceof Error ? err.message : "Gagal" });
    } finally { setActivating(false); }
  }

  if (loading) {
    return (
      <div>
        <Link href="/customers" className="text-sm text-blue-600 hover:underline mb-6 inline-block">
          ← Pelanggan
        </Link>
        <p className="text-slate-400 text-sm mt-4">Memuat data pelanggan…</p>
      </div>
    );
  }

  if (!customer) {
    return (
      <div>
        <Link href="/customers" className="text-sm text-blue-600 hover:underline mb-6 inline-block">
          ← Pelanggan
        </Link>
        <p className="text-slate-500 mt-4">Pelanggan tidak ditemukan.</p>
      </div>
    );
  }

  const TABS: { key: Tab; label: string; count: number }[] = [
    { key: "membership",   label: "Membership",  count: memberships.length },
    { key: "transactions", label: "Transaksi",   count: transactions.length },
    { key: "visits",       label: "Kunjungan",   count: visits.length },
  ];

  return (
    <div>
      {/* Breadcrumb */}
      <Link href="/customers" className="text-sm text-blue-600 hover:underline mb-4 inline-block">
        ← Daftar Pelanggan
      </Link>

      {/* ── Customer header ── */}
      <div className="bg-white rounded-xl border border-slate-200 p-6 mb-6">
        <div className="flex items-start gap-5">
          {/* Avatar */}
          <div className="w-16 h-16 rounded-full bg-blue-600 flex items-center justify-center shrink-0">
            <span className="text-white text-2xl font-bold">
              {customer.displayName.charAt(0).toUpperCase()}
            </span>
          </div>

          <div className="flex-1 min-w-0">
            <h2 className="text-2xl font-bold text-slate-900">{customer.displayName}</h2>
            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1">
              {customer.phone && (
                <span className="text-sm text-slate-500">📞 {customer.phone}</span>
              )}
              {customer.email && (
                <span className="text-sm text-slate-500">✉ {customer.email}</span>
              )}
              <span className="text-sm text-slate-400">
                Member sejak {customer.createdAt?.slice(0, 10)}
              </span>
            </div>
            {customer.notes && (
              <p className="text-sm text-slate-400 mt-1.5 italic">"{customer.notes}"</p>
            )}
            <p className="text-xs text-slate-300 font-mono mt-2 select-all">{customer.id}</p>
          </div>

          {/* Active membership badge */}
          {activeMembership ? (
            <div className={`shrink-0 px-4 py-3 rounded-xl border text-center ${TIER_STYLE[activeMembership.tier]?.bg ?? "bg-slate-100"}`}>
              <p className={`text-xs font-bold uppercase tracking-wide ${TIER_STYLE[activeMembership.tier]?.text ?? "text-slate-600"}`}>
                {activeMembership.tier}
              </p>
              <p className="text-sm font-semibold text-slate-800 mt-0.5">{activeMembership.planName}</p>
              <p className={`text-xs mt-1 font-medium ${daysLeft(activeMembership.expiresAt) <= 7 ? "text-red-600" : "text-slate-500"}`}>
                {activeMembership.visitRemaining}/{activeMembership.visitQuota} kunjungan
              </p>
              <p className="text-xs text-slate-400">s/d {activeMembership.expiresAt.slice(0, 10)}</p>
            </div>
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
          {/* Tabs */}
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
                      <th className="px-4 py-2 text-right">Kunjungan</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {memberships.map((m) => (
                      <tr key={m.id} className="hover:bg-slate-50">
                        <td className="px-4 py-2.5">
                          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${TIER_STYLE[m.tier]?.bg ?? "bg-slate-100"} ${TIER_STYLE[m.tier]?.text ?? "text-slate-600"}`}>
                            {m.tier.toUpperCase()}
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
                          {m.expiresAt?.slice(0, 10)}
                          {m.status === "active" && (
                            <span className={`ml-1 font-medium ${daysLeft(m.expiresAt) <= 7 ? "text-red-600" : "text-slate-400"}`}>
                              ({daysLeft(m.expiresAt)}h)
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-right font-medium text-slate-700">
                          {m.visitUsed} / {m.visitQuota}
                          <span className="text-slate-400 font-normal ml-1">
                            ({m.visitRemaining} sisa)
                          </span>
                        </td>
                      </tr>
                    ))}
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
                      <th className="px-4 py-2 text-right">Sebelum</th>
                      <th className="px-4 py-2 text-right">Sesudah</th>
                      <th className="px-4 py-2 text-left">Membership</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {visits.map((v) => (
                      <tr key={v.id} className="hover:bg-slate-50">
                        <td className="px-4 py-2.5 text-slate-500 text-xs whitespace-nowrap">
                          {v.createdAt?.slice(0, 16).replace("T", " ")}
                        </td>
                        <td className="px-4 py-2.5 text-right text-slate-600 font-medium">{v.visitsBefore}</td>
                        <td className="px-4 py-2.5 text-right font-bold text-green-700">{v.visitsAfter}</td>
                        <td className="px-4 py-2.5 text-slate-400 text-xs font-mono">{v.membershipId?.slice(0, 12)}…</td>
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
          <div className="bg-white rounded-xl border border-slate-200 p-5 sticky top-6">
            <h3 className="font-semibold text-slate-800 mb-4">Aktifkan / Ganti Paket</h3>

            {activeMembership && (
              <div className="bg-green-50 rounded-lg p-3 mb-4 text-xs">
                <p className="font-semibold text-green-800 mb-0.5">Paket aktif: {activeMembership.planName}</p>
                <p className="text-green-700">
                  {activeMembership.visitRemaining} kunjungan · s/d {activeMembership.expiresAt.slice(0, 10)}
                </p>
              </div>
            )}

            {feedback && (
              <div className={`mb-3 text-xs rounded-lg px-3 py-2 ${feedback.type === "ok" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"}`}>
                {feedback.msg}
              </div>
            )}

            <div className="space-y-3">
              {plans.map((p) => {
                const ts = TIER_STYLE[p.tier] ?? TIER_STYLE.basic!;
                const isSelected = selectedPlanId === p.id;
                return (
                  <button
                    key={p.id}
                    onClick={() => setSelectedPlanId(isSelected ? "" : p.id)}
                    className={`w-full text-left rounded-lg border p-3 transition ${
                      isSelected ? "border-blue-500 bg-blue-50" : "border-slate-200 hover:border-slate-300"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${ts.bg} ${ts.text}`}>
                        {p.tier.toUpperCase()}
                      </span>
                      {isSelected && <span className="text-blue-600 text-xs font-bold">✓ Dipilih</span>}
                    </div>
                    <p className="text-sm font-semibold text-slate-800 mt-1.5">{p.name}</p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {fmt(p.price)} · {p.visitQuota}× · {p.durationDays} hari
                    </p>
                  </button>
                );
              })}

              <button
                onClick={handleActivate}
                disabled={activating || !selectedPlanId}
                className="w-full bg-green-600 text-white rounded-lg py-2.5 text-sm font-semibold hover:bg-green-700 disabled:opacity-50 transition"
              >
                {activating ? "Mengaktifkan…" : activeMembership ? "Ganti Paket" : "Aktifkan Membership"}
              </button>
            </div>

            <button onClick={loadAll} className="mt-4 text-xs text-blue-600 hover:underline w-full text-center">
              Refresh data
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
