"use client";

import { useEffect, useState } from "react";
import { collection, getDocs, query, orderBy } from "firebase/firestore";
import { useOwnerAuthStore } from "@/store/auth.store";
import { callFunction, firebaseDb } from "@/firebase/firebase";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Operator {
  id: string;
  displayName: string;
  isActive: boolean;
  allowedDeviceIds: string[];
  createdAt: string;
}

interface Device {
  id: string;
  deviceName: string;
  platform: "android" | "ios";
  isActive: boolean;
  operatorId: string | null;
  lastSeenAt: string;
  registeredAt: string;
}

type MainTab = "operators" | "devices";

// ── Component ─────────────────────────────────────────────────────────────────

export default function TeamPage() {
  const { ownerId, clubId } = useOwnerAuthStore();
  const [mainTab, setMainTab] = useState<MainTab>("operators");

  // ── Operators state ──────────────────────────────────────────────────────────
  const [operators, setOperators] = useState<Operator[]>([]);
  const [loadingOps, setLoadingOps]   = useState(true);
  const [displayName, setDisplayName] = useState("");
  const [pin, setPin]                 = useState("");
  const [deviceIds, setDeviceIds]     = useState("");
  const [opLoading, setOpLoading]     = useState(false);
  const [opFeedback, setOpFeedback]   = useState<{ type: "ok" | "err"; msg: string } | undefined>();
  const [updateTargetId, setUpdateTargetId] = useState("");
  const [newPin, setNewPin]           = useState("");
  const [updateLoading, setUpdateLoading] = useState(false);
  const [updateFeedback, setUpdateFeedback] = useState<{ type: "ok" | "err"; msg: string } | undefined>();

  async function loadOperators() {
    if (!ownerId || !clubId) return;
    setLoadingOps(true);
    const snap = await getDocs(collection(firebaseDb(), `owners/${ownerId}/clubs/${clubId}/operators`));
    setOperators(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Operator)));
    setLoadingOps(false);
  }

  useEffect(() => { loadOperators(); }, [ownerId, clubId]);

  async function handleCreateOperator() {
    if (!displayName || pin.length !== 6 || !/^\d{6}$/.test(pin)) {
      setOpFeedback({ type: "err", msg: "Nama dan PIN 6 digit angka wajib diisi" });
      return;
    }
    setOpLoading(true);
    setOpFeedback(undefined);
    try {
      const allowedDeviceIds = deviceIds.split(",").map((s) => s.trim()).filter(Boolean);
      await callFunction("auth_createOperator", { ownerId, clubId, displayName, pin, allowedDeviceIds });
      setOpFeedback({ type: "ok", msg: `Operator "${displayName}" berhasil dibuat` });
      setDisplayName(""); setPin(""); setDeviceIds("");
      loadOperators();
    } catch (err) {
      setOpFeedback({ type: "err", msg: err instanceof Error ? err.message : "Gagal" });
    } finally { setOpLoading(false); }
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

  // ── Devices state ────────────────────────────────────────────────────────────
  const [devices, setDevices]         = useState<Device[]>([]);
  const [loadingDevices, setLoadingDevices] = useState(true);
  const [deviceName, setDeviceName]   = useState("");
  const [platform, setPlatform]       = useState<"android" | "ios">("android");
  const [devCreateLoading, setDevCreateLoading] = useState(false);
  const [devCreateFeedback, setDevCreateFeedback] = useState<{ type: "ok" | "err"; msg: string } | undefined>();
  const [deactivateLoading, setDeactivateLoading] = useState<string | null>(null);

  async function loadDevices() {
    if (!ownerId || !clubId) return;
    setLoadingDevices(true);
    const snap = await getDocs(
      query(
        collection(firebaseDb(), `owners/${ownerId}/clubs/${clubId}/registeredDevices`),
        orderBy("registeredAt", "desc")
      )
    );
    setDevices(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Device)));
    setLoadingDevices(false);
  }

  useEffect(() => { loadDevices(); }, [ownerId, clubId]);

  async function handleRegisterDevice() {
    if (!deviceName) {
      setDevCreateFeedback({ type: "err", msg: "Nama device wajib diisi" });
      return;
    }
    setDevCreateLoading(true);
    setDevCreateFeedback(undefined);
    try {
      const result = await callFunction<{ deviceId: string }>("auth_registerDevice", {
        ownerId, clubId, deviceName, platform,
      });
      setDevCreateFeedback({ type: "ok", msg: `Device terdaftar — ID: ${result.deviceId}` });
      setDeviceName("");
      loadDevices();
    } catch (err) {
      setDevCreateFeedback({ type: "err", msg: err instanceof Error ? err.message : "Gagal" });
    } finally { setDevCreateLoading(false); }
  }

  async function handleDeactivateDevice(deviceId: string) {
    setDeactivateLoading(deviceId);
    try {
      await callFunction("auth_deactivateDevice", { ownerId, clubId, deviceId });
      loadDevices();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Gagal menonaktifkan device");
    } finally { setDeactivateLoading(null); }
  }

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-slate-900">Tim &amp; Perangkat</h2>
      </div>

      {/* Tab switcher */}
      <div className="flex gap-1 bg-slate-100 rounded-xl p-1 w-fit mb-6">
        {([
          { key: "operators", label: "👤 Operator" },
          { key: "devices",   label: "📱 Device" },
        ] as { key: MainTab; label: string }[]).map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setMainTab(key)}
            className={`px-5 py-2 rounded-lg text-sm font-semibold transition ${
              mainTab === key ? "bg-white shadow text-slate-900" : "text-slate-500 hover:text-slate-700"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── Operators tab ── */}
      {mainTab === "operators" && (
        <div>
          <div className="bg-white rounded-xl border border-slate-200 mb-6 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
              <h3 className="font-semibold text-slate-800">Daftar Operator</h3>
              <button onClick={loadOperators} className="text-xs text-blue-600 hover:underline">Refresh</button>
            </div>
            {loadingOps ? (
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
              {opFeedback && (
                <div className={`mb-3 text-sm rounded-lg px-3 py-2 ${opFeedback.type === "ok" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"}`}>
                  {opFeedback.msg}
                </div>
              )}
              <div className="space-y-3">
                <input className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" placeholder="Nama Lengkap" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
                <input className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" placeholder="PIN (6 digit angka)" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} />
                <input className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" placeholder="Device ID (pisah koma, opsional)" value={deviceIds} onChange={(e) => setDeviceIds(e.target.value)} />
                <button onClick={handleCreateOperator} disabled={opLoading} className="w-full bg-green-600 text-white rounded-lg py-2.5 text-sm font-semibold hover:bg-green-700 disabled:opacity-50 transition">
                  {opLoading ? "Menyimpan…" : "Buat Operator"}
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
      )}

      {/* ── Devices tab ── */}
      {mainTab === "devices" && (
        <div>
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
            {loadingDevices ? (
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
                            onClick={() => handleDeactivateDevice(d.id)}
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
            {devCreateFeedback && (
              <div className={`mb-4 text-sm rounded-lg px-4 py-3 break-all ${devCreateFeedback.type === "ok" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"}`}>
                {devCreateFeedback.msg}
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
                onClick={handleRegisterDevice}
                disabled={devCreateLoading}
                className="w-full bg-blue-600 text-white rounded-lg py-2.5 text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition"
              >
                {devCreateLoading ? "Mendaftarkan…" : "Daftarkan Device"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
