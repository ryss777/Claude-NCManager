"use client";

import { useEffect, useState } from "react";
import { collection, getDocs, query, orderBy } from "firebase/firestore";
import { useOwnerAuthStore } from "@/store/auth.store";
import { callFunction, firebaseDb } from "@/firebase/firebase";
import { v4 as uuidv4 } from "uuid";

interface PriceTiers {
  retail: number;
  ds: number;
  sc: number;
  sbQp: number;
  spv: number;
}

interface InventoryItem {
  id: string;
  name: string;
  category: string | null;
  prices: PriceTiers;
  unit: string;
  currentStock: number;
  minimumStock: number;
  isActive: boolean;
}

interface CatalogProduct {
  id: string;
  name: string;
  category: string;
  prices: PriceTiers;
}

const TIER_LABELS: { key: keyof PriceTiers; label: string }[] = [
  { key: "retail", label: "Retail" },
  { key: "ds", label: "DS" },
  { key: "sc", label: "SC" },
  { key: "sbQp", label: "SB-QP" },
  { key: "spv", label: "SPV" },
];

const fmt = (n: number) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);

export default function InventoryPage() {
  const { ownerId, clubId } = useOwnerAuthStore();
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [catalog, setCatalog] = useState<CatalogProduct[]>([]);
  const [loadingList, setLoadingList] = useState(true);

  // Add from catalog
  const [addingId, setAddingId] = useState<string | null>(null);
  const [unit, setUnit] = useState("pcs");
  const [minimumStock, setMinimumStock] = useState("");
  const [addLoading, setAddLoading] = useState(false);
  const [addFeedback, setAddFeedback] = useState<{ type: "ok" | "err"; msg: string } | undefined>();

  // Adjust stock
  const [adjustItemId, setAdjustItemId] = useState("");
  const [newStock, setNewStock] = useState("");
  const [adjustLoading, setAdjustLoading] = useState(false);
  const [adjustFeedback, setAdjustFeedback] = useState<{ type: "ok" | "err"; msg: string } | undefined>();

  async function loadItems() {
    if (!ownerId || !clubId) return;
    setLoadingList(true);
    const snap = await getDocs(
      query(collection(firebaseDb(), `owners/${ownerId}/clubs/${clubId}/inventoryItems`), orderBy("createdAt", "desc"))
    );
    setItems(snap.docs.map((d) => ({ id: d.id, ...d.data() } as InventoryItem)));
    setLoadingList(false);
  }

  async function loadCatalog() {
    const snap = await getDocs(query(collection(firebaseDb(), "productCatalog"), orderBy("name")));
    setCatalog(snap.docs.map((d) => ({ id: d.id, ...d.data() } as CatalogProduct)));
  }

  useEffect(() => {
    loadItems();
    loadCatalog();
  }, [ownerId, clubId]);

  const addedIds = new Set(items.map((i) => (i as unknown as { productCatalogId?: string }).productCatalogId).filter(Boolean));
  const availableCatalog = catalog.filter((p) => !addedIds.has(p.id));

  async function handleAddFromCatalog(productCatalogId: string) {
    setAddLoading(true);
    setAddFeedback(undefined);
    try {
      await callFunction("inventory_addFromCatalog", {
        ownerId, clubId, productCatalogId,
        unit: unit || "pcs",
        minimumStock: parseFloat(minimumStock) || 0,
      });
      const prod = catalog.find((p) => p.id === productCatalogId);
      setAddFeedback({ type: "ok", msg: `"${prod?.name}" berhasil ditambahkan ke inventaris` });
      setAddingId(null); setUnit("pcs"); setMinimumStock("");
      loadItems();
    } catch (err) {
      setAddFeedback({ type: "err", msg: err instanceof Error ? err.message : "Gagal" });
    } finally { setAddLoading(false); }
  }

  async function handleAdjust() {
    const qty = parseInt(newStock, 10);
    if (!adjustItemId || isNaN(qty) || qty < 0) {
      setAdjustFeedback({ type: "err", msg: "Pilih item dan isi stok baru yang valid" });
      return;
    }
    setAdjustLoading(true);
    setAdjustFeedback(undefined);
    try {
      await callFunction("inventory_adjustStock", {
        ownerId, clubId,
        requestId: uuidv4(),
        operationId: uuidv4(),
        inventoryItemId: adjustItemId,
        quantity: qty,
        unitCost: 0,
      });
      setAdjustFeedback({ type: "ok", msg: `Stok diperbarui menjadi ${qty}` });
      setAdjustItemId(""); setNewStock("");
      loadItems();
    } catch (err) {
      setAdjustFeedback({ type: "err", msg: err instanceof Error ? err.message : "Gagal" });
    } finally { setAdjustLoading(false); }
  }

  return (
    <div>
      <h2 className="text-2xl font-bold text-slate-900 mb-6">Produk &amp; Stok</h2>

      {/* Current inventory */}
      <div className="bg-white rounded-xl border border-slate-200 mb-6 overflow-x-auto">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
          <h3 className="font-semibold text-slate-800">Stok Saat Ini</h3>
          <button onClick={loadItems} className="text-xs text-blue-600 hover:underline">Refresh</button>
        </div>
        {loadingList ? (
          <p className="text-sm text-slate-400 p-4">Memuat…</p>
        ) : items.length === 0 ? (
          <p className="text-sm text-slate-400 p-4">Belum ada produk. Tambahkan dari katalog di bawah.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs">
              <tr>
                <th className="px-4 py-2 text-left">Nama</th>
                <th className="px-4 py-2 text-left">Kategori</th>
                <th className="px-4 py-2 text-left">Satuan</th>
                {TIER_LABELS.map((t) => (
                  <th key={t.key} className="px-3 py-2 text-right">{t.label}</th>
                ))}
                <th className="px-4 py-2 text-right">Stok</th>
                <th className="px-4 py-2 text-right">Min.</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((item) => {
                const lowStock = item.currentStock <= item.minimumStock;
                return (
                  <tr key={item.id} className={`hover:bg-slate-50 ${lowStock ? "bg-red-50/40" : ""}`}>
                    <td className="px-4 py-2 font-medium">{item.name}</td>
                    <td className="px-4 py-2 text-slate-500 text-xs">{item.category ?? "—"}</td>
                    <td className="px-4 py-2 text-slate-500">{item.unit}</td>
                    {TIER_LABELS.map((t) => (
                      <td key={t.key} className="px-3 py-2 text-right font-mono text-xs text-slate-600">
                        {item.prices ? fmt(item.prices[t.key]) : "—"}
                      </td>
                    ))}
                    <td className={`px-4 py-2 text-right font-semibold ${lowStock ? "text-red-600" : "text-slate-800"}`}>
                      {item.currentStock}
                    </td>
                    <td className="px-4 py-2 text-right text-slate-400">{item.minimumStock}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="grid grid-cols-2 gap-6">
        {/* Add from catalog */}
        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <h3 className="font-semibold text-slate-800 mb-1">Tambah dari Katalog</h3>
          <p className="text-xs text-slate-400 mb-4">Pilih produk dari katalog global untuk ditambahkan ke stok klub ini.</p>
          {addFeedback && (
            <div className={`mb-3 text-sm rounded-lg px-3 py-2 ${addFeedback.type === "ok" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"}`}>
              {addFeedback.msg}
            </div>
          )}
          {availableCatalog.length === 0 ? (
            <p className="text-sm text-slate-400">Semua produk dari katalog sudah ditambahkan.</p>
          ) : (
            <div className="space-y-2">
              {availableCatalog.map((p) => (
                <div key={p.id} className="border border-slate-200 rounded-lg p-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-sm font-medium text-slate-800">{p.name}</p>
                      <p className="text-xs text-slate-400">{p.category} · Retail {fmt(p.prices.retail)}</p>
                    </div>
                    <button
                      onClick={() => { setAddingId(addingId === p.id ? null : p.id); setAddFeedback(undefined); }}
                      className="text-xs text-blue-600 hover:underline shrink-0 ml-2"
                    >
                      {addingId === p.id ? "Batal" : "Tambah"}
                    </button>
                  </div>
                  {addingId === p.id && (
                    <div className="mt-3 pt-3 border-t border-slate-100 flex gap-2">
                      <input
                        className="flex-1 border border-slate-200 rounded-lg px-2 py-1.5 text-sm"
                        placeholder="Satuan (pcs, kg…)"
                        value={unit}
                        onChange={(e) => setUnit(e.target.value)}
                      />
                      <input
                        type="number"
                        className="w-24 border border-slate-200 rounded-lg px-2 py-1.5 text-sm"
                        placeholder="Min. Stok"
                        value={minimumStock}
                        onChange={(e) => setMinimumStock(e.target.value)}
                      />
                      <button
                        onClick={() => handleAddFromCatalog(p.id)}
                        disabled={addLoading}
                        className="bg-orange-600 text-white text-xs px-4 py-1.5 rounded-lg hover:bg-orange-700 disabled:opacity-50 transition"
                      >
                        {addLoading ? "…" : "Simpan"}
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Adjust stock */}
        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <h3 className="font-semibold text-slate-800 mb-1">Sesuaikan Stok</h3>
          <p className="text-xs text-slate-400 mb-4">Set stok absolut berdasarkan hitung fisik.</p>
          {adjustFeedback && (
            <div className={`mb-3 text-sm rounded-lg px-3 py-2 ${adjustFeedback.type === "ok" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"}`}>
              {adjustFeedback.msg}
            </div>
          )}
          <div className="space-y-3">
            <select className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" value={adjustItemId} onChange={(e) => setAdjustItemId(e.target.value)}>
              <option value="">— Pilih Item —</option>
              {items.filter((i) => i.isActive).map((i) => (
                <option key={i.id} value={i.id}>{i.name} (stok: {i.currentStock})</option>
              ))}
            </select>
            <input type="number" className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" placeholder="Stok Baru" value={newStock} onChange={(e) => setNewStock(e.target.value)} />
            <button onClick={handleAdjust} disabled={adjustLoading} className="w-full bg-slate-700 text-white rounded-lg py-2.5 text-sm font-semibold hover:bg-slate-800 disabled:opacity-50 transition">
              {adjustLoading ? "Menyimpan…" : "Sesuaikan"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
