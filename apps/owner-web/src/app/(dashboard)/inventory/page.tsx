"use client";

import { useState } from "react";
import { useOwnerAuthStore } from "@/store/auth.store";
import { callFunction } from "@/firebase/firebase";
import { v4 as uuidv4 } from "uuid";

export default function InventoryPage() {
  const { ownerId, clubId } = useOwnerAuthStore();

  const [itemId, setItemId] = useState("");
  const [newStock, setNewStock] = useState("");
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "ok" | "err"; msg: string } | undefined>();

  async function handleAdjust() {
    const stock = parseInt(newStock, 10);
    if (!itemId || isNaN(stock) || stock < 0) {
      setFeedback({ type: "err", msg: "Isi ID item dan stok baru yang valid" });
      return;
    }

    setLoading(true);
    setFeedback(undefined);
    try {
      await callFunction("inventory_adjustStock", {
        ownerId,
        clubId,
        requestId: uuidv4(),
        operationId: uuidv4(),
        itemId,
        newStock: stock,
        reason: reason || "Physical count adjustment",
      });
      setFeedback({ type: "ok", msg: `Stok item ${itemId} diperbarui menjadi ${stock}` });
      setItemId("");
      setNewStock("");
      setReason("");
    } catch (err) {
      setFeedback({ type: "err", msg: err instanceof Error ? err.message : "Gagal" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <h2 className="text-2xl font-bold text-slate-900 mb-6">Inventaris</h2>

      <div className="max-w-lg bg-white rounded-xl border border-slate-200 p-6">
        <h3 className="font-semibold text-slate-800 mb-1">Penyesuaian Stok</h3>
        <p className="text-xs text-slate-400 mb-4">
          Perbarui stok absolut berdasarkan perhitungan fisik.
        </p>

        {feedback && (
          <div className={`mb-4 text-sm rounded-lg px-4 py-3 ${feedback.type === "ok" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"}`}>
            {feedback.msg}
          </div>
        )}

        <div className="space-y-3">
          <input
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
            placeholder="ID Item"
            value={itemId}
            onChange={(e) => setItemId(e.target.value)}
          />
          <input
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
            placeholder="Stok Baru"
            type="number"
            value={newStock}
            onChange={(e) => setNewStock(e.target.value)}
          />
          <input
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
            placeholder="Alasan (opsional)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <button
            onClick={handleAdjust}
            disabled={loading}
            className="w-full bg-orange-600 text-white rounded-lg py-2.5 text-sm font-semibold hover:bg-orange-700 disabled:opacity-50 transition"
          >
            {loading ? "Menyimpan…" : "Sesuaikan Stok"}
          </button>
        </div>
      </div>
    </div>
  );
}
