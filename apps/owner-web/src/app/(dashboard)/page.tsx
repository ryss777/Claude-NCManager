"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { collection, getDocs, query, where, orderBy, limit } from "firebase/firestore";
import { useOwnerAuthStore } from "@/store/auth.store";
import { firebaseDb } from "@/firebase/firebase";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Stats {
  customers: number;
  activeMemberships: number;
  expiringSoon: number;
  operators: number;
  plans: number;
  items: number;
  lowStock: number;
  activeDebts: number;
}

interface RecentTx {
  id: string;
  items: { productName: string; quantity: number }[];
  total: number;
  status: string;
  createdAt: string;
  createdBy: string;
}

interface LowStockItem {
  id: string;
  name: string;
  currentStock: number;
  minimumStock: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmt = (n: number) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);

function todayLabel() {
  return new Date().toLocaleDateString("id-ID", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  });
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function DashboardHome() {
  const { displayName, ownerId, clubId } = useOwnerAuthStore();
  const [stats, setStats]             = useState<Stats | null>(null);
  const [recentTx, setRecentTx]       = useState<RecentTx[]>([]);
  const [lowItems, setLowItems]       = useState<LowStockItem[]>([]);
  const [loading, setLoading]         = useState(true);

  useEffect(() => {
    if (ownerId && clubId) loadAll();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownerId, clubId]);

  async function loadAll() {
    setLoading(true);
    try {
      const db   = firebaseDb();
      const base = `owners/${ownerId}/clubs/${clubId}`;

      const soonIso = new Date(Date.now() + 7 * 86_400_000).toISOString();

      const [ops, plans, items, customers, memberships, debts, txSnap] = await Promise.all([
        getDocs(query(collection(db, `${base}/operators`), where("isActive", "==", true))),
        getDocs(query(collection(db, `${base}/membershipPlans`), where("isActive", "==", true))),
        getDocs(collection(db, `${base}/inventoryItems`)),
        getDocs(collection(db, `${base}/customers`)),
        getDocs(query(collection(db, `${base}/memberships`), where("status", "==", "active"))),
        getDocs(query(collection(db, `${base}/debts`), where("status", "in", ["unpaid", "partial"]))),
        getDocs(query(collection(db, `${base}/transactions`), orderBy("createdAt", "desc"), limit(6))),
      ]);

      const low = items.docs.filter((d) => {
        const data = d.data();
        return (data["minimumStock"] ?? 0) > 0 && (data["currentStock"] ?? 0) <= (data["minimumStock"] ?? 0);
      });

      const expiring = memberships.docs.filter((d) => {
        const exp = d.data()["expiresAt"] as string | null;
        return exp && exp <= soonIso;
      }).length;

      setStats({
        customers: customers.size,
        activeMemberships: memberships.size,
        expiringSoon: expiring,
        operators: ops.size,
        plans: plans.size,
        items: items.size,
        lowStock: low.length,
        activeDebts: debts.size,
      });

      setLowItems(low.slice(0, 5).map((d) => ({
        id: d.id,
        name: d.data()["name"] as string,
        currentStock: d.data()["currentStock"] as number,
        minimumStock: d.data()["minimumStock"] as number,
      })));

      setRecentTx(txSnap.docs.map((d) => ({
        id: d.id,
        items: (d.data()["items"] ?? []) as { productName: string; quantity: number }[],
        total: d.data()["total"] as number,
        status: d.data()["status"] as string,
        createdAt: d.data()["createdAt"] as string,
        createdBy: d.data()["createdBy"] as string,
      })));
    } finally {
      setLoading(false);
    }
  }

  const fname = displayName?.split(" ")[0] ?? "Owner";

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-5xl space-y-7">

      {/* ── Greeting header ───────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Halo, {fname} 👋</h2>
          <p className="text-sm text-slate-400 mt-0.5">{todayLabel()}</p>
        </div>
        <Link
          href="/pos"
          className="flex items-center gap-2 bg-slate-900 text-white px-4 py-2.5 rounded-xl text-sm font-semibold hover:bg-slate-700 transition"
        >
          🖥️ Buka Kasir
        </Link>
      </div>

      {/* ── KPI strip ────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">

        {/* Member aktif */}
        <Link href="/customers"
          className="bg-green-50 rounded-2xl p-4 hover:bg-green-100 transition group"
        >
          <p className="text-xs font-semibold text-green-600 mb-2">Member Aktif</p>
          <p className="text-3xl font-bold text-green-700 leading-none">
            {loading ? <span className="text-slate-300">…</span> : (stats?.activeMemberships ?? 0)}
          </p>
          <p className="text-xs text-green-500 mt-1.5">
            dari {loading ? "…" : (stats?.customers ?? 0)} pelanggan
          </p>
        </Link>

        {/* Akan expired */}
        {(() => {
          const n = stats?.expiringSoon ?? 0;
          const hot = n > 0;
          return (
            <Link href="/customers"
              className={`rounded-2xl p-4 transition ${hot ? "bg-amber-50 hover:bg-amber-100" : "bg-slate-50 hover:bg-slate-100"}`}
            >
              <p className={`text-xs font-semibold mb-2 ${hot ? "text-amber-600" : "text-slate-400"}`}>Akan Expired</p>
              <p className={`text-3xl font-bold leading-none ${hot ? "text-amber-600" : "text-slate-300"}`}>
                {loading ? <span className="text-slate-300">…</span> : n}
              </p>
              <p className={`text-xs mt-1.5 ${hot ? "text-amber-500" : "text-slate-400"}`}>
                dalam 7 hari ke depan
              </p>
            </Link>
          );
        })()}

        {/* Utang aktif */}
        {(() => {
          const n = stats?.activeDebts ?? 0;
          const hot = n > 0;
          return (
            <Link href="/debts"
              className={`rounded-2xl p-4 transition ${hot ? "bg-red-50 hover:bg-red-100" : "bg-slate-50 hover:bg-slate-100"}`}
            >
              <p className={`text-xs font-semibold mb-2 ${hot ? "text-red-500" : "text-slate-400"}`}>Utang Aktif</p>
              <p className={`text-3xl font-bold leading-none ${hot ? "text-red-600" : "text-slate-300"}`}>
                {loading ? <span className="text-slate-300">…</span> : n}
              </p>
              <p className={`text-xs mt-1.5 ${hot ? "text-red-400" : "text-slate-400"}`}>
                tagihan belum lunas
              </p>
            </Link>
          );
        })()}

        {/* Stok menipis */}
        {(() => {
          const n = stats?.lowStock ?? 0;
          const hot = n > 0;
          return (
            <Link href="/inventory"
              className={`rounded-2xl p-4 transition ${hot ? "bg-orange-50 hover:bg-orange-100" : "bg-slate-50 hover:bg-slate-100"}`}
            >
              <p className={`text-xs font-semibold mb-2 ${hot ? "text-orange-500" : "text-slate-400"}`}>Stok Menipis</p>
              <p className={`text-3xl font-bold leading-none ${hot ? "text-orange-600" : "text-slate-300"}`}>
                {loading ? <span className="text-slate-300">…</span> : n}
              </p>
              <p className={`text-xs mt-1.5 ${hot ? "text-orange-400" : "text-slate-400"}`}>
                item di bawah minimum
              </p>
            </Link>
          );
        })()}
      </div>

      {/* ── Main content ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">

        {/* Left: Quick actions (3 cols) */}
        <div className="lg:col-span-3 space-y-3">
          <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Akses Cepat</p>

          {/* Primary actions */}
          <div className="grid grid-cols-2 gap-3">
            {([
              { href: "/customers", icon: "🧑‍🤝‍🧑", label: "Pelanggan",  desc: "Daftar & kelola membership",  cls: "bg-blue-600 text-white hover:bg-blue-700" },
              { href: "/transfer",  icon: "↔️",  label: "Transfer Produk", desc: "Kirim dari gudang ke club", cls: "bg-teal-600 text-white hover:bg-teal-700" },
            ] as const).map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`flex flex-col gap-1.5 rounded-2xl p-5 transition ${item.cls}`}
              >
                <span className="text-2xl">{item.icon}</span>
                <span className="font-bold text-sm leading-tight">{item.label}</span>
                <span className="text-xs opacity-75">{item.desc}</span>
              </Link>
            ))}
          </div>

          {/* Secondary actions */}
          <div className="grid grid-cols-3 gap-3">
            {([
              { href: "/membership",   icon: "⭐", label: "Paket Member",  desc: "Kelola paket" },
              { href: "/inventory",    icon: "📦", label: "Produk & Stok", desc: "Stok & harga jual" },
              { href: "/transactions", icon: "🧾", label: "Transaksi",     desc: "Riwayat penjualan" },
              { href: "/debts",        icon: "💰", label: "Utang Piutang", desc: "Kelola tagihan" },
              { href: "/finance",      icon: "📈", label: "Keuangan",      desc: "Jurnal & shift" },
              { href: "/reports",      icon: "📊", label: "Laporan",       desc: "Grafik performa" },
            ] as const).map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="flex flex-col gap-0.5 rounded-2xl border border-slate-200 bg-white p-4 hover:border-slate-300 hover:shadow-sm transition"
              >
                <span className="text-xl mb-0.5">{item.icon}</span>
                <span className="font-semibold text-sm text-slate-800">{item.label}</span>
                <span className="text-xs text-slate-400">{item.desc}</span>
              </Link>
            ))}
          </div>

          {/* Management chips */}
          <div className="flex gap-2 flex-wrap">
            {([
              { href: "/operators", icon: "👤", label: "Operator" },
              { href: "/devices",   icon: "📱", label: "Device" },
              { href: "/club",      icon: "🏋️", label: "Manajemen Club" },
              { href: "/settings",  icon: "⚙️", label: "Pengaturan" },
            ] as const).map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 text-slate-600 text-xs font-medium hover:bg-slate-200 transition"
              >
                <span>{item.icon}</span>
                {item.label}
              </Link>
            ))}
          </div>
        </div>

        {/* Right: Recent activity (2 cols) */}
        <div className="lg:col-span-2 space-y-4">

          {/* Recent transactions */}
          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
              <h3 className="text-sm font-bold text-slate-700">Transaksi Terbaru</h3>
              <Link href="/transactions" className="text-xs text-blue-600 hover:underline font-medium">
                Semua →
              </Link>
            </div>
            {loading ? (
              <div className="px-4 py-8 text-center">
                <div className="w-6 h-6 border-2 border-slate-200 border-t-blue-500 rounded-full animate-spin mx-auto" />
              </div>
            ) : recentTx.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <p className="text-2xl mb-1.5">🧾</p>
                <p className="text-sm text-slate-400">Belum ada transaksi</p>
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {recentTx.map((tx) => {
                  const txItems = tx.items ?? [];
                  const label = txItems.length === 0
                    ? "—"
                    : txItems.length === 1
                      ? `${txItems[0]!.productName} ×${txItems[0]!.quantity}`
                      : `${txItems[0]!.productName} +${txItems.length - 1} lainnya`;
                  const reversed = tx.status === "reversed";
                  return (
                    <div key={tx.id} className="flex items-center gap-3 px-4 py-3">
                      <div className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs shrink-0 ${
                        reversed ? "bg-red-100 text-red-500" :
                        tx.createdBy === "owner" ? "bg-slate-100 text-slate-500" :
                        "bg-blue-50 text-blue-500"
                      }`}>
                        {reversed ? "↩" : tx.createdBy === "owner" ? "👤" : "🖥️"}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-slate-800 truncate">{label}</p>
                        <p className="text-xs text-slate-400">{tx.createdAt?.slice(0, 16).replace("T", " ")}</p>
                      </div>
                      <p className={`text-xs font-bold shrink-0 ${reversed ? "text-slate-300 line-through" : "text-slate-800"}`}>
                        {fmt(tx.total)}
                      </p>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Low stock alert */}
          {!loading && (stats?.lowStock ?? 0) > 0 && (
            <div className="bg-orange-50 rounded-2xl border border-orange-200 overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-orange-100">
                <h3 className="text-sm font-bold text-orange-700">⚠️ Stok Menipis</h3>
                <Link href="/inventory" className="text-xs text-orange-600 hover:underline font-medium">
                  Kelola →
                </Link>
              </div>
              <div className="divide-y divide-orange-100">
                {lowItems.map((item) => (
                  <div key={item.id} className="flex items-center justify-between px-4 py-2.5">
                    <p className="text-xs font-medium text-slate-800 truncate">{item.name}</p>
                    <span className="text-xs font-bold text-orange-600 ml-3 shrink-0">
                      {item.currentStock} / {item.minimumStock} min
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Mini stats */}
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: "Pelanggan",  value: stats?.customers,  color: "text-slate-700" },
              { label: "Paket Aktif", value: stats?.plans,     color: "text-purple-600" },
              { label: "Operator",   value: stats?.operators,  color: "text-violet-600" },
            ].map((s) => (
              <div key={s.label} className="bg-white rounded-xl border border-slate-200 p-3 text-center">
                <p className={`text-xl font-bold ${s.color}`}>
                  {loading ? <span className="text-slate-300">…</span> : (s.value ?? 0)}
                </p>
                <p className="text-xs text-slate-400 mt-0.5">{s.label}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
