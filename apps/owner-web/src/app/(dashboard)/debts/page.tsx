"use client";

import { useEffect, useState, useMemo } from "react";
import { collection, getDocs } from "firebase/firestore";
import { v4 as uuidv4 } from "uuid";
import Link from "next/link";
import { useOwnerAuthStore } from "@/store/auth.store";
import { callFunction, firebaseDb } from "@/firebase/firebase";

interface Debt {
  id: string;
  customerId: string;
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

interface Customer {
  id: string;
  displayName: string;
  phone: string | null;
}

const fmt = (n: number) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);

type StatusFilter = "all" | "outstanding" | "partial" | "paid";

export default function DebtsPage() {
  const { ownerId, clubId } = useOwnerAuthStore();

  const [debts, setDebts]         = useState<Debt[]>([]);
  const [customers, setCustomers] = useState<Map<string, Customer>>(new Map());
  const [loading, setLoading]     = useState(true);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  const [payDialog, setPayDialog] = useState<{
    debtId: string; remaining: number; label: string; customerId: string;
  } | null>(null);
  const [payAmount, setPayAmount]   = useState("");
  const [payMethod, setPayMethod]   = useState<"cash" | "transfer">("cash");
  const [payNotes, setPayNotes]     = useState("");
  const [paying, setPaying]         = useState(false);
  const [payError, setPayError]     = useState("");

  async function loadData() {
    if (!ownerId || !clubId) return;
    setLoading(true);
    try {
      const db = firebaseDb();
      const base = `owners/${ownerId}/clubs/${clubId}`;
      const [debtSnap, custSnap] = await Promise.all([
        getDocs(collection(db, `${base}/debts`)),
        getDocs(collection(db, `${base}/customers`)),
      ]);
      setDebts(
        debtSnap.docs
          .map((d) => ({ id: d.id, ...d.data() } as Debt))
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      );
      const custMap = new Map<string, Customer>();
      custSnap.docs.forEach((d) => custMap.set(d.id, { id: d.id, ...d.data() } as Customer));
      setCustomers(custMap);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadData(); }, [ownerId, clubId]);

  const filteredDebts = useMemo(() => {
    if (statusFilter === "all") return debts.filter((d) => d.status !== "paid");
    return debts.filter((d) => d.status === statusFilter);
  }, [debts, statusFilter]);

  const totalOutstanding = useMemo(
    () => debts.filter((d) => d.status !== "paid").reduce((s, d) => s + d.remainingAmount, 0),
    [debts]
  );

  const activeCount = useMemo(
    () => debts.filter((d) => d.status !== "paid").length,
    [debts]
  );

  async function handlePay() {
    if (!payDialog) return;
    const amount = parseFloat(payAmount);
    if (isNaN(amount) || amount <= 0 || amount > payDialog.remaining) return;
    setPaying(true);
    setPayError("");
    try {
      await callFunction("debt_recordPayment", {
        ownerId, clubId,
        requestId: uuidv4(), operationId: uuidv4(),
        debtId: payDialog.debtId,
        amount,
        paymentMethod: payMethod,
        notes: payNotes.trim() || undefined,
      });
      setPayDialog(null);
      setPayAmount("");
      setPayNotes("");
      loadData();
    } catch (err) {
      setPayError(err instanceof Error ? err.message : "Gagal mencatat pembayaran");
    } finally {
      setPaying(false);
    }
  }

  return (
    <div>
      {/* Payment dialog */}
      {payDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm mx-4">
            <h3 className="text-base font-bold text-slate-900 mb-1">Catat Pembayaran Utang</h3>
            <p className="text-sm text-slate-500 mb-1">{payDialog.label}</p>
            <p className="text-sm text-slate-400 mb-4">
              {customers.get(payDialog.customerId)?.displayName ?? ""}
            </p>
            <div className="bg-slate-50 rounded-xl p-3 mb-4 flex justify-between text-sm">
              <span className="text-slate-500">Sisa utang</span>
              <span className="font-bold text-red-600">{fmt(payDialog.remaining)}</span>
            </div>
            {payError && (
              <div className="mb-3 text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{payError}</div>
            )}
            <div className="space-y-3">
              <div>
                <label className="text-xs text-slate-500 block mb-1">Jumlah Bayar</label>
                <input
                  type="number"
                  min="1"
                  max={payDialog.remaining}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
                  value={payAmount}
                  onChange={(e) => setPayAmount(e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs text-slate-500 block mb-1">Metode</label>
                <div className="flex gap-2">
                  {(["cash", "transfer"] as const).map((m) => (
                    <button
                      key={m}
                      onClick={() => setPayMethod(m)}
                      className={`flex-1 py-2 rounded-lg text-sm font-medium border transition ${
                        payMethod === m
                          ? "border-blue-500 bg-blue-50 text-blue-700"
                          : "border-slate-200 text-slate-500"
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
                  value={payNotes}
                  onChange={(e) => setPayNotes(e.target.value)}
                />
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              <button
                onClick={() => { setPayDialog(null); setPayError(""); }}
                className="flex-1 border border-slate-200 text-slate-600 rounded-xl py-2.5 text-sm font-semibold hover:bg-slate-50 transition"
              >
                Batal
              </button>
              <button
                onClick={handlePay}
                disabled={paying || !payAmount || parseFloat(payAmount) <= 0}
                className="flex-1 bg-blue-600 text-white rounded-xl py-2.5 text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition"
              >
                {paying ? "Menyimpan…" : "Simpan"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Utang Piutang</h1>
          <p className="text-sm text-slate-500 mt-0.5">Tagihan dari pembayaran membership parsial</p>
        </div>
        <button onClick={loadData} className="text-xs text-blue-600 hover:underline">
          Refresh
        </button>
      </div>

      {/* Summary */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 mb-6 flex items-center gap-8">
        <div>
          <p className="text-xs text-slate-500 uppercase tracking-wide">Total Belum Lunas</p>
          <p className="text-2xl font-bold text-red-600 mt-0.5">{fmt(totalOutstanding)}</p>
        </div>
        <div className="h-10 w-px bg-slate-200" />
        <div>
          <p className="text-xs text-slate-500 uppercase tracking-wide">Tagihan Aktif</p>
          <p className="text-2xl font-bold text-slate-800 mt-0.5">{activeCount}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-2 mb-4">
        {([
          { key: "all",         label: "Belum Lunas" },
          { key: "outstanding", label: "Belum Bayar" },
          { key: "partial",     label: "Sebagian" },
          { key: "paid",        label: "Lunas" },
        ] as { key: StatusFilter; label: string }[]).map((f) => (
          <button
            key={f.key}
            onClick={() => setStatusFilter(f.key)}
            className={`px-4 py-1.5 rounded-full text-sm font-medium border transition ${
              statusFilter === f.key
                ? "bg-slate-800 text-white border-slate-800"
                : "border-slate-200 text-slate-500 hover:border-slate-400"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Table */}
      {loading ? (
        <p className="text-sm text-slate-400">Memuat…</p>
      ) : filteredDebts.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-8 text-center">
          <p className="text-slate-400">
            {statusFilter === "paid" ? "Tidak ada utang yang sudah lunas." : "Tidak ada utang yang belum lunas."}
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs">
              <tr>
                <th className="px-4 py-2.5 text-left">Pelanggan</th>
                <th className="px-4 py-2.5 text-left">Paket</th>
                <th className="px-4 py-2.5 text-right">Total</th>
                <th className="px-4 py-2.5 text-right">Terbayar</th>
                <th className="px-4 py-2.5 text-right">Sisa</th>
                <th className="px-4 py-2.5 text-center">Status</th>
                <th className="px-4 py-2.5 text-left">Tgl</th>
                <th className="px-4 py-2.5 text-center">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredDebts.map((debt) => {
                const cust = customers.get(debt.customerId);
                return (
                  <tr key={debt.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <Link
                        href={`/customers/${debt.customerId}`}
                        className="font-medium text-slate-800 hover:text-blue-600 transition"
                      >
                        {cust?.displayName ?? debt.customerId.slice(0, 8)}
                      </Link>
                      {cust?.phone && <p className="text-xs text-slate-400">{cust.phone}</p>}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{debt.referenceLabel}</td>
                    <td className="px-4 py-3 text-right font-mono text-slate-700 text-xs">{fmt(debt.totalAmount)}</td>
                    <td className="px-4 py-3 text-right font-mono text-green-700 text-xs">{fmt(debt.paidAmount)}</td>
                    <td className="px-4 py-3 text-right font-mono font-bold text-red-600">{fmt(debt.remainingAmount)}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        debt.status === "paid"    ? "bg-green-50 text-green-700" :
                        debt.status === "partial" ? "bg-amber-50 text-amber-700" :
                        "bg-red-50 text-red-600"
                      }`}>
                        {debt.status === "paid" ? "Lunas" : debt.status === "partial" ? "Sebagian" : "Belum Bayar"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-400 text-xs">{debt.createdAt.slice(0, 10)}</td>
                    <td className="px-4 py-3 text-center">
                      {debt.status !== "paid" && (
                        <button
                          onClick={() => {
                            setPayDialog({
                              debtId: debt.id,
                              remaining: debt.remainingAmount,
                              label: debt.referenceLabel,
                              customerId: debt.customerId,
                            });
                            setPayAmount(String(debt.remainingAmount));
                            setPayMethod("cash");
                            setPayNotes("");
                            setPayError("");
                          }}
                          className="px-3 py-1 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition font-medium"
                        >
                          Bayar
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
