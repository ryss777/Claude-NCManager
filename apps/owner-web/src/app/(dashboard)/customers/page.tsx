"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { collection, getDocs, query, where, orderBy } from "firebase/firestore";
import { useOwnerAuthStore } from "@/store/auth.store";
import { callFunction, firebaseDb } from "@/firebase/firebase";

type CustomerTier = "retail" | "ds" | "sc" | "sbQp" | "spv";
const TIER_LABELS: Record<CustomerTier, string> = { retail: "Retail", ds: "DS", sc: "SC", sbQp: "SB-QP", spv: "SPV" };

interface Customer {
  id: string;
  displayName: string;
  phone: string | null;
  email: string | null;
  tier: CustomerTier;
  activeMembershipId: string | null;
  createdAt: string;
}

interface Membership {
  id: string;
  customerId: string;
  planName: string;
  planType?: "regular" | "locker";
  tier: string;
  visitRemaining: number | null;
  visitQuota: number | null;
  expiresAt: string | null;
  status: string;
  blendingCredits?: number;
}

export default function CustomersPage() {
  const router = useRouter();
  const { ownerId, clubId } = useOwnerAuthStore();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [memberships, setMemberships] = useState<Map<string, Membership>>(new Map());
  const [loadingList, setLoadingList] = useState(true);
  const [sortKey, setSortKey] = useState<"name" | "tier" | "membership">("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const TIER_ORDER: Record<string, number> = { retail: 0, ds: 1, sc: 2, sbQp: 3, spv: 4 };

  function toggleSort(key: "name" | "tier" | "membership") {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("asc"); }
  }

  const sorted = useMemo(() => {
    const arr = [...customers];
    arr.sort((a, b) => {
      let cmp = 0;
      if (sortKey === "name") {
        cmp = a.displayName.localeCompare(b.displayName, "id");
      } else if (sortKey === "tier") {
        cmp = (TIER_ORDER[a.tier] ?? 0) - (TIER_ORDER[b.tier] ?? 0);
      } else {
        const ma = memberships.get(a.id);
        const mb = memberships.get(b.id);
        const na = ma ? ma.planName : "￿";
        const nb = mb ? mb.planName : "￿";
        cmp = na.localeCompare(nb, "id");
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [customers, memberships, sortKey, sortDir]);

  // Create customer form
  const [displayName, setDisplayName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [tier, setTier] = useState<CustomerTier>("retail");
  const [createLoading, setCreateLoading] = useState(false);
  const [createFeedback, setCreateFeedback] = useState<{ type: "ok" | "err"; msg: string } | undefined>();

  async function loadData() {
    if (!ownerId || !clubId) return;
    setLoadingList(true);
    const db = firebaseDb();
    const base = `owners/${ownerId}/clubs/${clubId}`;

    const [custSnap, memSnap] = await Promise.all([
      getDocs(query(collection(db, `${base}/customers`), orderBy("createdAt", "desc"))),
      getDocs(query(collection(db, `${base}/memberships`), where("status", "==", "active"))),
    ]);

    setCustomers(custSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Customer)));

    const memMap = new Map<string, Membership>();
    memSnap.docs.forEach((d) => {
      const m = { id: d.id, ...d.data() } as Membership;
      memMap.set(m.customerId, m);
    });
    setMemberships(memMap);
    setLoadingList(false);
  }

  useEffect(() => { loadData(); }, [ownerId, clubId]);

  async function handleCreate() {
    if (!displayName) {
      setCreateFeedback({ type: "err", msg: "Nama pelanggan wajib diisi" });
      return;
    }
    setCreateLoading(true);
    setCreateFeedback(undefined);
    try {
      await callFunction("customer_create", {
        ownerId, clubId,
        displayName,
        phone: phone || undefined,
        email: email || undefined,
        tier,
      });
      setCreateFeedback({ type: "ok", msg: `Pelanggan "${displayName}" berhasil dibuat` });
      setDisplayName(""); setPhone(""); setEmail(""); setTier("retail");
      loadData();
    } catch (err) {
      setCreateFeedback({ type: "err", msg: err instanceof Error ? err.message : "Gagal" });
    } finally { setCreateLoading(false); }
  }

  const TIER_COLOR: Record<string, string> = {
    basic: "bg-slate-100 text-slate-600",
    silver: "bg-slate-200 text-slate-700",
    gold: "bg-yellow-50 text-yellow-700",
    platinum: "bg-blue-50 text-blue-700",
    locker: "bg-purple-100 text-purple-700",
  };

  return (
    <div>
      <h2 className="text-2xl font-bold text-slate-900 mb-6">Pelanggan</h2>

      <div className="flex gap-6">
        {/* Customer list */}
        <div className="flex-1 min-w-0">
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden mb-6">
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
              <h3 className="font-semibold text-slate-800">
                Daftar Pelanggan <span className="text-slate-400 font-normal text-sm">({customers.length})</span>
              </h3>
              <button onClick={loadData} className="text-xs text-blue-600 hover:underline">Refresh</button>
            </div>

            {loadingList ? (
              <p className="text-sm text-slate-400 p-4">Memuat…</p>
            ) : customers.length === 0 ? (
              <p className="text-sm text-slate-400 p-4">Belum ada pelanggan.</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-500 text-xs">
                  <tr>
                    {(["name", "tier"] as const).map((key) => {
                      const label = key === "name" ? "Nama" : "Tier";
                      const active = sortKey === key;
                      return (
                        <th
                          key={key}
                          onClick={() => toggleSort(key)}
                          className="px-4 py-2 text-left cursor-pointer select-none hover:text-slate-700"
                        >
                          {label}
                          <span className="ml-1">{active ? (sortDir === "asc" ? "↑" : "↓") : <span className="opacity-30">↕</span>}</span>
                        </th>
                      );
                    })}
                    <th className="px-4 py-2 text-left">Kontak</th>
                    <th
                      onClick={() => toggleSort("membership")}
                      className="px-4 py-2 text-left cursor-pointer select-none hover:text-slate-700"
                    >
                      Membership
                      <span className="ml-1">{sortKey === "membership" ? (sortDir === "asc" ? "↑" : "↓") : <span className="opacity-30">↕</span>}</span>
                    </th>
                    <th className="px-4 py-2 text-right">Sisa Kuota</th>
                    <th className="px-4 py-2 text-left">Kadaluarsa</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {sorted.map((c) => {
                    const mem = memberships.get(c.id);
                    return (
                      <tr
                        key={c.id}
                        onClick={() => router.push(`/customers/${c.id}`)}
                        className="cursor-pointer hover:bg-slate-50 transition"
                      >
                        <td className="px-4 py-2.5 font-medium text-slate-800">{c.displayName}</td>
                        <td className="px-4 py-2.5">
                          <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                            {TIER_LABELS[c.tier] ?? c.tier}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-slate-400 text-xs">{c.phone ?? c.email ?? "—"}</td>
                        <td className="px-4 py-2.5">
                          {mem ? (
                            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${TIER_COLOR[mem.planType === "locker" ? "locker" : mem.tier] ?? "bg-slate-100 text-slate-600"}`}>
                              {mem.planName}
                            </span>
                          ) : (
                            <span className="text-xs text-slate-300">Tidak aktif</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-right font-semibold text-slate-700">
                          {mem?.planType === "locker"
                            ? `${mem.blendingCredits ?? 0} kredit`
                            : mem
                            ? `${mem.visitRemaining ?? 0} / ${mem.visitQuota ?? 0}`
                            : "—"}
                        </td>
                        <td className="px-4 py-2.5 text-slate-400 text-xs">
                          {mem?.expiresAt ? mem.expiresAt.slice(0, 10) : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          {/* Create customer form */}
          <div className="bg-white rounded-xl border border-slate-200 p-6 max-w-md">
            <h3 className="font-semibold text-slate-800 mb-4">Tambah Pelanggan</h3>
            {createFeedback && (
              <div className={`mb-3 text-sm rounded-lg px-3 py-2 ${createFeedback.type === "ok" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"}`}>
                {createFeedback.msg}
              </div>
            )}
            <div className="space-y-3">
              <input
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
                placeholder="Nama Lengkap *"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              />
              <div className="grid grid-cols-2 gap-3">
                <input className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" placeholder="No. HP (opsional)" value={phone} onChange={(e) => setPhone(e.target.value)} />
                <input className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" placeholder="Email (opsional)" value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">Level / Tier</label>
                <select className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" value={tier} onChange={(e) => setTier(e.target.value as CustomerTier)}>
                  {(Object.entries(TIER_LABELS) as [CustomerTier, string][]).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              </div>
              <button
                onClick={handleCreate}
                disabled={createLoading}
                className="w-full bg-blue-600 text-white rounded-lg py-2.5 text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition"
              >
                {createLoading ? "Menyimpan…" : "Tambah Pelanggan"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
