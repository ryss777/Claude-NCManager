"use client";

import { useEffect, useState } from "react";
import { collection, getDocs, query, where, orderBy } from "firebase/firestore";
import { v4 as uuidv4 } from "uuid";
import { useOwnerAuthStore } from "@/store/auth.store";
import { callFunction, firebaseDb } from "@/firebase/firebase";
import { COLLECTIONS } from "@nc-manager/shared-constants";

type PaymentType = "bayar" | "pinjam";
type PriceTier = "retail" | "ds" | "sc" | "sbQp" | "spv";
type DestType = "club" | "owner";

const TIER_LABELS: Record<PriceTier, string> = {
  retail: "Retail",
  ds: "DS",
  sc: "SC",
  sbQp: "SB/QP",
  spv: "SPV",
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
  new Date(iso).toLocaleString("id-ID", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

export default function TransferPage() {
  const { ownerId } = useOwnerAuthStore();
  const [tab, setTab] = useState<"keluar" | "masuk">("keluar");

  // ─── Shared data ──────────────────────────────────────────────────────────
  const [clubs, setClubs] = useState<Club[]>([]);

  useEffect(() => {
    if (!ownerId) return;
    getDocs(collection(firebaseDb(), `owners/${ownerId}/clubs`))
      .then((snap) => setClubs(snap.docs.map((d) => ({ id: d.id, name: d.data()["name"] as string }))))
      .catch(() => {});
  }, [ownerId]);

  return (
    <div>
      <h2 className="text-2xl font-bold text-slate-900 mb-5">Transfer Produk</h2>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-slate-100 rounded-xl p-1 w-fit">
        {(["keluar", "masuk"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-5 py-2 rounded-lg text-sm font-semibold transition ${
              tab === t ? "bg-white shadow text-slate-900" : "text-slate-500 hover:text-slate-700"
            }`}
          >
            {t === "keluar" ? "Transfer Keluar →" : "← Transfer Masuk"}
          </button>
        ))}
      </div>

      {tab === "keluar" ? (
        <TransferKeluar ownerId={ownerId} clubs={clubs} />
      ) : (
        <TransferMasuk ownerId={ownerId} clubs={clubs} />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Transfer Keluar
// ─────────────────────────────────────────────────────────────────────────────

function TransferKeluar({ ownerId, clubs }: { ownerId: string | undefined; clubs: Club[] }) {
  const [sourceClubId, setSourceClubId] = useState("");
  const [destType, setDestType] = useState<DestType>("club");
  const [destClubId, setDestClubId] = useState("");
  const [destOwnerId, setDestOwnerId] = useState("");
  const [paymentType, setPaymentType] = useState<PaymentType>("bayar");
  const [priceTier, setPriceTier] = useState<PriceTier>("retail");
  const [notes, setNotes] = useState("");

  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [loadingInv, setLoadingInv] = useState(false);
  // qty per item id
  const [qtyMap, setQtyMap] = useState<Record<string, string>>({});

  const [submitting, setSubmitting] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Load inventory when source club changes
  useEffect(() => {
    if (!ownerId || !sourceClubId) { setInventory([]); return; }
    setLoadingInv(true);
    setQtyMap({});
    getDocs(
      query(
        collection(firebaseDb(), COLLECTIONS.INVENTORY_ITEMS(ownerId, sourceClubId)),
        where("isActive", "==", true)
      )
    )
      .then((snap) => {
        const items = snap.docs
          .map((d) => ({ id: d.id, ...(d.data() as Omit<InventoryItem, "id">) }))
          .filter((i) => i.currentStock > 0)
          .sort((a, b) => a.name.localeCompare(b.name));
        setInventory(items);
      })
      .catch(() => {})
      .finally(() => setLoadingInv(false));
  }, [ownerId, sourceClubId]);

  function setQty(id: string, val: string) {
    setQtyMap((prev) => ({ ...prev, [id]: val }));
  }

  // Build cart from qtyMap
  const cartItems: TransferItem[] = inventory
    .filter((item) => {
      const q = parseInt(qtyMap[item.id] ?? "");
      return !isNaN(q) && q > 0;
    })
    .map((item) => {
      const qty = parseInt(qtyMap[item.id]!);
      const unitPrice = paymentType === "pinjam" ? 0 : (item.prices[priceTier] ?? 0);
      return {
        productId: item.id,
        productCatalogId: item.productCatalogId ?? null,
        productName: item.name,
        quantity: qty,
        unitPrice,
        subtotal: qty * unitPrice,
      };
    });

  const total = cartItems.reduce((s, i) => s + i.subtotal, 0);

  async function handleSend() {
    if (!ownerId || !sourceClubId) { setError("Pilih club sumber"); return; }
    if (destType === "club" && !destClubId) { setError("Pilih club tujuan"); return; }
    if (destType === "owner" && !destOwnerId.trim()) { setError("Masukkan Owner ID tujuan"); return; }
    if (cartItems.length === 0) { setError("Tambahkan setidaknya 1 item"); return; }

    // Validate quantities don't exceed stock
    const overStock = cartItems.find((ci) => {
      const inv = inventory.find((i) => i.id === ci.productId);
      return inv && ci.quantity > inv.currentStock;
    });
    if (overStock) {
      setError(`Stok ${overStock.productName} tidak cukup`);
      return;
    }

    setError(null);
    setSubmitting(true);
    try {
      const result = await callFunction("productTransfer_create", {
        ownerId,
        sourceClubId,
        destinationType: destType,
        ...(destType === "club" ? { destinationClubId: destClubId } : { destinationOwnerId: destOwnerId.trim() }),
        paymentType,
        priceTier,
        items: cartItems,
        notes: notes.trim() || undefined,
        requestId: uuidv4(),
        operationId: uuidv4(),
      }) as { transferId: string; total: number; status: string };

      const destLabel = destType === "club"
        ? clubs.find((c) => c.id === destClubId)?.name ?? destClubId
        : destOwnerId;

      setSuccessMsg(
        result.status === "completed"
          ? `Transfer ke ${destLabel} berhasil — ${cartItems.length} item, ${fmtIdr(result.total)}`
          : `Transfer ke owner ${destLabel} dikirim — menunggu konfirmasi penerima`
      );

      // Reset form
      setQtyMap({});
      setNotes("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal mengirim transfer");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-2xl space-y-5">
      {successMsg && (
        <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 flex items-start gap-3">
          <span className="text-green-600 text-lg">✓</span>
          <div className="flex-1">
            <p className="text-sm font-semibold text-green-800">{successMsg}</p>
          </div>
          <button onClick={() => setSuccessMsg(null)} className="text-green-400 hover:text-green-600 text-xs">✕</button>
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Source club */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Sumber</p>
        <div>
          <label className="block text-sm text-slate-600 mb-1">Club Pengirim</label>
          <select
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white"
            value={sourceClubId}
            onChange={(e) => { setSourceClubId(e.target.value); setDestClubId(""); }}
          >
            <option value="">— Pilih Club —</option>
            {clubs.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      </div>

      {/* Destination */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Tujuan</p>

        <div className="flex gap-2">
          {(["club", "owner"] as DestType[]).map((dt) => (
            <button
              key={dt}
              onClick={() => setDestType(dt)}
              className={`flex-1 py-2 rounded-lg border text-sm font-medium transition ${
                destType === dt
                  ? "border-brand-500 bg-brand-50 text-brand-700"
                  : "border-slate-200 text-slate-500 hover:border-slate-300"
              }`}
            >
              {dt === "club" ? "Club Sendiri" : "Owner Lain"}
            </button>
          ))}
        </div>

        {destType === "club" ? (
          <div>
            <label className="block text-sm text-slate-600 mb-1">Club Tujuan</label>
            <select
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white"
              value={destClubId}
              onChange={(e) => setDestClubId(e.target.value)}
            >
              <option value="">— Pilih Club —</option>
              {clubs.filter((c) => c.id !== sourceClubId).map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
        ) : (
          <div>
            <label className="block text-sm text-slate-600 mb-1">Owner ID Tujuan</label>
            <input
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
              placeholder="Contoh: owner_abc123"
              value={destOwnerId}
              onChange={(e) => setDestOwnerId(e.target.value)}
            />
            <p className="text-xs text-slate-400 mt-1">Transfer akan menunggu konfirmasi dari penerima.</p>
          </div>
        )}
      </div>

      {/* Payment & tier */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Pembayaran</p>

        <div>
          <label className="block text-sm text-slate-600 mb-1">Jenis</label>
          <div className="flex gap-2">
            {(["bayar", "pinjam"] as PaymentType[]).map((pt) => (
              <button
                key={pt}
                onClick={() => setPaymentType(pt)}
                className={`flex-1 py-2 rounded-lg border text-sm font-medium transition ${
                  paymentType === pt
                    ? "border-brand-500 bg-brand-50 text-brand-700"
                    : "border-slate-200 text-slate-500 hover:border-slate-300"
                }`}
              >
                {pt === "bayar" ? "💰 Bayar" : "🤝 Pinjam (Gratis)"}
              </button>
            ))}
          </div>
        </div>

        {paymentType === "bayar" && (
          <div>
            <label className="block text-sm text-slate-600 mb-1">Tier Harga</label>
            <div className="flex gap-2 flex-wrap">
              {(Object.keys(TIER_LABELS) as PriceTier[]).map((t) => (
                <button
                  key={t}
                  onClick={() => setPriceTier(t)}
                  className={`px-3 py-1.5 rounded-lg border text-xs font-semibold transition ${
                    priceTier === t
                      ? "border-brand-500 bg-brand-50 text-brand-700"
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

      {/* Item picker */}
      {sourceClubId && (
        <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">
            Pilih Produk ({inventory.length} tersedia)
          </p>

          {loadingInv ? (
            <p className="text-sm text-slate-400 py-2">Memuat stok…</p>
          ) : inventory.length === 0 ? (
            <p className="text-sm text-slate-400 py-2">Tidak ada stok di club ini.</p>
          ) : (
            <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
              {inventory.map((item) => {
                const unitPrice = paymentType === "pinjam" ? 0 : (item.prices[priceTier] ?? 0);
                const qty = parseInt(qtyMap[item.id] ?? "") || 0;
                const isOver = qty > item.currentStock;
                return (
                  <div
                    key={item.id}
                    className={`flex items-center gap-3 rounded-lg px-3 py-2.5 border transition ${
                      qty > 0 ? "border-brand-200 bg-brand-50" : "border-slate-100 bg-slate-50"
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-800 truncate">{item.name}</p>
                      <p className="text-xs text-slate-400">
                        Stok: {item.currentStock} {item.unit}
                        {paymentType === "bayar" && ` · ${fmtIdr(unitPrice)}`}
                      </p>
                    </div>
                    <input
                      type="number"
                      min={0}
                      max={item.currentStock}
                      className={`w-20 border rounded-lg px-2 py-1.5 text-sm text-center ${
                        isOver ? "border-red-400 bg-red-50 text-red-700" : "border-slate-200"
                      }`}
                      placeholder="0"
                      value={qtyMap[item.id] ?? ""}
                      onChange={(e) => setQty(item.id, e.target.value)}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Notes */}
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <label className="block text-sm text-slate-600 mb-1">Catatan (opsional)</label>
        <textarea
          className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm resize-none"
          rows={2}
          placeholder="Misal: titipan untuk event weekend…"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>

      {/* Cart summary + send */}
      {cartItems.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Ringkasan</p>
          <div className="space-y-1.5">
            {cartItems.map((ci) => (
              <div key={ci.productId} className="flex justify-between text-sm">
                <span className="text-slate-700">{ci.quantity}× {ci.productName}</span>
                {paymentType === "bayar" && (
                  <span className="text-slate-500 shrink-0 ml-2">{fmtIdr(ci.subtotal)}</span>
                )}
              </div>
            ))}
          </div>
          {paymentType === "bayar" && (
            <div className="border-t border-slate-100 pt-2 flex justify-between font-semibold text-sm">
              <span className="text-slate-600">Total</span>
              <span className="text-slate-900">{fmtIdr(total)}</span>
            </div>
          )}
        </div>
      )}

      <button
        onClick={handleSend}
        disabled={submitting || cartItems.length === 0 || !sourceClubId}
        className="w-full bg-brand-600 hover:bg-brand-700 text-white rounded-xl py-3 text-sm font-semibold disabled:opacity-40 transition"
      >
        {submitting ? "Mengirim…" : `Kirim Transfer (${cartItems.length} item)`}
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Transfer Masuk (existing logic, moved here)
// ─────────────────────────────────────────────────────────────────────────────

function TransferMasuk({ ownerId, clubs }: { ownerId: string | undefined; clubs: Club[] }) {
  const [transfers, setTransfers] = useState<IncomingTransfer[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedClub, setSelectedClub] = useState<Record<string, string>>({});
  const [accepting, setAccepting] = useState<Record<string, boolean>>({});
  const [receipt, setReceipt] = useState<AcceptReceipt | null>(null);

  async function loadData() {
    if (!ownerId) return;
    setLoading(true);
    try {
      const snap = await getDocs(
        query(
          collection(firebaseDb(), `owners/${ownerId}/notifications`),
          where("type", "==", "transfer_incoming"),
          orderBy("createdAt", "desc")
        )
      );
      setTransfers(snap.docs.map((d) => ({ id: d.id, ...d.data() } as IncomingTransfer)));
    } catch {
      // offline
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadData(); }, [ownerId]);

  async function handleAccept(t: IncomingTransfer) {
    const clubId = selectedClub[t.transferId];
    if (!clubId) { alert("Pilih club tujuan terlebih dahulu"); return; }
    if (!ownerId) return;

    setAccepting((prev) => ({ ...prev, [t.transferId]: true }));
    try {
      await callFunction("productTransfer_accept", {
        ownerId,
        sourceOwnerId: t.sourceOwnerId,
        transferId: t.transferId,
        destinationClubId: clubId,
        requestId: uuidv4(),
        operationId: uuidv4(),
      });
      const clubName = clubs.find((c) => c.id === clubId)?.name ?? clubId;
      setReceipt({
        transferId: t.transferId,
        total: t.total,
        paymentType: t.paymentType,
        sourceOwnerId: t.sourceOwnerId,
        destinationClubId: clubName,
        items: t.items,
        timestamp: new Date().toLocaleString("id-ID"),
      });
      loadData();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Gagal menerima transfer");
    } finally {
      setAccepting((prev) => ({ ...prev, [t.transferId]: false }));
    }
  }

  function shareReceipt(r: AcceptReceipt) {
    const isFree = r.paymentType === "pinjam";
    const lines = [
      "*KONFIRMASI TERIMA TRANSFER - NC Manager*",
      `Tanggal: ${r.timestamp}`,
      `Dari Owner: ${r.sourceOwnerId}`,
      `Masuk ke Club: ${r.destinationClubId}`,
      `Jenis: ${r.paymentType === "bayar" ? "Bayar" : "Pinjam (Gratis)"}`,
      "───────────────────────",
      ...r.items.map((i) => `- ${i.productName} ×${i.quantity}${isFree ? "" : ` = ${fmtIdr(i.subtotal)}`}`),
      "───────────────────────",
      `Total: ${isFree ? "Rp 0 (Gratis)" : fmtIdr(r.total)}`,
      `Ref: ${r.transferId.slice(0, 8).toUpperCase()}`,
      "Status: Diterima",
    ];
    window.open(`https://wa.me/?text=${encodeURIComponent(lines.join("\n"))}`, "_blank");
  }

  const pending = transfers.filter((t) => t.status === "pending");
  const accepted = transfers.filter((t) => t.status === "accepted");

  return (
    <div className="max-w-2xl space-y-8">
      {/* Receipt modal */}
      {receipt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm mx-4 overflow-hidden">
            <div className="bg-green-600 px-5 py-4">
              <p className="font-bold text-white text-base">Transfer Diterima!</p>
              <p className="text-xs text-white/80 mt-0.5">{receipt.timestamp}</p>
            </div>
            <div className="p-5 space-y-3">
              <div className="text-xs text-slate-500 space-y-1">
                <div className="flex justify-between">
                  <span>Dari Owner</span>
                  <span className="font-medium text-slate-700">{receipt.sourceOwnerId}</span>
                </div>
                <div className="flex justify-between">
                  <span>Masuk ke Club</span>
                  <span className="font-medium text-slate-700">{receipt.destinationClubId}</span>
                </div>
                <div className="flex justify-between">
                  <span>Jenis</span>
                  <span className={`font-semibold ${receipt.paymentType === "pinjam" ? "text-amber-600" : "text-blue-600"}`}>
                    {receipt.paymentType === "bayar" ? "Bayar" : "Pinjam (Gratis)"}
                  </span>
                </div>
              </div>
              <div className="border-t border-slate-100 pt-2 space-y-1">
                {receipt.items.map((item, i) => (
                  <div key={i} className="flex justify-between text-xs text-slate-600">
                    <span className="truncate mr-2">{item.quantity}× {item.productName}</span>
                    {receipt.paymentType === "bayar" && <span className="shrink-0">{fmtIdr(item.subtotal)}</span>}
                  </div>
                ))}
              </div>
              <div className="border-t border-slate-100 pt-2 flex justify-between font-bold text-sm">
                <span>Total</span>
                <span className={receipt.paymentType === "pinjam" ? "text-amber-600" : "text-slate-900"}>
                  {receipt.paymentType === "pinjam" ? "Rp 0 (Gratis)" : fmtIdr(receipt.total)}
                </span>
              </div>
              <p className="text-xs text-slate-400 font-mono">Ref: {receipt.transferId.slice(0, 8).toUpperCase()}</p>
              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => shareReceipt(receipt)}
                  className="flex-1 bg-green-500 hover:bg-green-600 text-white rounded-xl py-2.5 text-sm font-semibold transition"
                >
                  Kirim ke WhatsApp
                </button>
                <button
                  onClick={() => setReceipt(null)}
                  className="px-4 text-sm text-slate-400 hover:text-slate-600 font-medium"
                >
                  Tutup
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-slate-400">Memuat…</p>
      ) : (
        <>
          {/* Pending */}
          <section>
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">
              Menunggu Konfirmasi ({pending.length})
            </p>
            {pending.length === 0 ? (
              <div className="bg-slate-50 rounded-xl px-5 py-6 text-center">
                <p className="text-sm text-slate-400">Tidak ada transfer yang menunggu.</p>
              </div>
            ) : (
              <div className="space-y-4">
                {pending.map((t) => (
                  <div key={t.id} className="bg-white rounded-xl border border-amber-200 shadow-sm overflow-hidden">
                    <div className="bg-amber-50 px-4 py-3 flex items-center justify-between">
                      <div>
                        <p className="text-sm font-semibold text-amber-800">Dari Owner: {t.sourceOwnerId}</p>
                        <p className="text-xs text-amber-600 mt-0.5">{fmtDate(t.createdAt)}</p>
                      </div>
                      <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${
                        t.paymentType === "pinjam"
                          ? "bg-amber-100 text-amber-700"
                          : "bg-blue-100 text-blue-700"
                      }`}>
                        {t.paymentType === "bayar" ? "Bayar" : "Pinjam — Gratis"}
                      </span>
                    </div>
                    <div className="px-4 py-3 space-y-2">
                      {t.items.map((item, i) => (
                        <div key={i} className="flex justify-between text-sm">
                          <span className="text-slate-700">{item.quantity}× {item.productName}</span>
                          {t.paymentType === "bayar" && (
                            <span className="text-slate-500 text-xs">{fmtIdr(item.subtotal)}</span>
                          )}
                        </div>
                      ))}
                      {t.paymentType === "bayar" && (
                        <div className="border-t border-slate-100 pt-2 flex justify-between font-semibold text-sm">
                          <span className="text-slate-600">Total</span>
                          <span className="text-slate-900">{fmtIdr(t.total)}</span>
                        </div>
                      )}
                      {t.notes && <p className="text-xs text-slate-400 italic">Catatan: {t.notes}</p>}
                    </div>
                    <div className="px-4 py-3 border-t border-slate-100 flex items-center gap-3">
                      <select
                        className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white"
                        value={selectedClub[t.transferId] ?? ""}
                        onChange={(e) =>
                          setSelectedClub((prev) => ({ ...prev, [t.transferId]: e.target.value }))
                        }
                      >
                        <option value="">— Masuk ke Club —</option>
                        {clubs.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                      <button
                        onClick={() => handleAccept(t)}
                        disabled={accepting[t.transferId] || !selectedClub[t.transferId]}
                        className="bg-green-600 hover:bg-green-700 text-white rounded-lg px-5 py-2 text-sm font-semibold disabled:opacity-40 transition whitespace-nowrap"
                      >
                        {accepting[t.transferId] ? "Memproses…" : "Konfirmasi"}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Accepted history */}
          {accepted.length > 0 && (
            <section>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">
                Sudah Diterima ({accepted.length})
              </p>
              <div className="space-y-2">
                {accepted.map((t) => (
                  <div key={t.id} className="bg-white rounded-xl border border-slate-200 px-4 py-3 flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-slate-700">Dari Owner: {t.sourceOwnerId}</p>
                      <p className="text-xs text-slate-400 mt-0.5">
                        {t.items.length} produk ·{" "}
                        {t.paymentType === "pinjam" ? "Pinjam (Gratis)" : fmtIdr(t.total)} ·{" "}
                        {fmtDate(t.createdAt)}
                      </p>
                    </div>
                    <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-green-50 text-green-700">
                      Diterima
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
