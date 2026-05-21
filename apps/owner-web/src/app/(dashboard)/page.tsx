"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { collection, getDocs, query, where } from "firebase/firestore";
import { useOwnerAuthStore } from "@/store/auth.store";
import { firebaseDb } from "@/firebase/firebase";

interface Stats {
  operators: number;
  plans: number;
  items: number;
  lowStock: number;
  customers: number;
  activeMemberships: number;
}

export default function DashboardHome() {
  const { displayName, ownerId, clubId } = useOwnerAuthStore();
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    if (!ownerId || !clubId) return;
    const db = firebaseDb();

    async function load() {
      const base = `owners/${ownerId}/clubs/${clubId}`;
      const [ops, plans, items, customers, memberships] = await Promise.all([
        getDocs(query(collection(db, `${base}/operators`), where("isActive", "==", true))),
        getDocs(query(collection(db, `${base}/membershipPlans`), where("isActive", "==", true))),
        getDocs(collection(db, `${base}/inventoryItems`)),
        getDocs(collection(db, `${base}/customers`)),
        getDocs(query(collection(db, `${base}/memberships`), where("status", "==", "active"))),
      ]);
      const lowStock = items.docs.filter((d) => {
        const data = d.data();
        return (data.currentStock ?? 0) <= (data.minimumStock ?? 0);
      }).length;
      setStats({
        operators: ops.size,
        plans: plans.size,
        items: items.size,
        lowStock,
        customers: customers.size,
        activeMemberships: memberships.size,
      });
    }
    load();
  }, [ownerId, clubId]);

  const statCards = [
    { label: "Pelanggan",        value: stats?.customers,          color: "text-blue-700",   bg: "bg-blue-50" },
    { label: "Member Aktif",     value: stats?.activeMemberships,  color: "text-green-700",  bg: "bg-green-50" },
    { label: "Operator Aktif",   value: stats?.operators,          color: "text-violet-700", bg: "bg-violet-50" },
    { label: "Paket Member",     value: stats?.plans,              color: "text-purple-700", bg: "bg-purple-50" },
    { label: "Item Inventaris",  value: stats?.items,              color: "text-orange-700", bg: "bg-orange-50" },
    { label: "Stok Menipis",     value: stats?.lowStock,           color: "text-red-700",    bg: "bg-red-50" },
  ];

  const navCards = [
    { label: "Kasir Owner",  desc: "Jual langsung ke pelanggan",   href: "/pos",         accent: "border-blue-300" },
    { label: "Pelanggan",    desc: "Daftar & kelola member",       href: "/customers",   accent: "border-blue-200" },
    { label: "Paket Member", desc: "Rencana keanggotaan",          href: "/membership",  accent: "border-purple-200" },
    { label: "Produk & Stok", desc: "Katalog, harga jual & stok",   href: "/inventory",   accent: "border-orange-200" },
    { label: "Operator",     desc: "Kelola akses operator",        href: "/operators",   accent: "border-violet-200" },
    { label: "Device",       desc: "Daftarkan perangkat kasir",    href: "/devices",     accent: "border-slate-200" },
    { label: "Keuangan",     desc: "Jurnal & laporan shift",       href: "/finance",     accent: "border-emerald-200" },
    { label: "Laporan",      desc: "Grafik pendapatan & performa", href: "/reports",     accent: "border-sky-200" },
    { label: "Pengaturan",   desc: "Profil club & zona waktu",     href: "/settings",    accent: "border-slate-200" },
  ];

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-slate-900">
          Selamat datang, {displayName?.split(" ")[0] ?? "Owner"}
        </h2>
        <p className="text-slate-400 text-sm mt-1">{ownerId} / {clubId}</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-6 gap-3 mb-8">
        {statCards.map((c) => (
          <div key={c.label} className={`rounded-xl p-4 ${c.bg}`}>
            <p className="text-xs text-slate-500 mb-1 truncate">{c.label}</p>
            <p className={`text-2xl font-bold ${c.color}`}>
              {stats === null ? "…" : (c.value ?? 0)}
            </p>
          </div>
        ))}
      </div>

      {/* Quick nav */}
      <div className="grid grid-cols-3 gap-3">
        {navCards.map((c) => (
          <Link
            key={c.href}
            href={c.href}
            className={`block bg-white rounded-xl border-2 ${c.accent} p-5 hover:shadow-md transition`}
          >
            <p className="font-semibold text-slate-800 mb-1">{c.label}</p>
            <p className="text-slate-500 text-xs">{c.desc}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
