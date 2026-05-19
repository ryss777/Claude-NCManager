"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { signOut } from "@/firebase/firebase";
import { useOwnerAuthStore } from "@/store/auth.store";

const NAV = [
  { href: "/", label: "Beranda", icon: "⊞" },
  { href: "/pos", label: "Kasir Owner", icon: "🖥️" },
  { href: "/customers", label: "Pelanggan", icon: "🧑‍🤝‍🧑" },
  { href: "/membership", label: "Paket Member", icon: "⭐" },
  { href: "/inventory", label: "Produk & Stok", icon: "📦" },
  { href: "/operators", label: "Operator", icon: "👤" },
  { href: "/devices", label: "Device", icon: "📱" },
  { href: "/finance", label: "Keuangan", icon: "₿" },
  { href: "/reports", label: "Laporan", icon: "📊" },
];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { displayName, email, ownerId, clubId } = useOwnerAuthStore();

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
      <nav className="flex-1 px-3 py-4 space-y-1">
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
