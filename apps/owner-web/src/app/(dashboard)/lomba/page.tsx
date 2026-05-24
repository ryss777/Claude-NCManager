"use client";

import { useEffect, useState, useMemo } from "react";
import { collection, getDocs, query, orderBy } from "firebase/firestore";
import { v4 as uuidv4 } from "uuid";
import { useOwnerAuthStore } from "@/store/auth.store";
import { callFunction, firebaseDb } from "@/firebase/firebase";

// ── Types ─────────────────────────────────────────────────────────────────────

type CompStatus = "upcoming" | "active" | "finished";

interface Competition {
  id: string;
  name: string;
  adminFee: number;
  startDate: string;   // YYYY-MM-DD
  endDate: string;     // YYYY-MM-DD
  status: CompStatus;
  participantCount: number;
  createdAt: string;
  updatedAt: string;
}

interface Participant {
  id: string;
  competitionId: string;
  type: "customer" | "guest";
  customerId: string | null;
  displayName: string;
  joinedAt: string;
}

interface CustomerSearchItem {
  id: string;
  displayName: string;
  phone: string | null;
  tier: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmt = (n: number) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);

function fmtDate(iso: string) {
  return new Date(iso + "T00:00:00").toLocaleDateString("id-ID", {
    day: "numeric", month: "short", year: "numeric",
  });
}

function computeStatus(startDate: string, endDate: string): CompStatus {
  const today = new Date().toISOString().slice(0, 10);
  if (today < startDate) return "upcoming";
  if (today > endDate) return "finished";
  return "active";
}

function durationDays(startDate: string, endDate: string) {
  const diff = new Date(endDate).getTime() - new Date(startDate).getTime();
  return Math.round(diff / 86_400_000) + 1;
}

const STATUS_LABEL: Record<CompStatus, string> = {
  upcoming: "Akan Datang",
  active:   "Berjalan",
  finished: "Selesai",
};

const STATUS_STYLE: Record<CompStatus, string> = {
  upcoming: "bg-blue-100 text-blue-700",
  active:   "bg-green-100 text-green-700",
  finished: "bg-slate-100 text-slate-500",
};

const STATUS_ORDER: Record<CompStatus, number> = { active: 0, upcoming: 1, finished: 2 };

// ── Page ──────────────────────────────────────────────────────────────────────

export default function LombaPage() {
  const { ownerId, clubId } = useOwnerAuthStore();

  // ── List state ──────────────────────────────────────────────────────────────
  const [competitions, setCompetitions] = useState<Competition[]>([]);
  const [loading, setLoading]           = useState(true);
  const [selectedId, setSelectedId]     = useState<string | null>(null);

  // ── Participant state ────────────────────────────────────────────────────────
  const [participants, setParticipants]     = useState<Participant[]>([]);
  const [partLoading, setPartLoading]       = useState(false);
  const [removingId, setRemovingId]         = useState<string | null>(null);

  // ── Create dialog ───────────────────────────────────────────────────────────
  const [createOpen, setCreateOpen]       = useState(false);
  const [createName, setCreateName]       = useState("");
  const [createStart, setCreateStart]     = useState("");
  const [createEnd, setCreateEnd]         = useState("");
  const [createFee, setCreateFee]         = useState("0");
  const [createSaving, setCreateSaving]   = useState(false);
  const [createError, setCreateError]     = useState("");

  // ── Extend dialog ───────────────────────────────────────────────────────────
  const [extendOpen, setExtendOpen]       = useState(false);
  const [extendNewEnd, setExtendNewEnd]   = useState("");
  const [extendSaving, setExtendSaving]   = useState(false);
  const [extendError, setExtendError]     = useState("");

  // ── Add participant dialog ───────────────────────────────────────────────────
  const [addOpen, setAddOpen]             = useState(false);
  const [addMode, setAddMode]             = useState<"customer" | "guest">("customer");
  const [addSearch, setAddSearch]         = useState("");
  const [addCustomers, setAddCustomers]   = useState<CustomerSearchItem[]>([]);
  const [addCustLoading, setAddCustLoading] = useState(false);
  const [addGuestName, setAddGuestName]   = useState("");
  const [addSaving, setAddSaving]         = useState(false);
  const [addError, setAddError]           = useState("");

  const selected = useMemo(
    () => competitions.find((c) => c.id === selectedId) ?? null,
    [competitions, selectedId]
  );

  const sortedComps = useMemo(
    () =>
      [...competitions]
        .map((c) => ({ ...c, status: computeStatus(c.startDate, c.endDate) }))
        .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]),
    [competitions]
  );

  const filteredCustomers = useMemo(() => {
    if (!addSearch.trim()) return addCustomers;
    const q = addSearch.toLowerCase();
    return addCustomers.filter(
      (c) => c.displayName.toLowerCase().includes(q) || c.phone?.includes(q)
    );
  }, [addCustomers, addSearch]);

  // ── Load competitions ────────────────────────────────────────────────────────
  async function loadCompetitions() {
    if (!ownerId || !clubId) return;
    setLoading(true);
    try {
      const snap = await getDocs(
        query(
          collection(firebaseDb(), `owners/${ownerId}/clubs/${clubId}/competitions`),
          orderBy("createdAt", "desc")
        )
      );
      setCompetitions(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Competition, "id">) })));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadCompetitions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownerId, clubId]);

  // ── Load participants ────────────────────────────────────────────────────────
  async function loadParticipants(compId: string) {
    if (!ownerId || !clubId) return;
    setPartLoading(true);
    try {
      const snap = await getDocs(
        query(
          collection(
            firebaseDb(),
            `owners/${ownerId}/clubs/${clubId}/competitions/${compId}/participants`
          ),
          orderBy("joinedAt", "asc")
        )
      );
      setParticipants(
        snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Participant, "id">) }))
      );
    } finally {
      setPartLoading(false);
    }
  }

  useEffect(() => {
    if (selectedId) loadParticipants(selectedId);
    else setParticipants([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  // ── Load customers for participant search ────────────────────────────────────
  async function loadCustomers() {
    if (!ownerId || !clubId || addCustomers.length > 0) return;
    setAddCustLoading(true);
    try {
      const snap = await getDocs(
        query(
          collection(firebaseDb(), `owners/${ownerId}/clubs/${clubId}/customers`),
          orderBy("displayName", "asc")
        )
      );
      setAddCustomers(
        snap.docs.map((d) => {
          const data = d.data() as Record<string, unknown>;
          return {
            id: d.id,
            displayName: (data["displayName"] as string) ?? "",
            phone: (data["phone"] as string | null) ?? null,
            tier: (data["tier"] as string) ?? "retail",
          };
        })
      );
    } finally {
      setAddCustLoading(false);
    }
  }

  useEffect(() => {
    if (addOpen) loadCustomers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addOpen]);

  // ── Handlers ─────────────────────────────────────────────────────────────────

  async function handleCreateCompetition() {
    if (!createName.trim() || !createStart || !createEnd) return;
    if (createEnd < createStart) {
      setCreateError("Tanggal selesai tidak boleh sebelum tanggal mulai");
      return;
    }
    setCreateSaving(true);
    setCreateError("");
    try {
      await callFunction("competition_create", {
        ownerId, clubId,
        requestId: uuidv4(), operationId: uuidv4(),
        name:      createName.trim(),
        startDate: createStart,
        endDate:   createEnd,
        adminFee:  parseFloat(createFee) || 0,
      });
      setCreateOpen(false);
      setCreateName(""); setCreateStart(""); setCreateEnd(""); setCreateFee("0");
      await loadCompetitions();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Gagal membuat lomba");
    } finally {
      setCreateSaving(false);
    }
  }

  async function handleExtend() {
    if (!selected || !extendNewEnd) return;
    setExtendSaving(true);
    setExtendError("");
    try {
      await callFunction("competition_extend", {
        ownerId, clubId,
        requestId: uuidv4(), operationId: uuidv4(),
        competitionId: selected.id,
        newEndDate:    extendNewEnd,
      });
      setExtendOpen(false);
      setExtendNewEnd("");
      await loadCompetitions();
    } catch (err) {
      setExtendError(err instanceof Error ? err.message : "Gagal memperpanjang lomba");
    } finally {
      setExtendSaving(false);
    }
  }

  async function handleAddCustomer(customer: CustomerSearchItem) {
    if (!selected) return;
    setAddSaving(true);
    setAddError("");
    try {
      await callFunction("competition_addParticipant", {
        ownerId, clubId,
        requestId: uuidv4(), operationId: uuidv4(),
        competitionId: selected.id,
        type:          "customer",
        customerId:    customer.id,
      });
      setAddOpen(false);
      setAddSearch("");
      await Promise.all([loadParticipants(selected.id), loadCompetitions()]);
    } catch (err) {
      setAddError(err instanceof Error ? err.message : "Gagal menambahkan peserta");
    } finally {
      setAddSaving(false);
    }
  }

  async function handleAddGuest() {
    if (!selected || !addGuestName.trim()) return;
    setAddSaving(true);
    setAddError("");
    try {
      await callFunction("competition_addParticipant", {
        ownerId, clubId,
        requestId: uuidv4(), operationId: uuidv4(),
        competitionId: selected.id,
        type:          "guest",
        guestName:     addGuestName.trim(),
      });
      setAddOpen(false);
      setAddGuestName("");
      await Promise.all([loadParticipants(selected.id), loadCompetitions()]);
    } catch (err) {
      setAddError(err instanceof Error ? err.message : "Gagal menambahkan tamu");
    } finally {
      setAddSaving(false);
    }
  }

  async function handleRemoveParticipant(participant: Participant) {
    if (!selected) return;
    setRemovingId(participant.id);
    try {
      await callFunction("competition_removeParticipant", {
        ownerId, clubId,
        requestId: uuidv4(), operationId: uuidv4(),
        competitionId: selected.id,
        participantId: participant.id,
      });
      await Promise.all([loadParticipants(selected.id), loadCompetitions()]);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Gagal menghapus peserta");
    } finally {
      setRemovingId(null);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-6xl">

      {/* ── Create Dialog ─────────────────────────────────────────────────────── */}
      {createOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-md">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-base font-bold text-slate-900">Buat Lomba Baru</h3>
              <button onClick={() => { setCreateOpen(false); setCreateError(""); }}
                className="text-slate-400 hover:text-slate-600 text-xl leading-none">×</button>
            </div>
            {createError && (
              <div className="mb-4 text-sm text-red-600 bg-red-50 rounded-xl px-3 py-2">{createError}</div>
            )}
            <div className="space-y-3">
              <label className="block">
                <span className="text-xs text-slate-500 font-medium">Nama Lomba *</span>
                <input
                  className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Contoh: Lomba Body Transformation Mei 2026"
                  value={createName}
                  onChange={(e) => setCreateName(e.target.value)}
                />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-xs text-slate-500 font-medium">Tanggal Mulai *</span>
                  <input
                    type="date"
                    className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    value={createStart}
                    onChange={(e) => {
                      setCreateStart(e.target.value);
                      if (createEnd && e.target.value > createEnd) setCreateEnd(e.target.value);
                    }}
                  />
                </label>
                <label className="block">
                  <span className="text-xs text-slate-500 font-medium">Tanggal Selesai *</span>
                  <input
                    type="date"
                    min={createStart || undefined}
                    className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    value={createEnd}
                    onChange={(e) => setCreateEnd(e.target.value)}
                  />
                </label>
              </div>
              {createStart && createEnd && (
                <p className="text-xs text-slate-400">
                  Durasi: <strong className="text-slate-600">{durationDays(createStart, createEnd)} hari</strong>
                </p>
              )}
              <label className="block">
                <span className="text-xs text-slate-500 font-medium">Biaya Admin per Peserta</span>
                <div className="mt-1 relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">Rp</span>
                  <input
                    type="number"
                    min="0"
                    className="w-full border border-slate-200 rounded-xl pl-9 pr-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="0"
                    value={createFee}
                    onChange={(e) => setCreateFee(e.target.value)}
                  />
                </div>
                <p className="text-xs text-slate-400 mt-1">Isi 0 jika tidak ada biaya admin</p>
              </label>
            </div>
            <div className="flex gap-3 mt-5">
              <button
                onClick={() => { setCreateOpen(false); setCreateError(""); }}
                className="flex-1 border border-slate-200 text-slate-600 rounded-xl py-2.5 text-sm font-semibold hover:bg-slate-50 transition"
              >
                Batal
              </button>
              <button
                onClick={handleCreateCompetition}
                disabled={createSaving || !createName.trim() || !createStart || !createEnd}
                className="flex-1 bg-blue-600 text-white rounded-xl py-2.5 text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition"
              >
                {createSaving ? "Membuat…" : "🏆 Buat Lomba"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Extend Dialog ─────────────────────────────────────────────────────── */}
      {extendOpen && selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-base font-bold text-slate-900">Perpanjang Lomba</h3>
              <button onClick={() => { setExtendOpen(false); setExtendError(""); }}
                className="text-slate-400 hover:text-slate-600 text-xl leading-none">×</button>
            </div>
            <div className="bg-slate-50 rounded-xl px-4 py-3 mb-4">
              <p className="text-xs text-slate-400 mb-0.5">Lomba</p>
              <p className="font-semibold text-slate-800 text-sm">{selected.name}</p>
              <p className="text-xs text-slate-500 mt-1">
                Berakhir saat ini: <strong>{fmtDate(selected.endDate)}</strong>
              </p>
            </div>
            {extendError && (
              <div className="mb-3 text-sm text-red-600 bg-red-50 rounded-xl px-3 py-2">{extendError}</div>
            )}
            <label className="block">
              <span className="text-xs text-slate-500 font-medium">Tanggal Selesai Baru *</span>
              <input
                type="date"
                min={selected.endDate}
                className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={extendNewEnd}
                onChange={(e) => setExtendNewEnd(e.target.value)}
              />
            </label>
            {extendNewEnd && extendNewEnd > selected.endDate && (
              <p className="text-xs text-green-600 mt-2 font-medium">
                +{durationDays(selected.endDate, extendNewEnd) - 1} hari perpanjangan
              </p>
            )}
            <div className="flex gap-3 mt-5">
              <button
                onClick={() => { setExtendOpen(false); setExtendError(""); }}
                className="flex-1 border border-slate-200 text-slate-600 rounded-xl py-2.5 text-sm font-semibold hover:bg-slate-50 transition"
              >
                Batal
              </button>
              <button
                onClick={handleExtend}
                disabled={extendSaving || !extendNewEnd || extendNewEnd <= selected.endDate}
                className="flex-1 bg-amber-500 text-white rounded-xl py-2.5 text-sm font-semibold hover:bg-amber-600 disabled:opacity-50 transition"
              >
                {extendSaving ? "Menyimpan…" : "Perpanjang"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Add Participant Dialog ─────────────────────────────────────────────── */}
      {addOpen && selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-md flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between mb-4 shrink-0">
              <div>
                <h3 className="text-base font-bold text-slate-900">Tambah Peserta</h3>
                <p className="text-xs text-slate-400 mt-0.5 truncate max-w-xs">{selected.name}</p>
              </div>
              <button onClick={() => { setAddOpen(false); setAddError(""); setAddSearch(""); setAddGuestName(""); }}
                className="text-slate-400 hover:text-slate-600 text-xl leading-none shrink-0">×</button>
            </div>

            {/* Mode toggle */}
            <div className="flex gap-1 bg-slate-100 p-1 rounded-xl mb-4 shrink-0">
              {(["customer", "guest"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => { setAddMode(m); setAddError(""); }}
                  className={`flex-1 py-2 rounded-lg text-sm font-semibold transition ${
                    addMode === m
                      ? "bg-white text-slate-900 shadow-sm"
                      : "text-slate-500 hover:text-slate-700"
                  }`}
                >
                  {m === "customer" ? "🧑‍🤝‍🧑 Dari Pelanggan" : "👤 Tamu"}
                </button>
              ))}
            </div>

            {addError && (
              <div className="mb-3 text-sm text-red-600 bg-red-50 rounded-xl px-3 py-2 shrink-0">{addError}</div>
            )}

            {addMode === "customer" ? (
              <>
                <input
                  className="border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 mb-3 shrink-0"
                  placeholder="Cari nama atau nomor HP…"
                  value={addSearch}
                  onChange={(e) => setAddSearch(e.target.value)}
                />
                <div className="overflow-y-auto flex-1 min-h-0 rounded-xl border border-slate-100">
                  {addCustLoading ? (
                    <div className="flex items-center justify-center py-10">
                      <div className="w-6 h-6 border-2 border-slate-200 border-t-blue-500 rounded-full animate-spin" />
                    </div>
                  ) : filteredCustomers.length === 0 ? (
                    <p className="text-sm text-slate-400 text-center py-10">
                      {addSearch ? "Tidak ada hasil" : "Tidak ada pelanggan"}
                    </p>
                  ) : (
                    filteredCustomers.map((c) => {
                      const alreadyIn = participants.some((p) => p.customerId === c.id);
                      return (
                        <button
                          key={c.id}
                          disabled={addSaving || alreadyIn}
                          onClick={() => !alreadyIn && handleAddCustomer(c)}
                          className={`w-full flex items-center gap-3 px-4 py-3 text-left border-b border-slate-50 last:border-0 transition ${
                            alreadyIn
                              ? "opacity-40 cursor-not-allowed"
                              : "hover:bg-blue-50"
                          }`}
                        >
                          <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center shrink-0 text-sm font-bold text-slate-600">
                            {c.displayName.charAt(0).toUpperCase()}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-slate-800 truncate">{c.displayName}</p>
                            {c.phone && <p className="text-xs text-slate-400">{c.phone}</p>}
                          </div>
                          {alreadyIn ? (
                            <span className="text-xs text-slate-400 shrink-0">Sudah daftar</span>
                          ) : (
                            <span className="text-xs text-blue-500 shrink-0 font-semibold">+ Tambah</span>
                          )}
                        </button>
                      );
                    })
                  )}
                </div>
              </>
            ) : (
              <div className="space-y-3">
                <label className="block">
                  <span className="text-xs text-slate-500 font-medium">Nama Tamu *</span>
                  <input
                    className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Masukkan nama lengkap tamu"
                    value={addGuestName}
                    onChange={(e) => setAddGuestName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && addGuestName.trim()) handleAddGuest(); }}
                  />
                </label>
                <button
                  onClick={handleAddGuest}
                  disabled={addSaving || !addGuestName.trim()}
                  className="w-full bg-blue-600 text-white rounded-xl py-2.5 text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition"
                >
                  {addSaving ? "Menambahkan…" : "+ Tambahkan Tamu"}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Page Header ───────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">🏆 Lomba</h1>
          <p className="text-sm text-slate-400 mt-0.5">Kelola kompetisi dan peserta lomba club</p>
        </div>
        <button
          onClick={() => { setCreateOpen(true); setCreateError(""); }}
          className="bg-blue-600 text-white px-4 py-2.5 rounded-xl text-sm font-semibold hover:bg-blue-700 transition shadow-sm"
        >
          + Buat Lomba
        </button>
      </div>

      {loading ? (
        <div className="flex flex-col items-center gap-3 py-20 text-slate-400">
          <div className="w-8 h-8 border-2 border-slate-200 border-t-blue-500 rounded-full animate-spin" />
          <p className="text-sm">Memuat lomba…</p>
        </div>
      ) : sortedComps.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-16 text-center">
          <p className="text-4xl mb-3">🏆</p>
          <p className="font-semibold text-slate-700 mb-1">Belum ada lomba</p>
          <p className="text-sm text-slate-400 mb-5">Buat lomba pertama untuk club ini</p>
          <button
            onClick={() => setCreateOpen(true)}
            className="bg-blue-600 text-white px-5 py-2.5 rounded-xl text-sm font-semibold hover:bg-blue-700 transition"
          >
            + Buat Lomba
          </button>
        </div>
      ) : (
        <div className="flex gap-5 items-start">

          {/* ── Competition list ─────────────────────────────────────────────── */}
          <div className="w-80 shrink-0 space-y-2">
            {sortedComps.map((comp) => {
              const status = computeStatus(comp.startDate, comp.endDate);
              const isActive = selectedId === comp.id;
              return (
                <button
                  key={comp.id}
                  onClick={() => setSelectedId(comp.id === selectedId ? null : comp.id)}
                  className={`w-full text-left p-4 rounded-2xl border transition ${
                    isActive
                      ? "border-blue-300 bg-blue-50 shadow-sm"
                      : "border-slate-200 bg-white hover:border-slate-300 hover:shadow-sm"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <p className={`font-semibold text-sm leading-snug ${isActive ? "text-blue-900" : "text-slate-800"}`}>
                      {comp.name}
                    </p>
                    <span className={`shrink-0 text-xs font-bold px-2 py-0.5 rounded-full ${STATUS_STYLE[status]}`}>
                      {STATUS_LABEL[status]}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 mb-2">
                    {fmtDate(comp.startDate)} — {fmtDate(comp.endDate)}
                  </p>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-slate-500">
                      👥 <strong>{comp.participantCount}</strong> peserta
                    </span>
                    {comp.adminFee > 0 && (
                      <span className="text-xs text-slate-500">
                        💰 {fmt(comp.adminFee)}
                      </span>
                    )}
                    <span className="text-xs text-slate-400 ml-auto">
                      {durationDays(comp.startDate, comp.endDate)} hari
                    </span>
                  </div>
                </button>
              );
            })}
          </div>

          {/* ── Detail panel ─────────────────────────────────────────────────── */}
          {selected ? (
            <div className="flex-1 min-w-0">
              {/* Header card */}
              <div className="bg-white rounded-2xl border border-slate-200 p-5 mb-4">
                <div className="flex items-start justify-between gap-3 mb-4">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <h2 className="text-lg font-bold text-slate-900">{selected.name}</h2>
                      <span className={`text-xs font-bold px-2.5 py-0.5 rounded-full ${STATUS_STYLE[computeStatus(selected.startDate, selected.endDate)]}`}>
                        {STATUS_LABEL[computeStatus(selected.startDate, selected.endDate)]}
                      </span>
                    </div>
                    <p className="text-sm text-slate-500">
                      {fmtDate(selected.startDate)} — {fmtDate(selected.endDate)}
                      <span className="text-slate-400 ml-2">
                        ({durationDays(selected.startDate, selected.endDate)} hari)
                      </span>
                    </p>
                  </div>
                  {computeStatus(selected.startDate, selected.endDate) !== "finished" && (
                    <button
                      onClick={() => { setExtendOpen(true); setExtendError(""); setExtendNewEnd(""); }}
                      className="shrink-0 text-sm font-semibold text-amber-600 border border-amber-200 bg-amber-50 px-3.5 py-2 rounded-xl hover:bg-amber-100 transition"
                    >
                      📅 Perpanjang
                    </button>
                  )}
                </div>
                <div className="flex gap-4 text-sm">
                  <div className="bg-slate-50 rounded-xl px-4 py-2.5 text-center">
                    <p className="text-xs text-slate-400 mb-0.5">Peserta</p>
                    <p className="font-bold text-slate-800 text-lg">{selected.participantCount}</p>
                  </div>
                  {selected.adminFee > 0 && (
                    <div className="bg-slate-50 rounded-xl px-4 py-2.5 text-center">
                      <p className="text-xs text-slate-400 mb-0.5">Biaya Admin / Peserta</p>
                      <p className="font-bold text-slate-800">{fmt(selected.adminFee)}</p>
                    </div>
                  )}
                  {selected.adminFee > 0 && selected.participantCount > 0 && (
                    <div className="bg-green-50 rounded-xl px-4 py-2.5 text-center">
                      <p className="text-xs text-green-500 mb-0.5">Total Biaya Admin</p>
                      <p className="font-bold text-green-700">{fmt(selected.adminFee * selected.participantCount)}</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Participant list card */}
              <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
                  <h3 className="font-semibold text-slate-800">
                    Daftar Peserta
                    <span className="ml-2 text-xs font-normal text-slate-400">
                      ({participants.length} orang)
                    </span>
                  </h3>
                  {computeStatus(selected.startDate, selected.endDate) !== "finished" && (
                    <button
                      onClick={() => { setAddOpen(true); setAddError(""); setAddSearch(""); setAddGuestName(""); setAddMode("customer"); }}
                      className="text-sm font-semibold text-blue-600 border border-blue-200 bg-blue-50 px-3.5 py-1.5 rounded-xl hover:bg-blue-100 transition"
                    >
                      + Tambah Peserta
                    </button>
                  )}
                </div>

                {partLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <div className="w-6 h-6 border-2 border-slate-200 border-t-blue-500 rounded-full animate-spin" />
                  </div>
                ) : participants.length === 0 ? (
                  <div className="text-center py-12">
                    <p className="text-2xl mb-2">👥</p>
                    <p className="text-sm text-slate-400 mb-4">Belum ada peserta</p>
                    {computeStatus(selected.startDate, selected.endDate) !== "finished" && (
                      <button
                        onClick={() => { setAddOpen(true); setAddMode("customer"); }}
                        className="text-sm font-semibold text-blue-600 hover:underline"
                      >
                        Tambah peserta sekarang →
                      </button>
                    )}
                  </div>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-slate-500 text-xs">
                      <tr>
                        <th className="px-5 py-3 text-left font-semibold">No</th>
                        <th className="px-5 py-3 text-left font-semibold">Nama</th>
                        <th className="px-5 py-3 text-left font-semibold">Tipe</th>
                        <th className="px-5 py-3 text-left font-semibold">Terdaftar</th>
                        {computeStatus(selected.startDate, selected.endDate) !== "finished" && (
                          <th className="px-5 py-3 text-center font-semibold">Aksi</th>
                        )}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {participants.map((p, idx) => (
                        <tr key={p.id} className="hover:bg-slate-50 transition">
                          <td className="px-5 py-3 text-slate-400 text-xs font-medium">{idx + 1}</td>
                          <td className="px-5 py-3">
                            <div className="flex items-center gap-2.5">
                              <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-xs font-bold ${
                                p.type === "customer" ? "bg-blue-100 text-blue-700" : "bg-slate-100 text-slate-600"
                              }`}>
                                {p.displayName.charAt(0).toUpperCase()}
                              </div>
                              <span className="font-medium text-slate-800">{p.displayName}</span>
                            </div>
                          </td>
                          <td className="px-5 py-3">
                            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                              p.type === "customer"
                                ? "bg-blue-50 text-blue-700"
                                : "bg-slate-100 text-slate-600"
                            }`}>
                              {p.type === "customer" ? "Pelanggan" : "Tamu"}
                            </span>
                          </td>
                          <td className="px-5 py-3 text-xs text-slate-400">
                            {p.joinedAt?.slice(0, 10)}
                          </td>
                          {computeStatus(selected.startDate, selected.endDate) !== "finished" && (
                            <td className="px-5 py-3 text-center">
                              <button
                                onClick={() => handleRemoveParticipant(p)}
                                disabled={removingId === p.id}
                                className="text-xs text-red-500 hover:text-red-700 font-semibold disabled:opacity-40 transition"
                              >
                                {removingId === p.id ? "…" : "Hapus"}
                              </button>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center py-20 text-slate-400">
              <div className="text-center">
                <p className="text-3xl mb-3">👈</p>
                <p className="text-sm">Pilih lomba untuk melihat detail</p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
