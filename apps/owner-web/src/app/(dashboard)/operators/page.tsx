"use client";

import { useEffect, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
import { useOwnerAuthStore } from "@/store/auth.store";
import { callFunction, firebaseDb } from "@/firebase/firebase";
import { v4 as uuidv4 } from "uuid";

interface Operator {
  id: string;
  displayName: string;
  isActive: boolean;
  allowedDeviceIds: string[];
  createdAt: string;
}

export default function OperatorsPage() {
  const { ownerId, clubId } = useOwnerAuthStore();
  const [operators, setOperators] = useState<Operator[]>([]);
  const [loadingList, setLoadingList] = useState(true);

  const [displayName, setDisplayName] = useState("");
  const [pin, setPin] = useState("");
  const [deviceIds, setDeviceIds] = useState("");
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "ok" | "err"; msg: string } | undefined>();

  const [updateTargetId, setUpdateTargetId] = useState("");
  const [newPin, setNewPin] = useState("");
  const [updateLoading, setUpdateLoading] = useState(false);
  const [updateFeedback, setUpdateFeedback] = useState<{ type: "ok" | "err"; msg: string } | undefined>();

  async function loadOperators() {
    if (!ownerId || !clubId) return;
    setLoadingList(true);
    const snap = await getDocs(collection(firebaseDb(), `owners/${ownerId}/clubs/${clubId}/operators`));
    setOperators(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Operator)));
    setLoadingList(false);
  }

  useEffect(() => { loadOperators(); }, [ownerId, clubId]);

  async function handleCreate() {
    if (!displayName || pin.length !== 6 || !/^\d{6}$/.test(pin)) {
      setFeedback({ type: "err", msg: "Nama dan PIN 6 digit angka wajib diisi" });
      return;
    }
    setLoading(true);
    setFeedback(undefined);
    try {
      const allowedDeviceIds = deviceIds.split(",").map((s) => s.trim()).filter(Boolean);
      await callFunction("auth_createOperator", { ownerId, clubId, displayName, pin, allowedDeviceIds });
      setFeedback({ type: "ok", msg: `Operator "${displayName}" berhasil dibuat` });
      setDisplayName(""); setPin(""); setDeviceIds("");
      loadOperators();
    } catch (err) {
      setFeedback({ type: "err", msg: err instanceof Error ? err.message : "Gagal" });
    } finally { setLoading(false); }
  }

  async function handleUpdatePin() {
    if (!updateTargetId || newPin.length !== 6 || !/^\d{6}$/.test(newPin)) {
      setUpdateFeedback({ type: "err", msg: "ID operator dan PIN baru 6 digit wajib diisi" });
      return;
    }
    setUpdateLoading(true);
    setUpdateFeedback(undefined);
    try {
      await callFunction("auth_updateOperatorPin", { ownerId, clubId, operatorId: updateTargetId, newPin });
      setUpdateFeedback({ type: "ok", msg: "PIN berhasil diperbarui" });
      setUpdateTargetId(""); setNewPin("");
    } catch (err) {
      setUpdateFeedback({ type: "err", msg: err instanceof Error ? err.message : "Gagal" });
    } finally { setUpdateLoading(false); }
  }

  return (
    <div>
      <h2 className="text-2xl font-bold text-slate-900 mb-6">Operator</h2>

      <div className="bg-white rounded-xl border border-slate-200 mb-6 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
          <h3 className="font-semibold text-slate-800">Daftar Operator</h3>
          <button onClick={loadOperators} className="text-xs text-blue-600 hover:underline">Refresh</button>
        </div>
        {loadingList ? (
          <p className="text-sm text-slate-400 p-4">Memuat…</p>
        ) : operators.length === 0 ? (
          <p className="text-sm text-slate-400 p-4">Belum ada operator.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs">
              <tr>
                <th className="px-4 py-2 text-left">ID</th>
                <th className="px-4 py-2 text-left">Nama</th>
                <th className="px-4 py-2 text-left">Status</th>
                <th className="px-4 py-2 text-left">Device</th>
                <th className="px-4 py-2 text-left">Dibuat</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {operators.map((op) => (
                <tr key={op.id} className="hover:bg-slate-50">
                  <td className="px-4 py-2 font-mono text-xs text-slate-500">{op.id}</td>
                  <td className="px-4 py-2 font-medium">{op.displayName}</td>
                  <td className="px-4 py-2">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${op.isActive ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"}`}>
                      {op.isActive ? "Aktif" : "Nonaktif"}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-slate-500 text-xs">{op.allowedDeviceIds?.join(", ") || "—"}</td>
                  <td className="px-4 py-2 text-slate-400 text-xs">{op.createdAt?.slice(0, 10)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="grid grid-cols-2 gap-6 max-w-2xl">
        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <h3 className="font-semibold text-slate-800 mb-4">Buat Operator Baru</h3>
          {feedback && (
            <div className={`mb-3 text-sm rounded-lg px-3 py-2 ${feedback.type === "ok" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"}`}>
              {feedback.msg}
            </div>
          )}
          <div className="space-y-3">
            <input className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" placeholder="Nama Lengkap" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
            <input className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" placeholder="PIN (6 digit angka)" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} />
            <input className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" placeholder="Device ID (pisah koma, opsional)" value={deviceIds} onChange={(e) => setDeviceIds(e.target.value)} />
            <button onClick={handleCreate} disabled={loading} className="w-full bg-green-600 text-white rounded-lg py-2.5 text-sm font-semibold hover:bg-green-700 disabled:opacity-50 transition">
              {loading ? "Menyimpan…" : "Buat Operator"}
            </button>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <h3 className="font-semibold text-slate-800 mb-4">Reset PIN Operator</h3>
          {updateFeedback && (
            <div className={`mb-3 text-sm rounded-lg px-3 py-2 ${updateFeedback.type === "ok" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"}`}>
              {updateFeedback.msg}
            </div>
          )}
          <div className="space-y-3">
            <input className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" placeholder="ID Operator" value={updateTargetId} onChange={(e) => setUpdateTargetId(e.target.value)} />
            <input className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" placeholder="PIN Baru (6 digit)" maxLength={6} value={newPin} onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ""))} />
            <button onClick={handleUpdatePin} disabled={updateLoading} className="w-full bg-blue-600 text-white rounded-lg py-2.5 text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition">
              {updateLoading ? "Menyimpan…" : "Reset PIN"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
