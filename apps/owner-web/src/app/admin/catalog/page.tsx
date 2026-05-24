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

interface TakaranRow {
  name: string;   // "scoop", "sajian", …
  amount: number; // in baseUnit (g or ml)
}

interface CatalogProduct {
  id: string;
  name: string;
  category: string;
  prices: PriceTiers;
  isActive: boolean;
  // Serving data (optional)
  netWeight?: number | null;
  baseUnit?: "g" | "ml" | null;
  servingsPerContainer?: number | null;
  takaran?: TakaranRow[] | null;
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
const emptyTakaran = (): TakaranRow => ({ name: "", amount: 0 });

const fmt = (n: number) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);

// ── Takaran sub-form ──────────────────────────────────────────────────────────

function TakaranForm({
  rows,
  onChange,
}: {
  rows: TakaranRow[];
  onChange: (rows: TakaranRow[]) => void;
}) {
  function update(i: number, field: keyof TakaranRow, val: string) {
    const next = rows.map((r, idx) =>
      idx === i
        ? { ...r, [field]: field === "amount" ? parseFloat(val) || 0 : val }
        : r
    );
    onChange(next);
  }
  function remove(i: number) {
    onChange(rows.filter((_, idx) => idx !== i));
  }
  return (
    <div className="space-y-2">
      {rows.map((row, i) => (
        <div key={i} className="flex gap-2 items-center">
          <input
            className="flex-1 border border-slate-200 rounded-lg px-2 py-1.5 text-sm"
            placeholder="Nama takaran (scoop, sajian, …)"
            value={row.name}
            onChange={(e) => update(i, "name", e.target.value)}
          />
          <input
            type="number"
            className="w-28 border border-slate-200 rounded-lg px-2 py-1.5 text-sm text-right"
            placeholder="Jumlah"
            value={row.amount || ""}
            onChange={(e) => update(i, "amount", e.target.value)}
          />
          <button
            type="button"
            onClick={() => remove(i)}
            className="text-slate-400 hover:text-red-500 text-lg leading-none px-1"
          >
            ×
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...rows, emptyTakaran()])}
        className="text-xs text-blue-600 hover:underline"
      >
        + Tambah takaran
      </button>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function AdminCatalogPage() {
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<{ type: "ok" | "err"; msg: string } | undefined>();

  // ── Create form state
  const [name, setName] = useState("");
  const [category, setCategory] = useState<typeof CATEGORIES[number]>("Inner Nutrition");
  const [prices, setPrices] = useState<PriceTiers>(emptyPrices());
  const [netWeight, setNetWeight] = useState("");
  const [baseUnit, setBaseUnit] = useState<"g" | "ml">("g");
  const [servingsPerContainer, setServingsPerContainer] = useState("");
  const [takaran, setTakaran] = useState<TakaranRow[]>([]);
  const [createLoading, setCreateLoading] = useState(false);

  // ── Edit state
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editCategory, setEditCategory] = useState<typeof CATEGORIES[number]>("Inner Nutrition");
  const [editPrices, setEditPrices] = useState<PriceTiers>(emptyPrices());
  const [editNetWeight, setEditNetWeight] = useState("");
  const [editBaseUnit, setEditBaseUnit] = useState<"g" | "ml">("g");
  const [editServings, setEditServings] = useState("");
  const [editTakaran, setEditTakaran] = useState<TakaranRow[]>([]);
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

  // Build serving payload (null when no data entered)
  function buildServingPayload(nw: string, bu: "g" | "ml", spc: string, tk: TakaranRow[]) {
    const nwNum = parseFloat(nw) || null;
    const spcNum = parseInt(spc) || null;
    const validTakaran = tk.filter((r) => r.name.trim() && r.amount > 0);
    if (!nwNum && !spcNum && validTakaran.length === 0) return {};
    return {
      netWeight: nwNum,
      baseUnit: nwNum ? bu : null,
      servingsPerContainer: spcNum,
      takaran: validTakaran.length > 0 ? validTakaran : null,
    };
  }

  async function handleCreate() {
    if (!name.trim()) { setFeedback({ type: "err", msg: "Nama produk wajib diisi" }); return; }
    setCreateLoading(true);
    setFeedback(undefined);
    try {
      await callFunction("catalog_createProduct", {
        name: name.trim(),
        category,
        prices,
        ...buildServingPayload(netWeight, baseUnit, servingsPerContainer, takaran),
      });
      setFeedback({ type: "ok", msg: `"${name}" berhasil ditambahkan ke katalog` });
      setName(""); setPrices(emptyPrices());
      setNetWeight(""); setServingsPerContainer(""); setTakaran([]);
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
    setEditNetWeight(p.netWeight != null ? String(p.netWeight) : "");
    setEditBaseUnit(p.baseUnit ?? "g");
    setEditServings(p.servingsPerContainer != null ? String(p.servingsPerContainer) : "");
    setEditTakaran(p.takaran ? [...p.takaran] : []);
  }

  async function handleSaveEdit() {
    if (!editId) return;
    setEditLoading(true);
    try {
      await callFunction("catalog_updateProduct", {
        productId: editId,
        name: editName,
        category: editCategory,
        prices: editPrices,
        ...buildServingPayload(editNetWeight, editBaseUnit, editServings, editTakaran),
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

  // ── Serving data summary (for table row display)
  function servingSummary(p: CatalogProduct) {
    if (!p.netWeight) return null;
    const parts: string[] = [`${p.netWeight}${p.baseUnit ?? "g"}`];
    if (p.servingsPerContainer) parts.push(`${p.servingsPerContainer}x sajian`);
    if (p.takaran?.length) {
      parts.push(p.takaran.map((t) => `1 ${t.name}=${t.amount}${p.baseUnit ?? "g"}`).join(", "));
    }
    return parts.join(" · ");
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
                <th className="px-4 py-2 text-left">Takaran</th>
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
                  // ── Edit row (full-width card below)
                  <tr key={p.id}>
                    <td colSpan={8} className="p-0">
                      <div className="bg-blue-50 border-y border-blue-200 p-5 space-y-4">
                        <p className="text-sm font-semibold text-blue-700">Edit Produk</p>

                        {/* Name + Category */}
                        <div className="grid grid-cols-2 gap-3">
                          <input
                            className="border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white"
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                          />
                          <select
                            className="border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white"
                            value={editCategory}
                            onChange={(e) => setEditCategory(e.target.value as typeof CATEGORIES[number])}
                          >
                            {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
                          </select>
                        </div>

                        {/* Prices */}
                        <div>
                          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Harga per Tier</p>
                          <div className="grid grid-cols-5 gap-2">
                            {TIER_LABELS.map((t) => (
                              <div key={t.key}>
                                <label className="block text-xs text-slate-500 mb-1">{t.label}</label>
                                <input
                                  type="number"
                                  className="w-full border border-slate-200 rounded-lg px-2 py-2 text-sm bg-white"
                                  value={editPrices[t.key] || ""}
                                  onChange={(e) => setPrice(t.key, e.target.value, "edit")}
                                />
                              </div>
                            ))}
                          </div>
                        </div>

                        {/* Serving data */}
                        <div>
                          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Data Takaran</p>
                          <div className="grid grid-cols-3 gap-3 mb-3">
                            <div>
                              <label className="block text-xs text-slate-500 mb-1">Berat bersih per kemasan</label>
                              <div className="flex gap-1">
                                <input
                                  type="number"
                                  className="flex-1 border border-slate-200 rounded-lg px-2 py-1.5 text-sm bg-white"
                                  placeholder="e.g. 550"
                                  value={editNetWeight}
                                  onChange={(e) => setEditNetWeight(e.target.value)}
                                />
                                <select
                                  className="border border-slate-200 rounded-lg px-2 py-1.5 text-sm bg-white"
                                  value={editBaseUnit}
                                  onChange={(e) => setEditBaseUnit(e.target.value as "g" | "ml")}
                                >
                                  <option value="g">g</option>
                                  <option value="ml">ml</option>
                                </select>
                              </div>
                            </div>
                            <div>
                              <label className="block text-xs text-slate-500 mb-1">Sajian per kemasan</label>
                              <input
                                type="number"
                                className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm bg-white"
                                placeholder="e.g. 22"
                                value={editServings}
                                onChange={(e) => setEditServings(e.target.value)}
                              />
                            </div>
                          </div>
                          <div>
                            <label className="block text-xs text-slate-500 mb-1">
                              Pilihan takaran <span className="text-slate-400 font-normal">(nama + jumlah dalam {editBaseUnit})</span>
                            </label>
                            <TakaranForm rows={editTakaran} onChange={setEditTakaran} />
                          </div>
                        </div>

                        {/* Actions */}
                        <div className="flex gap-2">
                          <button
                            onClick={handleSaveEdit}
                            disabled={editLoading}
                            className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-50"
                          >
                            {editLoading ? "Menyimpan…" : "Simpan"}
                          </button>
                          <button onClick={() => setEditId(null)} className="text-sm text-slate-500 hover:text-slate-800 px-3">
                            Batal
                          </button>
                        </div>
                      </div>
                    </td>
                  </tr>
                ) : (
                  <tr key={p.id} className={`hover:bg-slate-50 ${!p.isActive ? "opacity-50" : ""}`}>
                    <td className="px-4 py-2.5 font-medium">{p.name}</td>
                    <td className="px-4 py-2.5 text-slate-500 text-xs">{p.category}</td>
                    <td className="px-4 py-2.5 text-slate-500 text-xs max-w-[200px]">
                      {servingSummary(p) ?? <span className="text-slate-300">—</span>}
                    </td>
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

      {/* ── Create form ── */}
      <div className="bg-white rounded-xl border border-slate-200 p-6 max-w-2xl">
        <h3 className="font-semibold text-slate-800 mb-4">Tambah Produk ke Katalog</h3>
        {feedback && (
          <div className={`mb-4 text-sm rounded-lg px-3 py-2 ${feedback.type === "ok" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"}`}>
            {feedback.msg}
          </div>
        )}
        <div className="space-y-5">
          {/* Name + Category */}
          <div className="grid grid-cols-2 gap-3">
            <input
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
              placeholder="Nama Produk *"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <select
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
              value={category}
              onChange={(e) => setCategory(e.target.value as typeof CATEGORIES[number])}
            >
              {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
            </select>
          </div>

          {/* Prices */}
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

          {/* Serving data */}
          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">
              Data Takaran <span className="text-slate-400 font-normal normal-case">(opsional — isi jika produk dijual berdasarkan takaran)</span>
            </p>
            <div className="grid grid-cols-3 gap-3 mb-3">
              <div>
                <label className="block text-xs text-slate-500 mb-1">Berat bersih per kemasan</label>
                <div className="flex gap-1">
                  <input
                    type="number"
                    className="flex-1 border border-slate-200 rounded-lg px-2 py-1.5 text-sm"
                    placeholder="e.g. 550"
                    value={netWeight}
                    onChange={(e) => setNetWeight(e.target.value)}
                  />
                  <select
                    className="border border-slate-200 rounded-lg px-2 py-1.5 text-sm"
                    value={baseUnit}
                    onChange={(e) => setBaseUnit(e.target.value as "g" | "ml")}
                  >
                    <option value="g">g</option>
                    <option value="ml">ml</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">Sajian per kemasan</label>
                <input
                  type="number"
                  className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm"
                  placeholder="e.g. 22"
                  value={servingsPerContainer}
                  onChange={(e) => setServingsPerContainer(e.target.value)}
                />
              </div>
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">
                Pilihan takaran <span className="text-slate-400 font-normal">(nama + jumlah dalam {baseUnit})</span>
              </label>
              <TakaranForm rows={takaran} onChange={setTakaran} />
            </div>
          </div>

          <button
            onClick={handleCreate}
            disabled={createLoading}
            className="w-full bg-blue-600 text-white rounded-lg py-2.5 text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition"
          >
            {createLoading ? "Menyimpan…" : "Tambah ke Katalog"}
          </button>
        </div>
      </div>
    </div>
  );
}
