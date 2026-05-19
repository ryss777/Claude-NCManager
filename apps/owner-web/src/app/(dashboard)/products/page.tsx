"use client";

import { useEffect, useState } from "react";
import {
  collection,
  getDocs,
  addDoc,
  updateDoc,
  doc,
  query,
  orderBy,
} from "firebase/firestore";
import { useOwnerAuthStore } from "@/store/auth.store";
import { firebaseDb } from "@/firebase/firebase";

interface Product {
  id: string;
  name: string;
  category: string;
  sellingPrice: number;
  description: string;
  isActive: boolean;
  createdAt: string;
}

const CATEGORIES = ["Minuman", "Makanan", "Suplemen", "Merchandise", "Lainnya"];

const fmt = (n: number) =>
  new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(n);

export default function ProductsPage() {
  const { ownerId, clubId } = useOwnerAuthStore();
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);

  // Create form
  const [name, setName] = useState("");
  const [category, setCategory] = useState("Minuman");
  const [sellingPrice, setSellingPrice] = useState("");
  const [description, setDescription] = useState("");
  const [creating, setCreating] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "ok" | "err"; msg: string } | undefined>();

  // Edit state
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editCategory, setEditCategory] = useState("");
  const [editPrice, setEditPrice] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editSaving, setEditSaving] = useState(false);

  function productPath() {
    return `owners/${ownerId}/clubs/${clubId}/products`;
  }

  async function loadProducts() {
    if (!ownerId || !clubId) return;
    setLoading(true);
    const snap = await getDocs(
      query(collection(firebaseDb(), productPath()), orderBy("createdAt", "desc"))
    );
    setProducts(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Product)));
    setLoading(false);
  }

  useEffect(() => { loadProducts(); }, [ownerId, clubId]);

  async function handleCreate() {
    if (!name.trim()) {
      setFeedback({ type: "err", msg: "Nama produk wajib diisi" });
      return;
    }
    const price = parseFloat(sellingPrice);
    if (isNaN(price) || price < 0) {
      setFeedback({ type: "err", msg: "Harga jual tidak valid" });
      return;
    }
    setCreating(true);
    setFeedback(undefined);
    try {
      const now = new Date().toISOString();
      await addDoc(collection(firebaseDb(), productPath()), {
        ownerId,
        clubId,
        name: name.trim(),
        category,
        sellingPrice: price,
        description: description.trim(),
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
      setFeedback({ type: "ok", msg: `Produk "${name.trim()}" berhasil ditambahkan` });
      setName(""); setSellingPrice(""); setDescription(""); setCategory("Minuman");
      loadProducts();
    } catch (err) {
      setFeedback({ type: "err", msg: err instanceof Error ? err.message : "Gagal" });
    } finally {
      setCreating(false);
    }
  }

  function startEdit(p: Product) {
    setEditId(p.id);
    setEditName(p.name);
    setEditCategory(p.category);
    setEditPrice(p.sellingPrice.toString());
    setEditDescription(p.description ?? "");
  }

  async function saveEdit() {
    if (!editId) return;
    const price = parseFloat(editPrice);
    if (!editName.trim() || isNaN(price) || price < 0) return;
    setEditSaving(true);
    try {
      await updateDoc(doc(firebaseDb(), productPath(), editId), {
        name: editName.trim(),
        category: editCategory,
        sellingPrice: price,
        description: editDescription.trim(),
        updatedAt: new Date().toISOString(),
      });
      setEditId(null);
      loadProducts();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Gagal menyimpan");
    } finally {
      setEditSaving(false);
    }
  }

  async function toggleActive(p: Product) {
    try {
      await updateDoc(doc(firebaseDb(), productPath(), p.id), {
        isActive: !p.isActive,
        updatedAt: new Date().toISOString(),
      });
      loadProducts();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Gagal");
    }
  }

  const active = products.filter((p) => p.isActive);
  const inactive = products.filter((p) => !p.isActive);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Produk</h2>
          <p className="text-sm text-slate-400 mt-0.5">
            Katalog produk yang tersedia di kasir operator
          </p>
        </div>
        <button onClick={loadProducts} className="text-xs text-blue-600 hover:underline">
          Refresh
        </button>
      </div>

      <div className="flex gap-6">
        {/* Product list */}
        <div className="flex-1 min-w-0">

          {loading ? (
            <p className="text-sm text-slate-400">Memuat…</p>
          ) : products.length === 0 ? (
            <p className="text-sm text-slate-400">Belum ada produk. Tambahkan produk pertama Anda.</p>
          ) : (
            <>
              {/* Active products */}
              <div className="bg-white rounded-xl border border-slate-200 overflow-hidden mb-4">
                <div className="px-4 py-2.5 border-b border-slate-100 bg-slate-50">
                  <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                    Aktif ({active.length})
                  </span>
                </div>
                {active.length === 0 ? (
                  <p className="text-sm text-slate-400 p-4">Tidak ada produk aktif.</p>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="text-slate-500 text-xs border-b border-slate-100">
                      <tr>
                        <th className="px-4 py-2 text-left">Nama</th>
                        <th className="px-4 py-2 text-left">Kategori</th>
                        <th className="px-4 py-2 text-right">Harga Jual</th>
                        <th className="px-4 py-2 text-left">Deskripsi</th>
                        <th className="px-4 py-2" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {active.map((p) =>
                        editId === p.id ? (
                          <tr key={p.id} className="bg-blue-50">
                            <td className="px-3 py-2">
                              <input
                                className="w-full border border-blue-300 rounded px-2 py-1 text-sm"
                                value={editName}
                                onChange={(e) => setEditName(e.target.value)}
                              />
                            </td>
                            <td className="px-3 py-2">
                              <select
                                className="w-full border border-blue-300 rounded px-2 py-1 text-sm"
                                value={editCategory}
                                onChange={(e) => setEditCategory(e.target.value)}
                              >
                                {CATEGORIES.map((c) => (
                                  <option key={c} value={c}>{c}</option>
                                ))}
                              </select>
                            </td>
                            <td className="px-3 py-2">
                              <input
                                type="number"
                                className="w-full border border-blue-300 rounded px-2 py-1 text-sm text-right"
                                value={editPrice}
                                onChange={(e) => setEditPrice(e.target.value)}
                              />
                            </td>
                            <td className="px-3 py-2">
                              <input
                                className="w-full border border-blue-300 rounded px-2 py-1 text-sm"
                                value={editDescription}
                                onChange={(e) => setEditDescription(e.target.value)}
                              />
                            </td>
                            <td className="px-3 py-2 whitespace-nowrap">
                              <button
                                onClick={saveEdit}
                                disabled={editSaving}
                                className="text-xs text-blue-600 font-semibold hover:text-blue-800 mr-3 disabled:opacity-50"
                              >
                                {editSaving ? "…" : "Simpan"}
                              </button>
                              <button
                                onClick={() => setEditId(null)}
                                className="text-xs text-slate-400 hover:text-slate-600"
                              >
                                Batal
                              </button>
                            </td>
                          </tr>
                        ) : (
                          <tr key={p.id} className="hover:bg-slate-50">
                            <td className="px-4 py-2.5 font-medium text-slate-800">{p.name}</td>
                            <td className="px-4 py-2.5">
                              <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">
                                {p.category}
                              </span>
                            </td>
                            <td className="px-4 py-2.5 text-right font-semibold text-slate-800">
                              {fmt(p.sellingPrice)}
                            </td>
                            <td className="px-4 py-2.5 text-slate-400 text-xs truncate max-w-[180px]">
                              {p.description || "—"}
                            </td>
                            <td className="px-4 py-2.5 whitespace-nowrap text-right">
                              <button
                                onClick={() => startEdit(p)}
                                className="text-xs text-blue-600 hover:underline mr-3"
                              >
                                Edit
                              </button>
                              <button
                                onClick={() => toggleActive(p)}
                                className="text-xs text-red-500 hover:text-red-700"
                              >
                                Nonaktifkan
                              </button>
                            </td>
                          </tr>
                        )
                      )}
                    </tbody>
                  </table>
                )}
              </div>

              {/* Inactive products */}
              {inactive.length > 0 && (
                <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                  <div className="px-4 py-2.5 border-b border-slate-100 bg-slate-50">
                    <span className="text-xs font-semibold text-slate-400 uppercase tracking-wide">
                      Nonaktif ({inactive.length})
                    </span>
                  </div>
                  <table className="w-full text-sm">
                    <tbody className="divide-y divide-slate-100">
                      {inactive.map((p) => (
                        <tr key={p.id} className="opacity-60 hover:opacity-80">
                          <td className="px-4 py-2.5 font-medium text-slate-500 w-1/3">{p.name}</td>
                          <td className="px-4 py-2.5 text-slate-400 text-xs">{p.category}</td>
                          <td className="px-4 py-2.5 text-right text-slate-400">{fmt(p.sellingPrice)}</td>
                          <td className="px-4 py-2.5 text-right">
                            <button
                              onClick={() => toggleActive(p)}
                              className="text-xs text-green-600 hover:text-green-800"
                            >
                              Aktifkan
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>

        {/* Create form */}
        <div className="w-72 shrink-0">
          <div className="bg-white rounded-xl border border-slate-200 p-6 sticky top-6">
            <h3 className="font-semibold text-slate-800 mb-4">Tambah Produk Baru</h3>

            {feedback && (
              <div
                className={`mb-4 text-sm rounded-lg px-3 py-2 ${
                  feedback.type === "ok"
                    ? "bg-green-50 text-green-700"
                    : "bg-red-50 text-red-600"
                }`}
              >
                {feedback.msg}
              </div>
            )}

            <div className="space-y-3">
              <div>
                <label className="text-xs text-slate-500 mb-1 block">Nama Produk *</label>
                <input
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
                  placeholder="Contoh: Protein Shake Coklat"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>

              <div>
                <label className="text-xs text-slate-500 mb-1 block">Kategori</label>
                <select
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                >
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs text-slate-500 mb-1 block">Harga Jual (Rp) *</label>
                <input
                  type="number"
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
                  placeholder="0"
                  value={sellingPrice}
                  onChange={(e) => setSellingPrice(e.target.value)}
                />
              </div>

              <div>
                <label className="text-xs text-slate-500 mb-1 block">Deskripsi (opsional)</label>
                <textarea
                  rows={2}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm resize-none"
                  placeholder="Keterangan singkat produk…"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>

              <button
                onClick={handleCreate}
                disabled={creating}
                className="w-full bg-teal-600 text-white rounded-lg py-2.5 text-sm font-semibold hover:bg-teal-700 disabled:opacity-50 transition"
              >
                {creating ? "Menyimpan…" : "Tambah Produk"}
              </button>
            </div>

            <p className="text-xs text-slate-400 mt-4 leading-relaxed">
              Produk aktif akan muncul di kasir operator app.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
