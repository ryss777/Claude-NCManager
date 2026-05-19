"use client";

import { useEffect, useState } from "react";
import { collection, getDocs, query, where, orderBy, limit } from "firebase/firestore";
import { useOwnerAuthStore } from "@/store/auth.store";
import { firebaseDb } from "@/firebase/firebase";

interface DayStat {
  date: string; // YYYY-MM-DD
  visits: number;
  revenue: number;
}

interface TierStat {
  tier: string;
  count: number;
}

interface RecentTransaction {
  id: string;
  total: number;
  paymentMethod: string;
  status: string;
  createdAt: string;
  items: { name: string; qty: number }[];
}

function startOfDay(date: Date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function dateKey(isoString: string) {
  return isoString.slice(0, 10);
}

function last7Days(): string[] {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    return d.toISOString().slice(0, 10);
  });
}

export default function ReportsPage() {
  const { ownerId, clubId } = useOwnerAuthStore();
  const [loading, setLoading] = useState(true);

  const [todayRevenue, setTodayRevenue] = useState(0);
  const [todayVisits, setTodayVisits] = useState(0);
  const [activeMembers, setActiveMembers] = useState(0);
  const [todayTx, setTodayTx] = useState(0);

  const [dayStats, setDayStats] = useState<DayStat[]>([]);
  const [tierStats, setTierStats] = useState<TierStat[]>([]);
  const [recentTx, setRecentTx] = useState<RecentTransaction[]>([]);

  useEffect(() => {
    if (!ownerId || !clubId) return;
    loadAll();
  }, [ownerId, clubId]);

  async function loadAll() {
    setLoading(true);
    const db = firebaseDb();
    const base = `owners/${ownerId}/clubs/${clubId}`;
    const days = last7Days();
    const weekStart = days[0] + "T00:00:00.000Z";
    const todayStart = startOfDay(new Date());

    const [journalSnap, visitsSnap, membershipsSnap, txSnap] = await Promise.all([
      getDocs(query(collection(db, `${base}/financeJournal`), where("createdAt", ">=", weekStart))),
      getDocs(query(collection(db, `${base}/membershipVisits`), where("createdAt", ">=", weekStart))),
      getDocs(query(collection(db, `${base}/memberships`), where("status", "==", "active"))),
      getDocs(query(collection(db, `${base}/transactions`), orderBy("createdAt", "desc"), limit(10))),
    ]);

    // ── Day stats: revenue per day ──
    const revenueByDay = new Map<string, number>();
    days.forEach((d) => revenueByDay.set(d, 0));
    journalSnap.docs.forEach((doc) => {
      const data = doc.data();
      const credit = data.creditAccount as string;
      if (credit === "SALES_REVENUE" || credit === "MEMBERSHIP_REVENUE") {
        const day = dateKey(data.createdAt as string);
        revenueByDay.set(day, (revenueByDay.get(day) ?? 0) + (data.amount as number));
      }
    });

    // ── Day stats: visits per day ──
    const visitsByDay = new Map<string, number>();
    days.forEach((d) => visitsByDay.set(d, 0));
    visitsSnap.docs.forEach((doc) => {
      const day = dateKey(doc.data().createdAt as string);
      visitsByDay.set(day, (visitsByDay.get(day) ?? 0) + 1);
    });

    setDayStats(days.map((d) => ({
      date: d,
      visits: visitsByDay.get(d) ?? 0,
      revenue: revenueByDay.get(d) ?? 0,
    })));

    // ── Today ──
    const todayKey = new Date().toISOString().slice(0, 10);
    setTodayRevenue(revenueByDay.get(todayKey) ?? 0);
    setTodayVisits(visitsByDay.get(todayKey) ?? 0);

    // Today's transactions
    const todayTxCount = txSnap.docs.filter((d) =>
      (d.data().createdAt as string) >= todayStart
    ).length;
    setTodayTx(todayTxCount);

    // ── Active members ──
    setActiveMembers(membershipsSnap.size);

    // ── Tier breakdown ──
    const tierMap = new Map<string, number>();
    membershipsSnap.docs.forEach((d) => {
      const tier = (d.data().tier as string) ?? "unknown";
      tierMap.set(tier, (tierMap.get(tier) ?? 0) + 1);
    });
    setTierStats(
      ["basic", "silver", "gold", "platinum"]
        .filter((t) => tierMap.has(t))
        .map((t) => ({ tier: t, count: tierMap.get(t)! }))
    );

    // ── Recent transactions ──
    setRecentTx(txSnap.docs.map((d) => ({ id: d.id, ...d.data() } as RecentTransaction)));

    setLoading(false);
  }

  const fmt = (n: number) =>
    new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);

  const maxRevenue = Math.max(...dayStats.map((d) => d.revenue), 1);
  const maxVisits = Math.max(...dayStats.map((d) => d.visits), 1);

  const TIER_COLOR: Record<string, string> = {
    basic: "bg-slate-400",
    silver: "bg-slate-500",
    gold: "bg-yellow-400",
    platinum: "bg-blue-500",
  };

  const shortDate = (iso: string) => {
    const d = new Date(iso);
    return `${d.getDate()}/${d.getMonth() + 1}`;
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-slate-900">Laporan & Analitik</h2>
        <button onClick={loadAll} className="text-sm text-blue-600 hover:underline">Refresh</button>
      </div>

      {loading ? (
        <p className="text-slate-400 text-sm">Memuat data…</p>
      ) : (
        <>
          {/* Today stats */}
          <div className="grid grid-cols-4 gap-4 mb-8">
            {[
              { label: "Pendapatan Hari Ini", value: fmt(todayRevenue), sub: "dari jurnal keuangan" },
              { label: "Kunjungan Hari Ini", value: todayVisits.toString(), sub: "deduct membership" },
              { label: "Member Aktif", value: activeMembers.toString(), sub: "semua tier" },
              { label: "Transaksi Hari Ini", value: todayTx.toString(), sub: "POS" },
            ].map((s) => (
              <div key={s.label} className="bg-white rounded-xl border border-slate-200 p-5">
                <p className="text-xs text-slate-400 mb-1">{s.label}</p>
                <p className="text-2xl font-bold text-slate-900">{s.value}</p>
                <p className="text-xs text-slate-400 mt-1">{s.sub}</p>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-3 gap-6 mb-8">
            {/* Revenue chart */}
            <div className="col-span-2 bg-white rounded-xl border border-slate-200 p-6">
              <h3 className="font-semibold text-slate-800 mb-4">Pendapatan 7 Hari Terakhir</h3>
              <div className="flex items-end gap-3 h-32">
                {dayStats.map((d) => (
                  <div key={d.date} className="flex-1 flex flex-col items-center gap-1">
                    <span className="text-xs text-slate-400 truncate w-full text-center">
                      {d.revenue > 0 ? fmt(d.revenue).replace("Rp ", "").replace("Rp", "") : ""}
                    </span>
                    <div
                      className="w-full bg-blue-500 rounded-t"
                      style={{ height: `${Math.max((d.revenue / maxRevenue) * 80, d.revenue > 0 ? 4 : 0)}px` }}
                    />
                    <span className="text-xs text-slate-400">{shortDate(d.date)}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Tier breakdown */}
            <div className="bg-white rounded-xl border border-slate-200 p-6">
              <h3 className="font-semibold text-slate-800 mb-4">Member per Tier</h3>
              {tierStats.length === 0 ? (
                <p className="text-sm text-slate-400">Belum ada member aktif.</p>
              ) : (
                <div className="space-y-3">
                  {tierStats.map((t) => (
                    <div key={t.tier}>
                      <div className="flex items-center justify-between text-sm mb-1">
                        <span className="capitalize text-slate-600 font-medium">{t.tier}</span>
                        <span className="font-bold text-slate-800">{t.count}</span>
                      </div>
                      <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${TIER_COLOR[t.tier] ?? "bg-slate-400"}`}
                          style={{ width: `${(t.count / activeMembers) * 100}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Visits chart */}
          <div className="bg-white rounded-xl border border-slate-200 p-6 mb-8 max-w-2xl">
            <h3 className="font-semibold text-slate-800 mb-4">Kunjungan 7 Hari Terakhir</h3>
            <div className="flex items-end gap-3 h-24">
              {dayStats.map((d) => (
                <div key={d.date} className="flex-1 flex flex-col items-center gap-1">
                  {d.visits > 0 && (
                    <span className="text-xs text-slate-500 font-medium">{d.visits}</span>
                  )}
                  <div
                    className="w-full bg-green-400 rounded-t"
                    style={{ height: `${Math.max((d.visits / maxVisits) * 60, d.visits > 0 ? 4 : 0)}px` }}
                  />
                  <span className="text-xs text-slate-400">{shortDate(d.date)}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Recent transactions */}
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden max-w-2xl">
            <div className="px-4 py-3 border-b border-slate-100">
              <h3 className="font-semibold text-slate-800">Transaksi Terbaru</h3>
            </div>
            {recentTx.length === 0 ? (
              <p className="text-sm text-slate-400 p-4">Belum ada transaksi.</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-500 text-xs">
                  <tr>
                    <th className="px-4 py-2 text-left">Waktu</th>
                    <th className="px-4 py-2 text-right">Total</th>
                    <th className="px-4 py-2 text-left">Pembayaran</th>
                    <th className="px-4 py-2 text-left">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {recentTx.map((tx) => (
                    <tr key={tx.id} className="hover:bg-slate-50">
                      <td className="px-4 py-2.5 text-slate-400 text-xs">{tx.createdAt?.slice(0, 16).replace("T", " ")}</td>
                      <td className="px-4 py-2.5 text-right font-semibold text-slate-800">{fmt(tx.total)}</td>
                      <td className="px-4 py-2.5 text-slate-500 text-xs uppercase">{tx.paymentMethod}</td>
                      <td className="px-4 py-2.5">
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                          tx.status === "completed" ? "bg-green-50 text-green-700" :
                          tx.status === "pending" ? "bg-yellow-50 text-yellow-700" :
                          "bg-red-50 text-red-600"
                        }`}>{tx.status}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  );
}
