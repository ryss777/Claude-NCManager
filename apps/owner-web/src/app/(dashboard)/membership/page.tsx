"use client";

import { useEffect, useState } from "react";
import { collection, getDocs, query, orderBy, updateDoc, deleteDoc, doc } from "firebase/firestore";
import { useOwnerAuthStore } from "@/store/auth.store";
import { callFunction, firebaseDb } from "@/firebase/firebase";

type Tier = "basic" | "silver" | "gold" | "platinum";

const TIERS: Tier[] = ["basic", "silver", "gold", "platinum"];

const TIER_COLORS: Record<Tier, string> = {
  basic:    "bg-slate-100 text-slate-600",
  silver:   "bg-slate-200 text-slate-700",
  gold:     "bg-yellow-50 text-yellow-700",
  platinum: "bg-blue-50 text-blue-700",
};

interface Plan {
  id: string;
  name: string;
  tier: Tier;
  price: number;
  visitQuota: number;
  hasExpiry: boolean;
  durationDays: number | null;
  benefits: string[];
  isActive: boolean;
}

const fmt = (n: number) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);

export default function MembershipPage() {
  const { ownerId, clubId } = useOwnerAuthStore();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loadingList, setLoadingList] = useState(true);

  // Create form
  const [name, setName] = useState("");
  const [tier, setTier] = useState<Tier>("silver");
  const [price, setPrice] = useState("");
  const [visitQuota, setVisitQuota] = useState("");
  const [hasExpiry, setHasExpiry] = useState(true);
  const [durationDays, setDurationDays] = useState("");
  const [benefits, setBenefits] = useState("");
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "ok" | "err"; msg: string } | undefined>();

  // Edit state
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editTier, setEditTier] = useState<Tier>("silver");
  const [editPrice, setEditPrice] = useState("");
  const [editVisitQuota, setEditVisitQuota] = useState("");
  const [editHasExpiry, setEditHasExpiry] = useState(true);
  const [editDurationDays, setEditDurationDays] = useState("");
  const [editBenefits, setEditBenefits] = useState("");
  const [editSaving, setEditSaving] = useState(false);

  function planPath(planId?: string) {
    const base = `owners/${ownerId}/clubs/${clubId}/membershipPlans`;
    return planId ? `${base}/${planId}` : base;
  }

  async function loadPlans() {
    if (!ownerId || !clubId) return;
    setLoadingList(true);
    const snap = await getDocs(
      query(collection(firebaseDb(), planPath()), orderBy("createdAt", "desc"))
    );
    setPlans(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Plan)));
    setLoadingList(false);
  }

  useEffect(() => { loadPlans(); }, [ownerId, clubId]);

  async function handleCreate() {
    if (!name || !price || !visitQuota) {
      setFeedback({ type: "err", msg: "Nama, harga, dan kuota wajib diisi" });
      return;
    }
    if (hasExpiry && !durationDays) {
      setFeedback({ type: "err", msg: "Durasi wajib diisi jika expired aktif" });
      return;
    }
    setLoading(true);
    setFeedback(undefined);
    try {
      await callFunction("membership_createPlan", {
        ownerId, clubId, name, tier,
        price: parseFloat(price),
        visitQuota: parseInt(visitQuota, 10),
        hasExpiry,
        durationDays: hasExpiry ? parseInt(durationDays, 10) : undefined,
        benefits: benefits.split("\n").map((s) => s.trim()).filter(Boolean),
      });
      setFeedback({ type: "ok", msg: `Paket "${name}" berhasil dibuat` });
      setName(""); setPrice(""); setVisitQuota(""); setHasExpiry(true); setDurationDays(""); setBenefits("");
      loadPlans();
    } catch (err) {
      setFeedback({ type: "err", msg: err instanceof Error ? err.message : "Gagal" });
    } finally { setLoading(false); }
  }

  function startEdit(p: Plan) {
    setEditId(p.id);
    setEditName(p.name);
    setEditTier(p.tier);
    setEditPrice(p.price.toString());
    setEditVisitQuota(p.visitQuota.toString());
    setEditHasExpiry(p.hasExpiry ?? true);
    setEditDurationDays(p.durationDays?.toString() ?? "");
    setEditBenefits((p.benefits ?? []).join("\n"));
  }

  async function saveEdit() {
    if (!editId || !editName || !editPrice || !editVisitQuota) return;
    if (editHasExpiry && !editDurationDays) return;
    setEditSaving(true);
    try {
      await updateDoc(doc(firebaseDb(), planPath(editId)), {
        name: editName.trim(),
        tier: editTier,
        price: parseFloat(editPrice),
        visitQuota: parseInt(editVisitQuota, 10),
        hasExpiry: editHasExpiry,
        durationDays: editHasExpiry ? parseInt(editDurationDays, 10) : null,
        benefits: editBenefits.split("\n").map((s) => s.trim()).filter(Boolean),
        updatedAt: new Date().toISOString(),
      });
      setEditId(null);
      loadPlans();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Gagal menyimpan");
    } finally { setEditSaving(false); }
  }

  async function toggleActive(p: Plan) {
    try {
      await updateDoc(doc(firebaseDb(), planPath(p.id)), {
        isActive: !p.isActive,
        updatedAt: new Date().toISOString(),
      });
      loadPlans();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Gagal");
    }
  }

  async function handleDelete(p: Plan) {
    if (!confirm(`Hapus paket "${p.name}"? Tindakan ini tidak dapat dibatalkan.\n\nMembership aktif yang menggunakan paket ini tidak terpengaruh.`)) return;
    try {
      await deleteDoc(doc(firebaseDb(), planPath(p.id)));
      loadPlans();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Gagal menghapus");
    }
  }

  const active = plans.filter((p) => p.isActive);
  const inactive = plans.filter((p) => !p.isActive);

  return (
    <div>
      <h2 className="text-2xl font-bold text-slate-900 mb-6">Paket Keanggotaan</h2>

      <div className="flex gap-6">
        {/* Plan list */}
        <div className="flex-1 min-w-0">

          {loadingList ? (
            <p className="text-sm text-slate-400">Memuat…</p>
          ) : plans.length === 0 ? (
            <p className="text-sm text-slate-400">Belum ada paket.</p>
          ) : (
            <>
              {/* Active plans */}
              <div className="mb-6">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">
                  Aktif ({active.length})
                </p>
                {active.length === 0 ? (
                  <p className="text-sm text-slate-400">Tidak ada paket aktif.</p>
                ) : (
                  <div className="grid grid-cols-3 gap-4">
                    {active.map((p) =>
                      editId === p.id ? (
                        /* Inline edit card */
                        <div key={p.id} className="bg-blue-50 rounded-xl border-2 border-blue-300 p-4 space-y-2">
                          <input
                            className="w-full border border-blue-300 rounded-lg px-2 py-1.5 text-sm font-semibold"
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            placeholder="Nama paket"
                          />
                          <div className="grid grid-cols-2 gap-2">
                            <select
                              className="border border-blue-300 rounded px-2 py-1 text-xs"
                              value={editTier}
                              onChange={(e) => setEditTier(e.target.value as Tier)}
                            >
                              {TIERS.map((t) => <option key={t} value={t}>{t}</option>)}
                            </select>
                            <input
                              type="number"
                              className="border border-blue-300 rounded px-2 py-1 text-xs"
                              value={editPrice}
                              onChange={(e) => setEditPrice(e.target.value)}
                              placeholder="Harga"
                            />
                          </div>
                          <input
                            type="number"
                            className="border border-blue-300 rounded px-2 py-1 text-xs w-full"
                            value={editVisitQuota}
                            onChange={(e) => setEditVisitQuota(e.target.value)}
                            placeholder="Kuota kunjungan"
                          />
                          <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={editHasExpiry}
                              onChange={(e) => setEditHasExpiry(e.target.checked)}
                              className="rounded"
                            />
                            Ada tanggal kadaluarsa
                          </label>
                          {editHasExpiry && (
                            <input
                              type="number"
                              className="border border-blue-300 rounded px-2 py-1 text-xs w-full"
                              value={editDurationDays}
                              onChange={(e) => setEditDurationDays(e.target.value)}
                              placeholder="Durasi (hari)"
                            />
                          )}
                          <textarea
                            rows={2}
                            className="w-full border border-blue-300 rounded px-2 py-1 text-xs resize-none"
                            value={editBenefits}
                            onChange={(e) => setEditBenefits(e.target.value)}
                            placeholder="Benefit (satu per baris)"
                          />
                          <div className="flex gap-2 pt-1">
                            <button
                              onClick={saveEdit}
                              disabled={editSaving}
                              className="flex-1 bg-blue-600 text-white rounded-lg py-1.5 text-xs font-semibold hover:bg-blue-700 disabled:opacity-50"
                            >
                              {editSaving ? "…" : "Simpan"}
                            </button>
                            <button
                              onClick={() => setEditId(null)}
                              className="px-3 text-xs text-slate-400 hover:text-slate-600"
                            >
                              Batal
                            </button>
                          </div>
                        </div>
                      ) : (
                        /* Normal plan card */
                        <div key={p.id} className="bg-white rounded-xl border border-slate-200 p-5">
                          <div className="flex items-center gap-2 mb-3">
                            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${TIER_COLORS[p.tier]}`}>
                              {p.tier}
                            </span>
                          </div>
                          <h4 className="font-semibold text-slate-800 mb-1">{p.name}</h4>
                          <p className="text-xl font-bold text-slate-900 mb-3">{fmt(p.price)}</p>
                          <div className="text-xs text-slate-500 space-y-1 mb-4">
                            <p>
                              {p.visitQuota} kunjungan
                              {" · "}
                              {p.hasExpiry && p.durationDays
                                ? `${p.durationDays} hari`
                                : <span className="text-green-600 font-medium">Tidak ada expired</span>}
                            </p>
                            {p.benefits?.length > 0 && (
                              <ul className="mt-2 space-y-0.5">
                                {p.benefits.map((b, i) => <li key={i}>• {b}</li>)}
                              </ul>
                            )}
                          </div>
                          <div className="flex gap-2 border-t border-slate-100 pt-3">
                            <button
                              onClick={() => startEdit(p)}
                              className="flex-1 text-xs text-blue-600 hover:text-blue-800 font-medium py-1"
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => toggleActive(p)}
                              className="flex-1 text-xs text-amber-600 hover:text-amber-800 font-medium py-1"
                            >
                              Nonaktifkan
                            </button>
                            <button
                              onClick={() => handleDelete(p)}
                              className="flex-1 text-xs text-red-500 hover:text-red-700 font-medium py-1"
                            >
                              Hapus
                            </button>
                          </div>
                        </div>
                      )
                    )}
                  </div>
                )}
              </div>

              {/* Inactive plans */}
              {inactive.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">
                    Nonaktif ({inactive.length})
                  </p>
                  <div className="grid grid-cols-3 gap-4">
                    {inactive.map((p) => (
                      <div key={p.id} className="bg-white rounded-xl border border-slate-200 p-5 opacity-60">
                        <div className="flex items-center gap-2 mb-3">
                          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${TIER_COLORS[p.tier]}`}>
                            {p.tier}
                          </span>
                          <span className="text-xs text-red-400 font-medium">Nonaktif</span>
                        </div>
                        <h4 className="font-semibold text-slate-700 mb-1">{p.name}</h4>
                        <p className="text-lg font-bold text-slate-600 mb-3">{fmt(p.price)}</p>
                        <p className="text-xs text-slate-400 mb-4">
                          {p.visitQuota} kunjungan
                          {" · "}
                          {p.hasExpiry && p.durationDays ? `${p.durationDays} hari` : "Tidak ada expired"}
                        </p>
                        <div className="flex gap-2 border-t border-slate-100 pt-3">
                          <button
                            onClick={() => toggleActive(p)}
                            className="flex-1 text-xs text-green-600 hover:text-green-800 font-medium py-1"
                          >
                            Aktifkan
                          </button>
                          <button
                            onClick={() => handleDelete(p)}
                            className="flex-1 text-xs text-red-500 hover:text-red-700 font-medium py-1"
                          >
                            Hapus
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Create form */}
        <div className="w-72 shrink-0">
          <div className="bg-white rounded-xl border border-slate-200 p-6 sticky top-6">
            <h3 className="font-semibold text-slate-800 mb-4">Buat Paket Baru</h3>
            {feedback && (
              <div className={`mb-4 text-sm rounded-lg px-4 py-3 ${feedback.type === "ok" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"}`}>
                {feedback.msg}
              </div>
            )}
            <div className="space-y-3">
              <input
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
                placeholder="Nama Paket"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-xs text-slate-500">Tier</span>
                  <select
                    className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
                    value={tier}
                    onChange={(e) => setTier(e.target.value as Tier)}
                  >
                    {TIERS.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className="text-xs text-slate-500">Harga (Rp)</span>
                  <input
                    type="number"
                    className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                  />
                </label>
              </div>
              <label className="block">
                <span className="text-xs text-slate-500">Kuota Kunjungan</span>
                <input
                  type="number"
                  className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
                  value={visitQuota}
                  onChange={(e) => setVisitQuota(e.target.value)}
                />
              </label>

              <label className="flex items-center gap-3 py-1 cursor-pointer select-none">
                <div
                  onClick={() => setHasExpiry(!hasExpiry)}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${hasExpiry ? "bg-purple-600" : "bg-slate-200"}`}
                >
                  <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${hasExpiry ? "translate-x-4" : "translate-x-1"}`} />
                </div>
                <span className="text-sm text-slate-700">Ada tanggal kadaluarsa</span>
              </label>

              {hasExpiry && (
                <label className="block">
                  <span className="text-xs text-slate-500">Durasi (hari)</span>
                  <input
                    type="number"
                    className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
                    placeholder="Contoh: 30"
                    value={durationDays}
                    onChange={(e) => setDurationDays(e.target.value)}
                  />
                </label>
              )}
              <label className="block">
                <span className="text-xs text-slate-500">Benefit (satu per baris, opsional)</span>
                <textarea
                  rows={3}
                  className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
                  value={benefits}
                  onChange={(e) => setBenefits(e.target.value)}
                />
              </label>
              <button
                onClick={handleCreate}
                disabled={loading}
                className="w-full bg-purple-600 text-white rounded-lg py-2.5 text-sm font-semibold hover:bg-purple-700 disabled:opacity-50 transition"
              >
                {loading ? "Menyimpan…" : "Buat Paket"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
