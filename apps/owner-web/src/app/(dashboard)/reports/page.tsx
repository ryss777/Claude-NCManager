"use client";

import { useEffect, useState, useCallback } from "react";
import { collection, getDocs, query, where, orderBy, limit } from "firebase/firestore";
import { useOwnerAuthStore } from "@/store/auth.store";
import { firebaseDb } from "@/firebase/firebase";

type Period = "7d" | "30d" | "3m";

interface DayStat { date: string; visits: number; revenue: number; }
interface MonthStat { month: string; label: string; revenue: number; }
interface TierStat { tier: string; count: number; }
interface OperatorStat { operatorId: string; displayName: string; transactions: number; revenue: number; }
interface ShiftRecord {
  id: string;
  operatorId: string;
  openedAt: string;
  closedAt: string | null;
  status: string;
  totalTransactions: number;
  totalRevenue: number;
  openingCash: number;
  actualCash?: number;
  expectedCash?: number;
  cashDiscrepancy?: number;
}
interface TxRow {
  id: string;
  total: number;
  paymentMethod: string;
  status: string;
  createdAt: string;
  operatorId: string;
  customerId: string | null;
}

// ── helpers ─────────────────────────────────────────────────────────────────

function isoOfDaysAgo(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function isoOfMonthsAgo(n: number) {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function periodStart(period: Period) {
  if (period === "7d") return isoOfDaysAgo(6);
  if (period === "30d") return isoOfDaysAgo(29);
  return isoOfMonthsAgo(3);
}

function dateKey(iso: string) { return iso.slice(0, 10); }

function datesInPeriod(period: Period): string[] {
  const days = period === "7d" ? 7 : period === "30d" ? 30 : 90;
  return Array.from({ length: days }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (days - 1 - i));
    return d.toISOString().slice(0, 10);
  });
}

function last12Months(): { key: string; label: string }[] {
  return Array.from({ length: 12 }, (_, i) => {
    const d = new Date();
    d.setMonth(d.getMonth() - (11 - i));
    const key = d.toISOString().slice(0, 7); // YYYY-MM
    const label = d.toLocaleString("id-ID", { month: "short", year: "2-digit" });
    return { key, label };
  });
}

function fmt(n: number) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency", currency: "IDR", maximumFractionDigits: 0,
  }).format(n);
}

function fmtShort(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}jt`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}rb`;
  return String(n);
}

function shortDate(iso: string) {
  const d = new Date(iso);
  return `${d.getDate()}/${d.getMonth() + 1}`;
}

function downloadCsv(rows: TxRow[]) {
  const header = ["ID", "Waktu", "Total", "Pembayaran", "Status", "Operator", "Customer"];
  const lines = rows.map((r) =>
    [r.id, r.createdAt.slice(0, 16).replace("T", " "), r.total, r.paymentMethod, r.status, r.operatorId, r.customerId ?? ""].join(",")
  );
  const csv = [header.join(","), ...lines].join("\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `transaksi_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── component ────────────────────────────────────────────────────────────────

export default function ReportsPage() {
  const { ownerId, clubId } = useOwnerAuthStore();
  const [period, setPeriod] = useState<Period>("7d");
  const [loading, setLoading] = useState(true);

  // KPI
  const [todayRevenue, setTodayRevenue] = useState(0);
  const [todayVisits, setTodayVisits] = useState(0);
  const [activeMembers, setActiveMembers] = useState(0);
  const [periodRevenue, setPeriodRevenue] = useState(0);
  const [periodTransactions, setPeriodTransactions] = useState(0);

  // Charts
  const [dayStats, setDayStats] = useState<DayStat[]>([]);
  const [monthStats, setMonthStats] = useState<MonthStat[]>([]);

  // Tables
  const [tierStats, setTierStats] = useState<TierStat[]>([]);
  const [operatorStats, setOperatorStats] = useState<OperatorStat[]>([]);
  const [shifts, setShifts] = useState<ShiftRecord[]>([]);
  const [txRows, setTxRows] = useState<TxRow[]>([]);

  // Operator names lookup
  const [operatorNames, setOperatorNames] = useState<Record<string, string>>({});

  const loadAll = useCallback(async () => {
    if (!ownerId || !clubId) return;
    setLoading(true);

    const db = firebaseDb();
    const base = `owners/${ownerId}/clubs/${clubId}`;
    const pStart = periodStart(period);
    const monthsAgo12 = isoOfMonthsAgo(12);
    const todayKey = new Date().toISOString().slice(0, 10);

    const [journalPeriod, journalMonthly, visitsSnap, membershipsSnap, txSnap, shiftsSnap, operatorsSnap] =
      await Promise.all([
        getDocs(query(collection(db, `${base}/financeJournal`), where("createdAt", ">=", pStart))),
        getDocs(query(collection(db, `${base}/financeJournal`), where("createdAt", ">=", monthsAgo12))),
        getDocs(query(collection(db, `${base}/membershipVisits`), where("createdAt", ">=", pStart))),
        getDocs(query(collection(db, `${base}/memberships`), where("status", "==", "active"))),
        getDocs(query(collection(db, `${base}/transactions`), orderBy("createdAt", "desc"), limit(50))),
        getDocs(query(collection(db, `${base}/shifts`), orderBy("openedAt", "desc"), limit(15))),
        getDocs(collection(db, `${base}/operators`)),
      ]);

    // ── Operator names map ──
    const namesMap: Record<string, string> = {};
    operatorsSnap.docs.forEach((d) => {
      const data = d.data();
      namesMap[d.id] = (data.displayName as string) ?? d.id;
    });
    setOperatorNames(namesMap);

    // ── Day stats ──
    const dates = datesInPeriod(period);
    const revenueByDay = new Map<string, number>();
    const visitsByDay = new Map<string, number>();
    dates.forEach((d) => { revenueByDay.set(d, 0); visitsByDay.set(d, 0); });

    journalPeriod.docs.forEach((doc) => {
      const data = doc.data();
      const credit = data.creditAccount as string;
      if (credit === "SALES_REVENUE" || credit === "MEMBERSHIP_REVENUE") {
        const day = dateKey(data.createdAt as string);
        revenueByDay.set(day, (revenueByDay.get(day) ?? 0) + (data.amount as number));
      }
    });

    visitsSnap.docs.forEach((doc) => {
      const day = dateKey(doc.data().createdAt as string);
      visitsByDay.set(day, (visitsByDay.get(day) ?? 0) + 1);
    });

    const ds = dates.map((d) => ({
      date: d,
      revenue: revenueByDay.get(d) ?? 0,
      visits: visitsByDay.get(d) ?? 0,
    }));
    setDayStats(ds);

    // KPI
    const todayRev = revenueByDay.get(todayKey) ?? 0;
    const todayVis = visitsByDay.get(todayKey) ?? 0;
    setTodayRevenue(todayRev);
    setTodayVisits(todayVis);

    let sumRev = 0;
    revenueByDay.forEach((v) => { sumRev += v; });
    setPeriodRevenue(sumRev);
    setActiveMembers(membershipsSnap.size);

    // ── Monthly stats ──
    const months = last12Months();
    const revenueByMonth = new Map<string, number>();
    months.forEach(({ key }) => revenueByMonth.set(key, 0));

    journalMonthly.docs.forEach((doc) => {
      const data = doc.data();
      const credit = data.creditAccount as string;
      if (credit === "SALES_REVENUE" || credit === "MEMBERSHIP_REVENUE") {
        const month = (data.createdAt as string).slice(0, 7);
        revenueByMonth.set(month, (revenueByMonth.get(month) ?? 0) + (data.amount as number));
      }
    });

    setMonthStats(months.map(({ key, label }) => ({
      month: key, label, revenue: revenueByMonth.get(key) ?? 0,
    })));

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

    // ── Transaction rows ──
    const txData = txSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<TxRow, "id">) }));
    setTxRows(txData);
    setPeriodTransactions(txData.filter((t) => t.createdAt >= pStart).length);

    // ── Operator breakdown (from period transactions) ──
    const opRevMap = new Map<string, { transactions: number; revenue: number }>();
    txData.forEach((t) => {
      if (t.createdAt < pStart) return;
      if (t.status !== "completed") return;
      const existing = opRevMap.get(t.operatorId) ?? { transactions: 0, revenue: 0 };
      opRevMap.set(t.operatorId, {
        transactions: existing.transactions + 1,
        revenue: existing.revenue + (t.total ?? 0),
      });
    });

    setOperatorStats(
      Array.from(opRevMap.entries())
        .map(([operatorId, stats]) => ({
          operatorId,
          displayName: namesMap[operatorId] ?? operatorId,
          ...stats,
        }))
        .sort((a, b) => b.revenue - a.revenue)
    );

    // ── Shifts ──
    setShifts(shiftsSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<ShiftRecord, "id">) })));

    setLoading(false);
  }, [ownerId, clubId, period]);

  useEffect(() => { loadAll(); }, [loadAll]);

  const PERIOD_OPTIONS: { key: Period; label: string }[] = [
    { key: "7d", label: "7 Hari" },
    { key: "30d", label: "30 Hari" },
    { key: "3m", label: "3 Bulan" },
  ];

  const TIER_COLOR: Record<string, string> = {
    basic: "bg-slate-400", silver: "bg-slate-500", gold: "bg-yellow-400", platinum: "bg-blue-500",
  };

  const maxDayRevenue = Math.max(...dayStats.map((d) => d.revenue), 1);
  const maxDayVisits = Math.max(...dayStats.map((d) => d.visits), 1);
  const maxMonthRevenue = Math.max(...monthStats.map((m) => m.revenue), 1);

  // For 30d / 3m, show fewer labels to avoid crowding
  const dayLabelStep = period === "7d" ? 1 : period === "30d" ? 5 : 15;

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Laporan & Analitik</h2>
          <p className="text-sm text-slate-400 mt-0.5">Data diambil langsung dari Firestore</p>
        </div>
        <div className="flex items-center gap-3">
          {/* Period selector */}
          <div className="flex rounded-lg border border-slate-200 overflow-hidden text-sm">
            {PERIOD_OPTIONS.map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setPeriod(key)}
                className={`px-4 py-1.5 font-medium transition ${
                  period === key
                    ? "bg-blue-600 text-white"
                    : "text-slate-500 hover:bg-slate-50"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            onClick={loadAll}
            className="text-sm text-blue-600 hover:underline"
          >
            Refresh
          </button>
        </div>
      </div>

      {loading ? (
        <p className="text-slate-400 text-sm">Memuat data…</p>
      ) : (
        <>
          {/* ── KPI cards ── */}
          <div className="grid grid-cols-5 gap-4 mb-8">
            <KpiCard label="Pendapatan Hari Ini" value={fmt(todayRevenue)} sub="dari jurnal" accent="blue" />
            <KpiCard label="Kunjungan Hari Ini" value={String(todayVisits)} sub="deduct membership" accent="green" />
            <KpiCard label={`Pendapatan ${PERIOD_OPTIONS.find(p => p.key === period)?.label}`} value={fmt(periodRevenue)} sub="total periode" accent="indigo" />
            <KpiCard label={`Transaksi ${PERIOD_OPTIONS.find(p => p.key === period)?.label}`} value={String(periodTransactions)} sub="completed" accent="violet" />
            <KpiCard label="Member Aktif" value={String(activeMembers)} sub="semua tier" accent="amber" />
          </div>

          {/* ── Revenue trend + tier ── */}
          <div className="grid grid-cols-3 gap-6 mb-8">
            <div className="col-span-2 bg-white rounded-xl border border-slate-200 p-6">
              <h3 className="font-semibold text-slate-800 mb-4">
                Pendapatan — {PERIOD_OPTIONS.find(p => p.key === period)?.label} Terakhir
              </h3>
              <BarChart
                bars={dayStats.map((d, i) => ({
                  value: d.revenue,
                  label: (i % dayLabelStep === 0) ? shortDate(d.date) : "",
                  tooltip: `${d.date}: ${fmt(d.revenue)}`,
                }))}
                maxValue={maxDayRevenue}
                color="bg-blue-500"
                heightPx={96}
              />
            </div>

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

          {/* ── Visits trend ── */}
          <div className="bg-white rounded-xl border border-slate-200 p-6 mb-8">
            <h3 className="font-semibold text-slate-800 mb-4">
              Kunjungan — {PERIOD_OPTIONS.find(p => p.key === period)?.label} Terakhir
            </h3>
            <BarChart
              bars={dayStats.map((d, i) => ({
                value: d.visits,
                label: (i % dayLabelStep === 0) ? shortDate(d.date) : "",
                tooltip: `${d.date}: ${d.visits} kunjungan`,
              }))}
              maxValue={maxDayVisits}
              color="bg-green-400"
              heightPx={72}
            />
          </div>

          {/* ── Monthly revenue ── */}
          <div className="bg-white rounded-xl border border-slate-200 p-6 mb-8">
            <h3 className="font-semibold text-slate-800 mb-4">Pendapatan 12 Bulan Terakhir</h3>
            <BarChart
              bars={monthStats.map((m) => ({
                value: m.revenue,
                label: m.label,
                tooltip: `${m.month}: ${fmt(m.revenue)}`,
              }))}
              maxValue={maxMonthRevenue}
              color="bg-indigo-500"
              heightPx={96}
            />
          </div>

          {/* ── Operator breakdown ── */}
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden mb-8">
            <div className="px-4 py-3 border-b border-slate-100">
              <h3 className="font-semibold text-slate-800">
                Performa Operator{" "}
                <span className="text-slate-400 font-normal text-sm">
                  ({PERIOD_OPTIONS.find(p => p.key === period)?.label} terakhir)
                </span>
              </h3>
            </div>
            {operatorStats.length === 0 ? (
              <p className="text-sm text-slate-400 p-4">Belum ada transaksi pada periode ini.</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-500 text-xs">
                  <tr>
                    <th className="px-4 py-2 text-left">Operator</th>
                    <th className="px-4 py-2 text-right">Transaksi</th>
                    <th className="px-4 py-2 text-right">Pendapatan</th>
                    <th className="px-4 py-2 text-right">Rata-rata / Tx</th>
                    <th className="px-4 py-2 text-left w-40">Kontribusi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {operatorStats.map((op) => (
                    <tr key={op.operatorId} className="hover:bg-slate-50">
                      <td className="px-4 py-2.5 font-medium text-slate-800">{op.displayName}</td>
                      <td className="px-4 py-2.5 text-right text-slate-600">{op.transactions}</td>
                      <td className="px-4 py-2.5 text-right font-semibold text-slate-800">{fmt(op.revenue)}</td>
                      <td className="px-4 py-2.5 text-right text-slate-500">
                        {op.transactions > 0 ? fmt(Math.round(op.revenue / op.transactions)) : "—"}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-indigo-500 rounded-full"
                              style={{
                                width: `${periodRevenue > 0 ? (op.revenue / periodRevenue) * 100 : 0}%`,
                              }}
                            />
                          </div>
                          <span className="text-xs text-slate-400 w-8 text-right">
                            {periodRevenue > 0 ? `${Math.round((op.revenue / periodRevenue) * 100)}%` : "—"}
                          </span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* ── Shift history ── */}
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden mb-8">
            <div className="px-4 py-3 border-b border-slate-100">
              <h3 className="font-semibold text-slate-800">
                Riwayat Shift{" "}
                <span className="text-slate-400 font-normal text-sm">({shifts.length} terakhir)</span>
              </h3>
            </div>
            {shifts.length === 0 ? (
              <p className="text-sm text-slate-400 p-4">Belum ada shift tercatat.</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-500 text-xs">
                  <tr>
                    <th className="px-4 py-2 text-left">Dibuka</th>
                    <th className="px-4 py-2 text-left">Ditutup</th>
                    <th className="px-4 py-2 text-left">Operator</th>
                    <th className="px-4 py-2 text-left">Status</th>
                    <th className="px-4 py-2 text-right">Transaksi</th>
                    <th className="px-4 py-2 text-right">Pendapatan</th>
                    <th className="px-4 py-2 text-right">Selisih Kas</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {shifts.map((s) => {
                    const discrepancy = s.cashDiscrepancy;
                    const hasDisc = discrepancy != null && Math.abs(discrepancy) > 10000;
                    return (
                      <tr key={s.id} className="hover:bg-slate-50">
                        <td className="px-4 py-2.5 text-slate-500 text-xs">{s.openedAt?.slice(0, 16).replace("T", " ")}</td>
                        <td className="px-4 py-2.5 text-slate-500 text-xs">{s.closedAt?.slice(0, 16).replace("T", " ") ?? "—"}</td>
                        <td className="px-4 py-2.5 text-slate-700 font-medium">{operatorNames[s.operatorId] ?? s.operatorId}</td>
                        <td className="px-4 py-2.5">
                          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                            s.status === "open" ? "bg-green-50 text-green-700" : "bg-slate-100 text-slate-500"
                          }`}>{s.status === "open" ? "Aktif" : "Tutup"}</span>
                        </td>
                        <td className="px-4 py-2.5 text-right text-slate-600">{s.totalTransactions}</td>
                        <td className="px-4 py-2.5 text-right font-semibold text-slate-800">{fmt(s.totalRevenue)}</td>
                        <td className="px-4 py-2.5 text-right">
                          {discrepancy != null ? (
                            <span className={`text-xs font-medium ${hasDisc ? "text-red-600" : "text-slate-500"}`}>
                              {discrepancy >= 0 ? "+" : ""}{fmt(discrepancy)}
                              {hasDisc ? " ⚠️" : ""}
                            </span>
                          ) : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          {/* ── Recent transactions ── */}
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
              <h3 className="font-semibold text-slate-800">
                Transaksi Terbaru{" "}
                <span className="text-slate-400 font-normal text-sm">({txRows.length})</span>
              </h3>
              <button
                onClick={() => downloadCsv(txRows)}
                className="text-xs text-blue-600 hover:text-blue-800 font-medium border border-blue-200 rounded-lg px-3 py-1.5 hover:bg-blue-50 transition"
              >
                Export CSV
              </button>
            </div>
            {txRows.length === 0 ? (
              <p className="text-sm text-slate-400 p-4">Belum ada transaksi.</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-500 text-xs">
                  <tr>
                    <th className="px-4 py-2 text-left">Waktu</th>
                    <th className="px-4 py-2 text-left">Operator</th>
                    <th className="px-4 py-2 text-right">Total</th>
                    <th className="px-4 py-2 text-left">Pembayaran</th>
                    <th className="px-4 py-2 text-left">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {txRows.map((tx) => (
                    <tr key={tx.id} className="hover:bg-slate-50">
                      <td className="px-4 py-2.5 text-slate-400 text-xs">{tx.createdAt?.slice(0, 16).replace("T", " ")}</td>
                      <td className="px-4 py-2.5 text-slate-600 text-xs">{operatorNames[tx.operatorId] ?? tx.operatorId ?? "—"}</td>
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

// ── Sub-components ───────────────────────────────────────────────────────────

function KpiCard({
  label, value, sub, accent,
}: {
  label: string; value: string; sub: string; accent: string;
}) {
  const borderColor: Record<string, string> = {
    blue: "border-t-blue-500", green: "border-t-green-500",
    indigo: "border-t-indigo-500", violet: "border-t-violet-500", amber: "border-t-amber-500",
  };
  return (
    <div className={`bg-white rounded-xl border border-slate-200 border-t-2 p-5 ${borderColor[accent] ?? ""}`}>
      <p className="text-xs text-slate-400 mb-1 truncate">{label}</p>
      <p className="text-xl font-bold text-slate-900 truncate">{value}</p>
      <p className="text-xs text-slate-400 mt-1">{sub}</p>
    </div>
  );
}

function BarChart({
  bars, maxValue, color, heightPx,
}: {
  bars: { value: number; label: string; tooltip: string }[];
  maxValue: number;
  color: string;
  heightPx: number;
}) {
  return (
    <div className="flex items-end gap-1" style={{ height: heightPx + 32 }}>
      {bars.map((b, i) => (
        <div key={i} className="flex-1 flex flex-col items-center gap-1" title={b.tooltip}>
          {b.value > 0 && (
            <span className="text-xs text-slate-400 truncate w-full text-center leading-tight">
              {fmtShort(b.value)}
            </span>
          )}
          <div style={{ height: heightPx, display: "flex", alignItems: "flex-end", width: "100%" }}>
            <div
              className={`w-full rounded-t ${color} transition-all`}
              style={{
                height: `${Math.max((b.value / maxValue) * heightPx, b.value > 0 ? 3 : 0)}px`,
              }}
            />
          </div>
          {b.label && (
            <span className="text-xs text-slate-400 truncate w-full text-center">{b.label}</span>
          )}
        </div>
      ))}
    </div>
  );
}
