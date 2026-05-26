"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { collection, getDocs, limit, orderBy, query, where } from "firebase/firestore";
import { firebaseDb } from "@/firebase/firebase";
import { useOwnerAuthStore } from "@/store/auth.store";
import { Icon, type IconName } from "@/components/ui-icons";

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

type ActionItem = {
  key: string;
  icon: IconName;
  title: string;
  detail: string;
  href: string;
  severity: "high" | "medium" | "low";
};

const fmt = (n: number) =>
  new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(n);

function greeting(name: string) {
  const h = new Date().getHours();
  const greet = h < 11 ? "Selamat pagi" : h < 15 ? "Selamat siang" : h < 19 ? "Selamat sore" : "Selamat malam";
  return `${greet}, ${name}`;
}

function todayLabel() {
  return new Date().toLocaleDateString("id-ID", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function daysFromNow(iso: string) {
  return Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000));
}

function txTime(iso: string) {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
}

export default function DashboardHome() {
  const { displayName, ownerId, clubId } = useOwnerAuthStore();

  const [stats, setStats] = useState<Stats | null>(null);
  const [recentTx, setRecentTx] = useState<RecentTx[]>([]);
  const [lowItems, setLowItems] = useState<LowStockItem[]>([]);
  const [expiringMembers, setExpiringMembers] = useState<ExpiringMember[]>([]);
  const [activeComps, setActiveComps] = useState<ActiveCompetition[]>([]);
  const [todayRevenue, setTodayRevenue] = useState(0);
  const [todayTxCount, setTodayTxCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (ownerId && clubId) void loadAll();
  }, [ownerId, clubId]);

  async function loadAll() {
    setLoading(true);
    setError(null);

    try {
      const db = firebaseDb();
      const base = `owners/${ownerId}/clubs/${clubId}`;
      const soonIso = new Date(Date.now() + 7 * 86_400_000).toISOString();
      const today = new Date().toISOString().slice(0, 10);
      const todayStart = `${today}T00:00:00.000Z`;
      const todayEnd = `${today}T23:59:59.999Z`;

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
          where("createdAt", "<=", todayEnd)
        )),
        getDocs(query(
          collection(db, `${base}/transactions`),
          where("createdAt", ">=", todayStart),
          where("createdAt", "<=", todayEnd)
        )),
      ]);

      const revenueCredits = new Set(["SALES_REVENUE", "MEMBERSHIP_REVENUE", "4001", "4002"]);
      let revenue = 0;
      journalSnap.docs.forEach((docSnap) => {
        const data = docSnap.data();
        if (revenueCredits.has(data["creditAccount"] as string)) {
          revenue += (data["amount"] as number | undefined) ?? 0;
        }
      });

      const low = items.docs.filter((docSnap) => {
        const data = docSnap.data();
        const minimumStock = (data["minimumStock"] as number | undefined) ?? 0;
        const currentStock = (data["currentStock"] as number | undefined) ?? 0;
        return minimumStock > 0 && currentStock <= minimumStock;
      });

      const customerNames = new Map<string, string>(
        customers.docs.map((docSnap) => [
          docSnap.id,
          (docSnap.data()["displayName"] as string | undefined) ?? docSnap.id,
        ])
      );

      const expiringList: ExpiringMember[] = [];
      memberships.docs.forEach((docSnap) => {
        const data = docSnap.data();
        const expiresAt = data["expiresAt"] as string | null;
        const customerId = data["customerId"] as string;
        if (expiresAt && expiresAt <= soonIso) {
          expiringList.push({
            id: docSnap.id,
            customerId,
            customerName: customerNames.get(customerId) ?? "-",
            expiresAt,
            daysLeft: daysFromNow(expiresAt),
          });
        }
      });
      expiringList.sort((a, b) => a.daysLeft - b.daysLeft);

      setTodayRevenue(revenue);
      setTodayTxCount(todayTxSnap.size);
      setStats({
        customers: customers.size,
        activeMemberships: memberships.size,
        expiringSoon: expiringList.length,
        lowStock: low.length,
        activeDebts: debts.size,
      });
      setLowItems(low.slice(0, 5).map((docSnap) => ({
        id: docSnap.id,
        name: docSnap.data()["name"] as string,
        currentStock: docSnap.data()["currentStock"] as number,
        minimumStock: docSnap.data()["minimumStock"] as number,
      })));
      setExpiringMembers(expiringList.slice(0, 5));
      setRecentTx(txSnap.docs.map((docSnap) => ({
        id: docSnap.id,
        items: (docSnap.data()["items"] ?? []) as { productName: string; quantity: number }[],
        total: docSnap.data()["total"] as number,
        status: docSnap.data()["status"] as string,
        createdAt: docSnap.data()["createdAt"] as string,
        createdBy: docSnap.data()["createdBy"] as string,
      })));
      setActiveComps(
        compSnap.docs
          .filter((docSnap) => {
            if ((docSnap.data()["status"] as string | undefined) === "finished") return false;
            const startDate = docSnap.data()["startDate"] as string;
            const endDate = docSnap.data()["endDate"] as string;
            return today >= startDate && today <= endDate;
          })
          .map((docSnap) => ({
            id: docSnap.id,
            name: docSnap.data()["name"] as string,
            participantCount: (docSnap.data()["participantCount"] as number | undefined) ?? 0,
            endDate: docSnap.data()["endDate"] as string,
          }))
          .sort((a, b) => a.endDate.localeCompare(b.endDate))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal memuat dashboard");
    } finally {
      setLoading(false);
    }
  }

  const fname = displayName?.split(" ")[0] ?? "Owner";
  const actions = buildActions(stats, lowItems, expiringMembers, activeComps);

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div className="flex flex-col gap-5 border-b border-slate-100 px-5 py-5 sm:flex-row sm:items-end sm:justify-between lg:px-7">
          <div>
            <p className="text-sm font-medium text-slate-500">{todayLabel()}</p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-950">
              {greeting(fname)}
            </h1>
          </div>
          <Link
            href="/pos"
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-slate-950 px-5 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-slate-800 sm:w-auto"
          >
            <Icon name="monitor" className="h-4 w-4" />
            Buka Kasir
          </Link>
        </div>

        <div className="grid grid-cols-1 divide-y divide-slate-100 sm:grid-cols-2 sm:divide-x sm:divide-y-0 xl:grid-cols-4">
          <HeroStat label="Pendapatan Hari Ini" value={loading ? null : fmt(todayRevenue)} />
          <HeroStat
            label="Transaksi Hari Ini"
            value={loading ? null : String(todayTxCount)}
            sub={todayTxCount > 0 ? "sudah masuk" : "belum ada"}
          />
          <HeroStat
            label="Membership Aktif"
            value={loading ? null : String(stats?.activeMemberships ?? 0)}
            sub={`dari ${stats?.customers ?? 0} pelanggan`}
          />
          <HeroStat
            label="Perlu Tindakan"
            value={loading ? null : String(actions.length)}
            sub={actions.length === 0 ? "semua aman" : "lihat ringkasan"}
            highlight={actions.length > 0}
          />
        </div>
      </section>

      {error && (
        <section className="flex flex-col gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 sm:flex-row sm:items-center sm:justify-between">
          <span>{error}</span>
          <button
            onClick={() => void loadAll()}
            className="rounded-lg bg-white px-3 py-2 text-xs font-bold text-red-700 ring-1 ring-red-200"
          >
            Coba lagi
          </button>
        </section>
      )}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-5">
        <div className="space-y-6 xl:col-span-3">
          <section>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-xs font-bold uppercase tracking-wide text-slate-500">
                Yang Perlu Tindakan
              </h2>
              {!loading && actions.length > 0 && (
                <span className="text-xs text-slate-400">{actions.length} item</span>
              )}
            </div>
            <ActionList loading={loading} actions={actions} />
          </section>

          <section>
            <h2 className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-500">
              Akses Cepat
            </h2>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
              {quickLinks.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="flex min-h-24 flex-col items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-4 text-center transition hover:border-slate-300 hover:shadow-sm"
                >
                  <Icon name={item.icon} className="h-5 w-5 text-slate-500" />
                  <span className="text-xs font-semibold text-slate-700">{item.label}</span>
                </Link>
              ))}
            </div>
          </section>
        </div>

        <section className="xl:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-xs font-bold uppercase tracking-wide text-slate-500">
              Aktivitas Terbaru
            </h2>
            <Link href="/transactions" className="text-xs font-semibold text-blue-600 hover:underline">
              Lihat semua
            </Link>
          </div>
          <RecentActivity loading={loading} transactions={recentTx} />
        </section>
      </div>
    </div>
  );
}

const quickLinks: { href: string; icon: IconName; label: string }[] = [
  { href: "/pos", icon: "monitor", label: "Kasir" },
  { href: "/customers", icon: "users", label: "Pelanggan" },
  { href: "/transfer", icon: "transfer", label: "Transfer" },
  { href: "/inventory", icon: "package", label: "Stok" },
  { href: "/transactions", icon: "receipt", label: "Transaksi" },
  { href: "/reports", icon: "activity", label: "Laporan" },
];

function buildActions(
  stats: Stats | null,
  lowItems: LowStockItem[],
  expiringMembers: ExpiringMember[],
  activeComps: ActiveCompetition[]
) {
  const actions: ActionItem[] = [];

  if ((stats?.lowStock ?? 0) > 0) {
    actions.push({
      key: "low-stock",
      icon: "package",
      title: `${stats!.lowStock} stok menipis`,
      detail: lowItems[0]
        ? `${lowItems[0].name}, ${lowItems[0].currentStock}/${lowItems[0].minimumStock}`
        : "Cek inventory",
      href: "/inventory",
      severity: "high",
    });
  }

  if ((stats?.activeDebts ?? 0) > 0) {
    actions.push({
      key: "debts",
      icon: "creditCard",
      title: `${stats!.activeDebts} utang aktif`,
      detail: "Tagihan belum lunas",
      href: "/transactions",
      severity: "high",
    });
  }

  if ((stats?.expiringSoon ?? 0) > 0) {
    actions.push({
      key: "expiring",
      icon: "clock",
      title: `${stats!.expiringSoon} membership akan expired`,
      detail: expiringMembers[0]
        ? `${expiringMembers[0].customerName}, ${expiringMembers[0].daysLeft} hari lagi`
        : "Dalam 7 hari",
      href: "/customers",
      severity: "medium",
    });
  }

  if (activeComps.length > 0) {
    const competition = activeComps[0]!;
    const daysLeft = daysFromNow(competition.endDate);
    actions.push({
      key: "competition",
      icon: "trophy",
      title: activeComps.length === 1 ? competition.name : `${activeComps.length} lomba berjalan`,
      detail: activeComps.length === 1
        ? `${competition.participantCount} peserta, ${daysLeft} hari lagi`
        : "Pantau progress",
      href: "/lomba",
      severity: daysLeft <= 3 ? "high" : "low",
    });
  }

  return actions;
}

function HeroStat({
  label,
  value,
  sub,
  highlight,
}: {
  label: string;
  value: string | null;
  sub?: string;
  highlight?: boolean;
}) {
  return (
    <div className="px-5 py-5 lg:px-7">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 text-2xl font-bold tabular-nums ${highlight ? "text-amber-600" : "text-slate-950"}`}>
        {value === null ? <span className="inline-block h-7 w-24 animate-pulse rounded bg-slate-100" /> : value}
      </p>
      {sub && <p className="mt-0.5 text-xs text-slate-500">{sub}</p>}
    </div>
  );
}

function ActionList({ loading, actions }: { loading: boolean; actions: ActionItem[] }) {
  if (loading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3].map((item) => (
          <div key={item} className="h-16 animate-pulse rounded-xl bg-slate-100" />
        ))}
      </div>
    );
  }

  if (actions.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-8 text-center">
        <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
          <Icon name="check" className="h-5 w-5" />
        </div>
        <p className="text-sm font-semibold text-slate-700">Semua beres hari ini</p>
        <p className="mt-1 text-xs text-slate-400">Tidak ada hal mendesak yang perlu perhatian</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {actions.map((action) => (
        <ActionCard key={action.key} action={action} />
      ))}
    </div>
  );
}

function ActionCard({ action }: { action: ActionItem }) {
  const style = {
    high: "border-red-200 bg-red-50 text-red-700",
    medium: "border-amber-200 bg-amber-50 text-amber-700",
    low: "border-blue-200 bg-blue-50 text-blue-700",
  }[action.severity];

  return (
    <Link
      href={action.href}
      className={`flex items-center gap-4 rounded-xl border px-5 py-4 transition hover:brightness-95 ${style}`}
    >
      <Icon name={action.icon} className="h-5 w-5 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-bold">{action.title}</p>
        <p className="mt-0.5 truncate text-xs text-slate-500">{action.detail}</p>
      </div>
      <Icon name="arrowRight" className="h-4 w-4 shrink-0 text-slate-400" />
    </Link>
  );
}

function RecentActivity({ loading, transactions }: { loading: boolean; transactions: RecentTx[] }) {
  if (loading) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white px-4 py-2">
        {[1, 2, 3, 4].map((item) => (
          <div key={item} className="flex items-center gap-3 py-2.5">
            <div className="h-9 w-9 animate-pulse rounded-xl bg-slate-100" />
            <div className="flex-1 space-y-1.5">
              <div className="h-3 w-3/4 animate-pulse rounded bg-slate-100" />
              <div className="h-2 w-1/2 animate-pulse rounded bg-slate-100" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (transactions.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white px-5 py-10 text-center">
        <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-500">
          <Icon name="receipt" className="h-5 w-5" />
        </div>
        <p className="text-sm font-medium text-slate-600">Belum ada transaksi</p>
        <Link href="/pos" className="mt-3 inline-block text-xs font-semibold text-blue-600 hover:underline">
          Buka kasir untuk mulai
        </Link>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="divide-y divide-slate-100">
        {transactions.map((tx) => {
          const txItems = tx.items ?? [];
          const label = txItems.length === 0
            ? "-"
            : txItems.length === 1
              ? `${txItems[0]!.productName} x${txItems[0]!.quantity}`
              : `${txItems[0]!.productName} +${txItems.length - 1} lainnya`;
          const reversed = tx.status === "reversed";

          return (
            <div key={tx.id} className="flex items-center gap-3 px-4 py-3">
              <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
                reversed
                  ? "bg-red-50 text-red-500"
                  : tx.createdBy === "owner"
                    ? "bg-slate-100 text-slate-600"
                    : "bg-blue-50 text-blue-600"
              }`}
              >
                <Icon
                  name={reversed ? "rotateBack" : tx.createdBy === "owner" ? "user" : "monitor"}
                  className="h-4 w-4"
                />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-slate-800">{label}</p>
                <p className="mt-0.5 text-xs text-slate-400">{txTime(tx.createdAt)}</p>
              </div>
              <p className={`shrink-0 text-sm font-bold ${reversed ? "text-slate-300 line-through" : "text-slate-950"}`}>
                {fmt(tx.total)}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
