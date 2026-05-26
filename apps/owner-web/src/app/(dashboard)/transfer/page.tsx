"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import { collection, getDocs, query, orderBy, limit } from "firebase/firestore";
import { v4 as uuidv4 } from "uuid";
import { useOwnerAuthStore } from "@/store/auth.store";
import { callFunction, firebaseDb } from "@/firebase/firebase";

// ── Types ──────────────────────────────────────────────────────────────────────

type PriceTier = "retail" | "ds" | "sc" | "sbQp" | "spv";
const TIER_LABELS: Record<PriceTier, string> = {
  retail: "Retail", ds: "DS", sc: "SC", sbQp: "SB-QP", spv: "SPV",
};

interface WarehouseItem {
  id: string;
  name: string;
  productCatalogId: string | null;
  currentStock: number;
  prices: Record<PriceTier, number>;
  isActive: boolean;
}

interface CartLine {
  item: WarehouseItem;
  qty: number;
  unitPrice: number;
}

interface Transfer {
  id: string;
  destinationType: string;
  destinationClubId: string | null;
  paymentType: "bayar" | "pinjam";
  status: "pending_acceptance" | "completed" | "rejected";
  total: number;
  items: { productName: string; quantity: number; subtotal: number }[];
  notes: string | null;
  createdAt: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmtIdr = (n: number) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);

const STATUS_STYLE: Record<Transfer["status"], string> = {
  pending_acceptance: "bg-amber-100 text-amber-700",
  completed:          "bg-green-100 text-green-700",
  rejected:           "bg-red-100 text-red-600",
};
const STATUS_LABEL: Record<Transfer["status"], string> = {
  pending_acceptance: "Menunggu",
  completed:          "Selesai",
  rejected:           "Ditolak",
};

// ── Component ──────────────────────────────────────────────────────────────────

export default function TransferPage() {
  const { ownerId, clubId } = useOwnerAuthStore();

  // ── Warehouse items ─────────────────────────────────────────────────────────
  const [items, setItems]       = useState<WarehouseItem[]>([]);
  const [itemLoading, setItemLoading] = useState(true);
  const [search, setSearch]     = useState("");

  // ── Cart ────────────────────────────────────────────────────────────────────
  const [cart, setCart]         = useState<CartLine[]>([]);
  const [priceTier, setPriceTier] = useState<PriceTier>("retail");
  const [payType, setPayType]   = useState<"bayar" | "pinjam">("bayar");
  const [notes, setNotes]       = useState("");

  // ── Submit ──────────────────────────────────────────────────────────────────
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [submitOk, setSubmitOk]   = useState(false);

  // ── Transfer history ────────────────────────────────────────────────────────
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [txLoading, setTxLoading] = useState(true);

  // ── Load warehouse inventory ─────────────────────────────────────────────────
  const loadItems = useCallback(async () => {
    if (!ownerId) return;
    setItemLoading(true);
    try {
      const snap = await getDocs(
        query(collection(firebaseDb(), `owners/${ownerId}/inventoryItems`), orderBy("name", "asc"))
      );
      setItems(
        snap.docs
          .map((d) => ({ id: d.id, ...(d.data() as Omit<WarehouseItem, "id">) }))
          .filter((i) => i.isActive !== false)
      );
    } finally { setItemLoading(false); }
  }, [ownerId]);

  // ── Load transfer history ───────────────────────────────────────────────────
  const loadTransfers = useCallback(async () => {
    if (!ownerId) return;
    setTxLoading(true);
    try {
      const snap = await getDocs(
        query(
          collection(firebaseDb(), `owners/${ownerId}/productTransfers`),
          orderBy("createdAt", "desc"),
          limit(20)
        )
      );
      setTransfers(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Transfer, "id">) })));
    } finally { setTxLoading(false); }
  }, [ownerId]);

  useEffect(() => {
    loadItems();
    loadTransfers();
  }, [loadItems, loadTransfers]);

  // ── Cart helpers ────────────────────────────────────────────────────────────
  const subtotal = cart.reduce((s, l) => s + l.qty * l.unitPrice, 0);

  function getUnitPrice(item: WarehouseItem, tier: PriceTier) {
    return item.prices?.[tier] ?? item.prices?.retail ?? 0;
  }

  function addToCart(item: WarehouseItem) {
    setCart((prev) => {
      const idx = prev.findIndex((l) => l.item.id === item.id);
      if (idx >= 0) {
        const cur = prev[idx]!;
        if (cur.qty >= item.currentStock) return prev;
        return prev.map((l, i) => i === idx ? { ...l, qty: l.qty + 1 } : l);
      }
      return [...prev, { item, qty: 1, unitPrice: getUnitPrice(item, priceTier) }];
    });
  }

  function setQty(itemId: string, qty: number) {
    if (qty <= 0) {
      setCart((prev) => prev.filter((l) => l.item.id !== itemId));
    } else {
      const max = items.find((i) => i.id === itemId)?.currentStock ?? 0;
      setCart((prev) => prev.map((l) =>
        l.item.id === itemId ? { ...l, qty: Math.min(qty, max) } : l
      ));
    }
  }

  function changeTier(tier: PriceTier) {
    setPriceTier(tier);
    setCart((prev) => prev.map((l) => ({
      ...l,
      unitPrice: getUnitPrice(l.item, tier),
    })));
  }

  function clearCart() {
    setCart([]);
    setNotes("");
    setSubmitError("");
    setSubmitOk(false);
  }

  const filteredItems = useMemo(() => {
    const q = search.toLowerCase();
    return items.filter(
      (i) => !q || i.name.toLowerCase().includes(q)
    );
  }, [items, search]);

  // ── Submit transfer ─────────────────────────────────────────────────────────
  async function handleSubmit() {
    if (!ownerId || !clubId || cart.length === 0) return;
    setSubmitting(true);
    setSubmitError("");
    setSubmitOk(false);
    try {
      await callFunction("productTransfer_create", {
        ownerId,
        requestId:  uuidv4(),
        operationId: uuidv4(),
        destinationType: "club",
        destinationClubId: clubId,
        paymentType: payType,
        priceTier,
        notes: notes.trim() || undefined,
        items: cart.map((l) => ({
          productId:        l.item.id,
          productCatalogId: l.item.productCatalogId ?? undefined,
          productName:      l.item.name,
          quantity:         l.qty,
          unitPrice:        l.unitPrice,
          subtotal:         l.qty * l.unitPrice,
        })),
      });
      setSubmitOk(true);
      clearCart();
      await Promise.all([loadItems(), loadTransfers()]);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Gagal membuat transfer");
    } finally {
      setSubmitting(false);
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="max-w-6xl space-y-6">

      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900">↔️ Transfer Produk</h1>
        <p className="text-sm text-slate-400 mt-0.5">
          Kirim produk dari gudang owner ke stok club
        </p>
      </div>

      <div className="flex gap-5 items-start">

        {/* ── Left: warehouse catalog ─────────────────────────────────────── */}
        <div className="flex-1 min-w-0 space-y-3">
          <div className="flex items-center gap-3">
            <div className="relative flex-1">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none">🔍</span>
              <input
                className="w-full pl-9 pr-3 py-2.5 text-sm border border-slate-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder:text-slate-400"
                placeholder="Cari produk di gudang…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="flex gap-1">
              {(Object.keys(TIER_LABELS) as PriceTier[]).map((t) => (
                <button
                  key={t}
                  onClick={() => changeTier(t)}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-bold transition ${
                    priceTier === t
                      ? "bg-slate-800 text-white"
                      : "bg-slate-100 text-slate-500 hover:bg-slate-200"
                  }`}
                >
                  {TIER_LABELS[t]}
                </button>
              ))}
            </div>
          </div>

          {itemLoading ? (
            <div className="flex items-center justify-center py-16">
              <div className="w-7 h-7 border-2 border-slate-200 border-t-blue-500 rounded-full animate-spin" />
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center">
              <p className="text-3xl mb-2">📦</p>
              <p className="text-sm text-slate-400">
                {items.length === 0 ? "Gudang owner kosong. Tambahkan produk di halaman Inventaris." : "Tidak ada produk yang cocok."}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 xl:grid-cols-3 gap-2.5">
              {filteredItems.map((item) => {
                const inCart   = cart.find((l) => l.item.id === item.id);
                const outOfStock = item.currentStock <= 0;
                const price    = getUnitPrice(item, priceTier);
                return (
                  <div
                    key={item.id}
                    onClick={() => !outOfStock && !inCart && addToCart(item)}
                    className={`relative rounded-2xl border-2 p-3.5 transition select-none ${
                      outOfStock   ? "border-slate-200 bg-slate-50 opacity-40 cursor-not-allowed"
                      : inCart     ? "border-teal-400 bg-teal-50 shadow-sm"
                      : "border-slate-200 bg-white hover:border-slate-300 hover:shadow-md cursor-pointer"
                    }`}
                  >
                    <span className={`absolute top-2.5 right-2.5 text-xs font-bold px-1.5 py-0.5 rounded-full leading-none ${
                      outOfStock  ? "bg-red-100 text-red-500"
                      : item.currentStock <= 5 ? "bg-amber-100 text-amber-600"
                      : "bg-slate-100 text-slate-400"
                    }`}>
                      {outOfStock ? "Habis" : item.currentStock}
                    </span>

                    <p className="text-sm font-bold text-slate-800 pr-10 leading-snug mb-2 min-h-[2.5rem] line-clamp-2">
                      {item.name}
                    </p>
                    <p className="text-base font-bold text-teal-700 mb-2">{fmtIdr(price)}</p>

                    {inCart ? (
                      <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() => setQty(item.id, inCart.qty - 1)}
                          className="w-7 h-7 rounded-full bg-white border border-slate-200 text-slate-600 text-sm font-bold flex items-center justify-center hover:bg-red-50 hover:text-red-500 hover:border-red-200 transition"
                        >−</button>
                        <span className="flex-1 text-center text-sm font-bold text-slate-800">{inCart.qty}</span>
                        <button
                          onClick={() => setQty(item.id, inCart.qty + 1)}
                          disabled={inCart.qty >= item.currentStock}
                          className="w-7 h-7 rounded-full bg-teal-600 text-white text-sm font-bold flex items-center justify-center hover:bg-teal-700 disabled:opacity-30 transition"
                        >+</button>
                      </div>
                    ) : (
                      !outOfStock && <p className="text-xs text-slate-300 text-center">tap untuk tambah</p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Right: transfer panel ───────────────────────────────────────── */}
        <div className="w-80 shrink-0 flex flex-col gap-3">
          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">

            {/* Panel header */}
            <div className="px-4 pt-4 pb-3 border-b border-slate-100">
              <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">📦 Produk yang Ditransfer</p>
            </div>

            {/* Cart items */}
            <div className="min-h-[100px]">
              {cart.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 text-slate-300 gap-2">
                  <span className="text-4xl">↔️</span>
                  <p className="text-xs font-medium">Pilih produk dari katalog</p>
                </div>
              ) : (
                <div className="p-3 space-y-1.5">
                  <div className="flex justify-between px-1 mb-1">
                    <p className="text-xs font-bold text-slate-400 uppercase">{cart.length} produk</p>
                    <button onClick={clearCart} className="text-xs text-red-400 hover:text-red-600 font-semibold">
                      Kosongkan
                    </button>
                  </div>
                  {cart.map((line) => (
                    <div key={line.item.id} className="flex items-center gap-2 bg-slate-50 rounded-xl px-3 py-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-slate-800 truncate">{line.item.name}</p>
                        <p className="text-xs text-slate-400">{fmtIdr(line.unitPrice)} / unit</p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={() => setQty(line.item.id, line.qty - 1)}
                          className="w-6 h-6 rounded-full bg-white border border-slate-200 text-slate-600 text-sm font-bold flex items-center justify-center hover:bg-red-50 hover:text-red-500 transition"
                        >−</button>
                        <span className="w-5 text-center text-sm font-bold text-slate-800">{line.qty}</span>
                        <button
                          onClick={() => setQty(line.item.id, line.qty + 1)}
                          disabled={line.qty >= line.item.currentStock}
                          className="w-6 h-6 rounded-full bg-slate-700 text-white text-sm font-bold flex items-center justify-center hover:bg-slate-900 disabled:opacity-30 transition"
                        >+</button>
                      </div>
                      <p className="text-xs font-bold text-slate-800 w-14 text-right shrink-0">
                        {fmtIdr(line.qty * line.unitPrice)}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Options & submit */}
            {cart.length > 0 && (
              <div className="border-t border-slate-100 p-4 space-y-3">
                {/* Subtotal */}
                <div className="flex justify-between text-sm font-bold text-slate-800">
                  <span>Total</span>
                  <span>{fmtIdr(subtotal)}</span>
                </div>

                {/* Payment type */}
                <div className="flex gap-2">
                  {(["bayar", "pinjam"] as const).map((pt) => (
                    <button
                      key={pt}
                      onClick={() => setPayType(pt)}
                      className={`flex-1 py-2 rounded-xl text-xs font-semibold border transition ${
                        payType === pt
                          ? "border-slate-800 bg-slate-900 text-white"
                          : "border-slate-200 text-slate-500 hover:border-slate-400"
                      }`}
                    >
                      {pt === "bayar" ? "💳 Bayar" : "🤝 Pinjam"}
                    </button>
                  ))}
                </div>

                {/* Notes */}
                <input
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm bg-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-500"
                  placeholder="Catatan (opsional)"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />

                {submitError && (
                  <p className="text-xs text-red-600 bg-red-50 rounded-xl px-3 py-2">{submitError}</p>
                )}
                {submitOk && (
                  <p className="text-xs text-green-600 bg-green-50 rounded-xl px-3 py-2 font-semibold">
                    ✓ Transfer berhasil dikirim ke club
                  </p>
                )}

                <button
                  onClick={handleSubmit}
                  disabled={submitting || cart.length === 0}
                  className="w-full bg-teal-600 text-white rounded-xl py-3 text-sm font-bold hover:bg-teal-700 disabled:opacity-40 transition shadow-sm"
                >
                  {submitting ? "⏳ Memproses…" : `✓ Transfer ${cart.length} Produk ke Club`}
                </button>
              </div>
            )}
          </div>

          {/* Info box */}
          <div className="bg-slate-50 rounded-xl border border-slate-200 px-4 py-3 text-xs text-slate-500 space-y-1 leading-relaxed">
            <p><strong>Bayar</strong> — stok dipotong dari gudang, dijurnal sebagai pendapatan</p>
            <p><strong>Pinjam</strong> — stok dipotong dari gudang, tidak ada jurnal keuangan</p>
          </div>
        </div>
      </div>

      {/* ── Transfer history ─────────────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <h3 className="font-semibold text-slate-800">Riwayat Transfer</h3>
          <button
            onClick={loadTransfers}
            className="text-xs text-slate-400 hover:text-blue-600 transition"
          >
            ↻ Refresh
          </button>
        </div>

        {txLoading ? (
          <div className="flex items-center justify-center py-10">
            <div className="w-6 h-6 border-2 border-slate-200 border-t-teal-500 rounded-full animate-spin" />
          </div>
        ) : transfers.length === 0 ? (
          <div className="text-center py-10">
            <p className="text-2xl mb-2">↔️</p>
            <p className="text-sm text-slate-400">Belum ada transfer tercatat</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs">
              <tr>
                <th className="px-5 py-3 text-left font-semibold">Tanggal</th>
                <th className="px-5 py-3 text-left font-semibold">Produk</th>
                <th className="px-5 py-3 text-left font-semibold">Tipe</th>
                <th className="px-5 py-3 text-right font-semibold">Total</th>
                <th className="px-5 py-3 text-center font-semibold">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {transfers.map((tx) => (
                <tr key={tx.id} className="hover:bg-slate-50 transition">
                  <td className="px-5 py-3 text-xs text-slate-400 whitespace-nowrap">
                    {tx.createdAt?.slice(0, 16).replace("T", " ")}
                  </td>
                  <td className="px-5 py-3 text-xs text-slate-600 max-w-xs truncate">
                    {tx.items?.length > 0
                      ? tx.items.map((i) => `${i.productName} ×${i.quantity}`).join(", ")
                      : "—"}
                  </td>
                  <td className="px-5 py-3">
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                      tx.paymentType === "bayar" ? "bg-blue-50 text-blue-700" : "bg-slate-100 text-slate-600"
                    }`}>
                      {tx.paymentType === "bayar" ? "Bayar" : "Pinjam"}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-right font-bold text-slate-800 text-xs">
                    {fmtIdr(tx.total ?? 0)}
                  </td>
                  <td className="px-5 py-3 text-center">
                    <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-full ${STATUS_STYLE[tx.status] ?? "bg-slate-100 text-slate-500"}`}>
                      {STATUS_LABEL[tx.status] ?? tx.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
