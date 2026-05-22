"use client";

import { useEffect, useState, useCallback } from "react";
import {
  collection,
  getDocs,
  query,
  orderBy,
  where,
} from "firebase/firestore";

interface ClubOption { id: string; name: string; }
import { useOwnerAuthStore } from "@/store/auth.store";
import { callFunction, firebaseDb } from "@/firebase/firebase";

// ── Types ─────────────────────────────────────────────────────────────────────

type ItemType = "product" | "ingredient";

interface InventoryItem {
  id: string;
  name: string;
  unit: string;
  category: string | null;
  itemType: ItemType | undefined;
  currentStock: number;
  minimumStock: number;
  isActive: boolean;
}

interface RecipeIngredient {
  inventoryItemId: string;
  inventoryItemName: string;
  quantity: number;
  unit: string;
}

interface Recipe {
  id: string;
  name: string;
  linkedProductId: string | null;
  linkedProductName: string | null;
  ingredients: RecipeIngredient[];
  isActive: boolean;
  createdAt: string;
}

interface MembershipVisit {
  id: string;
  customerId: string;
  membershipId: string;
  transactionId: string;
  visitsBefore: number;
  visitsAfter: number;
  createdAt: string;
}

type Tab = "stok" | "resep" | "absensi";

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleString("id-ID", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });

// ── Component ─────────────────────────────────────────────────────────────────

export default function ClubPage() {
  const { ownerId } = useOwnerAuthStore();
  const [tab, setTab] = useState<Tab>("stok");

  // ── Club selector ────────────────────────────────────────────────────────
  const [clubs, setClubs] = useState<ClubOption[]>([]);
  const [selectedClubId, setSelectedClubId] = useState<string>("");
  const [loadingClubs, setLoadingClubs] = useState(true);

  useEffect(() => {
    if (!ownerId) return;
    setLoadingClubs(true);
    getDocs(collection(firebaseDb(), `owners/${ownerId}/clubs`))
      .then((snap) => {
        const list = snap.docs.map((d) => ({ id: d.id, name: (d.data()["name"] as string) ?? d.id }));
        setClubs(list);
        if (list.length > 0 && !selectedClubId) setSelectedClubId(list[0]!.id);
      })
      .finally(() => setLoadingClubs(false));
  }, [ownerId]);

  const selectedClub = clubs.find((c) => c.id === selectedClubId);

  return (
    <div className="flex flex-col gap-5 h-full min-h-0">
      {/* Page header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Manajemen Club</h1>
          <p className="text-sm text-slate-400 mt-0.5">Stok produk club, resep minuman, dan absensi member</p>
        </div>

        {/* Club selector */}
        {loadingClubs ? (
          <div className="text-xs text-slate-400 mt-1.5">Memuat club…</div>
        ) : clubs.length === 0 ? (
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-2 text-xs text-amber-700">
            Belum ada club. Transfer produk ke club terlebih dahulu.
          </div>
        ) : clubs.length === 1 ? (
          <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-xl px-4 py-2.5">
            <span className="text-base">🏢</span>
            <div>
              <p className="text-xs text-blue-500 font-medium">Club aktif</p>
              <p className="text-sm font-bold text-blue-800">{selectedClub?.name}</p>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <label className="text-xs text-slate-500 font-medium whitespace-nowrap">Club aktif</label>
            <select
              className="border border-slate-200 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium"
              value={selectedClubId}
              onChange={(e) => setSelectedClubId(e.target.value)}
            >
              {clubs.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-slate-200">
        {([
          { key: "stok",   label: "📦 Stok",        desc: "Produk & Bahan Baku" },
          { key: "resep",  label: "📋 Resep",        desc: "Formula minuman" },
          { key: "absensi",label: "📅 Absensi",      desc: "Kunjungan member" },
        ] as { key: Tab; label: string; desc: string }[]).map(({ key, label, desc }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-5 py-3 text-sm font-medium border-b-2 transition -mb-px ${
              tab === key
                ? "border-blue-600 text-blue-700"
                : "border-transparent text-slate-500 hover:text-slate-800 hover:border-slate-300"
            }`}
          >
            {label}
            <span className={`block text-xs font-normal mt-0.5 ${tab === key ? "text-blue-400" : "text-slate-400"}`}>
              {desc}
            </span>
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {ownerId && selectedClubId ? (
          <>
            {tab === "stok"    && <StokTab    ownerId={ownerId} clubId={selectedClubId} />}
            {tab === "resep"   && <ResepTab   ownerId={ownerId} clubId={selectedClubId} />}
            {tab === "absensi" && <AbsensiTab ownerId={ownerId} clubId={selectedClubId} />}
          </>
        ) : !loadingClubs && clubs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-slate-400">
            <span className="text-4xl">🏢</span>
            <p className="text-sm font-medium">Belum ada club yang terdaftar.</p>
            <p className="text-xs text-center">Lakukan transfer produk dari laman <strong>Transfer Produk</strong> ke club Anda.</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// TAB: STOK
// ══════════════════════════════════════════════════════════════════════════════

function StokTab({ ownerId, clubId }: { ownerId: string; clubId: string }) {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState<"all" | ItemType>("all");
  const [showAddModal, setShowAddModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Single delete
  const [deleteTarget, setDeleteTarget] = useState<InventoryItem | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Bulk delete
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);

  // Form state
  const [ingName, setIngName] = useState("");
  const [ingUnit, setIngUnit] = useState("");
  const [ingCategory, setIngCategory] = useState("");
  const [ingMinStock, setIngMinStock] = useState("0");

  const loadItems = useCallback(async () => {
    setLoading(true);
    try {
      const db = firebaseDb();
      const snap = await getDocs(
        query(
          collection(db, `owners/${ownerId}/clubs/${clubId}/inventoryItems`),
          where("isActive", "==", true),
          orderBy("name")
        )
      );
      setItems(snap.docs.map((d) => ({ id: d.id, ...d.data() } as InventoryItem)));
    } finally {
      setLoading(false);
    }
  }, [ownerId, clubId]);

  useEffect(() => { loadItems(); }, [loadItems]);

  const displayed = typeFilter === "all"
    ? items
    : items.filter((i) => (i.itemType ?? "product") === typeFilter);

  const products    = items.filter((i) => (i.itemType ?? "product") === "product");
  const ingredients = items.filter((i) => i.itemType === "ingredient");
  const lowStock    = items.filter((i) => i.currentStock <= i.minimumStock);

  async function handleAddIngredient() {
    if (!ingName.trim() || !ingUnit.trim()) {
      setError("Nama dan satuan wajib diisi");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await callFunction("inventory_createIngredient", {
        ownerId, clubId,
        name: ingName.trim(),
        unit: ingUnit.trim(),
        category: ingCategory.trim() || undefined,
        minimumStock: parseFloat(ingMinStock) || 0,
      });
      setIngName(""); setIngUnit(""); setIngCategory(""); setIngMinStock("0");
      setShowAddModal(false);
      loadItems();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal menambah bahan baku");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await callFunction("inventory_removeItem", {
        ownerId, clubId, inventoryItemId: deleteTarget.id, force: true,
      });
      setDeleteTarget(null);
      loadItems();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal menghapus item");
    } finally {
      setDeleting(false);
    }
  }

  async function handleBulkDelete() {
    setBulkDeleting(true);
    setError("");
    try {
      await Promise.all(
        [...selectedIds].map((inventoryItemId) =>
          callFunction("inventory_removeItem", { ownerId, clubId, inventoryItemId, force: true })
        )
      );
      setSelectedIds(new Set());
      setBulkConfirmOpen(false);
      loadItems();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal menghapus beberapa item");
    } finally {
      setBulkDeleting(false);
    }
  }

  // Checkbox helpers
  const allDisplayedSelected =
    displayed.length > 0 && displayed.every((i) => selectedIds.has(i.id));
  const someDisplayedSelected = displayed.some((i) => selectedIds.has(i.id));

  function toggleAll() {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allDisplayedSelected) {
        displayed.forEach((i) => next.delete(i.id));
      } else {
        displayed.forEach((i) => next.add(i.id));
      }
      return next;
    });
  }

  function toggleOne(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Stats */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: "Total Item", value: items.length, color: "text-slate-800" },
          { label: "Produk Jual", value: products.length, color: "text-green-700" },
          { label: "Bahan Baku", value: ingredients.length, color: "text-violet-700" },
          { label: "Stok Menipis", value: lowStock.length, color: lowStock.length > 0 ? "text-red-600" : "text-slate-400" },
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-white rounded-xl border border-slate-200 px-4 py-3">
            <p className="text-xs text-slate-400">{label}</p>
            <p className={`text-2xl font-bold mt-0.5 ${color}`}>{value}</p>
          </div>
        ))}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-3">
        <div className="flex gap-1">
          {([
            { key: "all",        label: "Semua" },
            { key: "product",    label: "Produk Jual" },
            { key: "ingredient", label: "Bahan Baku" },
          ] as { key: typeof typeFilter; label: string }[]).map(({ key, label }) => (
            <button
              key={key}
              onClick={() => { setTypeFilter(key); setSelectedIds(new Set()); }}
              className={`px-3 py-1.5 rounded-full text-xs font-medium border transition ${
                typeFilter === key
                  ? "bg-slate-800 text-white border-slate-800"
                  : "border-slate-200 text-slate-500 hover:border-slate-400"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2">
          {selectedIds.size > 0 && (
            <button
              onClick={() => { setError(""); setBulkConfirmOpen(true); }}
              className="px-4 py-2 bg-red-600 text-white text-sm font-semibold rounded-xl hover:bg-red-700 transition"
            >
              🗑 Hapus {selectedIds.size} item
            </button>
          )}
          <button
            onClick={() => setShowAddModal(true)}
            className="px-4 py-2 bg-violet-600 text-white text-sm font-semibold rounded-xl hover:bg-violet-700 transition"
          >
            + Tambah Bahan Baku
          </button>
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <div className="text-center py-12 text-slate-400 text-sm">Memuat…</div>
      ) : displayed.length === 0 ? (
        <div className="text-center py-12 text-slate-400 text-sm">Tidak ada item.</div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
              <tr>
                <th className="pl-4 pr-2 py-3 w-8">
                  <input
                    type="checkbox"
                    checked={allDisplayedSelected}
                    ref={(el) => { if (el) el.indeterminate = someDisplayedSelected && !allDisplayedSelected; }}
                    onChange={toggleAll}
                    className="rounded cursor-pointer"
                  />
                </th>
                <th className="px-4 py-3 text-left">Nama</th>
                <th className="px-4 py-3 text-left">Tipe</th>
                <th className="px-4 py-3 text-left">Kategori</th>
                <th className="px-4 py-3 text-right">Stok</th>
                <th className="px-4 py-3 text-right">Min</th>
                <th className="px-4 py-3 text-center">Status</th>
                <th className="px-2 py-3 w-10"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {displayed.map((item) => {
                const isLow = item.currentStock <= item.minimumStock;
                const isIngredient = item.itemType === "ingredient";
                const isChecked = selectedIds.has(item.id);
                return (
                  <tr
                    key={item.id}
                    className={`hover:bg-slate-50 group ${isChecked ? "bg-red-50/40" : ""}`}
                  >
                    <td className="pl-4 pr-2 py-3">
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => toggleOne(item.id)}
                        className="rounded cursor-pointer"
                      />
                    </td>
                    <td className="px-4 py-3 font-medium text-slate-800">{item.name}</td>
                    <td className="px-4 py-3">
                      {isIngredient ? (
                        <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-violet-100 text-violet-700">Bahan Baku</span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-green-100 text-green-700">Produk</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-500 text-xs">{item.category ?? "—"}</td>
                    <td className={`px-4 py-3 text-right font-semibold ${isLow ? "text-red-600" : "text-slate-800"}`}>
                      {item.currentStock} <span className="text-xs font-normal text-slate-400">{item.unit}</span>
                    </td>
                    <td className="px-4 py-3 text-right text-slate-400 text-xs">{item.minimumStock}</td>
                    <td className="px-4 py-3 text-center">
                      {isLow ? (
                        <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-600">Menipis ⚠</span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-green-100 text-green-600">OK</span>
                      )}
                    </td>
                    <td className="px-2 py-3 text-center">
                      <button
                        onClick={() => { setError(""); setDeleteTarget(item); }}
                        className="opacity-0 group-hover:opacity-100 text-slate-300 hover:text-red-500 transition text-lg leading-none"
                        title="Hapus item"
                      >
                        🗑
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Bulk delete confirm dialog */}
      {bulkConfirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm mx-4">
            <p className="font-bold text-slate-900 mb-1">Hapus {selectedIds.size} Item?</p>
            <p className="text-xs text-slate-400 mb-3">Item berikut akan dihapus dari daftar stok:</p>
            <ul className="mb-4 max-h-48 overflow-y-auto space-y-1">
              {items.filter((i) => selectedIds.has(i.id)).map((i) => (
                <li key={i.id} className="flex items-center justify-between text-sm px-3 py-1.5 bg-red-50 rounded-lg">
                  <span className="font-medium text-slate-800">{i.name}</span>
                  {i.currentStock > 0 && (
                    <span className="text-xs text-amber-600 font-semibold ml-2 shrink-0">
                      stok: {i.currentStock} {i.unit}
                    </span>
                  )}
                </li>
              ))}
            </ul>
            {error && <div className="mb-3 text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</div>}
            <div className="flex gap-3">
              <button
                onClick={() => { setBulkConfirmOpen(false); setError(""); }}
                className="flex-1 border border-slate-200 text-slate-600 rounded-xl py-2.5 text-sm font-semibold hover:bg-slate-50"
              >
                Batal
              </button>
              <button
                onClick={handleBulkDelete}
                disabled={bulkDeleting}
                className="flex-1 bg-red-600 text-white rounded-xl py-2.5 text-sm font-semibold hover:bg-red-700 disabled:opacity-50"
              >
                {bulkDeleting ? "Menghapus…" : `Ya, Hapus ${selectedIds.size} Item`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Single delete confirm dialog */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm mx-4">
            <p className="font-bold text-slate-900 mb-1">Hapus Item?</p>
            <p className="text-sm text-slate-600 mb-1">
              <span className="font-semibold">{deleteTarget.name}</span>
            </p>
            <p className="text-xs text-slate-400 mb-4">
              {deleteTarget.currentStock > 0
                ? `Stok saat ini: ${deleteTarget.currentStock} ${deleteTarget.unit}. Item akan dihapus dari daftar stok.`
                : "Item akan dihapus dari daftar stok."}
            </p>
            {error && <div className="mb-3 text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</div>}
            <div className="flex gap-3">
              <button
                onClick={() => { setDeleteTarget(null); setError(""); }}
                className="flex-1 border border-slate-200 text-slate-600 rounded-xl py-2.5 text-sm font-semibold hover:bg-slate-50"
              >
                Batal
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="flex-1 bg-red-600 text-white rounded-xl py-2.5 text-sm font-semibold hover:bg-red-700 disabled:opacity-50"
              >
                {deleting ? "Menghapus…" : "Ya, Hapus"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add ingredient modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm mx-4">
            <h3 className="text-base font-bold text-slate-900 mb-4">Tambah Bahan Baku</h3>
            {error && <div className="mb-3 text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</div>}
            <div className="space-y-3">
              <div>
                <label className="text-xs text-slate-500 block mb-1">Nama Bahan Baku *</label>
                <input className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" placeholder="Contoh: Protein Powder" value={ingName} onChange={(e) => setIngName(e.target.value)} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-500 block mb-1">Satuan *</label>
                  <input className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" placeholder="gram / ml / scoops" value={ingUnit} onChange={(e) => setIngUnit(e.target.value)} />
                </div>
                <div>
                  <label className="text-xs text-slate-500 block mb-1">Min Stok</label>
                  <input type="number" className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" placeholder="0" value={ingMinStock} onChange={(e) => setIngMinStock(e.target.value)} />
                </div>
              </div>
              <div>
                <label className="text-xs text-slate-500 block mb-1">Kategori</label>
                <input className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" placeholder="Opsional" value={ingCategory} onChange={(e) => setIngCategory(e.target.value)} />
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={() => { setShowAddModal(false); setError(""); }} className="flex-1 border border-slate-200 text-slate-600 rounded-xl py-2.5 text-sm font-semibold hover:bg-slate-50">Batal</button>
              <button onClick={handleAddIngredient} disabled={saving} className="flex-1 bg-violet-600 text-white rounded-xl py-2.5 text-sm font-semibold hover:bg-violet-700 disabled:opacity-50">
                {saving ? "Menyimpan…" : "Simpan"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// TAB: RESEP
// ══════════════════════════════════════════════════════════════════════════════

function ResepTab({ ownerId, clubId }: { ownerId: string; clubId: string }) {
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [products, setProducts] = useState<InventoryItem[]>([]);
  const [ingredients, setIngredients] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Recipe | "new" | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");

  // Form state
  const [formName, setFormName] = useState("");
  const [formProductId, setFormProductId] = useState("");
  const [formIngredients, setFormIngredients] = useState<RecipeIngredient[]>([]);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const db = firebaseDb();
      const base = `owners/${ownerId}/clubs/${clubId}`;
      const [recipeSnap, itemSnap] = await Promise.all([
        getDocs(query(collection(db, `${base}/recipes`), where("isActive", "==", true), orderBy("name"))),
        getDocs(query(collection(db, `${base}/inventoryItems`), where("isActive", "==", true), orderBy("name"))),
      ]);
      setRecipes(recipeSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Recipe)));
      const allItems = itemSnap.docs.map((d) => ({ id: d.id, ...d.data() } as InventoryItem));
      setProducts(allItems.filter((i) => (i.itemType ?? "product") === "product"));
      setIngredients(allItems.filter((i) => i.itemType === "ingredient"));
    } finally {
      setLoading(false);
    }
  }, [ownerId, clubId]);

  useEffect(() => { loadData(); }, [loadData]);

  function openNew() {
    setSelected("new");
    setFormName("");
    setFormProductId("");
    setFormIngredients([{ inventoryItemId: "", inventoryItemName: "", quantity: 1, unit: "" }]);
    setError("");
  }

  function openEdit(r: Recipe) {
    setSelected(r);
    setFormName(r.name);
    setFormProductId(r.linkedProductId ?? "");
    setFormIngredients(r.ingredients.length > 0 ? r.ingredients : [{ inventoryItemId: "", inventoryItemName: "", quantity: 1, unit: "" }]);
    setError("");
  }

  function addIngredientRow() {
    setFormIngredients((prev) => [...prev, { inventoryItemId: "", inventoryItemName: "", quantity: 1, unit: "" }]);
  }

  function removeIngredientRow(idx: number) {
    setFormIngredients((prev) => prev.filter((_, i) => i !== idx));
  }

  function updateIngredientRow(idx: number, field: keyof RecipeIngredient, value: string | number) {
    setFormIngredients((prev) =>
      prev.map((row, i) => {
        if (i !== idx) return row;
        if (field === "inventoryItemId") {
          const item = ingredients.find((ing) => ing.id === value);
          return { ...row, inventoryItemId: value as string, inventoryItemName: item?.name ?? "", unit: item?.unit ?? "" };
        }
        return { ...row, [field]: value };
      })
    );
  }

  async function handleSave() {
    if (!formName.trim()) { setError("Nama resep wajib diisi"); return; }
    const validIng = formIngredients.filter((i) => i.inventoryItemId && i.quantity > 0);
    if (validIng.length === 0) { setError("Minimal satu bahan baku"); return; }

    setSaving(true);
    setError("");
    try {
      const linkedProduct = products.find((p) => p.id === formProductId);
      if (selected === "new") {
        await callFunction("club_createRecipe", {
          ownerId, clubId,
          name: formName.trim(),
          linkedProductId: formProductId || undefined,
          linkedProductName: linkedProduct?.name ?? undefined,
          ingredients: validIng,
        });
      } else if (selected) {
        await callFunction("club_updateRecipe", {
          ownerId, clubId,
          recipeId: selected.id,
          name: formName.trim(),
          linkedProductId: formProductId || null,
          linkedProductName: linkedProduct?.name ?? null,
          ingredients: validIng,
        });
      }
      setSelected(null);
      loadData();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal menyimpan resep");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(recipeId: string) {
    setDeleting(true);
    try {
      await callFunction("club_deleteRecipe", { ownerId, clubId, recipeId });
      setDeleteTarget(null);
      if (selected !== "new" && selected?.id === recipeId) setSelected(null);
      loadData();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal menghapus resep");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="flex gap-5 h-full">
      {/* Left — recipe list */}
      <div className="w-72 shrink-0 flex flex-col gap-3">
        <button
          onClick={openNew}
          className="w-full py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-xl hover:bg-blue-700 transition"
        >
          + Resep Baru
        </button>

        {loading ? (
          <div className="text-center py-8 text-slate-400 text-sm">Memuat…</div>
        ) : recipes.length === 0 ? (
          <div className="text-center py-8 text-slate-400 text-sm">Belum ada resep.</div>
        ) : (
          <div className="space-y-2">
            {recipes.map((r) => (
              <div
                key={r.id}
                onClick={() => openEdit(r)}
                className={`p-3 rounded-xl border cursor-pointer transition ${
                  selected !== "new" && (selected as Recipe | null)?.id === r.id
                    ? "border-blue-400 bg-blue-50"
                    : "border-slate-200 bg-white hover:border-slate-300"
                }`}
              >
                <p className="text-sm font-semibold text-slate-800">{r.name}</p>
                {r.linkedProductName && (
                  <p className="text-xs text-slate-400 mt-0.5">→ {r.linkedProductName}</p>
                )}
                <p className="text-xs text-slate-400 mt-0.5">{r.ingredients.length} bahan</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Right — form */}
      {selected !== null ? (
        <div className="flex-1 bg-white rounded-xl border border-slate-200 p-5 flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-slate-800">{selected === "new" ? "Resep Baru" : "Edit Resep"}</h3>
            {selected !== "new" && (
              <button
                onClick={() => setDeleteTarget(selected.id)}
                className="text-xs text-red-500 hover:text-red-700 font-medium"
              >
                Hapus Resep
              </button>
            )}
          </div>

          {error && <div className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</div>}

          {/* Recipe name */}
          <div>
            <label className="text-xs text-slate-500 block mb-1">Nama Resep *</label>
            <input
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Contoh: Shake Protein Vanila"
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
            />
          </div>

          {/* Linked product */}
          <div>
            <label className="text-xs text-slate-500 block mb-1">
              Terhubung ke Produk POS
              <span className="ml-1 text-slate-400">(opsional — bahan baku otomatis terpotong saat produk ini terjual)</span>
            </label>
            <select
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              value={formProductId}
              onChange={(e) => setFormProductId(e.target.value)}
            >
              <option value="">— Tidak ditautkan —</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>

          {/* Ingredients */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs text-slate-500 font-semibold uppercase tracking-wide">Bahan-bahan *</label>
              <button onClick={addIngredientRow} className="text-xs text-blue-600 hover:underline font-medium">+ Tambah bahan</button>
            </div>

            {ingredients.length === 0 && (
              <p className="text-xs text-amber-600 bg-amber-50 rounded-lg px-3 py-2 mb-2">
                Belum ada bahan baku. Tambahkan di tab <strong>Stok → Tambah Bahan Baku</strong>.
              </p>
            )}

            <div className="space-y-2">
              {formIngredients.map((row, idx) => (
                <div key={idx} className="flex gap-2 items-center">
                  <select
                    className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white"
                    value={row.inventoryItemId}
                    onChange={(e) => updateIngredientRow(idx, "inventoryItemId", e.target.value)}
                  >
                    <option value="">— Pilih bahan —</option>
                    {ingredients.map((ing) => (
                      <option key={ing.id} value={ing.id}>{ing.name} ({ing.unit})</option>
                    ))}
                  </select>
                  <input
                    type="number"
                    min="0.001"
                    step="0.1"
                    className="w-20 border border-slate-200 rounded-lg px-3 py-2 text-sm text-right"
                    placeholder="Qty"
                    value={row.quantity}
                    onChange={(e) => updateIngredientRow(idx, "quantity", parseFloat(e.target.value) || 0)}
                  />
                  <span className="text-xs text-slate-400 w-12 text-center">{row.unit}</span>
                  <button
                    onClick={() => removeIngredientRow(idx)}
                    disabled={formIngredients.length === 1}
                    className="text-slate-300 hover:text-red-500 disabled:opacity-30 text-lg leading-none"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-3 mt-auto pt-3 border-t border-slate-100">
            <button onClick={() => setSelected(null)} className="border border-slate-200 text-slate-600 rounded-xl px-4 py-2.5 text-sm font-semibold hover:bg-slate-50">
              Batal
            </button>
            <button onClick={handleSave} disabled={saving} className="flex-1 bg-blue-600 text-white rounded-xl py-2.5 text-sm font-semibold hover:bg-blue-700 disabled:opacity-50">
              {saving ? "Menyimpan…" : "Simpan Resep"}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center text-slate-300 text-sm">
          Pilih resep untuk diedit, atau buat resep baru.
        </div>
      )}

      {/* Delete confirm dialog */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-xs mx-4">
            <p className="font-bold text-slate-900 mb-2">Hapus Resep?</p>
            <p className="text-sm text-slate-500 mb-5">Resep ini tidak akan lagi memotong stok bahan baku saat produk terjual.</p>
            <div className="flex gap-3">
              <button onClick={() => setDeleteTarget(null)} className="flex-1 border border-slate-200 rounded-xl py-2.5 text-sm font-semibold">Batal</button>
              <button onClick={() => handleDelete(deleteTarget)} disabled={deleting} className="flex-1 bg-red-600 text-white rounded-xl py-2.5 text-sm font-semibold disabled:opacity-50">
                {deleting ? "Menghapus…" : "Ya, Hapus"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// TAB: ABSENSI
// ══════════════════════════════════════════════════════════════════════════════

function AbsensiTab({ ownerId, clubId }: { ownerId: string; clubId: string }) {
  const [visits, setVisits] = useState<MembershipVisit[]>([]);
  const [customers, setCustomers] = useState<Record<string, string>>({});
  const [membershipPlans, setMembershipPlans] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().slice(0, 10);
  });
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [searchName, setSearchName] = useState("");

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const db = firebaseDb();
      const base = `owners/${ownerId}/clubs/${clubId}`;

      const [visitSnap, custSnap, memSnap] = await Promise.all([
        getDocs(query(collection(db, `${base}/membershipVisits`), orderBy("createdAt", "desc"))),
        getDocs(collection(db, `${base}/customers`)),
        getDocs(collection(db, `${base}/memberships`)),
      ]);

      const custMap: Record<string, string> = {};
      custSnap.docs.forEach((d) => { custMap[d.id] = (d.data()["displayName"] as string) ?? d.id; });
      setCustomers(custMap);

      // membership → planName (denormalized)
      const planMap: Record<string, string> = {};
      memSnap.docs.forEach((d) => {
        const data = d.data();
        planMap[d.id] = (data["planName"] as string) ?? "—";
      });
      setMembershipPlans(planMap);

      setVisits(visitSnap.docs.map((d) => ({ id: d.id, ...d.data() } as MembershipVisit)));
    } finally {
      setLoading(false);
    }
  }, [ownerId, clubId]);

  useEffect(() => { loadData(); }, [loadData]);

  const filtered = visits.filter((v) => {
    const ts = new Date(v.createdAt).getTime();
    if (dateFrom && ts < new Date(dateFrom).getTime()) return false;
    if (dateTo) {
      const end = new Date(dateTo); end.setHours(23, 59, 59, 999);
      if (ts > end.getTime()) return false;
    }
    if (searchName.trim()) {
      const name = (customers[v.customerId] ?? "").toLowerCase();
      if (!name.includes(searchName.toLowerCase().trim())) return false;
    }
    return true;
  });

  // Unique members in filtered range
  const uniqueMembers = new Set(filtered.map((v) => v.customerId)).size;

  // Today's count
  const todayStr = new Date().toISOString().slice(0, 10);
  const todayCount = visits.filter((v) => v.createdAt.startsWith(todayStr)).length;

  return (
    <div className="flex flex-col gap-4">
      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-white rounded-xl border border-slate-200 px-4 py-3">
          <p className="text-xs text-slate-400">Kunjungan Hari Ini</p>
          <p className="text-2xl font-bold text-blue-600 mt-0.5">{todayCount}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 px-4 py-3">
          <p className="text-xs text-slate-400">Kunjungan (filter)</p>
          <p className="text-2xl font-bold text-slate-800 mt-0.5">{filtered.length}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 px-4 py-3">
          <p className="text-xs text-slate-400">Member Unik (filter)</p>
          <p className="text-2xl font-bold text-green-600 mt-0.5">{uniqueMembers}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-44">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm pointer-events-none">🔍</span>
          <input
            type="text"
            placeholder="Cari nama member…"
            value={searchName}
            onChange={(e) => setSearchName(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div className="flex items-center gap-1.5">
          <label className="text-xs text-slate-400">Dari</label>
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
            className="text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <div className="flex items-center gap-1.5">
          <label className="text-xs text-slate-400">Sampai</label>
          <input type="date" value={dateTo} min={dateFrom} onChange={(e) => setDateTo(e.target.value)}
            className="text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <button onClick={loadData} className="text-xs text-blue-600 hover:underline font-medium">Refresh</button>
      </div>

      {/* Table */}
      {loading ? (
        <div className="text-center py-12 text-slate-400 text-sm">Memuat…</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-slate-400 text-sm">Tidak ada kunjungan pada periode ini.</div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
              <tr>
                <th className="px-4 py-3 text-left">Waktu Kunjungan</th>
                <th className="px-4 py-3 text-left">Member</th>
                <th className="px-4 py-3 text-left">Paket</th>
                <th className="px-4 py-3 text-center">Sisa Kunjungan</th>
                <th className="px-4 py-3 text-left">Ref Transaksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((v) => (
                <tr key={v.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 text-slate-500 whitespace-nowrap text-xs">{fmtDate(v.createdAt)}</td>
                  <td className="px-4 py-3 font-medium text-slate-800">
                    {customers[v.customerId] ?? v.customerId}
                  </td>
                  <td className="px-4 py-3 text-slate-500 text-xs">{membershipPlans[v.membershipId] ?? "—"}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`text-sm font-bold ${v.visitsAfter <= 2 ? "text-red-600" : "text-green-600"}`}>
                      {v.visitsAfter}
                    </span>
                    <span className="text-xs text-slate-400 ml-1">sisa</span>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-400 font-mono">
                    #{v.transactionId.slice(0, 8).toUpperCase()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
