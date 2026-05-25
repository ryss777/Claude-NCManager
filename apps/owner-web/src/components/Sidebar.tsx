"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { signOut, firebaseDb } from "@/firebase/firebase";
import { useOwnerAuthStore } from "@/store/auth.store";

const NAV = [
  { href: "/", label: "Beranda", icon: "⊞" },
  { href: "/pos", label: "POS", icon: "🖥️" },
  { href: "/customers", label: "Pelanggan & Member", icon: "🧑‍🤝‍🧑" },
  { href: "/inventory", label: "Stok & Produk", icon: "📦" },
  { href: "/club",      label: "Manajemen Club", icon: "🏋️" },
  { href: "/operators", label: "Tim & Perangkat", icon: "👤" },
  { href: "/transactions", label: "Keuangan", icon: "💳" },
  { href: "/lomba", label: "Lomba", icon: "🏆" },
  { href: "/reports", label: "Laporan", icon: "📊" },
  { href: "/settings", label: "Pengaturan", icon: "⚙️" },
];

export function Sidebar() {
  const pathname = usePathname();
  const router   = useRouter();
  const { displayName, email, ownerId, clubId, isAdmin } = useOwnerAuthStore();

  const [unreadCount, setUnreadCount] = useState(0);

  // Live unread notification count via snapshot listener — no refetch on navigate.
  useEffect(() => {
    if (!ownerId) return;
    const unsub = onSnapshot(
      query(
        collection(firebaseDb(), `owners/${ownerId}/notifications`),
        where("isRead", "==", false)
      ),
      (snap) => setUnreadCount(snap.size),
      () => { /* ignore */ }
    );
    return unsub;
  }, [ownerId]);

  async function handleSignOut() {
    await signOut();
    router.replace("/login");
  }

  return (
    <aside className="w-60 shrink-0 bg-white border-r border-slate-200 flex flex-col h-screen sticky top-0">
      {/* Logo */}
      <div className="px-6 py-5 border-b border-slate-100">
        <h1 className="font-bold text-lg text-slate-900">NC Manager</h1>
        <p className="text-xs text-slate-400 mt-0.5 truncate">{ownerId} / {clubId}</p>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {NAV.map((item) => {
          const active = pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href));
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition ${
                active
                  ? "bg-brand-50 text-brand-700"
                  : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
              }`}
            >
              <span className="text-base">{item.icon}</span>
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* Admin link */}
      {isAdmin && (
        <div className="px-3 pb-2">
          <Link
            href="/admin/catalog"
            className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition ${
              pathname.startsWith("/admin")
                ? "bg-brand-50 text-brand-700"
                : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
            }`}
          >
            <span className="text-base">⚙️</span>
            Katalog Global
          </Link>
        </div>
      )}

      {/* Notifications bell */}
      <div className="px-3 pb-2">
        <Link
          href="/notifications"
          className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition ${
            pathname === "/notifications"
              ? "bg-brand-50 text-brand-700"
              : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
          }`}
        >
          <span className="relative text-base">
            🔔
            {unreadCount > 0 && (
              <span className="absolute -top-1.5 -right-1.5 min-w-[16px] h-4 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center px-0.5 leading-none">
                {unreadCount > 99 ? "99+" : unreadCount}
              </span>
            )}
          </span>
          Notifikasi
          {unreadCount > 0 && (
            <span className="ml-auto text-xs font-bold bg-red-100 text-red-600 px-1.5 py-0.5 rounded-full">
              {unreadCount}
            </span>
          )}
        </Link>
      </div>

      {/* User */}
      <div className="px-4 py-4 border-t border-slate-100">
        <p className="text-sm font-medium text-slate-800 truncate">{displayName ?? email ?? "Owner"}</p>
        <button
          onClick={handleSignOut}
          className="mt-2 text-xs text-red-500 hover:text-red-700 font-medium"
        >
          Keluar
        </button>
      </div>
    </aside>
  );
}
