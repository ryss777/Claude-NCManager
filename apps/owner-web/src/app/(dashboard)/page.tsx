"use client";

import { useEffect, useState } from "react";
import { collection, getDocs, query, where } from "firebase/firestore";
import { useOwnerAuthStore } from "@/store/auth.store";
import { firebaseDb } from "@/firebase/firebase";

interface Stats {
  operators: number;
  plans: number;
  items: number;
  lowStock: number;
}

export default function DashboardHome() {
  const { displayName, ownerId, clubId } = useOwnerAuthStore();
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    if (!ownerId || !clubId) return;
    const db = firebaseDb();

    async function load() {
      const base = `owners/${ownerId}/clubs/${clubId}`;
      const [ops, plans, items] = await Promise.all([
        getDocs(query(collection(db, `${base}/operators`), where("isActive", "==", true))),
        getDocs(query(collection(db, `${base}/membershipPlans`), where("isActive", "==", true))),
        getDocs(collection(db, `${base}/inventoryItems`)),
      ]);
      const lowStock = items.docs.filter((d) => {
        const data = d.data();
        return (data.currentStock ?? 0) <= (data.minimumStock ?? 0);
      }).length;
      setStats({ operators: ops.size, plans: plans.size, items: items.size, lowStock });
    }
    load();
  }, [ownerId, clubId]);

  const cards = [
    { label: "Operator Aktif", value: stats?.operators, color: "text-green-700", bg: "bg-green-50" },
    { label: "Paket Member", value: stats?.plans, color: "text-purple-700", bg: "bg-purple-50" },
    { label: "Item Inventaris", value: stats?.items, color: "text-orange-700", bg: "bg-orange-50" },
    { label: "Stok Menipis", value: stats?.lowStock, color: "text-red-700", bg: "bg-red-50" },
  ];

  const navCards = [
    { label: "Keuangan", desc: "Jurnal & laporan shift", href: "/finance" },
    { label: "Operator", desc: "Kelola akses operator", href: "/operators" },
    { label: "Paket Member", desc: "Rencana keanggotaan", href: "/membership" },
    { label: "Inventaris", desc: "Level stok produk", href: "/inventory" },
  ];

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-slate-900">
          Selamat datang, {displayName?.split(" ")[0] ?? "Owner"}
        </h2>
        <p className="text-slate-400 text-sm mt-1">{ownerId} / {clubId}</p>
      </div>

      <div className="grid grid-cols-4 gap-4 mb-8">
        {cards.map((c) => (
          <div key={c.label} className={`rounded-xl p-5 ${c.bg}`}>
            <p className="text-sm text-slate-500 mb-1">{c.label}</p>
            <p className={`text-3xl font-bold ${c.color}`}>
              {stats === null ? "…" : (c.value ?? 0)}
            </p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-4 max-w-xl">
        {navCards.map((c) => (
          <a
            key={c.href}
            href={c.href}
            className="block bg-white rounded-xl border border-slate-200 p-6 hover:shadow-md transition"
          >
            <p className="font-semibold text-slate-800 mb-1">{c.label}</p>
            <p className="text-slate-500 text-sm">{c.desc}</p>
          </a>
        ))}
      </div>
    </div>
  );
}
