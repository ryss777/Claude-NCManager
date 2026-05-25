"use client";

import { useEffect, useRef, useState } from "react";
import { doc, getDoc, updateDoc } from "firebase/firestore";
import { updateProfile } from "firebase/auth";
import { ref as storageRef, uploadBytes, getDownloadURL } from "firebase/storage";
import { useOwnerAuthStore } from "@/store/auth.store";
import { firebaseDb, firebaseAuth, firebaseStorage } from "@/firebase/firebase";

// ─── Types ────────────────────────────────────────────────────────────────────

const TIMEZONES = ["Asia/Jakarta", "Asia/Makassar", "Asia/Jayapura"] as const;

const DAYS = [
  { key: "monday",    short: "Sen", label: "Senin" },
  { key: "tuesday",   short: "Sel", label: "Selasa" },
  { key: "wednesday", short: "Rab", label: "Rabu" },
  { key: "thursday",  short: "Kam", label: "Kamis" },
  { key: "friday",    short: "Jum", label: "Jumat" },
  { key: "saturday",  short: "Sab", label: "Sabtu" },
  { key: "sunday",    short: "Min", label: "Minggu" },
] as const;

type DayKey = (typeof DAYS)[number]["key"];

interface DaySession {
  openTime: string;
  closeTime: string;
}
interface DaySchedule {
  isOpen: boolean;
  morning: DaySession;
  afternoon: { isActive: boolean; openTime: string; closeTime: string };
}
type OperationalHours = Record<DayKey, DaySchedule>;

interface ClubData {
  name: string;
  address: string;
  phoneNumber: string;
  timezone: string;
  logoUrl?: string;
  operationalHours?: OperationalHours;
}

type Tab = "profil" | "jam" | "akun";
type FB = { type: "ok" | "err"; msg: string } | undefined;

function defaultSchedule(): DaySchedule {
  return {
    isOpen:    true,
    morning:   { openTime: "08:00", closeTime: "12:00" },
    afternoon: { isActive: true, openTime: "14:00", closeTime: "21:00" },
  };
}
function defaultHours(): OperationalHours {
  return Object.fromEntries(DAYS.map(({ key }) => [key, defaultSchedule()])) as OperationalHours;
}

// ─── Mini-components ──────────────────────────────────────────────────────────

function Toast({ fb }: { fb: FB }) {
  if (!fb) return null;
  return (
    <div className={`flex items-center gap-2 text-sm rounded-lg px-3.5 py-2.5 ${
      fb.type === "ok"
        ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
        : "bg-red-50 text-red-600 border border-red-200"
    }`}>
      <span>{fb.type === "ok" ? "✓" : "⚠"}</span>
      <span>{fb.msg}</span>
    </div>
  );
}

function Toggle({ on, onChange }: { on: boolean; onChange: () => void }) {
  return (
    <button
      onClick={onChange}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${on ? "bg-blue-500" : "bg-slate-300"}`}
    >
      <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${on ? "translate-x-[18px]" : "translate-x-0.5"}`} />
    </button>
  );
}

function TimeRange({
  disabled,
  from,
  to,
  onFrom,
  onTo,
}: {
  disabled: boolean;
  from: string;
  to: string;
  onFrom: (v: string) => void;
  onTo: (v: string) => void;
}) {
  const cls = `border border-slate-200 rounded-lg px-2 py-1.5 text-sm bg-white w-[88px]
    disabled:bg-slate-50 disabled:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-400`;
  return (
    <div className="flex items-center gap-1.5">
      <input type="time" disabled={disabled} value={from} onChange={(e) => onFrom(e.target.value)} className={cls} />
      <span className="text-slate-400 text-xs">–</span>
      <input type="time" disabled={disabled} value={to}   onChange={(e) => onTo(e.target.value)}   className={cls} />
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const { ownerId, clubId, displayName, email, setUser, uid, isAdmin } = useOwnerAuthStore();

  const [activeTab, setActiveTab] = useState<Tab>("profil");
  const [clubData, setClubData]   = useState<ClubData | null>(null);
  const [loading, setLoading]     = useState(true);

  // ── Profil ──────────────────────────────────────────────────────────────
  const [name, setName]               = useState("");
  const [address, setAddress]         = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [timezone, setTimezone]       = useState<string>("Asia/Jakarta");
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileFb, setProfileFb]     = useState<FB>();

  // ── Logo ─────────────────────────────────────────────────────────────────
  const [logoUrl, setLogoUrl]         = useState<string | undefined>();
  const [logoFile, setLogoFile]       = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | undefined>();
  const [logoUploading, setLogoUploading] = useState(false);
  const [logoFb, setLogoFb]           = useState<FB>();
  const fileInputRef                  = useRef<HTMLInputElement>(null);

  // ── Jam operasional ─────────────────────────────────────────────────────
  const [hours, setHours]             = useState<OperationalHours>(defaultHours());
  const [hoursSaving, setHoursSaving] = useState(false);
  const [hoursFb, setHoursFb]         = useState<FB>();

  // ── Display name ─────────────────────────────────────────────────────────
  const [editName, setEditName]       = useState(displayName ?? "");
  const [nameUpdating, setNameUpdating] = useState(false);
  const [nameFb, setNameFb]           = useState<FB>();

  // ── Load ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!ownerId || !clubId) return;
    setLoading(true);
    getDoc(doc(firebaseDb(), `owners/${ownerId}/clubs/${clubId}`))
      .then((snap) => {
        if (!snap.exists()) return;
        const d = snap.data() as ClubData;
        setClubData(d);
        setName(d.name ?? "");
        setAddress(d.address ?? "");
        setPhoneNumber(d.phoneNumber ?? "");
        setTimezone(d.timezone ?? "Asia/Jakarta");
        setLogoUrl(d.logoUrl);
        if (d.operationalHours) {
          setHours({ ...defaultHours(), ...d.operationalHours } as OperationalHours);
        }
      })
      .finally(() => setLoading(false));
  }, [ownerId, clubId]);

  useEffect(() => { setEditName(displayName ?? ""); }, [displayName]);

  // ── Handlers ─────────────────────────────────────────────────────────────

  function handleLogoFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) { setLogoFb({ type: "err", msg: "File harus berupa gambar" }); return; }
    if (file.size > 2 * 1024 * 1024)     { setLogoFb({ type: "err", msg: "Ukuran maks 2 MB" }); return; }
    setLogoFile(file);
    setLogoFb(undefined);
    const reader = new FileReader();
    reader.onload = (ev) => setLogoPreview(ev.target?.result as string);
    reader.readAsDataURL(file);
  }

  async function handleUploadLogo() {
    if (!logoFile || !ownerId || !clubId) return;
    setLogoUploading(true);
    setLogoFb(undefined);
    try {
      const ext     = logoFile.type.split("/")[1] ?? "png";
      const path    = `owners/${ownerId}/clubs/${clubId}/assets/logo.${ext}`;
      const fileRef = storageRef(firebaseStorage(), path);
      await uploadBytes(fileRef, logoFile, { contentType: logoFile.type });
      const url     = await getDownloadURL(fileRef);
      await updateDoc(doc(firebaseDb(), `owners/${ownerId}/clubs/${clubId}`), { logoUrl: url, updatedAt: new Date().toISOString() });
      setLogoUrl(url);
      setLogoFile(null);
      setLogoPreview(undefined);
      if (fileInputRef.current) fileInputRef.current.value = "";
      setLogoFb({ type: "ok", msg: "Logo berhasil diupload" });
    } catch (err) {
      setLogoFb({ type: "err", msg: err instanceof Error ? err.message : "Gagal upload" });
    } finally {
      setLogoUploading(false);
    }
  }

  async function handleSaveProfile() {
    if (!name.trim()) { setProfileFb({ type: "err", msg: "Nama club tidak boleh kosong" }); return; }
    setProfileSaving(true); setProfileFb(undefined);
    try {
      await updateDoc(doc(firebaseDb(), `owners/${ownerId}/clubs/${clubId}`), {
        name: name.trim(), address: address.trim(), phoneNumber: phoneNumber.trim(), timezone,
        updatedAt: new Date().toISOString(),
      });
      setClubData((p) => p ? { ...p, name: name.trim(), address: address.trim(), phoneNumber: phoneNumber.trim(), timezone } : p);
      setProfileFb({ type: "ok", msg: "Profil club disimpan" });
    } catch (err) {
      setProfileFb({ type: "err", msg: err instanceof Error ? err.message : "Gagal menyimpan" });
    } finally { setProfileSaving(false); }
  }

  async function handleSaveHours() {
    setHoursSaving(true); setHoursFb(undefined);
    try {
      await updateDoc(doc(firebaseDb(), `owners/${ownerId}/clubs/${clubId}`), {
        operationalHours: hours, updatedAt: new Date().toISOString(),
      });
      setClubData((p) => p ? { ...p, operationalHours: hours } : p);
      setHoursFb({ type: "ok", msg: "Jam operasional disimpan" });
    } catch (err) {
      setHoursFb({ type: "err", msg: err instanceof Error ? err.message : "Gagal menyimpan" });
    } finally { setHoursSaving(false); }
  }

  async function handleUpdateName() {
    const trimmed = editName.trim();
    if (!trimmed) { setNameFb({ type: "err", msg: "Nama tidak boleh kosong" }); return; }
    setNameUpdating(true); setNameFb(undefined);
    try {
      const auth = firebaseAuth();
      if (auth.currentUser) await updateProfile(auth.currentUser, { displayName: trimmed });
      if (uid && ownerId && clubId) setUser({ uid, email: email ?? "", displayName: trimmed, ownerId, clubId, isAdmin });
      setNameFb({ type: "ok", msg: "Nama tampilan diubah" });
    } catch (err) {
      setNameFb({ type: "err", msg: err instanceof Error ? err.message : "Gagal mengubah nama" });
    } finally { setNameUpdating(false); }
  }

  function patchDay(key: DayKey, patch: Partial<DaySchedule>) {
    setHours((p) => ({ ...p, [key]: { ...p[key], ...patch } }));
  }
  function patchAfternoon(key: DayKey, patch: Partial<DaySchedule["afternoon"]>) {
    setHours((p) => ({ ...p, [key]: { ...p[key], afternoon: { ...p[key].afternoon, ...patch } } }));
  }
  function patchMorning(key: DayKey, patch: Partial<DaySession>) {
    setHours((p) => ({ ...p, [key]: { ...p[key], morning: { ...p[key].morning, ...patch } } }));
  }

  // ── Dirty ────────────────────────────────────────────────────────────────
  const isProfileDirty =
    name !== (clubData?.name ?? "") ||
    address !== (clubData?.address ?? "") ||
    phoneNumber !== (clubData?.phoneNumber ?? "") ||
    timezone !== (clubData?.timezone ?? "Asia/Jakarta");

  const savedHours = { ...defaultHours(), ...(clubData?.operationalHours ?? {}) } as OperationalHours;
  const isHoursDirty = JSON.stringify(hours) !== JSON.stringify(savedHours);
  const isNameDirty  = editName.trim() !== (displayName ?? "");

  // ── Tab config ───────────────────────────────────────────────────────────
  const TABS: { key: Tab; label: string; icon: string }[] = [
    { key: "profil", label: "Profil Club", icon: "🏢" },
    { key: "jam",    label: "Jam Operasional", icon: "🕐" },
    { key: "akun",   label: "Akun",  icon: "👤" },
  ];

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="max-w-2xl">
      <h2 className="text-2xl font-bold text-slate-900 mb-5">Pengaturan</h2>

      {/* Tab bar */}
      <div className="flex gap-1 bg-slate-100 rounded-xl p-1 mb-6">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-medium transition ${
              activeTab === t.key
                ? "bg-white text-slate-800 shadow-sm"
                : "text-slate-500 hover:text-slate-700"
            }`}
          >
            <span>{t.icon}</span>
            <span>{t.label}</span>
          </button>
        ))}
      </div>

      {loading ? (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center text-slate-400 text-sm">
          Memuat…
        </div>
      ) : (
        <>
          {/* ══════════════════ TAB: PROFIL ═══════════════════════════════ */}
          {activeTab === "profil" && (
            <div className="space-y-5">

              {/* Logo */}
              <div className="bg-white rounded-xl border border-slate-200 p-5">
                <p className="text-sm font-semibold text-slate-700 mb-4">Logo Club</p>

                <div
                  className="relative flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-slate-200 bg-slate-50 py-8 cursor-pointer hover:border-blue-400 hover:bg-blue-50/40 transition group"
                  onClick={() => fileInputRef.current?.click()}
                >
                  {(logoPreview ?? logoUrl) ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={logoPreview ?? logoUrl}
                      alt="Logo"
                      className="w-24 h-24 rounded-xl object-cover shadow-sm"
                    />
                  ) : (
                    <div className="w-24 h-24 rounded-xl bg-slate-200 flex items-center justify-center text-4xl">
                      🏢
                    </div>
                  )}
                  <div className="text-center">
                    <p className="text-sm font-medium text-slate-600 group-hover:text-blue-600 transition">
                      {logoFile ? logoFile.name : "Klik untuk pilih gambar"}
                    </p>
                    <p className="text-xs text-slate-400 mt-0.5">JPG, PNG, WebP — maks 2 MB</p>
                  </div>
                  {logoFile && (
                    <button
                      onClick={(e) => { e.stopPropagation(); setLogoFile(null); setLogoPreview(undefined); if (fileInputRef.current) fileInputRef.current.value = ""; }}
                      className="absolute top-3 right-3 w-6 h-6 rounded-full bg-slate-300 hover:bg-red-400 text-white text-xs flex items-center justify-center transition"
                    >
                      ✕
                    </button>
                  )}
                </div>
                <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleLogoFile} />

                <div className="mt-3 space-y-2">
                  <Toast fb={logoFb} />
                  {logoFile && (
                    <button
                      onClick={handleUploadLogo}
                      disabled={logoUploading}
                      className="w-full bg-blue-600 text-white text-sm font-semibold py-2.5 rounded-xl hover:bg-blue-700 disabled:opacity-40 transition"
                    >
                      {logoUploading ? "Mengupload…" : "Upload Logo"}
                    </button>
                  )}
                </div>
              </div>

              {/* Club info */}
              <div className="bg-white rounded-xl border border-slate-200 p-5">
                <p className="text-sm font-semibold text-slate-700 mb-4">Informasi Club</p>
                <div className="space-y-4">
                  <Toast fb={profileFb} />

                  <div>
                    <label className="block text-xs text-slate-500 mb-1.5">Nama Club</label>
                    <input className="input" value={name} onChange={(e) => { setName(e.target.value); setProfileFb(undefined); }} placeholder="Contoh: NC Jakarta Selatan" />
                  </div>

                  <div>
                    <label className="block text-xs text-slate-500 mb-1.5">Alamat</label>
                    <textarea rows={2} className="input resize-none" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Jl. Sudirman No. 123, Jakarta" />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-slate-500 mb-1.5">Nomor Telepon</label>
                      <input className="input" value={phoneNumber} onChange={(e) => setPhoneNumber(e.target.value)} placeholder="+62 21 1234 5678" />
                    </div>
                    <div>
                      <label className="block text-xs text-slate-500 mb-1.5">Zona Waktu</label>
                      <select className="input" value={timezone} onChange={(e) => setTimezone(e.target.value)}>
                        {TIMEZONES.map((tz) => (
                          <option key={tz} value={tz}>
                            {tz === "Asia/Jakarta" ? "WIB" : tz === "Asia/Makassar" ? "WITA" : "WIT"}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <button onClick={handleSaveProfile} disabled={profileSaving || !isProfileDirty} className="btn-primary w-full">
                    {profileSaving ? "Menyimpan…" : "Simpan Profil"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ══════════════════ TAB: JAM ══════════════════════════════════ */}
          {activeTab === "jam" && (
            <div className="bg-white rounded-xl border border-slate-200 p-5">
              <p className="text-sm font-semibold text-slate-700 mb-1">Jam Operasional</p>
              <p className="text-xs text-slate-400 mb-5">Setiap hari bisa punya 2 sesi (Pagi &amp; Sore).</p>

              <Toast fb={hoursFb} />

              <div className="mt-3 space-y-3">
                {DAYS.map(({ key, label }) => {
                  const day = hours[key];
                  return (
                    <div key={key} className={`rounded-xl border transition ${day.isOpen ? "border-slate-200 bg-white" : "border-slate-100 bg-slate-50"}`}>
                      {/* Day header */}
                      <div className="flex items-center justify-between px-4 py-3">
                        <span className={`text-sm font-semibold ${day.isOpen ? "text-slate-800" : "text-slate-400"}`}>{label}</span>
                        <div className="flex items-center gap-2">
                          <span className={`text-xs ${day.isOpen ? "text-blue-500" : "text-slate-400"}`}>{day.isOpen ? "Buka" : "Tutup"}</span>
                          <Toggle on={day.isOpen} onChange={() => patchDay(key, { isOpen: !day.isOpen })} />
                        </div>
                      </div>

                      {/* Sessions */}
                      {day.isOpen && (
                        <div className="border-t border-slate-100 px-4 py-3 space-y-3">
                          {/* Morning */}
                          <div className="flex items-center gap-3">
                            <span className="w-12 text-xs font-medium text-slate-500 shrink-0">🌅 Pagi</span>
                            <TimeRange
                              disabled={false}
                              from={day.morning.openTime}
                              to={day.morning.closeTime}
                              onFrom={(v) => patchMorning(key, { openTime: v })}
                              onTo={(v) => patchMorning(key, { closeTime: v })}
                            />
                          </div>

                          {/* Afternoon */}
                          <div className="flex items-center gap-3">
                            <span className="w-12 text-xs font-medium text-slate-500 shrink-0">🌆 Sore</span>
                            <TimeRange
                              disabled={!day.afternoon.isActive}
                              from={day.afternoon.openTime}
                              to={day.afternoon.closeTime}
                              onFrom={(v) => patchAfternoon(key, { openTime: v })}
                              onTo={(v) => patchAfternoon(key, { closeTime: v })}
                            />
                            <Toggle on={day.afternoon.isActive} onChange={() => patchAfternoon(key, { isActive: !day.afternoon.isActive })} />
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <button onClick={handleSaveHours} disabled={hoursSaving || !isHoursDirty} className="btn-primary w-full mt-5">
                {hoursSaving ? "Menyimpan…" : "Simpan Jam Operasional"}
              </button>
            </div>
          )}

          {/* ══════════════════ TAB: AKUN ═════════════════════════════════ */}
          {activeTab === "akun" && (
            <div className="space-y-5">

              {/* Display name */}
              <div className="bg-white rounded-xl border border-slate-200 p-5">
                <p className="text-sm font-semibold text-slate-700 mb-1">Nama Tampilan</p>
                <p className="text-xs text-slate-400 mb-4">Muncul di sidebar dan riwayat transaksi.</p>
                <Toast fb={nameFb} />
                <div className="flex gap-2 mt-3">
                  <input
                    className="input flex-1"
                    value={editName}
                    onChange={(e) => { setEditName(e.target.value); setNameFb(undefined); }}
                    placeholder="Nama tampilan"
                    onKeyDown={(e) => e.key === "Enter" && handleUpdateName()}
                  />
                  <button onClick={handleUpdateName} disabled={nameUpdating || !isNameDirty} className="shrink-0 bg-blue-600 text-white rounded-lg px-4 py-2 text-sm font-semibold hover:bg-blue-700 disabled:opacity-40 transition">
                    {nameUpdating ? "…" : "Simpan"}
                  </button>
                </div>
              </div>

              {/* Account info */}
              <div className="bg-white rounded-xl border border-slate-200 p-5">
                <p className="text-sm font-semibold text-slate-700 mb-4">Info Akun</p>
                <div className="space-y-3">
                  {[
                    { label: "Email",    value: email ?? "—" },
                    { label: "Login via", value: "🔐 Google OAuth" },
                    { label: "Owner ID", value: ownerId ?? "—", mono: true },
                    { label: "Club ID",  value: clubId ?? "—",  mono: true },
                  ].map(({ label, value, mono }) => (
                    <div key={label} className="flex justify-between items-center py-2.5 border-b border-slate-50 last:border-0">
                      <span className="text-sm text-slate-500">{label}</span>
                      <span className={`text-sm ${mono ? "font-mono text-xs text-slate-400 select-all" : "font-medium text-slate-700"}`}>{value}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
