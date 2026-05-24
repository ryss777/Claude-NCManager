"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { collection, getDocs, query, where, orderBy, updateDoc, doc } from "firebase/firestore";
import { v4 as uuidv4 } from "uuid";
import { useOwnerAuthStore } from "@/store/auth.store";
import { callFunction, firebaseDb } from "@/firebase/firebase";

// ── Types ─────────────────────────────────────────────────────────────────────

type CustomerTier = "retail" | "ds" | "sc" | "sbQp" | "spv";
const TIER_LABELS: Record<CustomerTier, string> = {
  retail: "Retail", ds: "DS", sc: "SC", sbQp: "SB-QP", spv: "SPV",
};
const TIER_BADGE: Record<CustomerTier, string> = {
  retail: "bg-slate-100 text-slate-600",
  ds:     "bg-blue-100 text-blue-700",
  sc:     "bg-violet-100 text-violet-700",
  sbQp:   "bg-amber-100 text-amber-700",
  spv:    "bg-rose-100 text-rose-700",
};
const TIER_AVATAR: Record<CustomerTier, string> = {
  retail: "bg-slate-200 text-slate-600",
  ds:     "bg-blue-500 text-white",
  sc:     "bg-violet-500 text-white",
  sbQp:   "bg-amber-400 text-white",
  spv:    "bg-rose-500 text-white",
};

interface Customer {
  id: string;
  displayName: string;
  phone: string | null;
  email: string | null;
  tier: CustomerTier;
  activeMembershipId: string | null;
  createdAt: string;
}

interface Membership {
  id: string;
  customerId: string;
  planName: string;
  planType?: "regular" | "locker";
  tier: string;
  visitRemaining: number | null;
  visitQuota: number | null;
  expiresAt: string | null;
  status: string;
  blendingCredits?: number;
}

const TIER_ORDER: Record<string, number> = { retail: 0, ds: 1, sc: 2, sbQp: 3, spv: 4 };

function daysLeft(iso: string | null) {
  if (!iso) return null;
  return Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000));
}

// ── Membership plan types ─────────────────────────────────────────────────────

type PlanTier = "basic" | "silver" | "gold" | "platinum";
const PLAN_TIERS: PlanTier[] = ["basic", "silver", "gold", "platinum"];
const PLAN_TIER_BADGE: Record<PlanTier, string> = {
  basic:    "bg-slate-100 text-slate-700",
  silver:   "bg-slate-200 text-slate-800",
  gold:     "bg-yellow-100 text-yellow-800",
  platinum: "bg-blue-100 text-blue-800",
};
const PLAN_TIER_ACCENT: Record<PlanTier, string> = {
  basic:    "border-slate-200",
  silver:   "border-slate-300",
  gold:     "border-yellow-200",
  platinum: "border-blue-200",
};

interface Plan {
  id: string;
  planType?: "regular" | "locker";
  name: string;
  tier: PlanTier;
  price: number;
  visitQuota: number;
  hasExpiry: boolean;
  durationDays: number | null;
  benefits: string[];
  isActive: boolean;
  blendingFeePerSession?: number;
}

const fmtIdr = (n: number) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);

type MainTab = "customers" | "membership";

// ── PlanFormDialog ─────────────────────────────────────────────────────────────

function PlanFormDialog({
  title, onClose, onSubmit, loading, feedback,
  planType, setPlanType, name, setName, tier, setTier,
  price, setPrice, visitQuota, setVisitQuota,
  blendingFee, setBlendingFee, hasExpiry, setHasExpiry,
  durationDays, setDurationDays, benefits, setBenefits,
}: {
  title: string; onClose: () => void; onSubmit: () => void;
  loading: boolean; feedback?: { type: "ok" | "err"; msg: string } | undefined;
  planType: "regular" | "locker"; setPlanType: (v: "regular" | "locker") => void;
  name: string; setName: (v: string) => void;
  tier: PlanTier; setTier: (v: PlanTier) => void;
  price: string; setPrice: (v: string) => void;
  visitQuota: string; setVisitQuota: (v: string) => void;
  blendingFee: string; setBlendingFee: (v: string) => void;
  hasExpiry: boolean; setHasExpiry: (v: boolean) => void;
  durationDays: string; setDurationDays: (v: string) => void;
  benefits: string; setBenefits: (v: string) => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-slate-100">
          <h3 className="text-base font-bold text-slate-900">{title}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none">×</button>
        </div>
        <div className="p-6 space-y-4">
          {feedback && (
            <div className={`text-sm rounded-xl px-4 py-3 ${feedback.type === "ok" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"}`}>
              {feedback.msg}
            </div>
          )}
          <div>
            <span className="text-xs text-slate-500 font-medium block mb-1.5">Tipe Paket</span>
            <div className="flex gap-1 p-1 bg-slate-100 rounded-xl">
              {(["regular", "locker"] as const).map((pt) => (
                <button key={pt} onClick={() => { setPlanType(pt); setHasExpiry(false); }}
                  className={`flex-1 py-2 rounded-lg text-sm font-semibold transition ${planType === pt ? pt === "locker" ? "bg-purple-600 text-white" : "bg-white text-slate-800 shadow-sm" : "text-slate-500 hover:text-slate-600"}`}>
                  {pt === "regular" ? "🎫 Regular" : "🔑 Loker"}
                </button>
              ))}
            </div>
          </div>
          <label className="block">
            <span className="text-xs text-slate-500 font-medium">Nama Paket *</span>
            <input className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Contoh: Member Gold 10x" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          {planType === "regular" ? (
            <>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-xs text-slate-500 font-medium">Tier</span>
                  <select className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    value={tier} onChange={(e) => setTier(e.target.value as PlanTier)}>
                    {PLAN_TIERS.map((t) => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className="text-xs text-slate-500 font-medium">Harga (Rp) *</span>
                  <input type="number" min={0} step={1000}
                    className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="250000" value={price} onChange={(e) => setPrice(e.target.value)} />
                </label>
              </div>
              <label className="block">
                <span className="text-xs text-slate-500 font-medium">Kuota Kunjungan *</span>
                <input type="number"
                  className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Contoh: 10" value={visitQuota} onChange={(e) => setVisitQuota(e.target.value)} />
              </label>
            </>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-xs text-slate-500 font-medium">Jumlah Kredit Awal</span>
                  <input type="number" min={0} step={1}
                    className="mt-1 w-full border border-purple-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                    placeholder="Cth: 10" value={visitQuota} onChange={(e) => setVisitQuota(e.target.value)} />
                </label>
                <label className="block">
                  <span className="text-xs text-slate-500 font-medium">Biaya / Sesi (Rp) *</span>
                  <input type="number" min={0} step={1000}
                    className="mt-1 w-full border border-purple-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                    placeholder="Cth: 5000" value={blendingFee} onChange={(e) => setBlendingFee(e.target.value)} />
                </label>
              </div>
              <p className="text-xs text-purple-500 -mt-1">Isi kredit awal = 0 untuk paket harian (bayar per sesi tanpa paket)</p>
            </>
          )}
          <div>
            <button type="button" onClick={() => setHasExpiry(!hasExpiry)} className="flex items-center gap-3 group">
              <div className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${hasExpiry ? (planType === "locker" ? "bg-purple-600" : "bg-blue-600") : "bg-slate-200"}`}>
                <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${hasExpiry ? "translate-x-4" : "translate-x-1"}`} />
              </div>
              <span className="text-sm text-slate-700">Ada tanggal kadaluarsa</span>
            </button>
            {hasExpiry && (
              <label className="block mt-2">
                <span className="text-xs text-slate-500 font-medium">Durasi (hari)</span>
                <input type="number"
                  className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Contoh: 30" value={durationDays} onChange={(e) => setDurationDays(e.target.value)} />
              </label>
            )}
          </div>
          <label className="block">
            <span className="text-xs text-slate-500 font-medium">Benefit (satu per baris, opsional)</span>
            <textarea rows={3}
              className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder={"Akses loker premium\nDiskon minuman 10%"} value={benefits} onChange={(e) => setBenefits(e.target.value)} />
          </label>
        </div>
        <div className="flex gap-3 px-6 pb-6">
          <button onClick={onClose} className="flex-1 border border-slate-200 text-slate-600 rounded-xl py-2.5 text-sm font-semibold hover:bg-slate-50 transition">Batal</button>
          <button onClick={onSubmit} disabled={loading}
            className={`flex-1 text-white rounded-xl py-2.5 text-sm font-semibold disabled:opacity-50 transition ${planType === "locker" ? "bg-purple-600 hover:bg-purple-700" : "bg-blue-600 hover:bg-blue-700"}`}>
            {loading ? "Menyimpan…" : title.includes("Edit") ? "Simpan Perubahan" : "Buat Paket"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── PlanCard ──────────────────────────────────────────────────────────────────

function PlanCard({ plan, inactive, onEdit, onDeactivate, onActivate, onDelete }: {
  plan: Plan; inactive?: boolean;
  onEdit: () => void; onDeactivate?: () => void; onActivate?: () => void; onDelete: () => void;
}) {
  const isLocker = plan.planType === "locker";
  const cardBg   = inactive ? "bg-white opacity-60" : isLocker ? "bg-purple-50" : "bg-white";
  const accent   = isLocker ? "border-purple-200" : PLAN_TIER_ACCENT[plan.tier] ?? "border-slate-200";
  return (
    <div className={`rounded-2xl border-2 p-5 flex flex-col gap-3 ${cardBg} ${accent}`}>
      <div className="flex items-center gap-2">
        {isLocker ? (
          <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-purple-200 text-purple-800">🔑 LOKER</span>
        ) : (
          <span className={`text-xs font-bold px-2 py-0.5 rounded-full capitalize ${PLAN_TIER_BADGE[plan.tier]}`}>{plan.tier}</span>
        )}
        {inactive && <span className="text-xs text-red-400 font-semibold">Nonaktif</span>}
      </div>
      <div>
        <h4 className="font-bold text-slate-900 text-base leading-snug">{plan.name}</h4>
        <p className={`text-2xl font-bold mt-1 ${isLocker ? "text-purple-700" : "text-slate-900"}`}>
          {isLocker
            ? <>{fmtIdr(plan.blendingFeePerSession ?? 0)}<span className="text-sm font-normal text-slate-400"> / sesi</span></>
            : fmtIdr(plan.price)}
        </p>
      </div>
      <div className="text-xs text-slate-500 space-y-1">
        <div className="flex items-center gap-1.5">
          <span>🎫</span>
          <span>{isLocker ? (plan.visitQuota > 0 ? `${plan.visitQuota} kredit awal` : "Harian (bayar per sesi)") : `${plan.visitQuota} kunjungan`}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span>⏱</span>
          {plan.hasExpiry && plan.durationDays ? <span>{plan.durationDays} hari</span> : <span className="text-green-600 font-medium">Tidak ada expired</span>}
        </div>
        {plan.benefits?.length > 0 && (
          <ul className="mt-2 space-y-0.5 pl-0.5">
            {plan.benefits.slice(0, 3).map((b, i) => (
              <li key={i} className="flex items-start gap-1"><span className="text-slate-300 mt-0.5">•</span><span>{b}</span></li>
            ))}
            {plan.benefits.length > 3 && <li className="text-slate-400 italic">+{plan.benefits.length - 3} lagi</li>}
          </ul>
        )}
      </div>
      <div className="flex gap-1 border-t border-slate-100 pt-3 mt-auto">
        <button onClick={onEdit} className="flex-1 text-xs text-blue-600 hover:text-blue-800 font-semibold py-1.5 rounded-lg hover:bg-blue-50 transition">Edit</button>
        {inactive
          ? <button onClick={onActivate} className="flex-1 text-xs text-green-600 hover:text-green-800 font-semibold py-1.5 rounded-lg hover:bg-green-50 transition">Aktifkan</button>
          : <button onClick={onDeactivate} className="flex-1 text-xs text-amber-600 hover:text-amber-800 font-semibold py-1.5 rounded-lg hover:bg-amber-50 transition">Nonaktifkan</button>}
        <button onClick={onDelete} className="flex-1 text-xs text-red-500 hover:text-red-700 font-semibold py-1.5 rounded-lg hover:bg-red-50 transition">Hapus</button>
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function CustomersPage() {
  const router = useRouter();
  const { ownerId, clubId } = useOwnerAuthStore();
  const [mainTab, setMainTab] = useState<MainTab>("customers");

  // ── Customers state ───────────────────────────────────────────────────────────
  const [customers, setCustomers]     = useState<Customer[]>([]);
  const [memberships, setMemberships] = useState<Map<string, Membership>>(new Map());
  const [loadingList, setLoadingList] = useState(true);
  const [sortKey, setSortKey]         = useState<"name" | "tier" | "membership">("name");
  const [sortDir, setSortDir]         = useState<"asc" | "desc">("asc");
  const [search, setSearch]           = useState("");
  const [tierFilter, setTierFilter]   = useState<CustomerTier | "all">("all");

  // Add customer dialog
  const [addOpen, setAddOpen]               = useState(false);
  const [displayName, setDisplayName]       = useState("");
  const [phone, setPhone]                   = useState("");
  const [email, setEmail]                   = useState("");
  const [newTier, setNewTier]               = useState<CustomerTier>("retail");
  const [createLoading, setCreateLoading]   = useState(false);
  const [createFeedback, setCreateFeedback] = useState<{ type: "ok" | "err"; msg: string } | undefined>();

  async function loadCustomers() {
    if (!ownerId || !clubId) return;
    setLoadingList(true);
    const db = firebaseDb();
    const base = `owners/${ownerId}/clubs/${clubId}`;
    const [custSnap, memSnap] = await Promise.all([
      getDocs(query(collection(db, `${base}/customers`), orderBy("createdAt", "desc"))),
      getDocs(query(collection(db, `${base}/memberships`), where("status", "==", "active"))),
    ]);
    setCustomers(custSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Customer)));
    const memMap = new Map<string, Membership>();
    memSnap.docs.forEach((d) => {
      const m = { id: d.id, ...d.data() } as Membership;
      memMap.set(m.customerId, m);
    });
    setMemberships(memMap);
    setLoadingList(false);
  }

  useEffect(() => { loadCustomers(); }, [ownerId, clubId]);

  function toggleSort(key: typeof sortKey) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("asc"); }
  }

  const filtered = useMemo(() => {
    let arr = [...customers];
    if (tierFilter !== "all") arr = arr.filter((c) => c.tier === tierFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      arr = arr.filter((c) =>
        c.displayName.toLowerCase().includes(q) ||
        (c.phone ?? "").includes(q) ||
        (c.email ?? "").toLowerCase().includes(q)
      );
    }
    arr.sort((a, b) => {
      let cmp = 0;
      if (sortKey === "name") cmp = a.displayName.localeCompare(b.displayName, "id");
      else if (sortKey === "tier") cmp = (TIER_ORDER[a.tier] ?? 0) - (TIER_ORDER[b.tier] ?? 0);
      else {
        const ma = memberships.get(a.id);
        const mb = memberships.get(b.id);
        cmp = (ma ? ma.planName : "￿").localeCompare(mb ? mb.planName : "￿", "id");
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [customers, memberships, sortKey, sortDir, search, tierFilter]);

  async function handleCreate() {
    if (!displayName.trim()) {
      setCreateFeedback({ type: "err", msg: "Nama pelanggan wajib diisi" });
      return;
    }
    setCreateLoading(true);
    setCreateFeedback(undefined);
    try {
      await callFunction("customer_create", {
        ownerId, clubId,
        displayName: displayName.trim(),
        phone: phone.trim() || undefined,
        email: email.trim() || undefined,
        tier: newTier,
      });
      setCreateFeedback({ type: "ok", msg: `✓ "${displayName}" berhasil ditambahkan` });
      setDisplayName(""); setPhone(""); setEmail(""); setNewTier("retail");
      loadCustomers();
      setTimeout(() => { setAddOpen(false); setCreateFeedback(undefined); }, 1200);
    } catch (err) {
      setCreateFeedback({ type: "err", msg: err instanceof Error ? err.message : "Gagal" });
    } finally { setCreateLoading(false); }
  }

  // ── Membership plans state ────────────────────────────────────────────────────
  const [plans, setPlans]           = useState<Plan[]>([]);
  const [loadingPlans, setLoadingPlans] = useState(false);

  // Create dialog
  const [createOpen, setCreateOpen]           = useState(false);
  const [createPlanType, setCreatePlanType]   = useState<"regular" | "locker">("regular");
  const [planName, setPlanName]               = useState("");
  const [planTier, setPlanTier]               = useState<PlanTier>("silver");
  const [planPrice, setPlanPrice]             = useState("");
  const [planVisitQuota, setPlanVisitQuota]   = useState("");
  const [planBlendingFee, setPlanBlendingFee] = useState("5000");
  const [planHasExpiry, setPlanHasExpiry]     = useState(false);
  const [planDurationDays, setPlanDurationDays] = useState("");
  const [planBenefits, setPlanBenefits]       = useState("");
  const [planLoading, setPlanLoading]         = useState(false);
  const [planFeedback, setPlanFeedback]       = useState<{ type: "ok" | "err"; msg: string } | undefined>();

  // Edit dialog
  const [editOpen, setEditOpen]               = useState(false);
  const [editId, setEditId]                   = useState<string | null>(null);
  const [editPlanType, setEditPlanType]       = useState<"regular" | "locker">("regular");
  const [editName, setEditName]               = useState("");
  const [editTier, setEditTier]               = useState<PlanTier>("silver");
  const [editPrice, setEditPrice]             = useState("");
  const [editVisitQuota, setEditVisitQuota]   = useState("");
  const [editBlendingFee, setEditBlendingFee] = useState("");
  const [editHasExpiry, setEditHasExpiry]     = useState(true);
  const [editDurationDays, setEditDurationDays] = useState("");
  const [editBenefits, setEditBenefits]       = useState("");
  const [editSaving, setEditSaving]           = useState(false);
  const [editFeedback, setEditFeedback]       = useState<{ type: "ok" | "err"; msg: string } | undefined>();

  // Confirm dialog
  interface AffectedCustomer { id: string; displayName: string; visitRemaining: number; }
  const [confirmDialog, setConfirmDialog] = useState<{
    type: "deactivate" | "delete"; plan: Plan;
    customers: AffectedCustomer[]; loadingCustomers: boolean;
  } | null>(null);
  const [confirmLoading, setConfirmLoading] = useState(false);

  function planPath(planId?: string) {
    const base = `owners/${ownerId}/clubs/${clubId}/membershipPlans`;
    return planId ? `${base}/${planId}` : base;
  }

  async function loadPlans() {
    if (!ownerId || !clubId) return;
    setLoadingPlans(true);
    const snap = await getDocs(query(collection(firebaseDb(), planPath()), orderBy("createdAt", "desc")));
    setPlans(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Plan)));
    setLoadingPlans(false);
  }

  useEffect(() => { if (mainTab === "membership") loadPlans(); }, [mainTab, ownerId, clubId]);

  function resetCreate() {
    setPlanName(""); setPlanPrice(""); setPlanVisitQuota(""); setPlanBlendingFee("5000");
    setPlanHasExpiry(false); setPlanDurationDays(""); setPlanBenefits("");
    setCreatePlanType("regular"); setPlanTier("silver"); setPlanFeedback(undefined);
  }

  async function handleCreatePlan() {
    if (!planName) { setPlanFeedback({ type: "err", msg: "Nama paket wajib diisi" }); return; }
    if (createPlanType === "regular" && (!planPrice || !planVisitQuota)) {
      setPlanFeedback({ type: "err", msg: "Harga dan kuota wajib diisi" }); return;
    }
    if (createPlanType === "locker" && !planBlendingFee) {
      setPlanFeedback({ type: "err", msg: "Biaya blender per sesi wajib diisi" }); return;
    }
    if (planHasExpiry && !planDurationDays) {
      setPlanFeedback({ type: "err", msg: "Durasi wajib diisi jika expired aktif" }); return;
    }
    setPlanLoading(true); setPlanFeedback(undefined);
    try {
      if (createPlanType === "locker") {
        await callFunction("membership_createPlan", {
          ownerId, clubId, planType: "locker", name: planName,
          visitQuota: planVisitQuota ? parseInt(planVisitQuota, 10) : 0,
          blendingFeePerSession: parseFloat(planBlendingFee),
          hasExpiry: planHasExpiry,
          durationDays: planHasExpiry ? parseInt(planDurationDays, 10) : undefined,
          benefits: planBenefits.split("\n").map((s) => s.trim()).filter(Boolean),
        });
      } else {
        await callFunction("membership_createPlan", {
          ownerId, clubId, name: planName, tier: planTier,
          price: parseFloat(planPrice), visitQuota: parseInt(planVisitQuota, 10),
          hasExpiry: planHasExpiry,
          durationDays: planHasExpiry ? parseInt(planDurationDays, 10) : undefined,
          benefits: planBenefits.split("\n").map((s) => s.trim()).filter(Boolean),
        });
      }
      resetCreate(); setCreateOpen(false); loadPlans();
    } catch (err) {
      setPlanFeedback({ type: "err", msg: err instanceof Error ? err.message : "Gagal" });
    } finally { setPlanLoading(false); }
  }

  function openEdit(p: Plan) {
    setEditId(p.id); setEditPlanType(p.planType === "locker" ? "locker" : "regular");
    setEditName(p.name); setEditTier(p.tier ?? "silver");
    setEditPrice(p.price?.toString() ?? ""); setEditVisitQuota(p.visitQuota?.toString() ?? "");
    setEditBlendingFee(p.blendingFeePerSession?.toString() ?? "");
    setEditHasExpiry(p.hasExpiry ?? false); setEditDurationDays(p.durationDays?.toString() ?? "");
    setEditBenefits((p.benefits ?? []).join("\n")); setEditFeedback(undefined); setEditOpen(true);
  }

  async function handleSaveEdit() {
    if (!editId || !editName) return;
    if (editPlanType === "regular" && (!editPrice || !editVisitQuota)) return;
    if (editPlanType === "locker" && !editBlendingFee) return;
    if (editHasExpiry && !editDurationDays) return;
    setEditSaving(true);
    try {
      const base = {
        name: editName.trim(), hasExpiry: editHasExpiry,
        durationDays: editHasExpiry ? parseInt(editDurationDays, 10) : null,
        benefits: editBenefits.split("\n").map((s) => s.trim()).filter(Boolean),
        updatedAt: new Date().toISOString(),
      };
      const extra = editPlanType === "locker"
        ? { visitQuota: editVisitQuota ? parseInt(editVisitQuota, 10) : 0, blendingFeePerSession: parseFloat(editBlendingFee) }
        : { tier: editTier, price: parseFloat(editPrice), visitQuota: parseInt(editVisitQuota, 10) };
      await updateDoc(doc(firebaseDb(), planPath(editId)), { ...base, ...extra });
      setEditOpen(false); loadPlans();
    } catch (err) {
      setEditFeedback({ type: "err", msg: err instanceof Error ? err.message : "Gagal menyimpan" });
    } finally { setEditSaving(false); }
  }

  async function openConfirm(p: Plan, type: "deactivate" | "delete") {
    if (!ownerId || !clubId) return;
    setConfirmDialog({ type, plan: p, customers: [], loadingCustomers: true });
    try {
      const db = firebaseDb();
      const base = `owners/${ownerId}/clubs/${clubId}`;
      const [memSnap, custSnap] = await Promise.all([
        getDocs(query(collection(db, `${base}/memberships`), where("planId", "==", p.id), where("status", "==", "active"))),
        getDocs(collection(db, `${base}/customers`)),
      ]);
      const custMap = new Map(custSnap.docs.map((d) => [d.id, d.data()["displayName"] as string]));
      const affected: AffectedCustomer[] = memSnap.docs.map((d) => ({
        id: d.data()["customerId"] as string,
        displayName: custMap.get(d.data()["customerId"] as string) ?? d.data()["customerId"] as string,
        visitRemaining: d.data()["visitRemaining"] as number,
      }));
      setConfirmDialog((prev) => prev ? { ...prev, customers: affected, loadingCustomers: false } : null);
    } catch {
      setConfirmDialog((prev) => prev ? { ...prev, loadingCustomers: false } : null);
    }
  }

  async function executeConfirm() {
    if (!confirmDialog) return;
    const { type, plan } = confirmDialog;
    setConfirmLoading(true);
    try {
      if (type === "deactivate") {
        if (plan.isActive) {
          await callFunction("membership_deactivatePlan", { ownerId, clubId, planId: plan.id });
        } else {
          await updateDoc(doc(firebaseDb(), planPath(plan.id)), { isActive: true, updatedAt: new Date().toISOString() });
        }
      } else {
        await callFunction("membership_deletePlan", {
          ownerId, clubId, planId: plan.id, requestId: uuidv4(), operationId: uuidv4(),
        });
      }
      setConfirmDialog(null); loadPlans();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Gagal");
    } finally { setConfirmLoading(false); }
  }

  const activePlans   = plans.filter((p) => p.isActive);
  const inactivePlans = plans.filter((p) => !p.isActive);
  const activeMembershipCount = customers.filter((c) => memberships.has(c.id)).length;

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-4">

      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Pelanggan &amp; Member</h1>
          <p className="text-sm text-slate-400 mt-0.5">
            {customers.length} pelanggan · {activeMembershipCount} membership aktif
          </p>
        </div>
        {mainTab === "customers" && (
          <button onClick={() => setAddOpen(true)}
            className="flex items-center gap-2 bg-blue-600 text-white rounded-xl px-5 py-2.5 text-sm font-bold hover:bg-blue-700 transition shadow-sm">
            <span className="text-lg leading-none">+</span> Tambah Pelanggan
          </button>
        )}
        {mainTab === "membership" && (
          <button onClick={() => { resetCreate(); setCreateOpen(true); }}
            className="flex items-center gap-2 bg-slate-900 text-white px-4 py-2.5 rounded-xl text-sm font-semibold hover:bg-slate-700 transition">
            <span className="text-base leading-none">+</span> Tambah Paket
          </button>
        )}
      </div>

      {/* Tab switcher */}
      <div className="flex gap-1 bg-slate-100 rounded-xl p-1 w-fit">
        {([
          { key: "customers",  label: "👥 Pelanggan" },
          { key: "membership", label: "🎫 Paket Member" },
        ] as { key: MainTab; label: string }[]).map(({ key, label }) => (
          <button key={key} onClick={() => setMainTab(key)}
            className={`px-5 py-2 rounded-lg text-sm font-semibold transition ${mainTab === key ? "bg-white shadow text-slate-900" : "text-slate-500 hover:text-slate-700"}`}>
            {label}
          </button>
        ))}
      </div>

      {/* ═══════════════════════════════════════════════════════════════════
          CUSTOMERS TAB
      ════════════════════════════════════════════════════════════════════ */}
      {mainTab === "customers" && (
        <>
          {/* Add dialog */}
          {addOpen && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
              <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm">
                <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
                  <h3 className="text-base font-bold text-slate-900">Tambah Pelanggan</h3>
                  <button onClick={() => { setAddOpen(false); setCreateFeedback(undefined); }} className="text-slate-400 hover:text-slate-600 text-xl leading-none">×</button>
                </div>
                <div className="px-6 py-4 space-y-3">
                  {createFeedback && (
                    <div className={`text-sm rounded-xl px-3 py-2.5 ${createFeedback.type === "ok" ? "bg-green-50 border border-green-200 text-green-700" : "bg-red-50 border border-red-200 text-red-600"}`}>
                      {createFeedback.msg}
                    </div>
                  )}
                  <div>
                    <label className="text-xs font-semibold text-slate-500 block mb-1">Nama Lengkap *</label>
                    <input className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="Masukkan nama lengkap" value={displayName} onChange={(e) => setDisplayName(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleCreate()} autoFocus />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-semibold text-slate-500 block mb-1">No. HP</label>
                      <input className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="08xx-xxxx-xxxx" value={phone} onChange={(e) => setPhone(e.target.value)} />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-slate-500 block mb-1">Email</label>
                      <input className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="email@contoh.com" value={email} onChange={(e) => setEmail(e.target.value)} />
                    </div>
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-slate-500 block mb-1.5">Level / Tier</label>
                    <div className="flex gap-1.5 flex-wrap">
                      {(Object.entries(TIER_LABELS) as [CustomerTier, string][]).map(([k, v]) => (
                        <button key={k} onClick={() => setNewTier(k)}
                          className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition ${newTier === k ? "bg-slate-800 text-white border-slate-800" : "border-slate-200 text-slate-500 hover:border-slate-400"}`}>
                          {v}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="px-6 pb-5 flex gap-3">
                  <button onClick={() => { setAddOpen(false); setCreateFeedback(undefined); }}
                    className="flex-1 border border-slate-200 text-slate-600 rounded-xl py-2.5 text-sm font-semibold hover:bg-slate-50 transition">Batal</button>
                  <button onClick={handleCreate} disabled={createLoading}
                    className="flex-1 bg-blue-600 text-white rounded-xl py-2.5 text-sm font-bold hover:bg-blue-700 disabled:opacity-50 transition">
                    {createLoading ? "Menyimpan…" : "Tambah"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Search + tier filter */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="relative flex-1 min-w-52">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none">🔍</span>
              <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder="Cari nama, HP, atau email…"
                className="w-full pl-9 pr-3 py-2.5 text-sm border border-slate-200 rounded-xl bg-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div className="flex gap-1.5 flex-wrap">
              <button onClick={() => setTierFilter("all")}
                className={`px-3 py-2 rounded-xl text-xs font-semibold border transition ${tierFilter === "all" ? "bg-slate-800 text-white border-slate-800" : "border-slate-200 text-slate-500 hover:border-slate-400"}`}>
                Semua
              </button>
              {(Object.entries(TIER_LABELS) as [CustomerTier, string][]).map(([k, v]) => (
                <button key={k} onClick={() => setTierFilter(tierFilter === k ? "all" : k)}
                  className={`px-3 py-2 rounded-xl text-xs font-semibold border transition ${tierFilter === k ? TIER_BADGE[k] + " border-transparent" : "border-slate-200 text-slate-500 hover:border-slate-400"}`}>
                  {v}
                </button>
              ))}
            </div>
            <span className="text-xs text-slate-400 ml-auto whitespace-nowrap">{filtered.length} pelanggan</span>
          </div>

          {/* Sort */}
          <div className="flex items-center gap-1 text-xs text-slate-400">
            <span className="mr-1 font-medium">Urutkan:</span>
            {([
              { key: "name" as const, label: "Nama" },
              { key: "tier" as const, label: "Tier" },
              { key: "membership" as const, label: "Membership" },
            ]).map(({ key, label }) => (
              <button key={key} onClick={() => toggleSort(key)}
                className={`px-3 py-1 rounded-lg font-semibold transition flex items-center gap-1 ${sortKey === key ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-500 hover:bg-slate-200"}`}>
                {label}
                <span className="text-xs">{sortKey === key ? (sortDir === "asc" ? "↑" : "↓") : ""}</span>
              </button>
            ))}
          </div>

          {/* List */}
          {loadingList ? (
            <div className="flex-1 flex items-center justify-center py-16 text-slate-400 text-sm">
              <span className="animate-pulse">Memuat…</span>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-2 text-slate-400">
              <span className="text-4xl">👥</span>
              <p className="text-sm font-medium">{customers.length === 0 ? "Belum ada pelanggan terdaftar" : "Tidak ada yang cocok dengan filter"}</p>
              {customers.length === 0 && (
                <button onClick={() => setAddOpen(true)} className="mt-2 text-sm text-blue-600 hover:underline font-semibold">+ Tambah pelanggan pertama</button>
              )}
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
              <div className="divide-y divide-slate-100">
                {filtered.map((c) => {
                  const mem = memberships.get(c.id);
                  const dl  = mem ? daysLeft(mem.expiresAt) : null;
                  const isLocker = mem?.planType === "locker";
                  const visitPct = mem && !isLocker && mem.visitQuota
                    ? Math.round(((mem.visitRemaining ?? 0) / mem.visitQuota) * 100) : null;
                  return (
                    <button key={c.id} onClick={() => router.push(`/customers/${c.id}`)}
                      className="w-full text-left px-4 py-3.5 hover:bg-slate-50 transition flex items-center gap-4">
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 font-bold text-base ${TIER_AVATAR[c.tier] ?? "bg-slate-200 text-slate-600"}`}>
                        {c.displayName.charAt(0).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="font-semibold text-slate-900 text-sm truncate">{c.displayName}</span>
                          <span className={`text-xs font-bold px-2 py-0.5 rounded-full shrink-0 ${TIER_BADGE[c.tier] ?? "bg-slate-100 text-slate-600"}`}>{TIER_LABELS[c.tier] ?? c.tier}</span>
                        </div>
                        {mem ? (
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-slate-500 truncate">
                              {isLocker ? `🔑 ${mem.planName} · ${mem.blendingCredits ?? 0} sesi` : `🎫 ${mem.planName} · ${mem.visitRemaining ?? 0}/${mem.visitQuota ?? 0} kunjungan`}
                            </span>
                            {!isLocker && visitPct !== null && (
                              <div className="w-16 h-1.5 bg-slate-200 rounded-full shrink-0 overflow-hidden">
                                <div className={`h-full rounded-full ${visitPct <= 25 ? "bg-red-400" : visitPct <= 50 ? "bg-amber-400" : "bg-green-500"}`} style={{ width: `${visitPct}%` }} />
                              </div>
                            )}
                            {mem.expiresAt && (
                              <span className={`text-xs shrink-0 font-medium ${dl !== null && dl <= 7 ? "text-red-500" : "text-slate-400"}`}>
                                {dl !== null && dl <= 7 ? `⚠ ${dl}h` : `s/d ${mem.expiresAt.slice(0, 10)}`}
                              </span>
                            )}
                          </div>
                        ) : (
                          <p className="text-xs text-slate-300">Tidak ada membership aktif</p>
                        )}
                      </div>
                      <div className="text-right shrink-0 hidden sm:block">
                        {c.phone ? <p className="text-xs text-slate-400">{c.phone}</p>
                          : c.email ? <p className="text-xs text-slate-400">{c.email}</p>
                          : <p className="text-xs text-slate-200">—</p>}
                        <p className="text-xs text-slate-200 mt-0.5">{c.createdAt?.slice(0, 10)}</p>
                      </div>
                      <span className="text-slate-300 text-sm shrink-0">›</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}

      {/* ═══════════════════════════════════════════════════════════════════
          MEMBERSHIP TAB
      ════════════════════════════════════════════════════════════════════ */}
      {mainTab === "membership" && (
        <div className="max-w-5xl">
          {/* Create dialog */}
          {createOpen && (
            <PlanFormDialog title="Buat Paket Baru"
              onClose={() => { setCreateOpen(false); resetCreate(); }} onSubmit={handleCreatePlan}
              loading={planLoading} feedback={planFeedback}
              planType={createPlanType} setPlanType={setCreatePlanType}
              name={planName} setName={setPlanName} tier={planTier} setTier={setPlanTier}
              price={planPrice} setPrice={setPlanPrice} visitQuota={planVisitQuota} setVisitQuota={setPlanVisitQuota}
              blendingFee={planBlendingFee} setBlendingFee={setPlanBlendingFee}
              hasExpiry={planHasExpiry} setHasExpiry={setPlanHasExpiry}
              durationDays={planDurationDays} setDurationDays={setPlanDurationDays}
              benefits={planBenefits} setBenefits={setPlanBenefits} />
          )}

          {/* Edit dialog */}
          {editOpen && (
            <PlanFormDialog title="Edit Paket"
              onClose={() => setEditOpen(false)} onSubmit={handleSaveEdit}
              loading={editSaving} feedback={editFeedback}
              planType={editPlanType} setPlanType={setEditPlanType}
              name={editName} setName={setEditName} tier={editTier} setTier={setEditTier}
              price={editPrice} setPrice={setEditPrice} visitQuota={editVisitQuota} setVisitQuota={setEditVisitQuota}
              blendingFee={editBlendingFee} setBlendingFee={setEditBlendingFee}
              hasExpiry={editHasExpiry} setHasExpiry={setEditHasExpiry}
              durationDays={editDurationDays} setDurationDays={setEditDurationDays}
              benefits={editBenefits} setBenefits={setEditBenefits} />
          )}

          {/* Confirm dialog */}
          {confirmDialog && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
              <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-md">
                <div className="flex items-start gap-3 mb-5">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${confirmDialog.type === "delete" ? "bg-red-100" : "bg-amber-100"}`}>
                    <span className="text-lg">{confirmDialog.type === "delete" ? "🗑️" : "⚠️"}</span>
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-slate-900">
                      {confirmDialog.type === "delete" ? "Hapus Paket" : confirmDialog.plan.isActive ? "Nonaktifkan Paket" : "Aktifkan Paket"}
                    </h3>
                    <p className="text-sm text-slate-500 mt-0.5">{confirmDialog.plan.name}</p>
                  </div>
                </div>
                <div className="mb-5">
                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Member aktif di paket ini</p>
                  {confirmDialog.loadingCustomers ? (
                    <p className="text-sm text-slate-400 py-3 text-center">Memuat…</p>
                  ) : confirmDialog.customers.length === 0 ? (
                    <div className="bg-green-50 rounded-xl px-4 py-3"><p className="text-sm text-green-700 font-medium">Tidak ada member yang terdampak.</p></div>
                  ) : (
                    <div className="space-y-2">
                      <div className={`rounded-xl px-4 py-3 ${confirmDialog.type === "delete" ? "bg-red-50" : "bg-amber-50"}`}>
                        <p className={`text-sm font-semibold ${confirmDialog.type === "delete" ? "text-red-700" : "text-amber-700"}`}>
                          {confirmDialog.type === "delete"
                            ? `Membership ${confirmDialog.customers.length} member akan langsung dibatalkan.`
                            : "Paket tidak bisa dibeli lagi. Sisa kunjungan member tetap berlaku."}
                        </p>
                      </div>
                      <div className={`border rounded-xl overflow-hidden divide-y divide-slate-100 max-h-40 overflow-y-auto ${confirmDialog.type === "delete" ? "border-red-100" : "border-amber-100"}`}>
                        {confirmDialog.customers.map((c) => (
                          <div key={c.id} className="flex items-center justify-between px-4 py-2.5">
                            <span className="text-sm text-slate-800 font-medium">{c.displayName}</span>
                            <span className={`text-xs font-semibold ${confirmDialog.type === "delete" ? "text-red-400" : "text-slate-400"}`}>
                              {c.visitRemaining} {confirmDialog.type === "delete" ? "kunjungan hangus" : "kunjungan tersisa"}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                <div className="flex gap-3">
                  <button onClick={() => setConfirmDialog(null)} disabled={confirmLoading}
                    className="flex-1 border border-slate-200 text-slate-600 rounded-xl py-2.5 text-sm font-semibold hover:bg-slate-50 disabled:opacity-50 transition">Batal</button>
                  <button onClick={executeConfirm} disabled={confirmLoading || confirmDialog.loadingCustomers}
                    className={`flex-1 text-white rounded-xl py-2.5 text-sm font-semibold disabled:opacity-50 transition ${confirmDialog.type === "delete" ? "bg-red-600 hover:bg-red-700" : confirmDialog.plan.isActive ? "bg-amber-600 hover:bg-amber-700" : "bg-green-600 hover:bg-green-700"}`}>
                    {confirmLoading ? "Memproses…" : confirmDialog.type === "delete" ? "Ya, Hapus" : confirmDialog.plan.isActive ? "Ya, Nonaktifkan" : "Ya, Aktifkan"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Plan list */}
          {loadingPlans ? (
            <div className="flex flex-col items-center gap-3 py-20 text-slate-400">
              <div className="w-8 h-8 border-2 border-slate-200 border-t-blue-500 rounded-full animate-spin" />
              <p className="text-sm">Memuat paket…</p>
            </div>
          ) : plans.length === 0 ? (
            <div className="bg-white rounded-2xl border border-slate-200 py-16 text-center">
              <p className="text-4xl mb-3">🎫</p>
              <p className="font-semibold text-slate-700">Belum ada paket membership</p>
              <p className="text-sm text-slate-400 mt-1 mb-5">Buat paket pertama untuk mulai menjual membership</p>
              <button onClick={() => { resetCreate(); setCreateOpen(true); }}
                className="bg-slate-900 text-white px-5 py-2.5 rounded-xl text-sm font-semibold hover:bg-slate-700 transition">
                Buat Paket Sekarang
              </button>
            </div>
          ) : (
            <div className="space-y-8">
              {activePlans.length > 0 && (
                <div>
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4">Aktif · {activePlans.length}</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {activePlans.map((p) => (
                      <PlanCard key={p.id} plan={p} onEdit={() => openEdit(p)}
                        onDeactivate={() => openConfirm(p, "deactivate")} onDelete={() => openConfirm(p, "delete")} />
                    ))}
                  </div>
                </div>
              )}
              {inactivePlans.length > 0 && (
                <div>
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4">Nonaktif · {inactivePlans.length}</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {inactivePlans.map((p) => (
                      <PlanCard key={p.id} plan={p} inactive onEdit={() => openEdit(p)}
                        onActivate={() => openConfirm(p, "deactivate")} onDelete={() => openConfirm(p, "delete")} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
