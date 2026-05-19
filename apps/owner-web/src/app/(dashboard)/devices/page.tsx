"use client";

import { useEffect, useState } from "react";
import { collection, getDocs, query, orderBy } from "firebase/firestore";
import { useOwnerAuthStore } from "@/store/auth.store";
import { callFunction, firebaseDb } from "@/firebase/firebase";

interface Device {
  id: string;
  deviceName: string;
  platform: "android" | "ios";
  isActive: boolean;
  operatorId: string | null;
  lastSeenAt: string;
  registeredAt: string;
}

export default function DevicesPage() {
  const { ownerId, clubId } = useOwnerAuthStore();
  const [devices, setDevices] = useState<Device[]>([]);
  const [loadingList, setLoadingList] = useState(true);

  const [deviceName, setDeviceName] = useState("");
  const [platform, setPlatform] = useState<"android" | "ios">("android");
  const [createLoading, setCreateLoading] = useState(false);
  const [createFeedback, setCreateFeedback] = useState<{ type: "ok" | "err"; msg: string } | undefined>();

  const [deactivateLoading, setDeactivateLoading] = useState<string | null>(null);

  async function loadDevices() {
    if (!ownerId || !clubId) return;
    setLoadingList(true);
    const snap = await getDocs(
      query(
        collection(firebaseDb(), `owners/${ownerId}/clubs/${clubId}/registeredDevices`),
        orderBy("registeredAt", "desc")
      )
    );
    setDevices(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Device)));
    setLoadingList(false);
  }

  useEffect(() => { loadDevices(); }, [ownerId, clubId]);

  async function handleRegister() {
    if (!deviceName) {
      setCreateFeedback({ type: "err", msg: "Nama device wajib diisi" });
      return;
    }
    setCreateLoading(true);
    setCreateFeedback(undefined);
    try {
      const result = await callFunction<{ deviceId: string }>("auth_registerDevice", {
        ownerId, clubId, deviceName, platform,
      });
      setCreateFeedback({ type: "ok", msg: `Device terdaftar — ID: ${result.deviceId}` });
      setDeviceName("");
      loadDevices();
    } catch (err) {
      setCreateFeedback({ type: "err", msg: err instanceof Error ? err.message : "Gagal" });
    } finally { setCreateLoading(false); }
  }

  async function handleDeactivate(deviceId: string) {
    setDeactivateLoading(deviceId);
    try {
      await callFunction("auth_deactivateDevice", { ownerId, clubId, deviceId });
      loadDevices();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Gagal menonaktifkan device");
    } finally { setDeactivateLoading(null); }
  }

  return (
    <div>
      <h2 className="text-2xl font-bold text-slate-900 mb-2">Manajemen Device</h2>
      <p className="text-sm text-slate-400 mb-6">
        Device ID dipakai operator saat login. Daftarkan device sebelum operator bisa masuk.
      </p>

      {/* Device list */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden mb-6">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
          <h3 className="font-semibold text-slate-800">
            Device Terdaftar <span className="text-slate-400 font-normal text-sm">({devices.length})</span>
          </h3>
          <button onClick={loadDevices} className="text-xs text-blue-600 hover:underline">Refresh</button>
        </div>

        {loadingList ? (
          <p className="text-sm text-slate-400 p-4">Memuat…</p>
        ) : devices.length === 0 ? (
          <p className="text-sm text-slate-400 p-4">Belum ada device terdaftar.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs">
              <tr>
                <th className="px-4 py-2 text-left">Nama Device</th>
                <th className="px-4 py-2 text-left">Platform</th>
                <th className="px-4 py-2 text-left">Status</th>
                <th className="px-4 py-2 text-left">Operator</th>
                <th className="px-4 py-2 text-left">Terakhir Aktif</th>
                <th className="px-4 py-2 text-left">Device ID</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {devices.map((d) => (
                <tr key={d.id} className="hover:bg-slate-50">
                  <td className="px-4 py-2.5 font-medium text-slate-800">{d.deviceName}</td>
                  <td className="px-4 py-2.5">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${d.platform === "android" ? "bg-green-50 text-green-700" : "bg-slate-100 text-slate-600"}`}>
                      {d.platform}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${d.isActive ? "bg-blue-50 text-blue-700" : "bg-red-50 text-red-500"}`}>
                      {d.isActive ? "Aktif" : "Nonaktif"}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-slate-400 text-xs font-mono">{d.operatorId ?? "—"}</td>
                  <td className="px-4 py-2.5 text-slate-400 text-xs">{d.lastSeenAt?.slice(0, 16).replace("T", " ")}</td>
                  <td className="px-4 py-2.5 font-mono text-xs text-slate-400 select-all">{d.id}</td>
                  <td className="px-4 py-2.5">
                    {d.isActive && (
                      <button
                        onClick={() => handleDeactivate(d.id)}
                        disabled={deactivateLoading === d.id}
                        className="text-xs text-red-500 hover:text-red-700 font-medium disabled:opacity-50"
                      >
                        {deactivateLoading === d.id ? "…" : "Nonaktifkan"}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Register form */}
      <div className="max-w-sm bg-white rounded-xl border border-slate-200 p-6">
        <h3 className="font-semibold text-slate-800 mb-1">Daftarkan Device Baru</h3>
        <p className="text-xs text-slate-400 mb-4">Setelah terdaftar, salin Device ID dan masukkan saat login operator.</p>

        {createFeedback && (
          <div className={`mb-4 text-sm rounded-lg px-4 py-3 break-all ${createFeedback.type === "ok" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"}`}>
            {createFeedback.msg}
          </div>
        )}

        <div className="space-y-3">
          <input
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
            placeholder="Nama Device (misal: Tablet Kasir 1)"
            value={deviceName}
            onChange={(e) => setDeviceName(e.target.value)}
          />
          <div className="flex gap-3">
            {(["android", "ios"] as const).map((p) => (
              <button
                key={p}
                onClick={() => setPlatform(p)}
                className={`flex-1 py-2 rounded-lg text-sm font-medium border transition ${
                  platform === p
                    ? "border-blue-500 bg-blue-50 text-blue-700"
                    : "border-slate-200 text-slate-500 hover:border-slate-300"
                }`}
              >
                {p === "android" ? "Android" : "iOS"}
              </button>
            ))}
          </div>
          <button
            onClick={handleRegister}
            disabled={createLoading}
            className="w-full bg-blue-600 text-white rounded-lg py-2.5 text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition"
          >
            {createLoading ? "Mendaftarkan…" : "Daftarkan Device"}
          </button>
        </div>
      </div>
    </div>
  );
}
