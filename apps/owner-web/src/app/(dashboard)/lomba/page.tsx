"use client";

import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { collection, getDocs, query, orderBy } from "firebase/firestore";
import { v4 as uuidv4 } from "uuid";
import { useOwnerAuthStore } from "@/store/auth.store";
import { callFunction, firebaseDb } from "@/firebase/firebase";

// ── Types ─────────────────────────────────────────────────────────────────────

type CompStatus = "upcoming" | "active" | "finished";

interface ScoringWeights {
  bodyFat:      number; // 0–100
  abdominalFat: number; // 0–100
  weightPct:    number; // 0–100
}

const DEFAULT_WEIGHTS: ScoringWeights = { bodyFat: 50, abdominalFat: 30, weightPct: 20 };

interface Competition {
  id: string;
  name: string;
  adminFee: number;
  startDate: string;   // YYYY-MM-DD
  endDate: string;     // YYYY-MM-DD
  status: CompStatus;
  participantCount: number;
  scoringWeights?: ScoringWeights;
  createdAt: string;
  updatedAt: string;
}

interface RankingEntry {
  participant:    Participant;
  first:          Measurement | null;
  last:           Measurement | null;
  score:          number | null;
  deltaBodyFat:   number | null;
  deltaAbdFat:    number | null;
  deltaWeightPct: number | null;
  deltaWeightKg:  number | null;
}

interface Participant {
  id: string;
  competitionId: string;
  type: "customer" | "guest";
  customerId: string | null;
  displayName: string;
  joinedAt: string;
  amountPaid?: number;
  measurementCount?: number;
}

interface CustomerSearchItem {
  id: string;
  displayName: string;
  phone: string | null;
  tier: string;
}

interface Measurement {
  id: string;
  weightKg: number;
  bodyFatPct: number;
  abdominalFatPct: number;
  boneMassKg?: number;
  metabolicAge?: number;
  muscleMassKg?: number;
  waterPct?: number;
  recordedAt: string;
  createdAt: string;
}

type ActivityLogType = "participant_added" | "participant_removed" | "payment_recorded";

interface ActivityLogEntry {
  id: string;
  type: ActivityLogType;
  participantId: string;
  participantName: string;
  participantType?: "customer" | "guest";
  reason?: string;
  amount?: number;
  totalPaid?: number;
  adminFee?: number;
  createdAt: string;
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

function calcBreakdown(first: Measurement, last: Measurement, w: ScoringWeights) {
  const deltaBodyFat   = first.bodyFatPct - last.bodyFatPct;
  const deltaAbdFat    = first.abdominalFatPct - last.abdominalFatPct;
  const deltaWeightKg  = first.weightKg - last.weightKg;
  const deltaWeightPct = (deltaWeightKg / first.weightKg) * 100;
  const score = (deltaBodyFat * w.bodyFat / 100)
              + (deltaAbdFat  * w.abdominalFat / 100)
              + (deltaWeightPct * w.weightPct / 100);
  return { score, deltaBodyFat, deltaAbdFat, deltaWeightPct, deltaWeightKg };
}

function deltaCell(value: number, unit: string, decimals = 1) {
  const good = value > 0;
  const neutral = Math.abs(value) < 0.05;
  const sign = value > 0 ? "▼" : value < 0 ? "▲" : "=";
  const color = neutral ? "text-slate-400" : good ? "text-green-600" : "text-red-500";
  return (
    <span className={`font-semibold text-xs ${color}`}>
      {sign} {Math.abs(value).toFixed(decimals)}{unit}
    </span>
  );
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

  // ── Remove confirmation dialog ───────────────────────────────────────────────
  const [removeOpen, setRemoveOpen]         = useState(false);
  const [removeTarget, setRemoveTarget]     = useState<Participant | null>(null);
  const [removeReason, setRemoveReason]     = useState("");
  const [removeSaving, setRemoveSaving]     = useState(false);
  const [removeError, setRemoveError]       = useState("");
  const removeReasonRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (removeOpen) setTimeout(() => removeReasonRef.current?.focus(), 80);
  }, [removeOpen]);

  // ── Detail tab ───────────────────────────────────────────────────────────────
  const [detailTab, setDetailTab] = useState<"peserta" | "ranking" | "aktivitas">("peserta");

  // ── Activity log ─────────────────────────────────────────────────────────────
  const [activityLog, setActivityLog]       = useState<ActivityLogEntry[]>([]);
  const [actLogLoading, setActLogLoading]   = useState(false);
  const [actLogLoaded, setActLogLoaded]     = useState(false);

  // ── Ranking ───────────────────────────────────────────────────────────────────
  const [rankingData, setRankingData]       = useState<RankingEntry[]>([]);
  const [rankingLoading, setRankingLoading] = useState(false);
  const [rankingLoaded, setRankingLoaded]   = useState(false);

  // ── Edit scoring weights dialog ───────────────────────────────────────────────
  const [editWeightsOpen, setEditWeightsOpen] = useState(false);
  const [ewBodyFat, setEwBodyFat]             = useState("50");
  const [ewAbdFat, setEwAbdFat]               = useState("30");
  const [ewWeightPct, setEwWeightPct]         = useState("20");
  const [ewSaving, setEwSaving]               = useState(false);
  const [ewError, setEwError]                 = useState("");

  // ── Measurement dialog ───────────────────────────────────────────────────────
  const [measOpen, setMeasOpen]               = useState(false);
  const [measParticipant, setMeasParticipant] = useState<Participant | null>(null);
  const [measurements, setMeasurements]       = useState<Measurement[]>([]);
  const [measLoading, setMeasLoading]         = useState(false);
  const [measSaving, setMeasSaving]           = useState(false);
  const [measError, setMeasError]             = useState("");
  // Form fields
  const [mWeight, setMWeight]     = useState("");
  const [mBodyFat, setMBodyFat]   = useState("");
  const [mAbdFat, setMAbdFat]     = useState("");
  const [mBone, setMBone]         = useState("");
  const [mMetAge, setMMetAge]     = useState("");
  const [mMuscle, setMMuscle]     = useState("");
  const [mWater, setMWater]       = useState("");

  function resetMeasForm() {
    setMWeight(""); setMBodyFat(""); setMAbdFat("");
    setMBone(""); setMMetAge(""); setMMuscle(""); setMWater("");
    setMeasError("");
  }

  async function loadMeasurements(compId: string, partId: string) {
    if (!ownerId || !clubId) return;
    setMeasLoading(true);
    try {
      const snap = await getDocs(
        query(
          collection(
            firebaseDb(),
            `owners/${ownerId}/clubs/${clubId}/competitions/${compId}/participants/${partId}/measurements`
          ),
          orderBy("createdAt", "asc")
        )
      );
      setMeasurements(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Measurement, "id">) })));
    } finally {
      setMeasLoading(false);
    }
  }

  function openMeasurements(participant: Participant) {
    setMeasParticipant(participant);
    setMeasurements([]);
    resetMeasForm();
    setMeasOpen(true);
    if (selected) loadMeasurements(selected.id, participant.id);
  }

  async function handleSaveMeasurement() {
    if (!selected || !measParticipant) return;
    const w = parseFloat(mWeight);
    const bf = parseFloat(mBodyFat);
    const af = parseFloat(mAbdFat);
    if (!w || !bf || !af) { setMeasError("Berat badan, lemak tubuh, dan lemak perut wajib diisi"); return; }
    setMeasSaving(true);
    setMeasError("");
    try {
      const payload: Record<string, unknown> = {
        ownerId, clubId,
        requestId: uuidv4(), operationId: uuidv4(),
        competitionId:   selected.id,
        participantId:   measParticipant.id,
        weightKg:        w,
        bodyFatPct:      bf,
        abdominalFatPct: af,
      };
      if (mBone)   payload["boneMassKg"]   = parseFloat(mBone);
      if (mMetAge) payload["metabolicAge"] = parseInt(mMetAge);
      if (mMuscle) payload["muscleMassKg"] = parseFloat(mMuscle);
      if (mWater)  payload["waterPct"]     = parseFloat(mWater);
      await callFunction("competition_recordMeasurement", payload);
      setMeasOpen(false);
      resetMeasForm();
      await loadParticipants(selected.id);
    } catch (err) {
      setMeasError(err instanceof Error ? err.message : "Gagal menyimpan data");
    } finally {
      setMeasSaving(false);
    }
  }

  // ── Create dialog ───────────────────────────────────────────────────────────
  const [createOpen, setCreateOpen]             = useState(false);
  const [createName, setCreateName]             = useState("");
  const [createStart, setCreateStart]           = useState("");
  const [createEnd, setCreateEnd]               = useState("");
  const [createFee, setCreateFee]               = useState("0");
  const [createBf, setCreateBf]                 = useState("50");
  const [createAf, setCreateAf]                 = useState("30");
  const [createWp, setCreateWp]                 = useState("20");
  const [createScoringOpen, setCreateScoringOpen] = useState(false);
  const [createSaving, setCreateSaving]         = useState(false);
  const [createError, setCreateError]           = useState("");

  // ── Force-start dialog ──────────────────────────────────────────────────────
  const [forceStartOpen, setForceStartOpen]     = useState(false);
  const [forceStartEndDate, setForceStartEndDate] = useState("");
  const [forceStartSaving, setForceStartSaving]   = useState(false);
  const [forceStartError, setForceStartError]     = useState("");

  function openForceStart() {
    setForceStartEndDate(selected?.endDate ?? "");
    setForceStartError("");
    setForceStartOpen(true);
  }

  async function handleForceStart() {
    if (!selected) return;
    setForceStartSaving(true);
    setForceStartError("");
    try {
      const today = new Date().toISOString().slice(0, 10);
      await callFunction("competition_forceStart", {
        ownerId, clubId,
        requestId: uuidv4(), operationId: uuidv4(),
        competitionId: selected.id,
        // only send newEndDate when it differs from the stored endDate
        ...(forceStartEndDate && forceStartEndDate !== selected.endDate
          ? { newEndDate: forceStartEndDate }
          : {}),
      });
      setForceStartOpen(false);
      await loadCompetitions();
    } catch (err) {
      setForceStartError(err instanceof Error ? err.message : "Gagal memulai lomba");
    } finally {
      setForceStartSaving(false);
    }
  }

  // ── Extend dialog ───────────────────────────────────────────────────────────
  const [extendOpen, setExtendOpen]       = useState(false);
  const [extendNewEnd, setExtendNewEnd]   = useState("");
  const [extendSaving, setExtendSaving]   = useState(false);
  const [extendError, setExtendError]     = useState("");

  // ── Force-end dialog ─────────────────────────────────────────────────────────
  const [forceEndOpen, setForceEndOpen]     = useState(false);
  const [forceEndSaving, setForceEndSaving] = useState(false);
  const [forceEndError, setForceEndError]   = useState("");

  // ── Payment dialog ──────────────────────────────────────────────────────────
  const [payOpen, setPayOpen]               = useState(false);
  const [payParticipant, setPayParticipant] = useState<Participant | null>(null);
  const [payAmount, setPayAmount]           = useState("");
  const [paySaving, setPaySaving]           = useState(false);
  const [payError, setPayError]             = useState("");
  const payAmountRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (payOpen) setTimeout(() => payAmountRef.current?.focus(), 80);
  }, [payOpen]);

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

  const sortedComps = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return [...competitions]
      .map((c) => ({
        ...c,
        // Stored "finished" takes priority — covers force-ended competitions
        // where endDate === today (computeStatus alone would wrongly return "active")
        status: c.status === "finished" ? "finished" : computeStatus(c.startDate, c.endDate),
      }))
      .sort((a, b) => {
        // Primary: status order (active → upcoming → finished)
        const sDiff = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
        if (sDiff !== 0) return sDiff;
        // Secondary: absolute distance of startDate from today (ascending → nearest first)
        const distA = Math.abs(new Date(a.startDate).getTime() - new Date(today).getTime());
        const distB = Math.abs(new Date(b.startDate).getTime() - new Date(today).getTime());
        if (distA !== distB) return distA - distB;
        // Tiebreak: alphabetical by name
        return a.name.localeCompare(b.name, "id");
      });
  }, [competitions]);

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
    if (selectedId) {
      loadParticipants(selectedId);
      setDetailTab("peserta");
      setActivityLog([]);
      setActLogLoaded(false);
      setRankingData([]);
      setRankingLoaded(false);
    } else {
      setParticipants([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  // ── Load activity log ────────────────────────────────────────────────────────
  const loadActivityLog = useCallback(async (compId: string) => {
    if (!ownerId || !clubId) return;
    setActLogLoading(true);
    try {
      const snap = await getDocs(
        query(
          collection(
            firebaseDb(),
            `owners/${ownerId}/clubs/${clubId}/competitions/${compId}/activityLog`
          ),
          orderBy("createdAt", "desc")
        )
      );
      setActivityLog(
        snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<ActivityLogEntry, "id">) }))
      );
      setActLogLoaded(true);
    } finally {
      setActLogLoading(false);
    }
  }, [ownerId, clubId]);

  // ── Load ranking ─────────────────────────────────────────────────────────────
  async function loadRanking(compId: string, parts: Participant[], weights: ScoringWeights) {
    if (!ownerId || !clubId) return;
    setRankingLoading(true);
    try {
      const entries = await Promise.all(
        parts.map(async (p) => {
          const snap = await getDocs(
            query(
              collection(
                firebaseDb(),
                `owners/${ownerId}/clubs/${clubId}/competitions/${compId}/participants/${p.id}/measurements`
              ),
              orderBy("createdAt", "asc")
            )
          );
          const meas = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Measurement, "id">) }));
          const first = meas[0] ?? null;
          const last  = meas.length >= 2 ? meas[meas.length - 1]! : null;
          if (!first || !last) {
            return { participant: p, first, last, score: null, deltaBodyFat: null, deltaAbdFat: null, deltaWeightPct: null, deltaWeightKg: null };
          }
          return { participant: p, first, last, ...calcBreakdown(first, last, weights) };
        })
      );
      setRankingData(entries);
      setRankingLoaded(true);
    } finally {
      setRankingLoading(false);
    }
  }

  // ── Update scoring weights ────────────────────────────────────────────────────
  async function handleUpdateWeights() {
    if (!selected) return;
    const bf = parseInt(ewBodyFat);
    const af = parseInt(ewAbdFat);
    const wp = parseInt(ewWeightPct);
    if (isNaN(bf) || isNaN(af) || isNaN(wp)) {
      setEwError("Semua bobot harus berupa angka bulat");
      return;
    }
    if (bf + af + wp !== 100) {
      setEwError(`Total bobot ${bf + af + wp}% — harus tepat 100%`);
      return;
    }
    setEwSaving(true);
    setEwError("");
    try {
      const newWeights: ScoringWeights = { bodyFat: bf, abdominalFat: af, weightPct: wp };
      await callFunction("competition_updateScoringWeights", {
        ownerId, clubId,
        requestId: uuidv4(), operationId: uuidv4(),
        competitionId: selected.id,
        scoringWeights: newWeights,
      });
      // Update local competitions state without re-fetching
      setCompetitions((prev) =>
        prev.map((c) => c.id === selected.id ? { ...c, scoringWeights: newWeights } : c)
      );
      setEditWeightsOpen(false);
      // Recalculate ranking if already loaded
      if (rankingLoaded) {
        await loadRanking(selected.id, participants, newWeights);
      }
    } catch (err) {
      setEwError(err instanceof Error ? err.message : "Gagal menyimpan bobot");
    } finally {
      setEwSaving(false);
    }
  }

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
    const bf = parseInt(createBf) || 0;
    const af = parseInt(createAf) || 0;
    const wp = parseInt(createWp) || 0;
    if (bf + af + wp !== 100) {
      setCreateError(`Total bobot penilaian ${bf + af + wp}% — harus tepat 100%`);
      setCreateScoringOpen(true);
      return;
    }
    setCreateSaving(true);
    setCreateError("");
    try {
      await callFunction("competition_create", {
        ownerId, clubId,
        requestId: uuidv4(), operationId: uuidv4(),
        name:           createName.trim(),
        startDate:      createStart,
        endDate:        createEnd,
        adminFee:       parseFloat(createFee) || 0,
        scoringWeights: { bodyFat: bf, abdominalFat: af, weightPct: wp },
      });
      setCreateOpen(false);
      setCreateName(""); setCreateStart(""); setCreateEnd(""); setCreateFee("0");
      setCreateBf("50"); setCreateAf("30"); setCreateWp("20");
      setCreateScoringOpen(false);
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

  async function handleForceEnd() {
    if (!selected) return;
    setForceEndSaving(true);
    setForceEndError("");
    try {
      await callFunction("competition_forceEnd", {
        ownerId, clubId,
        requestId: uuidv4(), operationId: uuidv4(),
        competitionId: selected.id,
      });
      setForceEndOpen(false);
      await loadCompetitions();
    } catch (err) {
      setForceEndError(err instanceof Error ? err.message : "Gagal mengakhiri lomba");
    } finally {
      setForceEndSaving(false);
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
      await Promise.all([
        loadParticipants(selected.id),
        loadCompetitions(),
        ...(actLogLoaded ? [loadActivityLog(selected.id)] : []),
      ]);
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
      await Promise.all([
        loadParticipants(selected.id),
        loadCompetitions(),
        ...(actLogLoaded ? [loadActivityLog(selected.id)] : []),
      ]);
    } catch (err) {
      setAddError(err instanceof Error ? err.message : "Gagal menambahkan tamu");
    } finally {
      setAddSaving(false);
    }
  }

  async function handleRemoveConfirm() {
    if (!selected || !removeTarget || !removeReason.trim()) return;
    setRemoveSaving(true);
    setRemoveError("");
    try {
      await callFunction("competition_removeParticipant", {
        ownerId, clubId,
        requestId: uuidv4(), operationId: uuidv4(),
        competitionId: selected.id,
        participantId: removeTarget.id,
        reason:        removeReason.trim(),
      });
      setRemoveOpen(false);
      setRemoveTarget(null);
      setRemoveReason("");
      await Promise.all([
        loadParticipants(selected.id),
        loadCompetitions(),
        ...(actLogLoaded ? [loadActivityLog(selected.id)] : []),
      ]);
    } catch (err) {
      setRemoveError(err instanceof Error ? err.message : "Gagal menghapus peserta");
    } finally {
      setRemoveSaving(false);
    }
  }

  async function handleRecordPayment() {
    if (!selected || !payParticipant || !payAmount) return;
    const amount = parseFloat(payAmount);
    if (!amount || amount <= 0) return;
    setPaySaving(true);
    setPayError("");
    try {
      await callFunction("competition_recordPayment", {
        ownerId, clubId,
        requestId: uuidv4(), operationId: uuidv4(),
        competitionId: selected.id,
        participantId: payParticipant.id,
        amount,
      });
      setPayOpen(false);
      setPayParticipant(null);
      setPayAmount("");
      await Promise.all([
        loadParticipants(selected.id),
        ...(actLogLoaded ? [loadActivityLog(selected.id)] : []),
      ]);
    } catch (err) {
      setPayError(err instanceof Error ? err.message : "Gagal mencatat pembayaran");
    } finally {
      setPaySaving(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-6xl">

      {/* ── Measurement Dialog ────────────────────────────────────────────────── */}
      {measOpen && measParticipant && selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[92vh] flex flex-col">

            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 shrink-0">
              <div className="flex items-center gap-3">
                <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold ${
                  measParticipant.type === "customer" ? "bg-blue-100 text-blue-700" : "bg-slate-100 text-slate-600"
                }`}>
                  {measParticipant.displayName.charAt(0).toUpperCase()}
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">{measParticipant.displayName}</h3>
                  <p className="text-xs text-slate-400 truncate max-w-xs">{selected.name}</p>
                </div>
              </div>
              <button
                onClick={() => { setMeasOpen(false); resetMeasForm(); }}
                className="text-slate-400 hover:text-slate-600 text-xl leading-none"
              >×</button>
            </div>

            {/* Body — two columns */}
            <div className="flex flex-1 min-h-0 overflow-hidden">

              {/* Left — measurement history */}
              <div className="w-64 shrink-0 border-r border-slate-100 overflow-y-auto p-4 space-y-3">
                <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                  Riwayat Data ({measurements.length})
                </p>
                {measLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <div className="w-5 h-5 border-2 border-slate-200 border-t-blue-500 rounded-full animate-spin" />
                  </div>
                ) : measurements.length === 0 ? (
                  <div className="text-center py-8 text-slate-300">
                    <p className="text-2xl mb-1">📊</p>
                    <p className="text-xs">Belum ada data</p>
                  </div>
                ) : (
                  measurements.map((m, idx) => (
                    <div key={m.id} className="bg-slate-50 rounded-xl p-3 space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-slate-700">
                          {idx === 0 ? "Data Awal" : `Data Ke-${idx + 1}`}
                        </span>
                        <span className="text-xs text-slate-400">
                          {new Date(m.recordedAt).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" })}
                        </span>
                      </div>
                      <div className="grid grid-cols-3 gap-x-2 gap-y-1">
                        <div>
                          <p className="text-xs text-slate-400">BB</p>
                          <p className="text-sm font-bold text-slate-800">{m.weightKg} <span className="text-xs font-normal text-slate-400">kg</span></p>
                        </div>
                        <div>
                          <p className="text-xs text-slate-400">Lemak</p>
                          <p className="text-sm font-bold text-slate-800">{m.bodyFatPct}<span className="text-xs font-normal text-slate-400">%</span></p>
                        </div>
                        <div>
                          <p className="text-xs text-slate-400">L.Perut</p>
                          <p className="text-sm font-bold text-slate-800">{m.abdominalFatPct}<span className="text-xs font-normal text-slate-400">%</span></p>
                        </div>
                        {m.muscleMassKg !== undefined && (
                          <div>
                            <p className="text-xs text-slate-400">Otot</p>
                            <p className="text-sm font-semibold text-slate-700">{m.muscleMassKg} <span className="text-xs font-normal text-slate-400">kg</span></p>
                          </div>
                        )}
                        {m.boneMassKg !== undefined && (
                          <div>
                            <p className="text-xs text-slate-400">Tulang</p>
                            <p className="text-sm font-semibold text-slate-700">{m.boneMassKg} <span className="text-xs font-normal text-slate-400">kg</span></p>
                          </div>
                        )}
                        {m.waterPct !== undefined && (
                          <div>
                            <p className="text-xs text-slate-400">Air</p>
                            <p className="text-sm font-semibold text-slate-700">{m.waterPct}<span className="text-xs font-normal text-slate-400">%</span></p>
                          </div>
                        )}
                        {m.metabolicAge !== undefined && (
                          <div>
                            <p className="text-xs text-slate-400">Usia Met.</p>
                            <p className="text-sm font-semibold text-slate-700">{m.metabolicAge} <span className="text-xs font-normal text-slate-400">thn</span></p>
                          </div>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* Right — add new measurement form */}
              <div className="flex-1 overflow-y-auto p-6 space-y-5">
                <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                  {measurements.length === 0 ? "Input Data Awal" : `Tambah Data Ke-${measurements.length + 1}`}
                </p>

                {measError && (
                  <div className="text-sm text-red-600 bg-red-50 rounded-xl px-3 py-2">{measError}</div>
                )}

                {/* Required fields */}
                <div>
                  <p className="text-xs font-semibold text-slate-500 mb-2">
                    Data Wajib <span className="text-red-400">*</span>
                  </p>
                  <div className="grid grid-cols-3 gap-3">
                    {[
                      { label: "Berat Badan", unit: "kg", val: mWeight, set: setMWeight, placeholder: "70.5" },
                      { label: "Lemak Tubuh", unit: "%",  val: mBodyFat, set: setMBodyFat, placeholder: "25.0" },
                      { label: "Lemak Perut", unit: "%",  val: mAbdFat, set: setMAbdFat, placeholder: "15.0" },
                    ].map(({ label, unit, val, set, placeholder }) => (
                      <label key={label} className="block">
                        <span className="text-xs text-slate-500">{label}</span>
                        <div className="mt-1 relative">
                          <input
                            type="number"
                            step="0.1"
                            className="w-full border border-slate-200 rounded-xl px-3 pr-9 py-2.5 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                            placeholder={placeholder}
                            value={val}
                            onChange={(e) => set(e.target.value)}
                          />
                          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400 pointer-events-none">
                            {unit}
                          </span>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>

                {/* Optional fields */}
                <div>
                  <p className="text-xs font-semibold text-slate-400 mb-2">Data Opsional</p>
                  <div className="grid grid-cols-2 gap-3">
                    {[
                      { label: "Massa Otot",       unit: "kg",  val: mMuscle,  set: setMMuscle,  placeholder: "35.0", step: "0.1" },
                      { label: "Massa Tulang",      unit: "kg",  val: mBone,    set: setMBone,    placeholder: "2.5",  step: "0.1" },
                      { label: "Kadar Air",         unit: "%",   val: mWater,   set: setMWater,   placeholder: "55.0", step: "0.1" },
                      { label: "Usia Metabolisme",  unit: "thn", val: mMetAge,  set: setMMetAge,  placeholder: "30",   step: "1"   },
                    ].map(({ label, unit, val, set, placeholder, step }) => (
                      <label key={label} className="block">
                        <span className="text-xs text-slate-400">{label}</span>
                        <div className="mt-1 relative">
                          <input
                            type="number"
                            step={step}
                            className="w-full border border-slate-100 rounded-xl px-3 pr-10 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-slate-50"
                            placeholder={placeholder}
                            value={val}
                            onChange={(e) => set(e.target.value)}
                          />
                          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400 pointer-events-none">
                            {unit}
                          </span>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>

                <button
                  onClick={handleSaveMeasurement}
                  disabled={measSaving || !mWeight || !mBodyFat || !mAbdFat}
                  className="w-full bg-blue-600 text-white rounded-xl py-3 text-sm font-bold hover:bg-blue-700 disabled:opacity-40 transition"
                >
                  {measSaving
                    ? "Menyimpan…"
                    : measurements.length === 0
                    ? "💾 Simpan Data Awal"
                    : `💾 Simpan Data Ke-${measurements.length + 1}`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Remove Confirmation Dialog ────────────────────────────────────────── */}
      {removeOpen && removeTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold text-slate-900">Hapus Peserta</h3>
              <button
                onClick={() => { setRemoveOpen(false); setRemoveError(""); setRemoveReason(""); }}
                className="text-slate-400 hover:text-slate-600 text-xl leading-none"
              >×</button>
            </div>

            {/* Participant info */}
            <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-3 mb-4 flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-red-100 flex items-center justify-center shrink-0 text-sm font-bold text-red-600">
                {removeTarget.displayName.charAt(0).toUpperCase()}
              </div>
              <div>
                <p className="font-semibold text-slate-800 text-sm">{removeTarget.displayName}</p>
                <p className="text-xs text-slate-400">
                  {removeTarget.type === "customer" ? "Pelanggan" : "Tamu"}
                </p>
              </div>
            </div>

            {removeError && (
              <div className="mb-3 text-sm text-red-600 bg-red-50 rounded-xl px-3 py-2">{removeError}</div>
            )}

            <label className="block mb-4">
              <span className="text-xs text-slate-500 font-medium">
                Alasan penghapusan <span className="text-red-500">*</span>
              </span>
              <textarea
                ref={removeReasonRef}
                rows={3}
                className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-400 resize-none"
                placeholder="Contoh: Mengundurkan diri, tidak memenuhi syarat, dll."
                value={removeReason}
                onChange={(e) => setRemoveReason(e.target.value)}
              />
            </label>

            <div className="flex gap-3">
              <button
                onClick={() => { setRemoveOpen(false); setRemoveError(""); setRemoveReason(""); }}
                className="flex-1 border border-slate-200 text-slate-600 rounded-xl py-2.5 text-sm font-semibold hover:bg-slate-50 transition"
              >
                Batal
              </button>
              <button
                onClick={handleRemoveConfirm}
                disabled={removeSaving || !removeReason.trim()}
                className="flex-1 bg-red-500 text-white rounded-xl py-2.5 text-sm font-semibold hover:bg-red-600 disabled:opacity-50 transition"
              >
                {removeSaving ? "Menghapus…" : "🗑 Hapus Peserta"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Payment Dialog ────────────────────────────────────────────────────── */}
      {payOpen && payParticipant && selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold text-slate-900">Catat Pembayaran Admin</h3>
              <button
                onClick={() => { setPayOpen(false); setPayError(""); }}
                className="text-slate-400 hover:text-slate-600 text-xl leading-none"
              >×</button>
            </div>

            {/* Participant summary */}
            <div className="bg-slate-50 rounded-xl px-4 py-3 mb-4 space-y-1.5">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-full bg-blue-100 flex items-center justify-center shrink-0 text-xs font-bold text-blue-700">
                  {payParticipant.displayName.charAt(0).toUpperCase()}
                </div>
                <p className="font-semibold text-slate-800 text-sm truncate">{payParticipant.displayName}</p>
              </div>
              <div className="flex justify-between text-xs text-slate-500 pt-0.5">
                <span>Sudah dibayar</span>
                <span className="font-semibold text-slate-700">{fmt(payParticipant.amountPaid ?? 0)}</span>
              </div>
              <div className="flex justify-between text-xs text-amber-600">
                <span>Sisa tagihan</span>
                <span className="font-bold">{fmt(selected.adminFee - (payParticipant.amountPaid ?? 0))}</span>
              </div>
            </div>

            {payError && (
              <div className="mb-3 text-sm text-red-600 bg-red-50 rounded-xl px-3 py-2">{payError}</div>
            )}

            {/* Amount stepper */}
            <div className="space-y-2 mb-5">
              <p className="text-xs text-slate-500 font-medium">Jumlah Bayar Sekarang</p>
              <div className="flex items-stretch gap-2">
                <button
                  onClick={() => setPayAmount(String(Math.max(0, (parseFloat(payAmount) || 0) - 50000)))}
                  className="w-11 shrink-0 rounded-xl bg-rose-50 border border-rose-200 text-rose-600 text-2xl font-bold hover:bg-rose-100 active:scale-95 transition flex items-center justify-center"
                >−</button>
                <input
                  ref={payAmountRef}
                  type="number"
                  className="flex-1 min-w-0 border-2 border-blue-300 rounded-xl px-3 py-3 text-2xl font-bold text-blue-700 text-center bg-blue-50 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-blue-400 placeholder:text-blue-200"
                  placeholder="0"
                  value={payAmount}
                  onChange={(e) => setPayAmount(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleRecordPayment(); }}
                />
                <button
                  onClick={() => setPayAmount(String((parseFloat(payAmount) || 0) + 50000))}
                  className="w-11 shrink-0 rounded-xl bg-blue-50 border border-blue-200 text-blue-600 text-2xl font-bold hover:bg-blue-100 active:scale-95 transition flex items-center justify-center"
                >+</button>
              </div>
              {/* Quick chips */}
              <div className="flex gap-1.5">
                <button
                  onClick={() => setPayAmount(String(selected.adminFee - (payParticipant.amountPaid ?? 0)))}
                  className="flex-1 py-1.5 bg-green-50 hover:bg-green-100 text-green-700 text-xs font-bold rounded-lg border border-green-200 transition"
                >
                  Lunas
                </button>
                {[50000, 100000, 150000, 200000].map((v) => (
                  <button
                    key={v}
                    onClick={() => setPayAmount(String(v))}
                    className="flex-1 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-lg transition"
                  >
                    {v >= 1_000_000 ? `${v / 1_000_000}jt` : `${v / 1000}rb`}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => { setPayOpen(false); setPayError(""); }}
                className="flex-1 border border-slate-200 text-slate-600 rounded-xl py-2.5 text-sm font-semibold hover:bg-slate-50 transition"
              >
                Batal
              </button>
              <button
                onClick={handleRecordPayment}
                disabled={paySaving || !payAmount || parseFloat(payAmount) <= 0}
                className="flex-1 bg-blue-600 text-white rounded-xl py-2.5 text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition"
              >
                {paySaving ? "Menyimpan…" : "✓ Catat Bayar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Edit Scoring Weights Dialog ──────────────────────────────────────── */}
      {editWeightsOpen && selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-base font-bold text-slate-900">Bobot Penilaian</h3>
                <p className="text-xs text-slate-400 mt-0.5 truncate max-w-xs">{selected.name}</p>
              </div>
              <button
                onClick={() => { setEditWeightsOpen(false); setEwError(""); }}
                className="text-slate-400 hover:text-slate-600 text-xl leading-none"
              >×</button>
            </div>

            <p className="text-xs text-slate-400 mb-4 leading-relaxed">
              Tentukan bobot masing-masing indikator. Total harus tepat <strong>100%</strong>.
              Skor = (ΔLemak × {ewBodyFat}%) + (ΔPerut × {ewAbdFat}%) + (ΔBerat × {ewWeightPct}%)
            </p>

            {ewError && (
              <div className="mb-3 text-sm text-red-600 bg-red-50 rounded-xl px-3 py-2">{ewError}</div>
            )}

            <div className="space-y-3 mb-4">
              {[
                { label: "Lemak Tubuh",  val: ewBodyFat,  set: setEwBodyFat },
                { label: "Lemak Perut",  val: ewAbdFat,   set: setEwAbdFat },
                { label: "Berat Badan",  val: ewWeightPct, set: setEwWeightPct },
              ].map(({ label, val, set }) => (
                <label key={label} className="flex items-center justify-between gap-3">
                  <span className="text-sm text-slate-700 w-28 shrink-0">{label}</span>
                  <div className="relative flex-1 max-w-[120px]">
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step={1}
                      className="w-full border border-slate-200 rounded-xl px-3 pr-8 py-2 text-sm font-semibold text-center focus:outline-none focus:ring-2 focus:ring-blue-500"
                      value={val}
                      onChange={(e) => set(e.target.value)}
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400 pointer-events-none">%</span>
                  </div>
                </label>
              ))}
            </div>

            {/* Live sum indicator */}
            {(() => {
              const total = (parseInt(ewBodyFat) || 0) + (parseInt(ewAbdFat) || 0) + (parseInt(ewWeightPct) || 0);
              const ok = total === 100;
              return (
                <div className={`flex items-center justify-between rounded-xl px-4 py-2.5 mb-4 text-sm font-semibold ${ok ? "bg-green-50 text-green-700" : "bg-amber-50 text-amber-700"}`}>
                  <span>Total</span>
                  <span>{total}% {ok ? "✓" : `— kurang ${100 - total}%`}</span>
                </div>
              );
            })()}

            <div className="flex gap-3">
              <button
                onClick={() => { setEditWeightsOpen(false); setEwError(""); }}
                className="flex-1 border border-slate-200 text-slate-600 rounded-xl py-2.5 text-sm font-semibold hover:bg-slate-50 transition"
              >
                Batal
              </button>
              <button
                onClick={handleUpdateWeights}
                disabled={ewSaving}
                className="flex-1 bg-blue-600 text-white rounded-xl py-2.5 text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition"
              >
                {ewSaving ? "Menyimpan…" : "💾 Simpan Bobot"}
              </button>
            </div>
          </div>
        </div>
      )}

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

              {/* Collapsible scoring weights */}
              <div className="border border-slate-100 rounded-xl overflow-hidden">
                <button
                  type="button"
                  onClick={() => setCreateScoringOpen((o) => !o)}
                  className="w-full flex items-center justify-between px-4 py-2.5 text-sm text-slate-600 hover:bg-slate-50 transition"
                >
                  <span className="font-medium">⚖️ Bobot Penilaian</span>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-400">
                      {createBf}% / {createAf}% / {createWp}%
                    </span>
                    <span className="text-slate-400">{createScoringOpen ? "▲" : "▼"}</span>
                  </div>
                </button>
                {createScoringOpen && (
                  <div className="px-4 pb-4 space-y-3 bg-slate-50">
                    <p className="text-xs text-slate-400 pt-2">
                      Lemak Tubuh + Lemak Perut + Berat Badan harus total 100%.
                    </p>
                    <div className="grid grid-cols-3 gap-2">
                      {[
                        { label: "Lemak Tubuh", val: createBf,  set: setCreateBf },
                        { label: "Lemak Perut", val: createAf,  set: setCreateAf },
                        { label: "Berat Badan", val: createWp,  set: setCreateWp },
                      ].map(({ label, val, set }) => (
                        <label key={label} className="block">
                          <span className="text-xs text-slate-500">{label}</span>
                          <div className="relative mt-1">
                            <input
                              type="number" min={0} max={100} step={1}
                              className="w-full border border-slate-200 rounded-lg px-2 pr-6 py-2 text-sm font-semibold text-center focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                              value={val}
                              onChange={(e) => set(e.target.value)}
                            />
                            <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-slate-400 pointer-events-none">%</span>
                          </div>
                        </label>
                      ))}
                    </div>
                    {(() => {
                      const total = (parseInt(createBf)||0) + (parseInt(createAf)||0) + (parseInt(createWp)||0);
                      const ok = total === 100;
                      return (
                        <p className={`text-xs font-semibold ${ok ? "text-green-600" : "text-amber-600"}`}>
                          Total: {total}% {ok ? "✓" : `— perlu ${100 - total}% lagi`}
                        </p>
                      );
                    })()}
                  </div>
                )}
              </div>
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

      {/* ── Force-start Dialog ────────────────────────────────────────────────── */}
      {forceStartOpen && selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold text-slate-900">Mulai Lomba Sekarang?</h3>
              <button
                onClick={() => { setForceStartOpen(false); setForceStartError(""); }}
                className="text-slate-400 hover:text-slate-600 text-xl leading-none"
              >×</button>
            </div>

            {/* Competition summary */}
            <div className="bg-green-50 border border-green-100 rounded-xl px-4 py-3.5 mb-4 space-y-2.5">
              <p className="font-semibold text-slate-800 text-sm leading-snug">{selected.name}</p>
              <div className="space-y-1.5 text-xs text-slate-600">
                <div className="flex justify-between">
                  <span className="text-slate-400">Jadwal mulai asli</span>
                  <span className="font-medium">{fmtDate(selected.startDate)}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-slate-400 shrink-0">Lomba selesai</span>
                  <input
                    type="date"
                    min={(() => {
                      const d = new Date();
                      d.setDate(d.getDate() + 1);
                      return d.toISOString().slice(0, 10);
                    })()}
                    className="border border-green-200 rounded-lg px-2 py-1 text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-green-400 bg-white"
                    value={forceStartEndDate}
                    onChange={(e) => setForceStartEndDate(e.target.value)}
                  />
                </div>
                <div className="flex justify-between border-t border-green-100 pt-2">
                  <span className="text-slate-400">Durasi aktif</span>
                  <span className="font-bold text-green-700">
                    {forceStartEndDate
                      ? `${durationDays(new Date().toISOString().slice(0, 10), forceStartEndDate)} hari`
                      : "—"}
                  </span>
                </div>
              </div>
            </div>

            <p className="text-xs text-slate-400 mb-4 leading-relaxed">
              Lomba akan langsung berstatus <strong className="text-green-700">Berjalan</strong> mulai hari ini.
              Ubah tanggal selesai di atas jika perlu, atau biarkan sesuai jadwal asli.
            </p>

            {forceStartError && (
              <div className="mb-3 text-sm text-red-600 bg-red-50 rounded-xl px-3 py-2">{forceStartError}</div>
            )}

            <div className="flex gap-3">
              <button
                onClick={() => { setForceStartOpen(false); setForceStartError(""); }}
                className="flex-1 border border-slate-200 text-slate-600 rounded-xl py-2.5 text-sm font-semibold hover:bg-slate-50 transition"
              >
                Batal
              </button>
              <button
                onClick={handleForceStart}
                disabled={forceStartSaving || !forceStartEndDate}
                className="flex-1 bg-green-600 text-white rounded-xl py-2.5 text-sm font-semibold hover:bg-green-700 disabled:opacity-50 transition"
              >
                {forceStartSaving ? "Memulai…" : "▶ Mulai Sekarang"}
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

      {/* ── Force-end Dialog ──────────────────────────────────────────────────── */}
      {forceEndOpen && selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold text-slate-900">Akhiri Lomba Sekarang?</h3>
              <button
                onClick={() => { setForceEndOpen(false); setForceEndError(""); }}
                className="text-slate-400 hover:text-slate-600 text-xl leading-none"
              >×</button>
            </div>

            <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-3.5 mb-4 space-y-1.5">
              <p className="font-semibold text-slate-800 text-sm">{selected.name}</p>
              <p className="text-xs text-slate-500">
                Berlangsung: <strong>{fmtDate(selected.startDate)} — {fmtDate(selected.endDate)}</strong>
              </p>
              <p className="text-xs text-slate-500">
                Peserta: <strong>{selected.participantCount} orang</strong>
              </p>
            </div>

            <p className="text-xs text-slate-400 mb-4 leading-relaxed">
              Lomba akan langsung berstatus <strong className="text-slate-700">Selesai</strong> hari ini.
              Tindakan ini <strong>tidak dapat diurungkan</strong> — pastikan semua data peserta sudah dicatat sebelum mengakhiri.
            </p>

            {forceEndError && (
              <div className="mb-3 text-sm text-red-600 bg-red-50 rounded-xl px-3 py-2">{forceEndError}</div>
            )}

            <div className="flex gap-3">
              <button
                onClick={() => { setForceEndOpen(false); setForceEndError(""); }}
                className="flex-1 border border-slate-200 text-slate-600 rounded-xl py-2.5 text-sm font-semibold hover:bg-slate-50 transition"
              >
                Batal
              </button>
              <button
                onClick={handleForceEnd}
                disabled={forceEndSaving}
                className="flex-1 bg-red-500 text-white rounded-xl py-2.5 text-sm font-semibold hover:bg-red-600 disabled:opacity-50 transition"
              >
                {forceEndSaving ? "Mengakhiri…" : "⏹ Akhiri Lomba"}
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
              // comp.status is already corrected in sortedComps (respects stored "finished")
              const status = comp.status;
              const isActive = selectedId === comp.id;
              return (
                <button
                  key={comp.id}
                  onClick={() => setSelectedId(comp.id === selectedId ? null : comp.id)}
                  className={`w-full text-left p-4 rounded-2xl border transition ${
                    isActive
                      ? status === "active"
                        ? "border-green-400 bg-green-100 shadow-sm"
                        : status === "finished"
                        ? "border-slate-300 bg-slate-100 shadow-sm"
                        : "border-blue-300 bg-blue-50 shadow-sm"
                      : status === "active"
                      ? "border-green-200 bg-green-50 hover:border-green-300 hover:shadow-sm"
                      : status === "finished"
                      ? "border-slate-100 bg-white hover:border-slate-200 opacity-60 hover:opacity-80"
                      : "border-slate-200 bg-white hover:border-slate-300 hover:shadow-sm"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <p className={`font-semibold text-sm leading-snug flex items-start gap-1.5 ${
                      isActive
                        ? status === "active" ? "text-green-900" : status === "finished" ? "text-slate-600" : "text-blue-900"
                        : status === "active" ? "text-green-800" : status === "finished" ? "text-slate-500" : "text-slate-800"
                    }`}>
                      {status === "active" && (
                        <span className="relative flex h-2 w-2 mt-1 shrink-0">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                          <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
                        </span>
                      )}
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
          {selected && (() => {
            // Single source of truth — stored "finished" takes priority over
            // date-based calculation (covers force-ended where endDate === today)
            const selectedStatus: CompStatus =
              selected.status === "finished"
                ? "finished"
                : computeStatus(selected.startDate, selected.endDate);
            return (
            <div className="flex-1 min-w-0">
              {/* Header card */}
              <div className="bg-white rounded-2xl border border-slate-200 p-5 mb-4">
                <div className="flex items-start justify-between gap-3 mb-4">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <h2 className="text-lg font-bold text-slate-900">{selected.name}</h2>
                      <span className={`text-xs font-bold px-2.5 py-0.5 rounded-full ${STATUS_STYLE[selectedStatus]}`}>
                        {STATUS_LABEL[selectedStatus]}
                      </span>
                    </div>
                    <p className="text-sm text-slate-500">
                      {fmtDate(selected.startDate)} — {fmtDate(selected.endDate)}
                      <span className="text-slate-400 ml-2">
                        ({durationDays(selected.startDate, selected.endDate)} hari)
                      </span>
                    </p>
                  </div>
                  <div className="flex gap-2 shrink-0 flex-wrap justify-end">
                    {selectedStatus === "upcoming" && (
                      <button
                        onClick={openForceStart}
                        className="text-sm font-semibold text-green-700 border border-green-200 bg-green-50 px-3.5 py-2 rounded-xl hover:bg-green-100 transition"
                      >
                        ▶ Mulai Sekarang
                      </button>
                    )}
                    {selectedStatus !== "finished" && (
                      <button
                        onClick={() => { setExtendOpen(true); setExtendError(""); setExtendNewEnd(""); }}
                        className="text-sm font-semibold text-amber-600 border border-amber-200 bg-amber-50 px-3.5 py-2 rounded-xl hover:bg-amber-100 transition"
                      >
                        📅 Perpanjang
                      </button>
                    )}
                    {selectedStatus === "active" && (
                      <button
                        onClick={() => { setForceEndOpen(true); setForceEndError(""); }}
                        className="text-sm font-semibold text-red-600 border border-red-200 bg-red-50 px-3.5 py-2 rounded-xl hover:bg-red-100 transition"
                      >
                        ⏹ Selesaikan
                      </button>
                    )}
                    <button
                      onClick={() => {
                        const w = selected.scoringWeights ?? DEFAULT_WEIGHTS;
                        setEwBodyFat(String(w.bodyFat));
                        setEwAbdFat(String(w.abdominalFat));
                        setEwWeightPct(String(w.weightPct));
                        setEwError("");
                        setEditWeightsOpen(true);
                      }}
                      className="text-sm font-semibold text-slate-600 border border-slate-200 bg-white px-3.5 py-2 rounded-xl hover:bg-slate-50 transition"
                    >
                      ⚖️ Bobot
                    </button>
                  </div>
                </div>
                {(() => {
                  const totalCollected   = participants.reduce((s, p) => s + (p.amountPaid ?? 0), 0);
                  const totalTarget      = selected.adminFee * participants.length;
                  const totalOutstanding = Math.max(0, totalTarget - totalCollected);
                  const unpaidCount      = participants.filter((p) => (p.amountPaid ?? 0) < selected.adminFee).length;
                  return (
                    <div className="flex gap-3 flex-wrap text-sm">
                      <div className="bg-slate-50 rounded-xl px-4 py-2.5 text-center">
                        <p className="text-xs text-slate-400 mb-0.5">Peserta</p>
                        <p className="font-bold text-slate-800 text-lg">{selected.participantCount}</p>
                      </div>
                      {selected.adminFee > 0 && (
                        <div className="bg-slate-50 rounded-xl px-4 py-2.5 text-center">
                          <p className="text-xs text-slate-400 mb-0.5">Admin / Peserta</p>
                          <p className="font-bold text-slate-800">{fmt(selected.adminFee)}</p>
                        </div>
                      )}
                      {selected.adminFee > 0 && participants.length > 0 && (
                        <div className="bg-green-50 rounded-xl px-4 py-2.5 text-center">
                          <p className="text-xs text-green-500 mb-0.5">Terkumpul</p>
                          <p className="font-bold text-green-700">{fmt(totalCollected)}</p>
                          <p className="text-xs text-green-400">dari {fmt(totalTarget)}</p>
                        </div>
                      )}
                      {selected.adminFee > 0 && totalOutstanding > 0 && (
                        <div className="bg-amber-50 rounded-xl px-4 py-2.5 text-center">
                          <p className="text-xs text-amber-500 mb-0.5">Belum Lunas</p>
                          <p className="font-bold text-amber-700">{fmt(totalOutstanding)}</p>
                          <p className="text-xs text-amber-400">{unpaidCount} peserta</p>
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>

              {/* Tab toggle */}
              <div className="flex gap-1 bg-slate-100 p-1 rounded-xl mb-3">
                {(["peserta", "ranking", "aktivitas"] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => {
                      setDetailTab(t);
                      if (t === "aktivitas" && !actLogLoaded) loadActivityLog(selected.id);
                      if (t === "ranking" && !rankingLoaded) {
                        loadRanking(selected.id, participants, selected.scoringWeights ?? DEFAULT_WEIGHTS);
                      }
                    }}
                    className={`flex-1 py-2 rounded-lg text-sm font-semibold transition ${
                      detailTab === t
                        ? "bg-white text-slate-900 shadow-sm"
                        : "text-slate-500 hover:text-slate-700"
                    }`}
                  >
                    {t === "peserta" ? "👥 Peserta" : t === "ranking" ? "🏅 Ranking" : "📋 Aktivitas"}
                  </button>
                ))}
              </div>

              {/* Participant list card */}
              {detailTab === "peserta" && (
              <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
                  <h3 className="font-semibold text-slate-800">
                    Daftar Peserta
                    <span className="ml-2 text-xs font-normal text-slate-400">
                      ({participants.length} orang)
                    </span>
                  </h3>
                  {selectedStatus !== "finished" && (
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
                    {selectedStatus !== "finished" && (
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
                        <th className="px-5 py-3 text-left font-semibold">Data Timbang</th>
                        {selected.adminFee > 0 && (
                          <th className="px-5 py-3 text-left font-semibold">Biaya Admin</th>
                        )}
                        {selectedStatus !== "finished" && (
                          <th className="px-5 py-3 text-center font-semibold">Aksi</th>
                        )}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {participants.map((p, idx) => (
                        <tr key={p.id} className="hover:bg-slate-50 transition">
                          <td className="px-5 py-3 text-slate-400 text-xs font-medium">{idx + 1}</td>
                          <td className="px-5 py-3">
                            <button
                              onClick={() => openMeasurements(p)}
                              className="flex items-center gap-2.5 group text-left"
                            >
                              <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-xs font-bold ${
                                p.type === "customer" ? "bg-blue-100 text-blue-700" : "bg-slate-100 text-slate-600"
                              }`}>
                                {p.displayName.charAt(0).toUpperCase()}
                              </div>
                              <span className="font-medium text-slate-800 group-hover:text-blue-600 group-hover:underline transition-colors">
                                {p.displayName}
                              </span>
                              <span className="text-xs text-slate-300 group-hover:text-blue-400 transition-colors">📊</span>
                            </button>
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
                          <td className="px-5 py-3">
                            {(() => {
                              const n = p.measurementCount ?? 0;
                              if (n === 0) return (
                                <span className="text-xs text-slate-400 bg-slate-100 px-2.5 py-1 rounded-full">
                                  Belum ada
                                </span>
                              );
                              const label = n === 1 ? "Data Awal" : `Data Ke-${n}`;
                              return (
                                <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${
                                  n === 1
                                    ? "bg-green-100 text-green-700"
                                    : "bg-blue-100 text-blue-700"
                                }`}>
                                  ✓ {label}
                                </span>
                              );
                            })()}
                          </td>
                          {selected.adminFee > 0 && (() => {
                            const paid      = p.amountPaid ?? 0;
                            const remaining = selected.adminFee - paid;
                            const isPaid    = paid >= selected.adminFee;
                            return (
                              <td className="px-5 py-3">
                                {isPaid ? (
                                  <span className="text-xs font-bold text-green-600 bg-green-50 px-2.5 py-1 rounded-full">
                                    ✓ Lunas
                                  </span>
                                ) : (
                                  <div className="flex items-center gap-2">
                                    <div>
                                      <p className="text-xs font-semibold text-amber-700">
                                        {fmt(paid)} <span className="text-slate-400 font-normal">/ {fmt(selected.adminFee)}</span>
                                      </p>
                                      <p className="text-xs text-slate-400">Sisa {fmt(remaining)}</p>
                                    </div>
                                    <button
                                      onClick={() => {
                                        setPayParticipant(p);
                                        setPayAmount("");
                                        setPayError("");
                                        setPayOpen(true);
                                      }}
                                      className="shrink-0 text-xs font-semibold text-blue-600 border border-blue-200 bg-blue-50 px-2.5 py-1 rounded-lg hover:bg-blue-100 transition"
                                    >
                                      Cicil
                                    </button>
                                  </div>
                                )}
                              </td>
                            );
                          })()}
                          {selectedStatus !== "finished" && (
                            <td className="px-5 py-3 text-center">
                              <button
                                onClick={() => {
                                  setRemoveTarget(p);
                                  setRemoveReason("");
                                  setRemoveError("");
                                  setRemoveOpen(true);
                                }}
                                className="text-xs text-red-500 hover:text-red-700 font-semibold transition"
                              >
                                Hapus
                              </button>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
              )}

              {/* Ranking tab */}
              {detailTab === "ranking" && (() => {
                const w = selected.scoringWeights ?? DEFAULT_WEIGHTS;
                const ranked  = rankingData.filter((e) => e.score !== null)
                  .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
                const pending = rankingData.filter((e) => e.score === null);
                return (
                  <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                    {/* Weights info bar */}
                    <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100 bg-slate-50">
                      <div className="flex items-center gap-3 text-xs text-slate-500">
                        <span className="font-semibold text-slate-700">Bobot:</span>
                        <span>Lemak Tubuh <strong className="text-slate-800">{w.bodyFat}%</strong></span>
                        <span>·</span>
                        <span>Lemak Perut <strong className="text-slate-800">{w.abdominalFat}%</strong></span>
                        <span>·</span>
                        <span>Berat <strong className="text-slate-800">{w.weightPct}%</strong></span>
                      </div>
                      <span className="text-xs text-slate-400">skor lebih tinggi = lebih baik</span>
                    </div>

                    {rankingLoading ? (
                      <div className="flex items-center justify-center py-14">
                        <div className="w-6 h-6 border-2 border-slate-200 border-t-blue-500 rounded-full animate-spin" />
                      </div>
                    ) : rankingData.length === 0 ? (
                      <div className="text-center py-12">
                        <p className="text-2xl mb-2">🏅</p>
                        <p className="text-sm text-slate-400">Belum ada peserta</p>
                      </div>
                    ) : (
                      <>
                        {/* Ranked participants */}
                        {ranked.length > 0 && (
                          <table className="w-full text-sm">
                            <thead className="bg-slate-50 text-slate-500 text-xs border-b border-slate-100">
                              <tr>
                                <th className="px-4 py-3 text-center w-10">#</th>
                                <th className="px-4 py-3 text-left">Peserta</th>
                                <th className="px-4 py-3 text-center">Berat</th>
                                <th className="px-4 py-3 text-center">Δ Lemak Tubuh</th>
                                <th className="px-4 py-3 text-center">Δ Lemak Perut</th>
                                <th className="px-4 py-3 text-center">Δ Berat</th>
                                <th className="px-4 py-3 text-center font-bold">Skor</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                              {ranked.map((e, idx) => {
                                const medal = idx === 0 ? "🥇" : idx === 1 ? "🥈" : idx === 2 ? "🥉" : null;
                                const rowBg = idx === 0 ? "bg-yellow-50" : idx === 1 ? "bg-slate-50" : idx === 2 ? "bg-orange-50/40" : "";
                                return (
                                  <tr key={e.participant.id} className={`${rowBg} hover:brightness-95 transition`}>
                                    <td className="px-4 py-3 text-center text-base">
                                      {medal ?? <span className="text-xs text-slate-400 font-medium">{idx + 1}</span>}
                                    </td>
                                    <td className="px-4 py-3">
                                      <div className="flex items-center gap-2">
                                        <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-xs font-bold ${
                                          e.participant.type === "customer" ? "bg-blue-100 text-blue-700" : "bg-slate-100 text-slate-600"
                                        }`}>
                                          {e.participant.displayName.charAt(0).toUpperCase()}
                                        </div>
                                        <span className="font-medium text-slate-800 text-sm">{e.participant.displayName}</span>
                                      </div>
                                    </td>
                                    <td className="px-4 py-3 text-center text-xs text-slate-600">
                                      <span>{e.first!.weightKg}</span>
                                      <span className="text-slate-300 mx-1">→</span>
                                      <span className="font-semibold">{e.last!.weightKg} kg</span>
                                    </td>
                                    <td className="px-4 py-3 text-center">{deltaCell(e.deltaBodyFat!, "%")}</td>
                                    <td className="px-4 py-3 text-center">{deltaCell(e.deltaAbdFat!, "%")}</td>
                                    <td className="px-4 py-3 text-center">
                                      {deltaCell(e.deltaWeightKg!, "kg")}
                                      <span className="block text-xs text-slate-400">({e.deltaWeightPct!.toFixed(1)}%)</span>
                                    </td>
                                    <td className="px-4 py-3 text-center">
                                      <span className={`font-bold text-sm ${(e.score ?? 0) > 0 ? "text-green-700" : "text-slate-400"}`}>
                                        {(e.score ?? 0).toFixed(2)}
                                      </span>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        )}

                        {/* Participants without complete data */}
                        {pending.length > 0 && (
                          <div className={`${ranked.length > 0 ? "border-t border-slate-100" : ""} px-5 py-4`}>
                            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">
                              Belum dapat dinilai ({pending.length})
                            </p>
                            <div className="space-y-2">
                              {pending.map((e) => (
                                <div key={e.participant.id} className="flex items-center gap-2.5 text-sm text-slate-500">
                                  <div className="w-6 h-6 rounded-full bg-slate-100 flex items-center justify-center shrink-0 text-xs font-bold text-slate-400">
                                    {e.participant.displayName.charAt(0).toUpperCase()}
                                  </div>
                                  <span>{e.participant.displayName}</span>
                                  <span className="text-xs text-slate-300">—</span>
                                  <span className="text-xs text-slate-400 italic">
                                    {e.first === null ? "Belum ada data timbangan" : "Baru data awal, belum ada data akhir"}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                );
              })()}

              {/* Activity log tab */}
              {detailTab === "aktivitas" && (
                <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                  <div className="px-5 py-4 border-b border-slate-100">
                    <h3 className="font-semibold text-slate-800">Log Aktivitas</h3>
                  </div>

                  {actLogLoading ? (
                    <div className="flex items-center justify-center py-12">
                      <div className="w-6 h-6 border-2 border-slate-200 border-t-blue-500 rounded-full animate-spin" />
                    </div>
                  ) : activityLog.length === 0 ? (
                    <div className="text-center py-12">
                      <p className="text-2xl mb-2">📋</p>
                      <p className="text-sm text-slate-400">Belum ada aktivitas tercatat</p>
                    </div>
                  ) : (
                    <div className="divide-y divide-slate-100">
                      {activityLog.map((entry) => (
                        <div key={entry.id} className="px-5 py-4 flex items-start gap-3">
                          {/* Icon */}
                          <div className={`mt-0.5 w-8 h-8 rounded-full flex items-center justify-center text-base shrink-0 ${
                            entry.type === "participant_added"   ? "bg-blue-100"  :
                            entry.type === "participant_removed" ? "bg-red-100"   :
                                                                   "bg-green-100"
                          }`}>
                            {entry.type === "participant_added"   ? "➕" :
                             entry.type === "participant_removed" ? "➖" : "💰"}
                          </div>

                          {/* Content */}
                          <div className="flex-1 min-w-0">
                            <p className="text-sm text-slate-800 leading-snug">
                              {entry.type === "participant_added" && (
                                <>
                                  <strong>{entry.participantName}</strong>{" "}
                                  ditambahkan sebagai peserta
                                  {entry.participantType && (
                                    <span className={`ml-1.5 text-xs font-semibold px-1.5 py-0.5 rounded-full ${
                                      entry.participantType === "customer"
                                        ? "bg-blue-50 text-blue-700"
                                        : "bg-slate-100 text-slate-600"
                                    }`}>
                                      {entry.participantType === "customer" ? "Pelanggan" : "Tamu"}
                                    </span>
                                  )}
                                </>
                              )}
                              {entry.type === "participant_removed" && (
                                <>
                                  <strong>{entry.participantName}</strong>{" "}
                                  <span className="text-red-600">dihapus dari peserta</span>
                                </>
                              )}
                              {entry.type === "payment_recorded" && (
                                <>
                                  <strong>{entry.participantName}</strong>{" "}
                                  membayar{" "}
                                  <strong className="text-green-700">{fmt(entry.amount ?? 0)}</strong>
                                  {entry.totalPaid !== undefined && entry.adminFee !== undefined ? (
                                    entry.totalPaid >= entry.adminFee ? (
                                      <span className="ml-1.5 text-xs font-bold text-green-600 bg-green-50 px-1.5 py-0.5 rounded-full">
                                        ✓ LUNAS
                                      </span>
                                    ) : (
                                      <span className="text-slate-400 text-xs ml-1">
                                        (total: {fmt(entry.totalPaid)} / {fmt(entry.adminFee)})
                                      </span>
                                    )
                                  ) : null}
                                </>
                              )}
                            </p>
                            {entry.reason && (
                              <p className="text-xs text-slate-400 mt-1">
                                📝 Alasan: <span className="italic">{entry.reason}</span>
                              </p>
                            )}
                            <p className="text-xs text-slate-400 mt-1">
                              {new Date(entry.createdAt).toLocaleString("id-ID", {
                                day: "numeric", month: "short", year: "numeric",
                                hour: "2-digit", minute: "2-digit",
                              })}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
            );
          })()}
          {!selected && (
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
