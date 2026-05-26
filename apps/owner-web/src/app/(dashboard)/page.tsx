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
  lowStock: number;
  activeDebts: number;
}

interface ActiveCompetition {
  id: string;
  name: string;
  participantCount: number;
  endDate: string;
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

interface ExpiringMember {
  id: string;
  customerId: string;
  customerName: string;
  expiresAt: string;
  daysLeft: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmt = (n: number) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);

function greeting(name: string) {
  const h = new Date().getHours();
  const greet = h < 11 ? "Selamat pagi" : h < 15 ? "Selamat siang" : h < 19 ? "Selamat sore" : "Selamat malam";
  return `${greet}, ${name}`;
}

function todayLabel() {
  return new Date().toLocaleDateString("id-ID", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  });
}

function daysFromNow(iso: string) {
  return Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000));
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function DashboardHome() {
  const { displayName, ownerId, clubId } = useOwnerAuthStore();

  const [stats, setStats]                 = useState<Stats | null>(null);
  const [recentTx, setRecentTx]           = useState<RecentTx[]>([]);
  const [lowItems, setLowItems]           = useState<LowStockItem[]>([]);
  const [expiringMembers, setExpiringMembers] = useState<ExpiringMember[]>([]);
  const [activeComps, setActiveComps]     = useState<ActiveCompetition[]>([]);
  const [todayRevenue, setTodayRevenue]   = useState(0);
  const [todayTxCount, setTodayTxCount]   = useState(0);
  const [loading, setLoading]             = useState(true);

  useEffect(() => {
    if (ownerId && clubId) loadAll();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownerId, clubId]);

  async function loadAll() {
    setLoading(true);
    try {
      const db   = firebaseDb();
      const base = `owners/${ownerId}/clubs/${clubId}`;

      const soonIso    = new Date(Date.now() + 7 * 86_400_000).toISOString();
      const todayStart = `${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`;
      const todayEnd   = `${new Date().toISOString().slice(0, 10)}T23:59:59.999Z`;

      const [items, customers, memberships, debts, txSnap, compSnap, journalSnap, todayTxSnap] = await Promise.all([
        getDocs(collection(db, `${base}/inventoryItems`)),
        getDocs(collection(db, `${base}/customers`)),
        getDocs(query(collection(db, `${base}/memberships`), where("status", "==", "active"))),
        getDocs(query(collection(db, `${base}/debts`), where("status", "in", ["unpaid", "outstanding", "partial"]))),
        getDocs(query(collection(db, `${base}/transactions`), orderBy("createdAt", "desc"), limit(6))),
        getDocs(collection(db, `${base}/competitions`)),
        getDocs(query(
          collection(db, `${base}/financeJournal`),
          where("createdAt", ">=", todayStart),
          where("createdAt", "<=", todayEnd),
        )),
        getDocs(query(
          collection(db, `${base}/transactions`),
          where("createdAt", ">=", todayStart),
          where("createdAt", "<=", todayEnd),
        )),
      ]);

      // Today's revenue from journal credits
      const REVENUE_CREDITS = new Set(["SALES_REVENUE", "MEMBERSHIP_REVENUE", "4001", "4002"]);
      let rev = 0;
      journalSnap.docs.forEach((d) => {
        const data = d.data();
        if (REVENUE_CREDITS.has(data["creditAccount"] as string)) {
          rev += (data["amount"] as number) ?? 0;
        }
      });
      setTodayRevenue(rev);
      setTodayTxCount(todayTxSnap.size);

      // Low stock items
      const low = items.docs.filter((d) => {
        const data = d.data();
        return (data["minimumStock"] ?? 0) > 0 && (data["currentStock"] ?? 0) <= (data["minimumStock"] ?? 0);
      });

      // Expiring memberships (with names)
      const custMap = new Map<string, string>(
        customers.docs.map((d) => [d.id, (d.data()["displayName"] as string) ?? d.id])
      );
      const expiringList: ExpiringMember[] = [];
      memberships.docs.forEach((d) => {
        const data = d.data();
        const exp = data["expiresAt"] as string | null;
        if (exp && exp <= soonIso) {
          expiringList.push({
            id: d.id,
            customerId: data["customerId"] as string,
            customerName: custMap.get(data["customerId"] as string) ?? "—",
            expiresAt: exp,
            daysLeft: daysFromNow(exp),
          });
        }
      });
      expiringList.sort((a, b) => a.daysLeft - b.daysLeft);

      setStats({
        customers: customers.size,
        activeMemberships: memberships.size,
        expiringSoon: expiringList.length,
        lowStock: low.length,
        activeDebts: debts.size,
      });

      setLowItems(low.slice(0, 5).map((d) => ({
        id: d.id,
        name: d.data()["name"] as string,
        currentStock: d.data()["currentStock"] as number,
        minimumStock: d.data()["minimumStock"] as number,
      })));

      setExpiringMembers(expiringList.slice(0, 5));

      setRecentTx(txSnap.docs.map((d) => ({
        id: d.id,
        items: (d.data()["items"] ?? []) as { productName: string; quantity: number }[],
        total: d.data()["total"] as number,
        status: d.data()["status"] as string,
        createdAt: d.data()["createdAt"] as string,
        createdBy: d.data()["createdBy"] as string,
      })));

      const today = new Date().toISOString().slice(0, 10);
      setActiveComps(
        compSnap.docs
          .filter((d) => {
            if ((d.data()["status"] as string | undefined) === "finished") return false;
            const s = d.data()["startDate"] as string;
            const e = d.data()["endDate"] as string;
            return today >= s && today <= e;
          })
          .map((d) => ({
            id: d.id,
            name: d.data()["name"] as string,
            participantCount: (d.data()["participantCount"] as number) ?? 0,
            endDate: d.data()["endDate"] as string,
          }))
          .sort((a, b) => a.endDate.localeCompare(b.endDate))
      );
    } finally {
      setLoading(false);
    }
  }

  const fname = displayName?.split(" ")[0] ?? "Owner";

  // ── Action items: things that need owner attention today ────────────────────
  type ActionItem = {
    key: string;
    icon: string;
    title: string;
    detail: string;
    href: string;
    severity: "high" | "med" | "low";
  };
  const actions: ActionItem[] = [];
  if ((stats?.lowStock ?? 0) > 0) {
    actions.push({
      key: "low-stock", icon: "📦",
      title: `${stats!.lowStock} stok menipis`,
      detail: lowItems[0] ? `${lowItems[0].name}, ${lowItems[0].currentStock}/${lowItems[0].minimumStock}` : "Cek inventory",
      href: "/inventory", severity: "high",
    });
  }
  if ((stats?.activeDebts ?? 0) > 0) {
    actions.push({
      key: "debts", icon: "💰",
      title: `${stats!.activeDebts} utang aktif`,
      detail: "Tagihan belum lunas",
      href: "/transactions", severity: "high",
    });
  }
  if ((stats?.expiringSoon ?? 0) > 0) {
    actions.push({
      key: "expiring", icon: "⏰",
      title: `${stats!.expiringSoon} member akan expired`,
      detail: expiringMembers[0]
        ? `${expiringMembers[0].customerName}, ${expiringMembers[0].daysLeft}h lagi`
        : "Dalam 7 hari",
      href: "/customers", severity: "med",
    });
  }
  if (activeComps.length > 0) {
    const c = activeComps[0]!;
    const dl = daysFromNow(c.endDate);
    actions.push({
      key: "comp", icon: "🏆",
      title: activeComps.length === 1 ? c.name : `${activeComps.length} lomba berjalan`,
      detail: activeComps.length === 1
        ? `${c.participantCount} peserta · ${dl}h lagi`
        : "Pantau progress",
      href: "/lomba", severity: dl <= 3 ? "high" : "low",
    });
  }

  const severityStyle: Record<ActionItem["severity"], { bg: string; ring: string; text: string }> = {
    high: { bg: "bg-red-50",    ring: "ring-red-100",    text: "text-red-700" },
    med:  { bg: "bg-amber-50",  ring: "ring-amber-100",  text: "text-amber-700" },
    low:  { bg: "bg-blue-50",   ring: "ring-blue-100",   text: "text-blue-700" },
  };

  // ── Quick access — only the truly common destinations ───────────────────────
  const quickLinks = [
    { href: "/pos",          icon: "🖥️", label: "Kasir" },
    { href: "/customers",    icon: "🧑‍🤝‍🧑", label: "Pelanggan" },
    { href: "/transfer",     icon: "↔️", label: "Transfer" },
    { href: "/inventory",    icon: "📦", label: "Stok" },
    { href: "/transactions", icon: "🧾", label: "Transaksi" },
    { href: "/reports",      icon: "📊", label: "Laporan" },
  ];

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">

      {/* ── Hero: greeting + headline KPI strip ─────────────────────────────── */}
      <div className="rounded-3xl bg-gradient-to-br from-blue-100 via-blue-50 to-indigo-100 ring-1 ring-blue-200/60 px-7 py-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">{greeting(fname)}</h1>
            <p className="text-sm text-slate-500 mt-1">{todayLabel()}</p>
          </div>
          <Link
            href="/pos"
            className="inline-flex items-center gap-2 bg-slate-900 text-white px-5 py-2.5 rounded-xl text-sm font-bold hover:bg-slate-700 transition shadow-sm"
          >
            🖥️ Buka Kasir
          </Link>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-6">
          <HeroStat
            label="Pendapatan Hari Ini"
            value={loading ? null : fmt(todayRevenue)}
          />
          <HeroStat
            label="Transaksi Hari Ini"
            value={loading ? null : String(todayTxCount)}
            sub={todayTxCount > 0 ? "sudah masuk" : "belum ada"}
          />
          <HeroStat
            label="Member Aktif"
            value={loading ? null : String(stats?.activeMemberships ?? 0)}
            sub={`dari ${stats?.customers ?? 0} pelanggan`}
          />
          <HeroStat
            label="Perlu Tindakan"
            value={loading ? null : String(actions.length)}
            sub={actions.length === 0 ? "semua aman" : "lihat ringkasan ↓"}
            highlight={actions.length > 0}
          />
        </div>
      </div>

      {/* ── Two-column body ────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">

        {/* Left: Action items + quick access */}
        <div className="lg:col-span-3 space-y-6">

          {/* Action items */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-bold text-slate-700 uppercase tracking-widest">⚡ Yang Perlu Tindakan</h2>
              {!loading && actions.length > 0 && (
                <span className="text-xs text-slate-400">{actions.length} item</span>
              )}
            </div>

            {loading ? (
              <div className="space-y-2">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-16 bg-slate-100 rounded-2xl animate-pulse" />
                ))}
              </div>
            ) : actions.length === 0 ? (
              <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center">
                <div className="text-4xl mb-2">✅</div>
                <p className="text-sm font-semibold text-slate-700">Semua beres hari ini</p>
                <p className="text-xs text-slate-400 mt-1">Tidak ada hal mendesak yang perlu perhatian</p>
              </div>
            ) : (
              <div className="space-y-2">
                {actions.map((a) => {
                  const s = severityStyle[a.severity];
                  return (
                    <Link
                      key={a.key}
                      href={a.href}
                      className={`flex items-center gap-4 ${s.bg} ring-1 ${s.ring} rounded-2xl px-5 py-4 hover:brightness-95 transition`}
                    >
                      <div className="text-2xl shrink-0">{a.icon}</div>
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm font-bold ${s.text} truncate`}>{a.title}</p>
                        <p className="text-xs text-slate-500 truncate mt-0.5">{a.detail}</p>
                      </div>
                      <span className="text-slate-400 text-lg shrink-0">›</span>
                    </Link>
                  );
                })}
              </div>
            )}
          </section>

          {/* Quick access */}
          <section>
            <h2 className="text-sm font-bold text-slate-700 uppercase tracking-widest mb-3">Akses Cepat</h2>
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
              {quickLinks.map((l) => (
                <Link
                  key={l.href}
                  href={l.href}
                  className="flex flex-col items-center justify-center gap-1.5 bg-white border border-slate-200 rounded-2xl py-4 hover:border-slate-300 hover:shadow-sm transition"
                >
                  <span className="text-2xl">{l.icon}</span>
                  <span className="text-xs font-semibold text-slate-700">{l.label}</span>
                </Link>
              ))}
            </div>
          </section>
        </div>

        {/* Right: Recent activity */}
        <div className="lg:col-span-2">
          <section>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-bold text-slate-700 uppercase tracking-widest">📊 Aktivitas Terbaru</h2>
              <Link href="/transactions" className="text-xs text-blue-600 hover:underline font-medium">
                Lihat semua →
              </Link>
            </div>

            <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
              {loading ? (
                <div className="px-4 py-2">
                  {[1, 2, 3, 4].map((i) => (
                    <div key={i} className="flex items-center gap-3 py-2.5">
                      <div className="w-9 h-9 bg-slate-100 rounded-xl animate-pulse" />
                      <div className="flex-1 space-y-1.5">
                        <div className="h-3 bg-slate-100 rounded animate-pulse w-3/4" />
                        <div className="h-2 bg-slate-100 rounded animate-pulse w-1/2" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : recentTx.length === 0 ? (
                <div className="px-5 py-10 text-center">
                  <p className="text-3xl mb-2">🧾</p>
                  <p className="text-sm font-medium text-slate-600">Belum ada transaksi</p>
                  <Link
                    href="/pos"
                    className="inline-block mt-3 text-xs font-semibold text-blue-600 hover:underline"
                  >
                    Buka kasir untuk mulai →
                  </Link>
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
                        <div className={`w-9 h-9 rounded-xl flex items-center justify-center text-sm shrink-0 ${
                          reversed ? "bg-red-50 text-red-500" :
                          tx.createdBy === "owner" ? "bg-slate-100 text-slate-600" :
                          "bg-blue-50 text-blue-600"
                        }`}>
                          {reversed ? "↩" : tx.createdBy === "owner" ? "👤" : "🖥️"}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-slate-800 truncate">{label}</p>
                          <p className="text-xs text-slate-400 mt-0.5">{tx.createdAt?.slice(11, 16)}</p>
                        </div>
                        <p className={`text-sm font-bold shrink-0 ${reversed ? "text-slate-300 line-through" : "text-slate-900"}`}>
                          {fmt(tx.total)}
                        </p>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function HeroStat({
  label, value, sub, highlight,
}: {
  label: string;
  value: string | null;
  sub?: string;
  highlight?: boolean;
}) {
  return (
    <div>
      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">{label}</p>
      <p className={`text-2xl font-bold mt-1 tabular-nums ${highlight ? "text-amber-600" : "text-slate-900"}`}>
        {value === null ? <span className="inline-block w-20 h-7 bg-slate-200/70 rounded animate-pulse" /> : value}
      </p>
      {sub && <p className="text-xs text-slate-500 mt-0.5">{sub}</p>}
    </div>
  );
}
