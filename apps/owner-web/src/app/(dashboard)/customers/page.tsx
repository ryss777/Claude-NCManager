"use client";

import { useEffect, useState } from "react";
import { collection, getDocs, query, where, orderBy } from "firebase/firestore";
import { useOwnerAuthStore } from "@/store/auth.store";
import { callFunction, firebaseDb } from "@/firebase/firebase";
import { v4 as uuidv4 } from "uuid";

interface Customer {
  id: string;
  displayName: string;
  phone: string | null;
  email: string | null;
  activeMembershipId: string | null;
  createdAt: string;
}

interface Membership {
  id: string;
  customerId: string;
  planName: string;
  tier: string;
  visitRemaining: number;
  visitQuota: number;
  expiresAt: string;
  status: string;
}

interface Plan {
  id: string;
  name: string;
  tier: string;
  price: number;
}

export default function CustomersPage() {
  const { ownerId, clubId } = useOwnerAuthStore();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [memberships, setMemberships] = useState<Map<string, Membership>>(new Map());
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [selected, setSelected] = useState<Customer | null>(null);

  // Create customer form
  const [displayName, setDisplayName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [createLoading, setCreateLoading] = useState(false);
  const [createFeedback, setCreateFeedback] = useState<{ type: "ok" | "err"; msg: string } | undefined>();

  // Activate membership form
  const [activatePlanId, setActivatePlanId] = useState("");
  const [activateLoading, setActivateLoading] = useState(false);
  const [activateFeedback, setActivateFeedback] = useState<{ type: "ok" | "err"; msg: string } | undefined>();

  async function loadData() {
    if (!ownerId || !clubId) return;
    setLoadingList(true);
    const db = firebaseDb();
    const base = `owners/${ownerId}/clubs/${clubId}`;

    const [custSnap, memSnap, planSnap] = await Promise.all([
      getDocs(query(collection(db, `${base}/customers`), orderBy("createdAt", "desc"))),
      getDocs(query(collection(db, `${base}/memberships`), where("status", "==", "active"))),
      getDocs(query(collection(db, `${base}/membershipPlans`), where("isActive", "==", true))),
    ]);

    setCustomers(custSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Customer)));

    const memMap = new Map<string, Membership>();
    memSnap.docs.forEach((d) => {
      const m = { id: d.id, ...d.data() } as Membership;
      memMap.set(m.customerId, m);
    });
    setMemberships(memMap);

    setPlans(planSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Plan)));
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
      });
      setCreateFeedback({ type: "ok", msg: `Pelanggan "${displayName}" berhasil dibuat` });
      setDisplayName(""); setPhone(""); setEmail("");
      loadData();
    } catch (err) {
      setCreateFeedback({ type: "err", msg: err instanceof Error ? err.message : "Gagal" });
    } finally { setCreateLoading(false); }
  }

  async function handleActivate() {
    if (!selected || !activatePlanId) {
      setActivateFeedback({ type: "err", msg: "Pilih paket terlebih dahulu" });
      return;
    }
    setActivateLoading(true);
    setActivateFeedback(undefined);
    try {
      await callFunction("membership_activate", {
        ownerId, clubId,
        requestId: uuidv4(),
        operationId: uuidv4(),
        customerId: selected.id,
        planId: activatePlanId,
        transactionId: uuidv4(),
      });
      setActivateFeedback({ type: "ok", msg: "Membership berhasil diaktifkan" });
      setActivatePlanId("");
      loadData();
    } catch (err) {
      setActivateFeedback({ type: "err", msg: err instanceof Error ? err.message : "Gagal" });
    } finally { setActivateLoading(false); }
  }

  const fmt = (n: number) => new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);
  const TIER_COLOR: Record<string, string> = {
    basic: "bg-slate-100 text-slate-600",
    silver: "bg-slate-200 text-slate-700",
    gold: "bg-yellow-50 text-yellow-700",
    platinum: "bg-blue-50 text-blue-700",
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
                    <th className="px-4 py-2 text-left">Nama</th>
                    <th className="px-4 py-2 text-left">Kontak</th>
                    <th className="px-4 py-2 text-left">Membership</th>
                    <th className="px-4 py-2 text-right">Sisa Kunjungan</th>
                    <th className="px-4 py-2 text-left">Kadaluarsa</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {customers.map((c) => {
                    const mem = memberships.get(c.id);
                    const isSelected = selected?.id === c.id;
                    return (
                      <tr
                        key={c.id}
                        onClick={() => { setSelected(isSelected ? null : c); setActivateFeedback(undefined); setActivatePlanId(""); }}
                        className={`cursor-pointer hover:bg-slate-50 transition ${isSelected ? "bg-blue-50" : ""}`}
                      >
                        <td className="px-4 py-2.5 font-medium text-slate-800">{c.displayName}</td>
                        <td className="px-4 py-2.5 text-slate-400 text-xs">{c.phone ?? c.email ?? "—"}</td>
                        <td className="px-4 py-2.5">
                          {mem ? (
                            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${TIER_COLOR[mem.tier] ?? "bg-slate-100 text-slate-600"}`}>
                              {mem.planName}
                            </span>
                          ) : (
                            <span className="text-xs text-slate-300">Tidak aktif</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-right font-semibold text-slate-700">
                          {mem ? `${mem.visitRemaining} / ${mem.visitQuota}` : "—"}
                        </td>
                        <td className="px-4 py-2.5 text-slate-400 text-xs">
                          {mem ? mem.expiresAt.slice(0, 10) : "—"}
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
              <input className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" placeholder="Nama Lengkap *" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
              <div className="grid grid-cols-2 gap-3">
                <input className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" placeholder="No. HP (opsional)" value={phone} onChange={(e) => setPhone(e.target.value)} />
                <input className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" placeholder="Email (opsional)" value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <button onClick={handleCreate} disabled={createLoading} className="w-full bg-blue-600 text-white rounded-lg py-2.5 text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition">
                {createLoading ? "Menyimpan…" : "Tambah Pelanggan"}
              </button>
            </div>
          </div>
        </div>

        {/* Detail panel */}
        {selected && (
          <div className="w-72 shrink-0">
            <div className="bg-white rounded-xl border border-slate-200 p-6 sticky top-6">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h3 className="font-semibold text-slate-800">{selected.displayName}</h3>
                  <p className="text-xs text-slate-400 mt-0.5">{selected.phone ?? selected.email ?? "Tidak ada kontak"}</p>
                </div>
                <button onClick={() => setSelected(null)} className="text-slate-300 hover:text-slate-500 text-lg leading-none">×</button>
              </div>

              {/* Current membership */}
              {memberships.get(selected.id) ? (
                <div className="bg-slate-50 rounded-lg p-3 mb-5">
                  <p className="text-xs text-slate-500 mb-1">Membership Aktif</p>
                  {(() => {
                    const m = memberships.get(selected.id)!;
                    return (
                      <>
                        <p className="font-semibold text-slate-800">{m.planName}</p>
                        <p className="text-xs text-slate-500 mt-1">{m.visitRemaining} kunjungan tersisa · kadaluarsa {m.expiresAt.slice(0, 10)}</p>
                      </>
                    );
                  })()}
                </div>
              ) : (
                <div className="bg-amber-50 rounded-lg p-3 mb-5">
                  <p className="text-xs text-amber-700">Belum memiliki membership aktif</p>
                </div>
              )}

              {/* Activate membership */}
              <h4 className="text-sm font-semibold text-slate-700 mb-3">Aktifkan Membership</h4>
              {activateFeedback && (
                <div className={`mb-3 text-xs rounded-lg px-3 py-2 ${activateFeedback.type === "ok" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"}`}>
                  {activateFeedback.msg}
                </div>
              )}
              <div className="space-y-3">
                <select className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" value={activatePlanId} onChange={(e) => setActivatePlanId(e.target.value)}>
                  <option value="">— Pilih Paket —</option>
                  {plans.map((p) => (
                    <option key={p.id} value={p.id}>{p.name} · {fmt(p.price)}</option>
                  ))}
                </select>
                <button onClick={handleActivate} disabled={activateLoading || !activatePlanId} className="w-full bg-green-600 text-white rounded-lg py-2.5 text-sm font-semibold hover:bg-green-700 disabled:opacity-50 transition">
                  {activateLoading ? "Mengaktifkan…" : "Aktifkan"}
                </button>
              </div>

              <p className="text-xs text-slate-300 mt-4 font-mono">{selected.id}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
