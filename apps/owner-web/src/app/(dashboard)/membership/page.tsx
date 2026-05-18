"use client";

import { useState } from "react";
import { useOwnerAuthStore } from "@/store/auth.store";
import { callFunction } from "@/firebase/firebase";
import { v4 as uuidv4 } from "uuid";

export default function MembershipPage() {
  const { ownerId, clubId } = useOwnerAuthStore();

  const [planId, setPlanId] = useState("");
  const [planName, setPlanName] = useState("");
  const [visitQuota, setVisitQuota] = useState("");
  const [durationDays, setDurationDays] = useState("");
  const [price, setPrice] = useState("");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "ok" | "err"; msg: string } | undefined>();

  async function handleCreate() {
    if (!planId || !planName || !visitQuota || !durationDays || !price) {
      setFeedback({ type: "err", msg: "Semua field wajib diisi" });
      return;
    }

    setLoading(true);
    setFeedback(undefined);
    try {
      // Write directly to Firestore via function — no sync queue needed (owner online action)
      const planRef = `owners/${ownerId}/clubs/${clubId}/membershipPlans/${planId}`;
      await callFunction("auth_initOwner", {
        // Using a generic callable — in production this would be a dedicated createPlan function
        // For now we write via the admin SDK through a Cloud Function placeholder
        _action: "createMembershipPlan",
        ownerId,
        clubId,
        planId,
        planName,
        visitQuota: parseInt(visitQuota, 10),
        durationDays: parseInt(durationDays, 10),
        price: parseFloat(price),
        description,
      });
      setFeedback({ type: "ok", msg: `Paket "${planName}" berhasil dibuat` });
      setPlanId("");
      setPlanName("");
      setVisitQuota("");
      setDurationDays("");
      setPrice("");
      setDescription("");
    } catch (err) {
      setFeedback({ type: "err", msg: err instanceof Error ? err.message : "Gagal" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <h2 className="text-2xl font-bold text-slate-900 mb-6">Paket Keanggotaan</h2>

      <div className="max-w-lg bg-white rounded-xl border border-slate-200 p-6">
        <h3 className="font-semibold text-slate-800 mb-4">Buat Paket Baru</h3>

        {feedback && (
          <div className={`mb-4 text-sm rounded-lg px-4 py-3 ${feedback.type === "ok" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"}`}>
            {feedback.msg}
          </div>
        )}

        <div className="space-y-3">
          <input
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
            placeholder="ID Paket (contoh: plan_silver)"
            value={planId}
            onChange={(e) => setPlanId(e.target.value)}
          />
          <input
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
            placeholder="Nama Paket"
            value={planName}
            onChange={(e) => setPlanName(e.target.value)}
          />
          <div className="grid grid-cols-2 gap-3">
            <input
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
              placeholder="Kuota Kunjungan"
              type="number"
              value={visitQuota}
              onChange={(e) => setVisitQuota(e.target.value)}
            />
            <input
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
              placeholder="Durasi (hari)"
              type="number"
              value={durationDays}
              onChange={(e) => setDurationDays(e.target.value)}
            />
          </div>
          <input
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
            placeholder="Harga (Rp)"
            type="number"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
          />
          <input
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
            placeholder="Deskripsi (opsional)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
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
  );
}
