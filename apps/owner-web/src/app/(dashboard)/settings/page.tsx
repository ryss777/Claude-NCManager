"use client";

import { useEffect, useState } from "react";
import { doc, getDoc, updateDoc } from "firebase/firestore";
import { useOwnerAuthStore } from "@/store/auth.store";
import { firebaseDb } from "@/firebase/firebase";

const TIMEZONES = [
  "Asia/Jakarta",
  "Asia/Makassar",
  "Asia/Jayapura",
];

interface ClubData {
  name: string;
  address: string;
  phoneNumber: string;
  timezone: string;
}

export default function SettingsPage() {
  const { ownerId, clubId, displayName, email } = useOwnerAuthStore();

  const [clubData, setClubData] = useState<ClubData | null>(null);
  const [loading, setLoading] = useState(true);

  // Edit form
  const [name, setName]               = useState("");
  const [address, setAddress]         = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [timezone, setTimezone]       = useState("Asia/Jakarta");

  const [saving, setSaving]     = useState(false);
  const [feedback, setFeedback] = useState<{ type: "ok" | "err"; msg: string } | undefined>();

  useEffect(() => {
    if (!ownerId || !clubId) return;
    setLoading(true);
    getDoc(doc(firebaseDb(), `owners/${ownerId}/clubs/${clubId}`))
      .then((snap) => {
        if (snap.exists()) {
          const d = snap.data() as ClubData;
          setClubData(d);
          setName(d.name ?? "");
          setAddress(d.address ?? "");
          setPhoneNumber(d.phoneNumber ?? "");
          setTimezone(d.timezone ?? "Asia/Jakarta");
        }
      })
      .finally(() => setLoading(false));
  }, [ownerId, clubId]);

  async function handleSave() {
    if (!name.trim()) {
      setFeedback({ type: "err", msg: "Nama club tidak boleh kosong" });
      return;
    }
    setSaving(true);
    setFeedback(undefined);
    try {
      await updateDoc(doc(firebaseDb(), `owners/${ownerId}/clubs/${clubId}`), {
        name:        name.trim(),
        address:     address.trim(),
        phoneNumber: phoneNumber.trim(),
        timezone,
        updatedAt:   new Date().toISOString(),
      });
      setClubData({ name: name.trim(), address: address.trim(), phoneNumber: phoneNumber.trim(), timezone });
      setFeedback({ type: "ok", msg: "Pengaturan club berhasil disimpan" });
    } catch (err) {
      setFeedback({ type: "err", msg: err instanceof Error ? err.message : "Gagal menyimpan" });
    } finally {
      setSaving(false);
    }
  }

  const isDirty =
    name !== (clubData?.name ?? "") ||
    address !== (clubData?.address ?? "") ||
    phoneNumber !== (clubData?.phoneNumber ?? "") ||
    timezone !== (clubData?.timezone ?? "Asia/Jakarta");

  return (
    <div className="max-w-xl">
      <h2 className="text-2xl font-bold text-slate-900 mb-6">Pengaturan</h2>

      {/* Account info (read-only) */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 mb-5">
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Akun Owner</p>
        <div className="space-y-1.5 text-sm">
          <div className="flex justify-between">
            <span className="text-slate-500">Nama</span>
            <span className="font-medium text-slate-800">{displayName ?? "—"}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">Email</span>
            <span className="font-medium text-slate-800">{email ?? "—"}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">Owner ID</span>
            <span className="font-mono text-xs text-slate-500 select-all">{ownerId}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">Club ID</span>
            <span className="font-mono text-xs text-slate-500 select-all">{clubId}</span>
          </div>
        </div>
      </div>

      {/* Club settings */}
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-4">Profil Club</p>

        {loading ? (
          <p className="text-sm text-slate-400">Memuat…</p>
        ) : (
          <div className="space-y-4">
            {feedback && (
              <div className={`text-sm rounded-lg px-3 py-2.5 ${
                feedback.type === "ok"
                  ? "bg-green-50 text-green-700 border border-green-200"
                  : "bg-red-50 text-red-700 border border-red-200"
              }`}>
                {feedback.type === "ok" ? "✓ " : "⚠ "}{feedback.msg}
              </div>
            )}

            <div>
              <label className="block text-xs text-slate-500 mb-1">Nama Club *</label>
              <input
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Contoh: NC Jakarta Selatan"
              />
            </div>

            <div>
              <label className="block text-xs text-slate-500 mb-1">Alamat</label>
              <textarea
                rows={2}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-brand-300"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="Jl. Sudirman No. 123, Jakarta"
              />
            </div>

            <div>
              <label className="block text-xs text-slate-500 mb-1">Nomor Telepon</label>
              <input
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300"
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
                placeholder="+62 21 1234 5678"
              />
            </div>

            <div>
              <label className="block text-xs text-slate-500 mb-1">Zona Waktu</label>
              <select
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-300"
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
              >
                {TIMEZONES.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz === "Asia/Jakarta"  ? "WIB (Asia/Jakarta)" :
                     tz === "Asia/Makassar" ? "WITA (Asia/Makassar)" :
                                             "WIT (Asia/Jayapura)"}
                  </option>
                ))}
              </select>
            </div>

            <button
              onClick={handleSave}
              disabled={saving || !isDirty}
              className="w-full bg-brand-600 hover:bg-brand-700 text-white rounded-xl py-2.5 text-sm font-semibold disabled:opacity-40 transition"
            >
              {saving ? "Menyimpan…" : "Simpan Perubahan"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
