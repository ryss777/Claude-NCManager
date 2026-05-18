"use client";

import { useState } from "react";
import { useOwnerAuthStore } from "@/store/auth.store";
import { callFunction } from "@/firebase/firebase";
import { v4 as uuidv4 } from "uuid";

export default function OperatorsPage() {
  const { ownerId, clubId } = useOwnerAuthStore();

  const [operatorId, setOperatorId] = useState("");
  const [name, setName] = useState("");
  const [pin, setPin] = useState("");
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "ok" | "err"; msg: string } | undefined>();

  async function handleCreate() {
    if (!operatorId || !name || pin.length < 4) {
      setFeedback({ type: "err", msg: "ID, nama, dan PIN (min 4 digit) wajib diisi" });
      return;
    }

    setLoading(true);
    setFeedback(undefined);
    try {
      await callFunction("auth_createOperator", {
        ownerId,
        clubId,
        requestId: uuidv4(),
        operationId: uuidv4(),
        operatorId,
        name,
        pin,
      });
      setFeedback({ type: "ok", msg: `Operator ${name} berhasil dibuat` });
      setOperatorId("");
      setName("");
      setPin("");
    } catch (err) {
      setFeedback({ type: "err", msg: err instanceof Error ? err.message : "Gagal membuat operator" });
    } finally {
      setLoading(false);
    }
  }

  // Update PIN
  const [updateTargetId, setUpdateTargetId] = useState("");
  const [newPin, setNewPin] = useState("");
  const [updateLoading, setUpdateLoading] = useState(false);
  const [updateFeedback, setUpdateFeedback] = useState<{ type: "ok" | "err"; msg: string } | undefined>();

  async function handleUpdatePin() {
    if (!updateTargetId || newPin.length < 4) {
      setUpdateFeedback({ type: "err", msg: "ID operator dan PIN baru (min 4 digit) wajib diisi" });
      return;
    }

    setUpdateLoading(true);
    setUpdateFeedback(undefined);
    try {
      await callFunction("auth_updateOperatorPin", {
        ownerId,
        clubId,
        requestId: uuidv4(),
        operationId: uuidv4(),
        operatorId: updateTargetId,
        newPin,
      });
      setUpdateFeedback({ type: "ok", msg: "PIN berhasil diperbarui" });
      setUpdateTargetId("");
      setNewPin("");
    } catch (err) {
      setUpdateFeedback({ type: "err", msg: err instanceof Error ? err.message : "Gagal memperbarui PIN" });
    } finally {
      setUpdateLoading(false);
    }
  }

  return (
    <div>
      <h2 className="text-2xl font-bold text-slate-900 mb-6">Operator</h2>

      <div className="grid grid-cols-2 gap-6 max-w-3xl">
        {/* Create */}
        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <h3 className="font-semibold text-slate-800 mb-4">Buat Operator Baru</h3>

          {feedback && (
            <div className={`mb-3 text-sm rounded-lg px-3 py-2 ${feedback.type === "ok" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"}`}>
              {feedback.msg}
            </div>
          )}

          <div className="space-y-3">
            <input className="input" placeholder="ID Operator" value={operatorId} onChange={(e) => setOperatorId(e.target.value)} />
            <input className="input" placeholder="Nama Lengkap" value={name} onChange={(e) => setName(e.target.value)} />
            <input className="input" placeholder="PIN (min 4 digit)" type="password" value={pin} onChange={(e) => setPin(e.target.value)} />
            <button onClick={handleCreate} disabled={loading} className="w-full bg-green-600 text-white rounded-lg py-2.5 text-sm font-semibold hover:bg-green-700 disabled:opacity-50 transition">
              {loading ? "Menyimpan…" : "Buat Operator"}
            </button>
          </div>
        </div>

        {/* Update PIN */}
        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <h3 className="font-semibold text-slate-800 mb-4">Ubah PIN Operator</h3>

          {updateFeedback && (
            <div className={`mb-3 text-sm rounded-lg px-3 py-2 ${updateFeedback.type === "ok" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"}`}>
              {updateFeedback.msg}
            </div>
          )}

          <div className="space-y-3">
            <input className="input" placeholder="ID Operator" value={updateTargetId} onChange={(e) => setUpdateTargetId(e.target.value)} />
            <input className="input" placeholder="PIN Baru" type="password" value={newPin} onChange={(e) => setNewPin(e.target.value)} />
            <button onClick={handleUpdatePin} disabled={updateLoading} className="w-full bg-blue-600 text-white rounded-lg py-2.5 text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition">
              {updateLoading ? "Menyimpan…" : "Perbarui PIN"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
