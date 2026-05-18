"use client";

import { useOwnerAuthStore } from "@/store/auth.store";

export default function DashboardHome() {
  const { displayName, ownerId, clubId } = useOwnerAuthStore();

  const cards = [
    { label: "Keuangan", desc: "Jurnal & laporan shift", href: "/(dashboard)/finance", color: "bg-blue-50 text-blue-700" },
    { label: "Operator", desc: "Kelola akses operator", href: "/(dashboard)/operators", color: "bg-green-50 text-green-700" },
    { label: "Paket Member", desc: "Rencana keanggotaan", href: "/(dashboard)/membership", color: "bg-purple-50 text-purple-700" },
    { label: "Inventaris", desc: "Level stok produk", href: "/(dashboard)/inventory", color: "bg-orange-50 text-orange-700" },
  ];

  return (
    <div>
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-slate-900">
          Selamat datang, {displayName?.split(" ")[0] ?? "Owner"}
        </h2>
        <p className="text-slate-500 text-sm mt-1">
          {ownerId} / {clubId}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {cards.map((c) => (
          <a
            key={c.href}
            href={c.href}
            className="block bg-white rounded-xl border border-slate-200 p-6 hover:shadow-md transition"
          >
            <span className={`inline-block text-sm font-semibold px-3 py-1 rounded-full mb-3 ${c.color}`}>
              {c.label}
            </span>
            <p className="text-slate-600 text-sm">{c.desc}</p>
          </a>
        ))}
      </div>
    </div>
  );
}
