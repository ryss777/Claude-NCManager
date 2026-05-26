"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { signOut, firebaseDb } from "@/firebase/firebase";
import { useOwnerAuthStore } from "@/store/auth.store";
import { Icon, type IconName } from "@/components/ui-icons";

type NavItem = { href: string; label: string; icon: IconName };

const NAV: NavItem[] = [
  { href: "/", label: "Beranda", icon: "home" },
  { href: "/pos", label: "POS", icon: "monitor" },
  { href: "/customers", label: "Pelanggan dan Membership", icon: "users" },
  { href: "/inventory", label: "Stok & Produk", icon: "package" },
  { href: "/club", label: "Manajemen Club", icon: "building" },
  { href: "/operators", label: "Tim & Perangkat", icon: "user" },
  { href: "/transactions", label: "Keuangan", icon: "creditCard" },
  { href: "/lomba", label: "Lomba", icon: "trophy" },
  { href: "/reports", label: "Laporan", icon: "activity" },
  { href: "/settings", label: "Pengaturan", icon: "settings" },
];

function isActivePath(pathname: string, href: string) {
  return pathname === href || (href !== "/" && pathname.startsWith(href));
}

function OwnerBadge({
  ownerId,
  clubId,
}: {
  ownerId: string | undefined;
  clubId: string | undefined;
}) {
  return (
    <p className="mt-0.5 truncate text-xs text-slate-400">
      {ownerId && clubId ? `${ownerId} / ${clubId}` : "Memuat tenant..."}
    </p>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { displayName, email, ownerId, clubId, isAdmin } = useOwnerAuthStore();
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    if (!ownerId) return;
    const unsub = onSnapshot(
      query(
        collection(firebaseDb(), `owners/${ownerId}/notifications`),
        where("isRead", "==", false)
      ),
      (snap) => setUnreadCount(snap.size),
      () => {}
    );
    return unsub;
  }, [ownerId]);

  async function handleSignOut() {
    await signOut();
    router.replace("/login");
  }

  return (
    <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-slate-200 bg-white lg:flex">
      <div className="border-b border-slate-100 px-6 py-5">
        <h1 className="text-lg font-bold text-slate-900">NC Manager</h1>
        <OwnerBadge ownerId={ownerId} clubId={clubId} />
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
        {NAV.map((item) => {
          const active = isActivePath(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition ${
                active
                  ? "bg-brand-50 text-brand-700 ring-1 ring-brand-100"
                  : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
              }`}
            >
              <Icon name={item.icon} className="h-4 w-4 shrink-0" />
              <span className="truncate">{item.label}</span>
            </Link>
          );
        })}
      </nav>

      {isAdmin && (
        <div className="px-3 pb-2">
          <Link
            href="/admin/catalog"
            className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition ${
              pathname.startsWith("/admin")
                ? "bg-brand-50 text-brand-700 ring-1 ring-brand-100"
                : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
            }`}
          >
            <Icon name="settings" className="h-4 w-4 shrink-0" />
            <span className="truncate">Katalog Global</span>
          </Link>
        </div>
      )}

      <div className="px-3 pb-2">
        <Link
          href="/notifications"
          className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition ${
            pathname === "/notifications"
              ? "bg-brand-50 text-brand-700 ring-1 ring-brand-100"
              : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
          }`}
        >
          <span className="relative">
            <Icon name="bell" className="h-4 w-4 shrink-0" />
            {unreadCount > 0 && (
              <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-500 px-0.5 text-[10px] font-bold leading-none text-white">
                {unreadCount > 99 ? "99+" : unreadCount}
              </span>
            )}
          </span>
          <span className="truncate">Notifikasi</span>
          {unreadCount > 0 && (
            <span className="ml-auto rounded-full bg-red-100 px-1.5 py-0.5 text-xs font-bold text-red-600">
              {unreadCount}
            </span>
          )}
        </Link>
      </div>

      <div className="border-t border-slate-100 px-4 py-4">
        <p className="truncate text-sm font-medium text-slate-800">
          {displayName ?? email ?? "Owner"}
        </p>
        <button
          onClick={handleSignOut}
          className="mt-2 text-xs font-medium text-red-500 hover:text-red-700"
        >
          Keluar
        </button>
      </div>
    </aside>
  );
}

export function MobileTopBar() {
  const pathname = usePathname();
  const router = useRouter();
  const { displayName, email, ownerId, clubId, isAdmin } = useOwnerAuthStore();
  const nav = isAdmin
    ? [...NAV, { href: "/admin/catalog", label: "Katalog", icon: "settings" as const }]
    : NAV;

  async function handleSignOut() {
    await signOut();
    router.replace("/login");
  }

  return (
    <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur lg:hidden">
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <p className="text-sm font-bold text-slate-900">NC Manager</p>
          <OwnerBadge ownerId={ownerId} clubId={clubId} />
          <p className="sr-only">{displayName ?? email ?? "Owner"}</p>
        </div>
        <button
          onClick={handleSignOut}
          className="shrink-0 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-xs font-semibold text-red-600"
        >
          Keluar
        </button>
      </div>
      <nav className="flex gap-2 overflow-x-auto px-4 pb-3">
        {nav.map((item) => {
          const active = isActivePath(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`inline-flex shrink-0 items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold ${
                active
                  ? "border-blue-200 bg-brand-50 text-brand-700"
                  : "border-slate-200 bg-white text-slate-600"
              }`}
            >
              <Icon name={item.icon} className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
