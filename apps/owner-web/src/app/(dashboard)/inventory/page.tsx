"use client";

import { useEffect, useState } from "react";
import { collection, getDocs, query, orderBy } from "firebase/firestore";
import { useOwnerAuthStore } from "@/store/auth.store";
import { callFunction, firebaseDb } from "@/firebase/firebase";
import { v4 as uuidv4 } from "uuid";

interface InventoryItem {
  id: string;
  name: string;
  sku: string;
  unit: string;
  currentStock: number;
  minimumStock: number;
  costPerUnit: number;
  isActive: boolean;
}

export default function InventoryPage() {
  const { ownerId, clubId } = useOwnerAuthStore();
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loadingList, setLoadingList] = useState(true);

  const [name, setName] = useState("");
  const [sku, setSku] = useState("");
  const [unit, setUnit] = useState("");
  const [minimumStock, setMinimumStock] = useState("");
  const [costPerUnit, setCostPerUnit] = useState("");
  const [createLoading, setCreateLoading] = useState(false);
  const [createFeedback, setCreateFeedback] = useState<{ type: "ok" | "err"; msg: string } | undefined>();

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

  useEffect(() => { loadItems(); }, [ownerId, clubId]);

  async function handleCreate() {
    if (!name || !sku || !unit) {
      setCreateFeedback({ type: "err", msg: "Nama, SKU, dan satuan wajib diisi" });
      return;
    }
    setCreateLoading(true);
    setCreateFeedback(undefined);
    try {
      await callFunction("inventory_createItem", {
        ownerId, clubId, name, sku, unit,
        minimumStock: parseFloat(minimumStock) || 0,
        costPerUnit: parseFloat(costPerUnit) || 0,
      });
      setCreateFeedback({ type: "ok", msg: `Item "${name}" berhasil dibuat` });
      setName(""); setSku(""); setUnit(""); setMinimumStock(""); setCostPerUnit("");
      loadItems();
    } catch (err) {
      setCreateFeedback({ type: "err", msg: err instanceof Error ? err.message : "Gagal" });
    } finally { setCreateLoading(false); }
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

  const fmt = (n: number) => new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);

  return (
    <div>
      <h2 className="text-2xl font-bold text-slate-900 mb-6">Inventaris</h2>

      <div className="bg-white rounded-xl border border-slate-200 mb-6 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
          <h3 className="font-semibold text-slate-800">Daftar Item</h3>
          <button onClick={loadItems} className="text-xs text-blue-600 hover:underline">Refresh</button>
        </div>
        {loadingList ? (
          <p className="text-sm text-slate-400 p-4">Memuat…</p>
        ) : items.length === 0 ? (
          <p className="text-sm text-slate-400 p-4">Belum ada item.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs">
              <tr>
                <th className="px-4 py-2 text-left">Nama</th>
                <th className="px-4 py-2 text-left">SKU</th>
                <th className="px-4 py-2 text-left">Satuan</th>
                <th className="px-4 py-2 text-right">Stok</th>
                <th className="px-4 py-2 text-right">Min. Stok</th>
                <th className="px-4 py-2 text-right">Harga/Unit</th>
                <th className="px-4 py-2 text-left">ID</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((item) => {
                const lowStock = item.currentStock <= item.minimumStock;
                return (
                  <tr key={item.id} className={`hover:bg-slate-50 ${lowStock ? "bg-red-50/40" : ""}`}>
                    <td className="px-4 py-2 font-medium">{item.name}</td>
                    <td className="px-4 py-2 font-mono text-xs text-slate-500">{item.sku}</td>
                    <td className="px-4 py-2 text-slate-500">{item.unit}</td>
                    <td className={`px-4 py-2 text-right font-semibold ${lowStock ? "text-red-600" : "text-slate-800"}`}>{item.currentStock}</td>
                    <td className="px-4 py-2 text-right text-slate-400">{item.minimumStock}</td>
                    <td className="px-4 py-2 text-right text-slate-500">{fmt(item.costPerUnit)}</td>
                    <td className="px-4 py-2 font-mono text-xs text-slate-400">{item.id}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="grid grid-cols-2 gap-6 max-w-2xl">
        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <h3 className="font-semibold text-slate-800 mb-4">Tambah Item Baru</h3>
          {createFeedback && (
            <div className={`mb-3 text-sm rounded-lg px-3 py-2 ${createFeedback.type === "ok" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"}`}>
              {createFeedback.msg}
            </div>
          )}
          <div className="space-y-3">
            <input className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" placeholder="Nama Item" value={name} onChange={(e) => setName(e.target.value)} />
            <div className="grid grid-cols-2 gap-3">
              <input className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" placeholder="SKU" value={sku} onChange={(e) => setSku(e.target.value)} />
              <input className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" placeholder="Satuan (pcs, kg…)" value={unit} onChange={(e) => setUnit(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <input type="number" className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" placeholder="Min. Stok" value={minimumStock} onChange={(e) => setMinimumStock(e.target.value)} />
              <input type="number" className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" placeholder="Harga/Unit (Rp)" value={costPerUnit} onChange={(e) => setCostPerUnit(e.target.value)} />
            </div>
            <button onClick={handleCreate} disabled={createLoading} className="w-full bg-orange-600 text-white rounded-lg py-2.5 text-sm font-semibold hover:bg-orange-700 disabled:opacity-50 transition">
              {createLoading ? "Menyimpan…" : "Tambah Item"}
            </button>
          </div>
        </div>

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
