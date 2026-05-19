"use client";

import { useEffect, useState } from "react";
import { collection, getDocs, orderBy, query } from "firebase/firestore";
import { callFunction, firebaseDb } from "@/firebase/firebase";

interface PriceTiers {
  retail: number;
  ds: number;
  sc: number;
  sbQp: number;
  spv: number;
}

interface CatalogProduct {
  id: string;
  name: string;
  category: string;
  prices: PriceTiers;
  isActive: boolean;
}

const CATEGORIES = ["Inner Nutrition", "Outer Nutrition", "Accessories"] as const;
const TIER_LABELS: { key: keyof PriceTiers; label: string }[] = [
  { key: "retail", label: "Retail" },
  { key: "ds", label: "DS" },
  { key: "sc", label: "SC" },
  { key: "sbQp", label: "SB-QP" },
  { key: "spv", label: "SPV" },
];

const emptyPrices = (): PriceTiers => ({ retail: 0, ds: 0, sc: 0, sbQp: 0, spv: 0 });

const fmt = (n: number) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);

export default function AdminCatalogPage() {
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<{ type: "ok" | "err"; msg: string } | undefined>();

  // Create form
  const [name, setName] = useState("");
  const [category, setCategory] = useState<typeof CATEGORIES[number]>("Inner Nutrition");
  const [prices, setPrices] = useState<PriceTiers>(emptyPrices());
  const [createLoading, setCreateLoading] = useState(false);

  // Edit
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editCategory, setEditCategory] = useState<typeof CATEGORIES[number]>("Inner Nutrition");
  const [editPrices, setEditPrices] = useState<PriceTiers>(emptyPrices());
  const [editLoading, setEditLoading] = useState(false);

  async function load() {
    setLoading(true);
    const snap = await getDocs(query(collection(firebaseDb(), "productCatalog"), orderBy("createdAt", "desc")));
    setProducts(snap.docs.map((d) => ({ id: d.id, ...d.data() } as CatalogProduct)));
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  function setPrice(tier: keyof PriceTiers, val: string, target: "create" | "edit") {
    const n = parseFloat(val) || 0;
    if (target === "create") setPrices((p) => ({ ...p, [tier]: n }));
    else setEditPrices((p) => ({ ...p, [tier]: n }));
  }

  async function handleCreate() {
    if (!name.trim()) { setFeedback({ type: "err", msg: "Nama produk wajib diisi" }); return; }
    setCreateLoading(true);
    setFeedback(undefined);
    try {
      await callFunction("catalog_createProduct", { name: name.trim(), category, prices });
      setFeedback({ type: "ok", msg: `"${name}" berhasil ditambahkan ke katalog` });
      setName(""); setPrices(emptyPrices());
      load();
    } catch (err) {
      setFeedback({ type: "err", msg: err instanceof Error ? err.message : "Gagal" });
    } finally { setCreateLoading(false); }
  }

  function startEdit(p: CatalogProduct) {
    setEditId(p.id);
    setEditName(p.name);
    setEditCategory(p.category as typeof CATEGORIES[number]);
    setEditPrices({ ...p.prices });
  }

  async function handleSaveEdit() {
    if (!editId) return;
    setEditLoading(true);
    try {
      await callFunction("catalog_updateProduct", {
        productId: editId, name: editName, category: editCategory, prices: editPrices,
      });
      setEditId(null);
      load();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Gagal menyimpan");
    } finally { setEditLoading(false); }
  }

  async function handleToggle(p: CatalogProduct) {
    try {
      await callFunction("catalog_toggleActive", { productId: p.id });
      load();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Gagal");
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-slate-900">Katalog Produk Global</h2>
        <button onClick={load} className="text-xs text-blue-600 hover:underline">Refresh</button>
      </div>

      {/* Product list */}
      <div className="bg-white rounded-xl border border-slate-200 mb-8 overflow-hidden">
        {loading ? (
          <p className="text-sm text-slate-400 p-4">Memuat…</p>
        ) : products.length === 0 ? (
          <p className="text-sm text-slate-400 p-4">Belum ada produk di katalog.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs">
              <tr>
                <th className="px-4 py-2 text-left">Nama</th>
                <th className="px-4 py-2 text-left">Kategori</th>
                {TIER_LABELS.map((t) => (
                  <th key={t.key} className="px-3 py-2 text-right">{t.label}</th>
                ))}
                <th className="px-4 py-2 text-left">Status</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {products.map((p) =>
                editId === p.id ? (
                  <tr key={p.id} className="bg-blue-50">
                    <td className="px-4 py-2">
                      <input className="w-full border border-slate-200 rounded px-2 py-1 text-sm" value={editName} onChange={(e) => setEditName(e.target.value)} />
                    </td>
                    <td className="px-4 py-2">
                      <select className="border border-slate-200 rounded px-2 py-1 text-sm" value={editCategory} onChange={(e) => setEditCategory(e.target.value as typeof CATEGORIES[number])}>
                        {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
                      </select>
                    </td>
                    {TIER_LABELS.map((t) => (
                      <td key={t.key} className="px-3 py-2">
                        <input type="number" className="w-24 border border-slate-200 rounded px-2 py-1 text-sm text-right" value={editPrices[t.key]} onChange={(e) => setPrice(t.key, e.target.value, "edit")} />
                      </td>
                    ))}
                    <td className="px-4 py-2"></td>
                    <td className="px-4 py-2 flex gap-2">
                      <button onClick={handleSaveEdit} disabled={editLoading} className="text-xs bg-blue-600 text-white px-3 py-1.5 rounded-lg hover:bg-blue-700 disabled:opacity-50">
                        {editLoading ? "…" : "Simpan"}
                      </button>
                      <button onClick={() => setEditId(null)} className="text-xs text-slate-500 hover:text-slate-800">Batal</button>
                    </td>
                  </tr>
                ) : (
                  <tr key={p.id} className={`hover:bg-slate-50 ${!p.isActive ? "opacity-50" : ""}`}>
                    <td className="px-4 py-2.5 font-medium">{p.name}</td>
                    <td className="px-4 py-2.5 text-slate-500 text-xs">{p.category}</td>
                    {TIER_LABELS.map((t) => (
                      <td key={t.key} className="px-3 py-2.5 text-right text-slate-700 font-mono text-xs">
                        {fmt(p.prices[t.key])}
                      </td>
                    ))}
                    <td className="px-4 py-2.5">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${p.isActive ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-500"}`}>
                        {p.isActive ? "Aktif" : "Nonaktif"}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 flex gap-2 items-center">
                      <button onClick={() => startEdit(p)} className="text-xs text-blue-600 hover:underline">Edit</button>
                      <button onClick={() => handleToggle(p)} className="text-xs text-slate-400 hover:text-slate-700">
                        {p.isActive ? "Nonaktifkan" : "Aktifkan"}
                      </button>
                    </td>
                  </tr>
                )
              )}
            </tbody>
          </table>
        )}
      </div>

      {/* Create form */}
      <div className="bg-white rounded-xl border border-slate-200 p-6 max-w-2xl">
        <h3 className="font-semibold text-slate-800 mb-4">Tambah Produk ke Katalog</h3>
        {feedback && (
          <div className={`mb-4 text-sm rounded-lg px-3 py-2 ${feedback.type === "ok" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"}`}>
            {feedback.msg}
          </div>
        )}
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <input className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" placeholder="Nama Produk *" value={name} onChange={(e) => setName(e.target.value)} />
            <select className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" value={category} onChange={(e) => setCategory(e.target.value as typeof CATEGORIES[number])}>
              {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Harga per Tier</p>
            <div className="grid grid-cols-5 gap-2">
              {TIER_LABELS.map((t) => (
                <div key={t.key}>
                  <label className="block text-xs text-slate-500 mb-1">{t.label}</label>
                  <input
                    type="number"
                    className="w-full border border-slate-200 rounded-lg px-2 py-2 text-sm"
                    placeholder="0"
                    value={prices[t.key] || ""}
                    onChange={(e) => setPrice(t.key, e.target.value, "create")}
                  />
                </div>
              ))}
            </div>
          </div>
          <button onClick={handleCreate} disabled={createLoading} className="w-full bg-blue-600 text-white rounded-lg py-2.5 text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition">
            {createLoading ? "Menyimpan…" : "Tambah ke Katalog"}
          </button>
        </div>
      </div>
    </div>
  );
}
