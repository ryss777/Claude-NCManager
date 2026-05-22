"use client";

import { useEffect, useState, useMemo } from "react";
import { collection, getDocs, query, where, orderBy } from "firebase/firestore";
import { v4 as uuidv4 } from "uuid";
import { useOwnerAuthStore } from "@/store/auth.store";
import { callFunction, firebaseDb } from "@/firebase/firebase";

// ── Types ─────────────────────────────────────────────────────────────────────

type PaymentType = "bayar" | "pinjam";
type PriceTier = "retail" | "ds" | "sc" | "sbQp" | "spv";
type DestType = "club" | "owner";

const TIER_LABELS: Record<PriceTier, string> = {
  retail: "Retail", ds: "DS", sc: "SC", sbQp: "SB/QP", spv: "SPV",
};

interface TransferItem {
  productId: string;
  productCatalogId: string | null | undefined;
  productName: string;
  quantity: number;
  unitPrice: number;
  subtotal: number;
}

interface IncomingTransfer {
  id: string;
  transferId: string;
  sourceOwnerId: string;
  sourceClubId: string;
  paymentType: PaymentType;
  priceTier: string;
  items: TransferItem[];
  total: number;
  notes: string | null;
  status: "pending" | "accepted";
  createdAt: string;
}

interface Club { id: string; name: string; }

interface InventoryItem {
  id: string;
  name: string;
  category: string | null;
  unit: string;
  currentStock: number;
  productCatalogId: string | null;
  prices: Record<PriceTier, number>;
}

interface AcceptReceipt {
  transferId: string;
  total: number;
  paymentType: PaymentType;
  sourceOwnerId: string;
  destinationClubId: string;
  items: TransferItem[];
  timestamp: string;
}

const fmtIdr = (n: number) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleString("id-ID", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });

// ── Page ──────────────────────────────────────────────────────────────────────

export default function TransferPage() {
  const { ownerId, clubId } = useOwnerAuthStore();
  const [tab, setTab] = useState<"keluar" | "masuk">("keluar");
  const [clubs, setClubs] = useState<Club[]>([]);

  useEffect(() => {
    if (!ownerId) return;
    getDocs(collection(firebaseDb(), `owners/${ownerId}/clubs`))
      .then((snap) => setClubs(snap.docs.map((d) => ({ id: d.id, name: d.data()["name"] as string }))))
      .catch(() => {});
  }, [ownerId]);

  return (
    <div className="flex flex-col h-full min-h-0 gap-4">
      {/* Header + tabs */}
      <div className="flex items-center justify-between shrink-0">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Transfer Produk</h2>
          <p className="text-sm text-slate-400 mt-0.5">Kirim stok ke club lain atau terima transfer masuk</p>
        </div>
        <div className="flex gap-1 bg-slate-100 rounded-xl p-1">
          {([
            { key: "keluar", label: "Transfer Keluar", icon: "→" },
            { key: "masuk",  label: "Transfer Masuk",  icon: "←" },
          ] as { key: "keluar" | "masuk"; label: string; icon: string }[]).map(({ key, label, icon }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`px-5 py-2 rounded-lg text-sm font-semibold transition flex items-center gap-1.5 ${
                tab === key ? "bg-white shadow text-slate-900" : "text-slate-500 hover:text-slate-700"
              }`}
            >
              <span className="text-xs">{icon}</span>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      <div className="flex-1 min-h-0">
        {tab === "keluar" ? (
          <TransferKeluar ownerId={ownerId} sourceClubId={clubId} clubs={clubs} />
        ) : (
          <TransferMasuk ownerId={ownerId} clubs={clubs} />
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Transfer Keluar — two-column POS-style layout
// ─────────────────────────────────────────────────────────────────────────────

function TransferKeluar({
  ownerId, sourceClubId, clubs,
}: {
  ownerId: string | undefined;
  sourceClubId: string | undefined;
  clubs: Club[];
}) {
  const [destType, setDestType]       = useState<DestType>("club");
  const [destClubId, setDestClubId]   = useState("");
  const [destOwnerId, setDestOwnerId] = useState("");
  const [paymentType, setPaymentType] = useState<PaymentType>("bayar");
  const [priceTier, setPriceTier]     = useState<PriceTier>("retail");
  const [notes, setNotes]             = useState("");
  const [search, setSearch]           = useState("");

  // All owner's clubs are valid destinations (owner transfers TO their club)
  const destClubs = clubs;

  // Auto-select first available club whenever destType = "club" or destClubs loads
  useEffect(() => {
    if (destType === "club" && destClubs.length > 0 && !destClubId) {
      setDestClubId(destClubs[0]!.id);
    }
  }, [destType, destClubs]);

  const [inventory, setInventory]     = useState<InventoryItem[]>([]);
  const [loadingInv, setLoadingInv]   = useState(false);
  const [qtyMap, setQtyMap]           = useState<Record<string, string>>({});

  const [submitting, setSubmitting]   = useState(false);
  const [error, setError]             = useState<string | null>(null);
  const [successTransferId, setSuccessTransferId] = useState<string | null>(null);
  const [successMsg, setSuccessMsg]   = useState<string | null>(null);

  // Load owner's warehouse inventory
  useEffect(() => {
    if (!ownerId) { setInventory([]); return; }
    setLoadingInv(true);
    setQtyMap({});
    getDocs(query(
      collection(firebaseDb(), `owners/${ownerId}/inventoryItems`),
      where("isActive", "==", true),
    ))
      .then((snap) => {
        const items = snap.docs
          .map((d) => ({ id: d.id, ...(d.data() as Omit<InventoryItem, "id">) }))
          .filter((i) => (i.currentStock ?? 0) > 0)
          .sort((a, b) => a.name.localeCompare(b.name, "id"));
        setInventory(items);
      })
      .catch(() => {})
      .finally(() => setLoadingInv(false));
  }, [ownerId]);

  const filtered = useMemo(() =>
    search.trim()
      ? inventory.filter((i) => i.name.toLowerCase().includes(search.toLowerCase()))
      : inventory,
    [inventory, search]
  );

  function setQty(id: string, val: string) {
    setQtyMap((prev) => ({ ...prev, [id]: val }));
  }

  const cartItems: TransferItem[] = useMemo(() =>
    inventory
      .filter((item) => { const q = parseInt(qtyMap[item.id] ?? ""); return !isNaN(q) && q > 0; })
      .map((item) => {
        const qty = parseInt(qtyMap[item.id]!);
        const unitPrice = paymentType === "pinjam" ? 0 : (item.prices[priceTier] ?? 0);
        return { productId: item.id, productCatalogId: item.productCatalogId ?? null, productName: item.name, quantity: qty, unitPrice, subtotal: qty * unitPrice };
      }),
    [inventory, qtyMap, paymentType, priceTier]
  );

  const total = cartItems.reduce((s, i) => s + i.subtotal, 0);

  async function handleSend() {
    if (!ownerId) { setError("Data owner tidak ditemukan"); return; }
    if (destType === "club" && !destClubId) { setError("Pilih club tujuan"); return; }
    if (destType === "owner" && !destOwnerId.trim()) { setError("Masukkan Owner ID tujuan"); return; }
    if (cartItems.length === 0) { setError("Pilih setidaknya 1 produk"); return; }
    const overStock = cartItems.find((ci) => {
      const inv = inventory.find((i) => i.id === ci.productId);
      return inv && ci.quantity > inv.currentStock;
    });
    if (overStock) { setError(`Stok ${overStock.productName} tidak cukup`); return; }

    setError(null);
    setSubmitting(true);
    try {
      const result = await callFunction("productTransfer_create", {
        ownerId,
        destinationType: destType,
        ...(destType === "club" ? { destinationClubId: destClubId } : { destinationOwnerId: destOwnerId.trim() }),
        paymentType, priceTier,
        items: cartItems,
        notes: notes.trim() || undefined,
        requestId: uuidv4(), operationId: uuidv4(),
      }) as { transferId: string; total: number; status: string };

      const destLabel = destType === "club"
        ? clubs.find((c) => c.id === destClubId)?.name ?? destClubId
        : destOwnerId;

      setSuccessTransferId(result.transferId);
      setSuccessMsg(
        result.status === "completed"
          ? `Transfer ke ${destLabel} berhasil — ${cartItems.length} produk, ${fmtIdr(result.total)}`
          : `Transfer ke ${destLabel} dikirim — menunggu konfirmasi penerima`
      );
      setQtyMap({});
      setNotes("");
      setDestClubId("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal mengirim transfer");
    } finally {
      setSubmitting(false);
    }
  }

  const sourceClubName = clubs.find((c) => c.id === sourceClubId)?.name ?? "—";

  const canSend = cartItems.length > 0
    && (destType === "club" ? !!destClubId : !!destOwnerId.trim())
    && !submitting;

  return (
    <div className="flex gap-5 h-full min-h-0">

      {/* ── Left: product picker ───────────────────────────────────────── */}
      <div className="flex-1 min-w-0 flex flex-col gap-3">
        {/* Search + stats bar */}
        <div className="flex items-center gap-3">
          <div className="relative flex-1">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm pointer-events-none">🔍</span>
            <input
              type="text"
              placeholder="Cari produk…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          {loadingInv ? (
            <span className="text-xs text-slate-400">Memuat…</span>
          ) : (
            <span className="text-xs text-slate-400 whitespace-nowrap">
              {inventory.length} produk · {cartItems.length} dipilih
            </span>
          )}
          {cartItems.length > 0 && (
            <button
              onClick={() => setQtyMap({})}
              className="text-xs text-slate-400 hover:text-red-500 transition whitespace-nowrap"
            >
              Reset pilihan
            </button>
          )}
        </div>

        {/* Product table */}
        {loadingInv ? (
          <div className="flex-1 flex items-center justify-center text-slate-400 text-sm">Memuat stok…</div>
        ) : !sourceClubId ? (
          <div className="flex-1 flex items-center justify-center text-slate-400 text-sm">Memuat data club…</div>
        ) : inventory.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center text-slate-400 gap-2">
            <span className="text-3xl">📦</span>
            <p className="text-sm">Belum ada stok di inventaris Anda.</p>
          </div>
        ) : (
          <div className="flex-1 bg-white rounded-xl border border-slate-200 overflow-hidden flex flex-col min-h-0">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide sticky top-0 z-10">
                <tr>
                  <th className="px-4 py-2.5 text-left">Produk</th>
                  <th className="px-4 py-2.5 text-right">Stok</th>
                  {paymentType === "bayar" && (
                    <th className="px-4 py-2.5 text-right">Harga ({TIER_LABELS[priceTier]})</th>
                  )}
                  <th className="px-4 py-2.5 text-center w-28">Jumlah Kirim</th>
                  {paymentType === "bayar" && (
                    <th className="px-4 py-2.5 text-right">Subtotal</th>
                  )}
                </tr>
              </thead>
            </table>
            <div className="overflow-y-auto flex-1">
              <table className="w-full text-sm">
                <tbody className="divide-y divide-slate-100">
                  {filtered.length === 0 ? (
                    <tr>
                      <td className="px-4 py-8 text-center text-slate-400 text-sm" colSpan={5}>
                        Tidak ada produk yang cocok.
                      </td>
                    </tr>
                  ) : filtered.map((item) => {
                    const unitPrice = paymentType === "pinjam" ? 0 : (item.prices[priceTier] ?? 0);
                    const qty = parseInt(qtyMap[item.id] ?? "") || 0;
                    const isOver = qty > item.currentStock;
                    const hasQty = qty > 0;
                    return (
                      <tr
                        key={item.id}
                        className={`transition ${hasQty ? "bg-blue-50/60" : "hover:bg-slate-50"}`}
                      >
                        <td className="px-4 py-2.5">
                          <p className={`font-medium ${hasQty ? "text-blue-800" : "text-slate-800"}`}>{item.name}</p>
                          {item.category && <p className="text-xs text-slate-400">{item.category}</p>}
                        </td>
                        <td className={`px-4 py-2.5 text-right text-sm font-semibold ${isOver ? "text-red-500" : "text-slate-600"}`}>
                          {item.currentStock}
                          <span className="text-xs font-normal text-slate-400 ml-1">{item.unit}</span>
                        </td>
                        {paymentType === "bayar" && (
                          <td className="px-4 py-2.5 text-right text-xs text-slate-500 font-mono">
                            {fmtIdr(unitPrice)}
                          </td>
                        )}
                        <td className="px-4 py-2.5 text-center">
                          <input
                            type="number"
                            min={0}
                            max={item.currentStock}
                            className={`w-20 border rounded-lg px-2 py-1.5 text-sm text-center focus:outline-none focus:ring-2 focus:ring-blue-500 transition ${
                              isOver
                                ? "border-red-400 bg-red-50 text-red-700"
                                : hasQty
                                ? "border-blue-300 bg-white"
                                : "border-slate-200 bg-white"
                            }`}
                            placeholder="0"
                            value={qtyMap[item.id] ?? ""}
                            onChange={(e) => setQty(item.id, e.target.value)}
                          />
                        </td>
                        {paymentType === "bayar" && (
                          <td className="px-4 py-2.5 text-right text-sm font-semibold text-slate-700">
                            {qty > 0 ? fmtIdr(qty * unitPrice) : <span className="text-slate-300">—</span>}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* ── Right: config + summary ────────────────────────────────────── */}
      <div className="w-80 shrink-0 flex flex-col gap-3 overflow-y-auto">

        {/* Error / success banners */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700 flex items-start gap-2">
            <span className="shrink-0 mt-0.5">⚠️</span>
            <span>{error}</span>
          </div>
        )}
        {successMsg && (
          <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 flex gap-2">
            <span className="text-green-600 shrink-0">✓</span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-green-800">{successMsg}</p>
              {successTransferId && (
                <p className="text-xs text-green-600 font-mono mt-0.5">
                  Ref: {successTransferId.slice(0, 8).toUpperCase()}
                </p>
              )}
            </div>
            <button onClick={() => { setSuccessMsg(null); setSuccessTransferId(null); }} className="text-green-400 hover:text-green-600 shrink-0">✕</button>
          </div>
        )}

        {/* Tujuan */}
        <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Tujuan</p>
            <span className="text-xs text-slate-400">dari: {sourceClubName}</span>
          </div>
          <div className="flex gap-2">
            {(["club", "owner"] as DestType[]).map((dt) => (
              <button
                key={dt}
                onClick={() => { setDestType(dt); setDestClubId(""); setDestOwnerId(""); }}
                className={`flex-1 py-2 rounded-lg border text-sm font-medium transition ${
                  destType === dt
                    ? "border-blue-500 bg-blue-50 text-blue-700"
                    : "border-slate-200 text-slate-500 hover:border-slate-300"
                }`}
              >
                {dt === "club" ? "🏢 Club" : "👤 Owner Lain"}
              </button>
            ))}
          </div>
          {destType === "club" ? (
            destClubs.length === 0 ? (
              <p className="text-xs text-slate-400 bg-slate-50 rounded-lg px-3 py-2">
                Tidak ada club lain. Tambahkan club baru terlebih dahulu.
              </p>
            ) : destClubs.length === 1 ? (
              // Single club — show as read-only chip
              <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2.5">
                <span className="text-base">🏢</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-blue-800">{destClubs[0]!.name}</p>
                  <p className="text-xs text-blue-500">Club tujuan</p>
                </div>
              </div>
            ) : (
              // Multiple clubs — show dropdown (pre-selected)
              <select
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={destClubId}
                onChange={(e) => setDestClubId(e.target.value)}
              >
                {destClubs.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            )
          ) : (
            <div>
              <input
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Owner ID tujuan"
                value={destOwnerId}
                onChange={(e) => setDestOwnerId(e.target.value)}
              />
              <p className="text-xs text-slate-400 mt-1.5">Transfer akan menunggu konfirmasi penerima.</p>
            </div>
          )}
        </div>

        {/* Pembayaran */}
        <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Pembayaran</p>
          <div className="flex gap-2">
            {(["bayar", "pinjam"] as PaymentType[]).map((pt) => (
              <button
                key={pt}
                onClick={() => setPaymentType(pt)}
                className={`flex-1 py-2 rounded-lg border text-sm font-medium transition ${
                  paymentType === pt
                    ? "border-blue-500 bg-blue-50 text-blue-700"
                    : "border-slate-200 text-slate-500 hover:border-slate-300"
                }`}
              >
                {pt === "bayar" ? "💰 Bayar" : "🤝 Pinjam"}
              </button>
            ))}
          </div>

          {paymentType === "pinjam" && (
            <p className="text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2">
              Stok dikirim tanpa biaya. Jika ke owner lain, dicatat sebagai titipan.
            </p>
          )}

          {paymentType === "bayar" && (
            <div>
              <p className="text-xs text-slate-500 mb-1.5">Tier Harga</p>
              <div className="flex gap-1.5 flex-wrap">
                {(Object.keys(TIER_LABELS) as PriceTier[]).map((t) => (
                  <button
                    key={t}
                    onClick={() => setPriceTier(t)}
                    className={`px-3 py-1 rounded-lg border text-xs font-semibold transition ${
                      priceTier === t
                        ? "border-blue-500 bg-blue-50 text-blue-700"
                        : "border-slate-200 text-slate-500 hover:border-slate-300"
                    }`}
                  >
                    {TIER_LABELS[t]}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Cart summary */}
        <div className="bg-white rounded-xl border border-slate-200 p-4 flex-1 flex flex-col gap-2 min-h-0">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide shrink-0">
            Ringkasan {cartItems.length > 0 && <span className="ml-1 bg-blue-100 text-blue-700 rounded-full px-1.5 py-0.5 text-xs">{cartItems.length}</span>}
          </p>
          {cartItems.length === 0 ? (
            <div className="flex-1 flex items-center justify-center text-center">
              <p className="text-sm text-slate-400">Isi jumlah produk<br />yang akan dikirim</p>
            </div>
          ) : (
            <div className="overflow-y-auto flex-1 space-y-1 pr-1">
              {cartItems.map((ci) => (
                <div key={ci.productId} className="flex items-center justify-between text-sm gap-2">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="text-blue-500 font-bold shrink-0 text-xs">{ci.quantity}×</span>
                    <span className="text-slate-700 truncate">{ci.productName}</span>
                  </div>
                  {paymentType === "bayar" && (
                    <span className="text-slate-500 shrink-0 text-xs">{fmtIdr(ci.subtotal)}</span>
                  )}
                </div>
              ))}
            </div>
          )}
          {cartItems.length > 0 && paymentType === "bayar" && (
            <div className="border-t border-slate-100 pt-2 flex justify-between font-bold text-sm shrink-0">
              <span className="text-slate-600">Total</span>
              <span className="text-slate-900">{fmtIdr(total)}</span>
            </div>
          )}
        </div>

        {/* Notes */}
        <textarea
          className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm resize-none bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 shrink-0"
          rows={2}
          placeholder="Catatan (opsional)…"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />

        {/* Send button */}
        <button
          onClick={handleSend}
          disabled={!canSend}
          className={`w-full rounded-xl py-3.5 text-sm font-bold transition shrink-0 ${
            canSend
              ? "bg-blue-600 hover:bg-blue-700 text-white"
              : "bg-slate-100 text-slate-400 cursor-not-allowed"
          }`}
        >
          {submitting
            ? "Mengirim…"
            : cartItems.length === 0
            ? "Pilih produk dulu"
            : destType === "club" && !destClubId
            ? "Pilih club tujuan"
            : destType === "owner" && !destOwnerId.trim()
            ? "Masukkan Owner ID"
            : paymentType === "bayar"
            ? `Kirim ${cartItems.length} produk — ${fmtIdr(total)}`
            : `Kirim ${cartItems.length} produk (Gratis)`}
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Transfer Masuk
// ─────────────────────────────────────────────────────────────────────────────

function TransferMasuk({ ownerId, clubs }: { ownerId: string | undefined; clubs: Club[] }) {
  const [transfers, setTransfers]   = useState<IncomingTransfer[]>([]);
  const [loading, setLoading]       = useState(true);
  const [selectedClub, setSelectedClub] = useState<Record<string, string>>({});
  const [accepting, setAccepting]   = useState<Record<string, boolean>>({});
  const [receipt, setReceipt]       = useState<AcceptReceipt | null>(null);
  const [errors, setErrors]         = useState<Record<string, string>>({});

  async function loadData() {
    if (!ownerId) return;
    setLoading(true);
    try {
      const snap = await getDocs(query(
        collection(firebaseDb(), `owners/${ownerId}/notifications`),
        where("type", "==", "transfer_incoming"),
        orderBy("createdAt", "desc"),
      ));
      setTransfers(snap.docs.map((d) => ({ id: d.id, ...d.data() } as IncomingTransfer)));
    } catch { /* offline */ } finally { setLoading(false); }
  }

  useEffect(() => { loadData(); }, [ownerId]);

  async function handleAccept(t: IncomingTransfer) {
    const clubId = selectedClub[t.transferId];
    if (!clubId) {
      setErrors((p) => ({ ...p, [t.transferId]: "Pilih club tujuan terlebih dahulu" }));
      return;
    }
    if (!ownerId) return;
    setErrors((p) => { const n = { ...p }; delete n[t.transferId]; return n; });
    setAccepting((prev) => ({ ...prev, [t.transferId]: true }));
    try {
      await callFunction("productTransfer_accept", {
        ownerId,
        sourceOwnerId: t.sourceOwnerId,
        transferId: t.transferId,
        destinationClubId: clubId,
        requestId: uuidv4(), operationId: uuidv4(),
      });
      const clubName = clubs.find((c) => c.id === clubId)?.name ?? clubId;
      setReceipt({
        transferId: t.transferId, total: t.total, paymentType: t.paymentType,
        sourceOwnerId: t.sourceOwnerId, destinationClubId: clubName,
        items: t.items, timestamp: new Date().toLocaleString("id-ID"),
      });
      loadData();
    } catch (err) {
      setErrors((p) => ({ ...p, [t.transferId]: err instanceof Error ? err.message : "Gagal menerima transfer" }));
    } finally {
      setAccepting((prev) => ({ ...prev, [t.transferId]: false }));
    }
  }

  function shareReceipt(r: AcceptReceipt) {
    const isFree = r.paymentType === "pinjam";
    const lines = [
      "*KONFIRMASI TERIMA TRANSFER - NC Manager*",
      `Tanggal: ${r.timestamp}`, `Dari Owner: ${r.sourceOwnerId}`,
      `Masuk ke Club: ${r.destinationClubId}`,
      `Jenis: ${r.paymentType === "bayar" ? "Bayar" : "Pinjam (Gratis)"}`,
      "───────────────────────",
      ...r.items.map((i) => `- ${i.productName} ×${i.quantity}${isFree ? "" : ` = ${fmtIdr(i.subtotal)}`}`),
      "───────────────────────",
      `Total: ${isFree ? "Rp 0 (Gratis)" : fmtIdr(r.total)}`,
      `Ref: ${r.transferId.slice(0, 8).toUpperCase()}`, "Status: Diterima",
    ];
    window.open(`https://wa.me/?text=${encodeURIComponent(lines.join("\n"))}`, "_blank");
  }

  const pending  = transfers.filter((t) => t.status === "pending");
  const accepted = transfers.filter((t) => t.status === "accepted");

  return (
    <div className="max-w-2xl space-y-6">
      {/* Receipt modal */}
      {receipt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm mx-4 overflow-hidden">
            <div className="bg-green-600 px-5 py-4">
              <p className="font-bold text-white text-base">✓ Transfer Diterima!</p>
              <p className="text-xs text-white/80 mt-0.5">{receipt.timestamp}</p>
            </div>
            <div className="p-5 space-y-3">
              <div className="bg-slate-50 rounded-xl p-3 space-y-1.5 text-xs text-slate-600">
                <div className="flex justify-between">
                  <span className="text-slate-400">Dari Owner</span>
                  <span className="font-medium text-slate-700 font-mono">{receipt.sourceOwnerId}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Masuk ke Club</span>
                  <span className="font-medium text-slate-700">{receipt.destinationClubId}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Jenis</span>
                  <span className={`font-semibold ${receipt.paymentType === "pinjam" ? "text-amber-600" : "text-blue-600"}`}>
                    {receipt.paymentType === "bayar" ? "Bayar" : "Pinjam (Gratis)"}
                  </span>
                </div>
              </div>
              <div className="space-y-1">
                {receipt.items.map((item, i) => (
                  <div key={i} className="flex justify-between text-sm">
                    <span className="text-slate-700">{item.quantity}× {item.productName}</span>
                    {receipt.paymentType === "bayar" && <span className="text-slate-500 text-xs">{fmtIdr(item.subtotal)}</span>}
                  </div>
                ))}
              </div>
              {receipt.paymentType === "bayar" && (
                <div className="border-t border-slate-100 pt-2 flex justify-between font-bold text-sm">
                  <span>Total</span>
                  <span>{fmtIdr(receipt.total)}</span>
                </div>
              )}
              <p className="text-xs text-slate-400 font-mono">Ref: {receipt.transferId.slice(0, 8).toUpperCase()}</p>
              <div className="flex gap-2 pt-1">
                <button onClick={() => shareReceipt(receipt)}
                  className="flex-1 bg-green-500 hover:bg-green-600 text-white rounded-xl py-2.5 text-sm font-semibold transition">
                  WhatsApp
                </button>
                <button onClick={() => setReceipt(null)}
                  className="px-4 text-sm text-slate-400 hover:text-slate-600 font-medium">
                  Tutup
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Header row */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
            Menunggu Konfirmasi
            {pending.length > 0 && (
              <span className="ml-2 bg-amber-100 text-amber-700 rounded-full px-2 py-0.5 text-xs normal-case font-bold">
                {pending.length}
              </span>
            )}
          </p>
        </div>
        <button onClick={loadData} className="text-xs text-blue-600 hover:underline font-medium">
          Refresh
        </button>
      </div>

      {loading ? (
        <div className="text-center py-12 text-slate-400 text-sm">Memuat…</div>
      ) : (
        <>
          {/* Pending */}
          {pending.length === 0 ? (
            <div className="bg-slate-50 rounded-2xl px-6 py-10 text-center">
              <p className="text-2xl mb-2">📭</p>
              <p className="text-sm font-medium text-slate-600">Tidak ada transfer yang menunggu</p>
              <p className="text-xs text-slate-400 mt-1">Transfer masuk dari owner lain akan muncul di sini.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {pending.map((t) => (
                <div key={t.id} className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                  {/* Card header */}
                  <div className="bg-amber-50 border-b border-amber-100 px-4 py-3 flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-bold text-slate-800">
                        Transfer dari Owner
                      </p>
                      <p className="text-xs text-slate-400 font-mono mt-0.5">{t.sourceOwnerId}</p>
                      <p className="text-xs text-slate-400 mt-0.5">{fmtDate(t.createdAt)}</p>
                    </div>
                    <span className={`text-xs font-semibold px-2.5 py-1 rounded-full shrink-0 ${
                      t.paymentType === "pinjam"
                        ? "bg-amber-100 text-amber-700"
                        : "bg-blue-100 text-blue-700"
                    }`}>
                      {t.paymentType === "bayar" ? "💰 Bayar" : "🤝 Pinjam — Gratis"}
                    </span>
                  </div>

                  {/* Items */}
                  <div className="px-4 py-3 space-y-1.5">
                    {t.items.map((item, i) => (
                      <div key={i} className="flex justify-between text-sm">
                        <span className="text-slate-700">{item.quantity}× {item.productName}</span>
                        {t.paymentType === "bayar" && (
                          <span className="text-slate-500 text-xs">{fmtIdr(item.subtotal)}</span>
                        )}
                      </div>
                    ))}
                    {t.paymentType === "bayar" && (
                      <div className="border-t border-slate-100 pt-2 mt-1 flex justify-between font-semibold text-sm">
                        <span className="text-slate-600">Total</span>
                        <span className="text-slate-900">{fmtIdr(t.total)}</span>
                      </div>
                    )}
                    {t.notes && (
                      <p className="text-xs text-slate-400 italic bg-slate-50 rounded-lg px-2.5 py-1.5 mt-1">
                        📝 {t.notes}
                      </p>
                    )}
                  </div>

                  {/* Accept footer */}
                  <div className="px-4 py-3 border-t border-slate-100 bg-slate-50 space-y-2">
                    {errors[t.transferId] && (
                      <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-1.5">
                        {errors[t.transferId]}
                      </p>
                    )}
                    <div className="flex items-center gap-2">
                      <select
                        className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-green-500"
                        value={selectedClub[t.transferId] ?? ""}
                        onChange={(e) => setSelectedClub((prev) => ({ ...prev, [t.transferId]: e.target.value }))}
                      >
                        <option value="">— Masuk ke Club mana? —</option>
                        {clubs.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                      <button
                        onClick={() => handleAccept(t)}
                        disabled={accepting[t.transferId] || !selectedClub[t.transferId]}
                        className="bg-green-600 hover:bg-green-700 text-white rounded-lg px-5 py-2 text-sm font-semibold disabled:opacity-40 transition whitespace-nowrap"
                      >
                        {accepting[t.transferId] ? "Memproses…" : "✓ Konfirmasi"}
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Accepted history */}
          {accepted.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">
                Sudah Diterima ({accepted.length})
              </p>
              <div className="space-y-2">
                {accepted.map((t) => (
                  <div key={t.id} className="bg-white rounded-xl border border-slate-200 px-4 py-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-700 truncate">
                        Dari <span className="font-mono text-xs text-slate-500">{t.sourceOwnerId}</span>
                      </p>
                      <p className="text-xs text-slate-400 mt-0.5">
                        {t.items.length} produk ·{" "}
                        {t.paymentType === "pinjam" ? "Pinjam" : fmtIdr(t.total)} ·{" "}
                        {fmtDate(t.createdAt)}
                      </p>
                    </div>
                    <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-green-50 text-green-700 shrink-0">
                      ✓ Diterima
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
}
