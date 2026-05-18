"use client";

import { useEffect, useState } from "react";
import { collection, getDocs, query, orderBy } from "firebase/firestore";
import { useOwnerAuthStore } from "@/store/auth.store";
import { callFunction, firebaseDb } from "@/firebase/firebase";

type Tier = "basic" | "silver" | "gold" | "platinum";

const TIERS: Tier[] = ["basic", "silver", "gold", "platinum"];

const TIER_COLORS: Record<Tier, string> = {
  basic: "bg-slate-100 text-slate-600",
  silver: "bg-slate-200 text-slate-700",
  gold: "bg-yellow-50 text-yellow-700",
  platinum: "bg-blue-50 text-blue-700",
};

interface Plan {
  id: string;
  name: string;
  tier: Tier;
  price: number;
  visitQuota: number;
  durationDays: number;
  benefits: string[];
  isActive: boolean;
}

export default function MembershipPage() {
  const { ownerId, clubId } = useOwnerAuthStore();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loadingList, setLoadingList] = useState(true);

  const [name, setName] = useState("");
  const [tier, setTier] = useState<Tier>("silver");
  const [price, setPrice] = useState("");
  const [visitQuota, setVisitQuota] = useState("");
  const [durationDays, setDurationDays] = useState("");
  const [benefits, setBenefits] = useState("");
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "ok" | "err"; msg: string } | undefined>();

  async function loadPlans() {
    if (!ownerId || !clubId) return;
    setLoadingList(true);
    const snap = await getDocs(
      query(collection(firebaseDb(), `owners/${ownerId}/clubs/${clubId}/membershipPlans`), orderBy("createdAt", "desc"))
    );
    setPlans(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Plan)));
    setLoadingList(false);
  }

  useEffect(() => { loadPlans(); }, [ownerId, clubId]);

  async function handleCreate() {
    if (!name || !price || !visitQuota || !durationDays) {
      setFeedback({ type: "err", msg: "Nama, harga, kuota, dan durasi wajib diisi" });
      return;
    }
    setLoading(true);
    setFeedback(undefined);
    try {
      await callFunction("membership_createPlan", {
        ownerId,
        clubId,
        name,
        tier,
        price: parseFloat(price),
        visitQuota: parseInt(visitQuota, 10),
        durationDays: parseInt(durationDays, 10),
        benefits: benefits.split("\n").map((s) => s.trim()).filter(Boolean),
      });
      setFeedback({ type: "ok", msg: `Paket "${name}" berhasil dibuat` });
      setName(""); setPrice(""); setVisitQuota(""); setDurationDays(""); setBenefits("");
      loadPlans();
    } catch (err) {
      setFeedback({ type: "err", msg: err instanceof Error ? err.message : "Gagal" });
    } finally { setLoading(false); }
  }

  const fmt = (n: number) => new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);

  return (
    <div>
      <h2 className="text-2xl font-bold text-slate-900 mb-6">Paket Keanggotaan</h2>

      <div className="grid grid-cols-3 gap-4 mb-8">
        {loadingList ? (
          <p className="col-span-3 text-sm text-slate-400">Memuat…</p>
        ) : plans.length === 0 ? (
          <p className="col-span-3 text-sm text-slate-400">Belum ada paket.</p>
        ) : plans.map((p) => (
          <div key={p.id} className="bg-white rounded-xl border border-slate-200 p-5">
            <div className="flex items-center gap-2 mb-3">
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${TIER_COLORS[p.tier]}`}>{p.tier}</span>
              {!p.isActive && <span className="text-xs text-red-500">Nonaktif</span>}
            </div>
            <h4 className="font-semibold text-slate-800 mb-1">{p.name}</h4>
            <p className="text-xl font-bold text-slate-900 mb-3">{fmt(p.price)}</p>
            <div className="text-xs text-slate-500 space-y-1">
              <p>{p.visitQuota} kunjungan · {p.durationDays} hari</p>
              {p.benefits?.length > 0 && (
                <ul className="mt-2 space-y-0.5">
                  {p.benefits.map((b, i) => <li key={i}>• {b}</li>)}
                </ul>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="max-w-md bg-white rounded-xl border border-slate-200 p-6">
        <h3 className="font-semibold text-slate-800 mb-4">Buat Paket Baru</h3>
        {feedback && (
          <div className={`mb-4 text-sm rounded-lg px-4 py-3 ${feedback.type === "ok" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"}`}>
            {feedback.msg}
          </div>
        )}
        <div className="space-y-3">
          <input className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" placeholder="Nama Paket" value={name} onChange={(e) => setName(e.target.value)} />
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs text-slate-500">Tier</span>
              <select className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" value={tier} onChange={(e) => setTier(e.target.value as Tier)}>
                {TIERS.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-xs text-slate-500">Harga (Rp)</span>
              <input type="number" className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" value={price} onChange={(e) => setPrice(e.target.value)} />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs text-slate-500">Kuota Kunjungan</span>
              <input type="number" className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" value={visitQuota} onChange={(e) => setVisitQuota(e.target.value)} />
            </label>
            <label className="block">
              <span className="text-xs text-slate-500">Durasi (hari)</span>
              <input type="number" className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" value={durationDays} onChange={(e) => setDurationDays(e.target.value)} />
            </label>
          </div>
          <label className="block">
            <span className="text-xs text-slate-500">Benefit (satu per baris, opsional)</span>
            <textarea rows={3} className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" value={benefits} onChange={(e) => setBenefits(e.target.value)} />
          </label>
          <button onClick={handleCreate} disabled={loading} className="w-full bg-purple-600 text-white rounded-lg py-2.5 text-sm font-semibold hover:bg-purple-700 disabled:opacity-50 transition">
            {loading ? "Menyimpan…" : "Buat Paket"}
          </button>
        </div>
      </div>
    </div>
  );
}
