"use client";

import { useEffect, useState, useCallback } from "react";
import { collection, getDocs, orderBy, query } from "firebase/firestore";
import { v4 as uuidv4 } from "uuid";
import { useOwnerAuthStore } from "@/store/auth.store";
import { callFunction, firebaseDb } from "@/firebase/firebase";
import Link from "next/link";

// ── Types ─────────────────────────────────────────────────────────────────────

interface TxItem {
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  subtotal: number;
}

interface ProductTx {
  kind: "product";
  id: string;
  createdAt: string;
  customerId: string | null;
  items: TxItem[];
  total: number;
  amountPaid: number;
  change: number;
  paymentMethod: string;
  status: string;
  notes: string | null;
  debtId: string | null;
  operatorId: string | null;
  createdBy: string | null;
}

interface MembershipTx {
  kind: "membership";
  id: string;
  createdAt: string;
  customerId: string;
  planName: string;
  planType: string;
  tier: string;
  visitQuota: number;
  hasExpiry: boolean;
  durationDays: number | null;
  expiresAt: string | null;
  activatedAt: string | null;
  status: string;
  debtId: string | null;
  createdBy: string | null;
  operatorId: string | null;
}

type HistoryItem = ProductTx | MembershipTx;

const fmtIdr = (n: number) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleString("id-ID", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });

const fmtDateShort = (iso: string) =>
  new Date(iso).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });

// ── Component ─────────────────────────────────────────────────────────────────

export default function TransactionsPage() {
  const { ownerId, clubId } = useOwnerAuthStore();

  const [items, setItems] = useState<HistoryItem[]>([]);
  const [customers, setCustomers] = useState<Record<string, string>>({});
  const [operators, setOperators] = useState<Record<string, string>>({});
  const [debtRemaining, setDebtRemaining] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<HistoryItem | null>(null);
  const [typeFilter, setTypeFilter] = useState<"all" | "product" | "membership">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  // Reversal
  const [reverseDialog, setReverseDialog] = useState<{ transactionId: string; total: number } | null>(null);
  const [reverseReason, setReverseReason] = useState("");
  const [reversing, setReversing] = useState(false);
  const [reverseError, setReverseError] = useState("");

  const loadData = useCallback(async () => {
    if (!ownerId || !clubId) return;
    setLoading(true);
    try {
      const db = firebaseDb();
      const base = `owners/${ownerId}/clubs/${clubId}`;

      const [txSnap, memSnap, custSnap, debtSnap, opSnap] = await Promise.all([
        getDocs(query(collection(db, `${base}/transactions`), orderBy("createdAt", "desc"))),
        getDocs(query(collection(db, `${base}/memberships`), orderBy("createdAt", "desc"))),
        getDocs(collection(db, `${base}/customers`)),
        getDocs(collection(db, `${base}/debts`)),
        getDocs(collection(db, `${base}/operators`)),
      ]);

      const custMap: Record<string, string> = {};
      custSnap.docs.forEach((d) => {
        custMap[d.id] = (d.data()["displayName"] as string) ?? d.id;
      });
      setCustomers(custMap);

      const opMap: Record<string, string> = {};
      opSnap.docs.forEach((d) => {
        opMap[d.id] = (d.data()["displayName"] as string) ?? d.id;
      });
      setOperators(opMap);

      const debtMap: Record<string, number> = {};
      debtSnap.docs.forEach((d) => {
        debtMap[d.id] = (d.data()["remainingAmount"] as number) ?? 0;
      });
      setDebtRemaining(debtMap);

      const txItems: ProductTx[] = txSnap.docs
        .map((d) => ({ kind: "product" as const, id: d.id, ...d.data() } as ProductTx))
        .filter((t) => t.status !== "reversed");

      const memItems: MembershipTx[] = memSnap.docs
        .map((d) => ({ kind: "membership" as const, id: d.id, ...d.data() } as MembershipTx));

      const merged: HistoryItem[] = [...txItems, ...memItems].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );

      setItems(merged);
    } finally {
      setLoading(false);
    }
  }, [ownerId, clubId]);

  useEffect(() => { loadData(); }, [loadData]);

  const filtered = items.filter((item) => {
    // type filter
    if (typeFilter !== "all" && item.kind !== typeFilter) return false;

    // customer name search
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      const name = item.customerId ? (customers[item.customerId] ?? "").toLowerCase() : "";
      const extra = item.kind === "product"
        ? item.items?.map((i) => i.productName.toLowerCase()).join(" ") ?? ""
        : item.planName?.toLowerCase() ?? "";
      if (!name.includes(q) && !extra.includes(q)) return false;
    }

    // date range
    const ts = new Date(item.createdAt).getTime();
    if (dateFrom) {
      if (ts < new Date(dateFrom).getTime()) return false;
    }
    if (dateTo) {
      const end = new Date(dateTo);
      end.setHours(23, 59, 59, 999);
      if (ts > end.getTime()) return false;
    }

    return true;
  });

  async function handleReverse() {
    if (!reverseDialog || !ownerId || !clubId) return;
    if (reverseReason.trim().length < 10) {
      setReverseError("Alasan minimal 10 karakter");
      return;
    }
    setReversing(true);
    setReverseError("");
    try {
      await callFunction("pos_reverseTransaction", {
        ownerId, clubId,
        requestId: uuidv4(), operationId: uuidv4(),
        transactionId: reverseDialog.transactionId,
        reason: reverseReason.trim(),
      });
      setReverseDialog(null);
      setReverseReason("");
      setSelected(null);
      loadData();
    } catch (err) {
      setReverseError(err instanceof Error ? err.message : "Gagal membatalkan transaksi");
    } finally {
      setReversing(false);
    }
  }

  const hasActiveFilter = searchQuery.trim() !== "" || dateFrom !== "" || dateTo !== "";
  function clearFilters() {
    setSearchQuery("");
    setDateFrom("");
    setDateTo("");
  }

  function creatorBadge(createdBy: string | null, operatorId: string | null) {
    if (createdBy === "owner" || (!createdBy && !operatorId)) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-violet-100 text-violet-700">
          👑 Owner
        </span>
      );
    }
    const name = operatorId ? (operators[operatorId] ?? "Operator") : "Operator";
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-orange-100 text-orange-700">
        🧑‍💼 {name}
      </span>
    );
  }

  return (
    <div className="flex gap-6 h-full min-h-0">

      {/* ── Reversal dialog ── */}
      {reverseDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm mx-4">
            <div className="flex items-start gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center shrink-0">
                <span className="text-lg">⚠️</span>
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">Batalkan Transaksi</h3>
                <p className="text-sm text-slate-500 mt-0.5">
                  {fmtIdr(reverseDialog.total)} akan dikembalikan ke stok.
                </p>
              </div>
            </div>
            {reverseError && (
              <div className="mb-3 text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{reverseError}</div>
            )}
            <div className="mb-4">
              <label className="text-xs text-slate-500 block mb-1">Alasan pembatalan (min 10 karakter)</label>
              <textarea
                rows={3}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm resize-none"
                placeholder="Contoh: Pelanggan salah pesan, produk dikembalikan..."
                value={reverseReason}
                onChange={(e) => setReverseReason(e.target.value)}
              />
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => { setReverseDialog(null); setReverseReason(""); setReverseError(""); }}
                className="flex-1 border border-slate-200 text-slate-600 rounded-xl py-2.5 text-sm font-semibold hover:bg-slate-50 transition"
              >
                Batal
              </button>
              <button
                onClick={handleReverse}
                disabled={reversing}
                className="flex-1 bg-red-600 text-white rounded-xl py-2.5 text-sm font-semibold hover:bg-red-700 disabled:opacity-50 transition"
              >
                {reversing ? "Memproses…" : "Ya, Batalkan"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── List ── */}
      <div className="flex-1 min-w-0 flex flex-col gap-4">

        {/* Header */}
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-slate-900">Riwayat Transaksi</h1>
          {loading && <span className="text-xs text-slate-400">Memuat…</span>}
        </div>

        {/* Filter */}
        <div className="flex flex-wrap gap-2 items-center">
          {([
            { key: "all",        label: "Semua" },
            { key: "product",    label: "Penjualan Produk" },
            { key: "membership", label: "Membership" },
          ] as { key: typeof typeFilter; label: string }[]).map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setTypeFilter(key)}
              className={`px-4 py-1.5 rounded-full text-sm font-medium border transition ${
                typeFilter === key
                  ? "bg-slate-800 text-white border-slate-800"
                  : "border-slate-200 text-slate-500 hover:border-slate-400"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Search & date range */}
        <div className="flex flex-wrap gap-3 items-center">
          {/* Customer name search */}
          <div className="relative flex-1 min-w-52">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm pointer-events-none">🔍</span>
            <input
              type="text"
              placeholder="Cari nama pelanggan atau produk…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-lg bg-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          {/* Date from */}
          <div className="flex items-center gap-1.5">
            <label className="text-xs text-slate-400 whitespace-nowrap">Dari</label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          {/* Date to */}
          <div className="flex items-center gap-1.5">
            <label className="text-xs text-slate-400 whitespace-nowrap">Sampai</label>
            <input
              type="date"
              value={dateTo}
              min={dateFrom || undefined}
              onChange={(e) => setDateTo(e.target.value)}
              className="text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          {/* Clear filters */}
          {hasActiveFilter && (
            <button
              onClick={clearFilters}
              className="text-xs text-slate-400 hover:text-slate-700 transition flex items-center gap-1"
            >
              ✕ Reset
            </button>
          )}

          {/* Result count */}
          <span className="text-xs text-slate-400 ml-auto whitespace-nowrap">
            {filtered.length} transaksi
          </span>
        </div>

        {/* Table */}
        {filtered.length === 0 && !loading ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-2 text-slate-400 text-sm py-16">
            {hasActiveFilter || typeFilter !== "all" ? (
              <>
                <span className="text-2xl">🔍</span>
                <p>Tidak ada transaksi yang cocok.</p>
                <button onClick={() => { clearFilters(); setTypeFilter("all"); }} className="text-blue-500 hover:underline text-xs">
                  Reset semua filter
                </button>
              </>
            ) : (
              <p>Belum ada transaksi.</p>
            )}
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
                <tr>
                  <th className="px-4 py-3 text-left">Waktu</th>
                  <th className="px-4 py-3 text-left">Jenis</th>
                  <th className="px-4 py-3 text-left">Dibuat oleh</th>
                  <th className="px-4 py-3 text-left">Pelanggan</th>
                  <th className="px-4 py-3 text-left">Ringkasan</th>
                  <th className="px-4 py-3 text-right">Jumlah</th>
                  <th className="px-4 py-3 text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((item) => {
                  const customerName = item.customerId ? (customers[item.customerId] ?? item.customerId) : "—";
                  const isSelected = selected?.id === item.id;

                  if (item.kind === "product") {
                    const summary = item.items?.length === 1
                      ? item.items[0]!.productName
                      : `${item.items?.length ?? 0} produk`;
                    return (
                      <tr
                        key={item.id}
                        onClick={() => setSelected(isSelected ? null : item)}
                        className={`cursor-pointer transition ${isSelected ? "bg-blue-50" : "hover:bg-slate-50"}`}
                      >
                        <td className="px-4 py-3 text-slate-500 whitespace-nowrap text-xs">{fmtDate(item.createdAt)}</td>
                        <td className="px-4 py-3">
                          <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-green-100 text-green-700">Produk</span>
                        </td>
                        <td className="px-4 py-3">{creatorBadge(item.createdBy, item.operatorId)}</td>
                        <td className="px-4 py-3 font-medium text-slate-800">{customerName}</td>
                        <td className="px-4 py-3 text-slate-500 truncate max-w-xs">{summary}</td>
                        <td className="px-4 py-3 text-right font-semibold text-slate-800">{fmtIdr(item.total)}</td>
                        <td className="px-4 py-3 text-center">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                            item.status === "completed" ? "bg-green-100 text-green-700" :
                            item.status === "pending"   ? "bg-amber-100 text-amber-700" :
                            "bg-slate-100 text-slate-600"
                          }`}>{item.status}</span>
                        </td>
                      </tr>
                    );
                  }

                  // membership
                  return (
                    <tr
                      key={item.id}
                      onClick={() => setSelected(isSelected ? null : item)}
                      className={`cursor-pointer transition ${isSelected ? "bg-blue-50" : "hover:bg-slate-50"}`}
                    >
                      <td className="px-4 py-3 text-slate-500 whitespace-nowrap text-xs">{fmtDate(item.createdAt)}</td>
                      <td className="px-4 py-3">
                        <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-100 text-blue-700">Membership</span>
                      </td>
                      <td className="px-4 py-3">{creatorBadge(item.createdBy ?? null, item.operatorId ?? null)}</td>
                      <td className="px-4 py-3 font-medium text-slate-800">{customerName}</td>
                      <td className="px-4 py-3 text-slate-500 truncate max-w-xs">{item.planName}</td>
                      <td className="px-4 py-3 text-right text-slate-400 text-xs">—</td>
                      <td className="px-4 py-3 text-center">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                          item.status === "active"       ? "bg-green-100 text-green-700" :
                          item.status === "expired"      ? "bg-slate-100 text-slate-500" :
                          item.status === "pending_next" ? "bg-amber-100 text-amber-700" :
                          "bg-slate-100 text-slate-600"
                        }`}>{item.status === "pending_next" ? "antrian" : item.status}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Detail panel ── */}
      {selected && (
        <div className="w-80 shrink-0 flex flex-col gap-3">
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">

            {/* Header */}
            <div className={`px-4 py-3 flex items-center justify-between ${
              selected.kind === "product" ? "bg-green-600" : "bg-blue-600"
            }`}>
              <div>
                <p className="text-sm font-bold text-white">
                  {selected.kind === "product" ? "Penjualan Produk" : "Aktivasi Membership"}
                </p>
                <p className="text-xs text-white/70 mt-0.5">{fmtDate(selected.createdAt)}</p>
              </div>
              <button onClick={() => setSelected(null)} className="text-white/60 hover:text-white text-xl leading-none">×</button>
            </div>

            <div className="p-4 space-y-4 text-sm">

              {/* Customer */}
              <div>
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">Pelanggan</p>
                {selected.customerId ? (
                  <Link
                    href={`/customers/${selected.customerId}`}
                    className="font-semibold text-blue-600 hover:underline"
                  >
                    {customers[selected.customerId] ?? selected.customerId}
                  </Link>
                ) : (
                  <p className="text-slate-500">Walk-in (tanpa akun)</p>
                )}
              </div>

              {/* Creator */}
              <div>
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">Dibuat oleh</p>
                {selected.kind === "product"
                  ? creatorBadge(selected.createdBy, selected.operatorId)
                  : creatorBadge(selected.createdBy ?? null, selected.operatorId ?? null)}
              </div>

              {/* Product detail */}
              {selected.kind === "product" && (
                <>
                  <div>
                    <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Item</p>
                    <div className="space-y-1.5">
                      {selected.items?.map((item, i) => (
                        <div key={i} className="flex justify-between text-slate-700">
                          <span className="flex-1 mr-2">{item.quantity}× {item.productName}</span>
                          <span className="font-medium shrink-0">{fmtIdr(item.subtotal)}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="border-t border-slate-100 pt-3 space-y-1.5">
                    <div className="flex justify-between font-bold text-slate-800">
                      <span>Total</span>
                      <span>{fmtIdr(selected.total)}</span>
                    </div>
                    <div className="flex justify-between text-slate-500">
                      <span>Dibayar</span>
                      <span>{fmtIdr(selected.amountPaid)}</span>
                    </div>
                    {selected.debtId && (debtRemaining[selected.debtId] ?? 0) > 0 ? (
                      <div className="flex justify-between text-amber-600 font-semibold">
                        <span>Utang</span>
                        <span>{fmtIdr(debtRemaining[selected.debtId] ?? 0)}</span>
                      </div>
                    ) : (
                      <div className="flex justify-between text-slate-500">
                        <span>Kembalian</span>
                        <span>{fmtIdr(selected.change)}</span>
                      </div>
                    )}
                    <div className="flex justify-between text-slate-500">
                      <span>Metode</span>
                      <span className="capitalize">{selected.paymentMethod === "cash" ? "Tunai" : "Transfer"}</span>
                    </div>
                  </div>

                  {selected.notes && (
                    <div className="bg-slate-50 rounded-lg px-3 py-2 text-slate-600 text-xs">
                      {selected.notes}
                    </div>
                  )}
                </>
              )}

              {/* Membership detail */}
              {selected.kind === "membership" && (
                <div className="space-y-1.5">
                  <div className="flex justify-between text-slate-700">
                    <span className="text-slate-400">Paket</span>
                    <span className="font-semibold">{selected.planName}</span>
                  </div>
                  <div className="flex justify-between text-slate-700">
                    <span className="text-slate-400">Tier</span>
                    <span className="capitalize">{selected.tier}</span>
                  </div>
                  {selected.planType !== "locker" && (
                    <>
                      <div className="flex justify-between text-slate-700">
                        <span className="text-slate-400">Kuota</span>
                        <span>{selected.visitQuota}× kunjungan</span>
                      </div>
                      <div className="flex justify-between text-slate-700">
                        <span className="text-slate-400">Durasi</span>
                        <span>
                          {selected.hasExpiry && selected.durationDays
                            ? `${selected.durationDays} hari`
                            : "Tidak ada expired"}
                        </span>
                      </div>
                      {selected.expiresAt && (
                        <div className="flex justify-between text-slate-700">
                          <span className="text-slate-400">Kadaluarsa</span>
                          <span>{fmtDateShort(selected.expiresAt)}</span>
                        </div>
                      )}
                    </>
                  )}
                  <div className="flex justify-between text-slate-700">
                    <span className="text-slate-400">Status</span>
                    <span className={`font-semibold ${
                      selected.status === "active" ? "text-green-600" :
                      selected.status === "expired" ? "text-slate-400" :
                      "text-amber-600"
                    }`}>
                      {selected.status === "pending_next" ? "Antrian" : selected.status}
                    </span>
                  </div>
                  {selected.debtId && (debtRemaining[selected.debtId] ?? 0) > 0 && (
                    <div className="mt-2 px-3 py-2 bg-amber-50 rounded-lg text-amber-700 text-xs font-medium">
                      Ada utang — cek tab Utang di profil pelanggan
                    </div>
                  )}
                </div>
              )}

              {/* Reversal button — product tx only */}
              {selected.kind === "product" && selected.status === "completed" && (
                <div className="border-t border-slate-100 pt-3">
                  <button
                    onClick={() => setReverseDialog({ transactionId: selected.id, total: selected.total })}
                    className="w-full border border-red-200 text-red-600 rounded-lg py-2 text-xs font-semibold hover:bg-red-50 transition"
                  >
                    Batalkan Transaksi
                  </button>
                </div>
              )}

              {/* Ref */}
              <p className="text-xs text-slate-300 font-mono pt-1">
                #{selected.id.slice(0, 12).toUpperCase()}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
