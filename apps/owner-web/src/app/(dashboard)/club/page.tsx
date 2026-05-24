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
  // Serving data — present when product was transferred from a catalog item with takaran
  baseUnit?: string | null;
  takaran?: TakaranOption[] | null;
}

interface TakaranOption {
  name: string;   // "scoop", "sajian", …
  amount: number; // in baseUnit (g or ml)
}

/** Returns e.g. "≈88 scoop · 44 sajian" for a given stock + takaran list */
function takaranSummary(currentStock: number, takaran: TakaranOption[]): string {
  return takaran
    .map((t) => `≈${Math.floor(currentStock / t.amount)} ${t.name}`)
    .join(" · ");
}

interface RecipeIngredient {
  inventoryItemId: string | null; // null = free-text ingredient (no stock deduction)
  inventoryItemName: string;
  quantity: number;
  unit: string;
  unitAmount: number | null; // grams/ml per 1 unit — used for stock deduction
}

interface RecipePrices {
  retail: number; ds: number; sc: number; sbQp: number; spv: number;
}

interface Recipe {
  id: string;
  name: string;
  linkedProductId: string | null;
  linkedProductName: string | null;
  ingredients: RecipeIngredient[];
  prices: RecipePrices | null;
  isActive: boolean;
  createdAt: string;
}

const PRICE_TIERS: { key: keyof RecipePrices; label: string }[] = [
  { key: "retail", label: "Retail" },
  { key: "ds",     label: "DS" },
  { key: "sc",     label: "SC" },
  { key: "sbQp",   label: "SB-QP" },
  { key: "spv",    label: "SPV" },
];

const emptyPrices = (): RecipePrices => ({ retail: 0, ds: 0, sc: 0, sbQp: 0, spv: 0 });

const fmtIdr = (n: number) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);

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
          { key: "stok",   label: "📦 Stok",        desc: "Stok produk club" },
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
  const [error, setError] = useState("");

  // Single delete
  const [deleteTarget, setDeleteTarget] = useState<InventoryItem | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Bulk delete
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);

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
      setItems(
        snap.docs
          .map((d) => ({ id: d.id, ...d.data() } as InventoryItem))
          .filter((i) => (i.itemType ?? "product") === "product")
      );
    } finally {
      setLoading(false);
    }
  }, [ownerId, clubId]);

  useEffect(() => { loadItems(); }, [loadItems]);

  const lowStock = items.filter((i) => i.currentStock <= i.minimumStock);

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

  const allSelected = items.length > 0 && items.every((i) => selectedIds.has(i.id));
  const someSelected = items.some((i) => selectedIds.has(i.id));

  function toggleAll() {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allSelected) { items.forEach((i) => next.delete(i.id)); }
      else             { items.forEach((i) => next.add(i.id)); }
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
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Total Produk",  value: items.length,     color: "text-slate-800" },
          { label: "Stok Aman",     value: items.length - lowStock.length, color: "text-green-700" },
          { label: "Stok Menipis",  value: lowStock.length,  color: lowStock.length > 0 ? "text-red-600" : "text-slate-400" },
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-white rounded-xl border border-slate-200 px-4 py-3">
            <p className="text-xs text-slate-400">{label}</p>
            <p className={`text-2xl font-bold mt-0.5 ${color}`}>{value}</p>
          </div>
        ))}
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-400">
          {selectedIds.size > 0 ? `${selectedIds.size} item dipilih` : `${items.length} produk`}
        </p>
        <div className="flex items-center gap-2">
          {selectedIds.size > 0 && (
            <button
              onClick={() => { setError(""); setBulkConfirmOpen(true); }}
              className="px-4 py-2 bg-red-600 text-white text-sm font-semibold rounded-xl hover:bg-red-700 transition"
            >
              🗑 Hapus {selectedIds.size} item
            </button>
          )}
          <button onClick={loadItems} className="text-xs text-blue-600 hover:underline font-medium">Refresh</button>
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <div className="text-center py-12 text-slate-400 text-sm">Memuat…</div>
      ) : items.length === 0 ? (
        <div className="text-center py-12 text-slate-400 text-sm">
          Belum ada produk di stok club ini.<br />
          <span className="text-xs">Transfer produk dari gudang owner untuk mengisi stok.</span>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
              <tr>
                <th className="pl-4 pr-2 py-3 w-8">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    ref={(el) => { if (el) el.indeterminate = someSelected && !allSelected; }}
                    onChange={toggleAll}
                    className="rounded cursor-pointer"
                  />
                </th>
                <th className="px-4 py-3 text-left">Nama Produk</th>
                <th className="px-4 py-3 text-left">Kategori</th>
                <th className="px-4 py-3 text-right">Stok</th>
                <th className="px-4 py-3 text-right">Min</th>
                <th className="px-4 py-3 text-center">Status</th>
                <th className="px-2 py-3 w-10"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((item) => {
                const isLow     = item.currentStock <= item.minimumStock;
                const isChecked = selectedIds.has(item.id);
                return (
                  <tr key={item.id} className={`hover:bg-slate-50 group ${isChecked ? "bg-red-50/40" : ""}`}>
                    <td className="pl-4 pr-2 py-3">
                      <input type="checkbox" checked={isChecked} onChange={() => toggleOne(item.id)} className="rounded cursor-pointer" />
                    </td>
                    <td className="px-4 py-3 font-medium text-slate-800">{item.name}</td>
                    <td className="px-4 py-3 text-slate-500 text-xs">{item.category ?? "—"}</td>
                    <td className={`px-4 py-3 text-right ${isLow ? "text-red-600" : "text-slate-800"}`}>
                      <span className="font-semibold">{item.currentStock}</span>
                      <span className="text-xs font-normal text-slate-400 ml-1">{item.unit}</span>
                      {item.takaran?.length ? (
                        <p className="text-[11px] text-slate-400 mt-0.5">
                          {takaranSummary(item.currentStock, item.takaran)}
                        </p>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-400 text-xs">{item.minimumStock}</td>
                    <td className="px-4 py-3 text-center">
                      {isLow
                        ? <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-600">Menipis ⚠</span>
                        : <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-green-100 text-green-600">OK</span>
                      }
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
            <p className="font-bold text-slate-900 mb-1">Hapus {selectedIds.size} Produk?</p>
            <p className="text-xs text-slate-400 mb-3">Produk berikut akan dihapus dari stok club:</p>
            <ul className="mb-4 max-h-48 overflow-y-auto space-y-1">
              {items.filter((i) => selectedIds.has(i.id)).map((i) => (
                <li key={i.id} className="flex items-center justify-between text-sm px-3 py-1.5 bg-red-50 rounded-lg">
                  <span className="font-medium text-slate-800">{i.name}</span>
                  {i.currentStock > 0 && (
                    <span className="text-xs text-amber-600 font-semibold ml-2 shrink-0text-right">
                      {i.currentStock} {i.unit}
                      {i.takaran?.length ? ` (${takaranSummary(i.currentStock, i.takaran)})` : ""}
                    </span>
                  )}
                </li>
              ))}
            </ul>
            {error && <div className="mb-3 text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</div>}
            <div className="flex gap-3">
              <button onClick={() => { setBulkConfirmOpen(false); setError(""); }} className="flex-1 border border-slate-200 text-slate-600 rounded-xl py-2.5 text-sm font-semibold hover:bg-slate-50">Batal</button>
              <button onClick={handleBulkDelete} disabled={bulkDeleting} className="flex-1 bg-red-600 text-white rounded-xl py-2.5 text-sm font-semibold hover:bg-red-700 disabled:opacity-50">
                {bulkDeleting ? "Menghapus…" : `Ya, Hapus ${selectedIds.size} Produk`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Single delete confirm dialog */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm mx-4">
            <p className="font-bold text-slate-900 mb-1">Hapus Produk dari Stok?</p>
            <p className="text-sm text-slate-600 mb-1"><span className="font-semibold">{deleteTarget.name}</span></p>
            <p className="text-xs text-slate-400 mb-4">
              {deleteTarget.currentStock > 0
                ? `Stok saat ini: ${deleteTarget.currentStock} ${deleteTarget.unit}${
                    deleteTarget.takaran?.length
                      ? ` (${takaranSummary(deleteTarget.currentStock, deleteTarget.takaran)})`
                      : ""
                  }. Produk akan dihapus dari daftar stok club.`
                : "Produk akan dihapus dari daftar stok club."}
            </p>
            {error && <div className="mb-3 text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</div>}
            <div className="flex gap-3">
              <button onClick={() => { setDeleteTarget(null); setError(""); }} className="flex-1 border border-slate-200 text-slate-600 rounded-xl py-2.5 text-sm font-semibold hover:bg-slate-50">Batal</button>
              <button onClick={handleDelete} disabled={deleting} className="flex-1 bg-red-600 text-white rounded-xl py-2.5 text-sm font-semibold hover:bg-red-700 disabled:opacity-50">
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
// TAB: RESEP
// ══════════════════════════════════════════════════════════════════════════════

function ResepTab({ ownerId, clubId }: { ownerId: string; clubId: string }) {
  // ── Data ─────────────────────────────────────────────────────────────────────
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [products, setProducts] = useState<InventoryItem[]>([]); // club stock — for ingredient suggestions
  const [loading, setLoading] = useState(true);

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
    } finally {
      setLoading(false);
    }
  }, [ownerId, clubId]);

  useEffect(() => { loadData(); }, [loadData]);

  // ── Form state ───────────────────────────────────────────────────────────────
  const [selected, setSelected] = useState<Recipe | "new" | null>(null);
  const [recipeDeleteTarget, setRecipeDeleteTarget] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [recipeError, setRecipeError] = useState("");
  const [formName, setFormName] = useState("");
  const [formPrices, setFormPrices] = useState<RecipePrices>(emptyPrices());
  const [formIngredients, setFormIngredients] = useState<RecipeIngredient[]>([]);
  const [ingDropdownOpenIdx, setIngDropdownOpenIdx] = useState<number | null>(null);

  const emptyRow = (): RecipeIngredient => ({
    inventoryItemId: null, inventoryItemName: "", quantity: 1, unit: "", unitAmount: null,
  });

  function openNew() {
    setSelected("new");
    setFormName("");
    setFormPrices(emptyPrices());
    setFormIngredients([emptyRow()]);
    setRecipeError("");
  }

  function openEdit(r: Recipe) {
    setSelected(r);
    setFormName(r.name);
    setFormPrices(r.prices ?? emptyPrices());
    setFormIngredients(r.ingredients.length > 0 ? r.ingredients : [emptyRow()]);
    setRecipeError("");
  }

  function addIngredientRow() {
    setFormIngredients((prev) => [...prev, emptyRow()]);
  }

  function removeIngredientRow(idx: number) {
    setFormIngredients((prev) => prev.filter((_, i) => i !== idx));
  }

  function setIngRowName(idx: number, name: string) {
    setFormIngredients((prev) =>
      prev.map((row, i) => i !== idx ? row : {
        ...row, inventoryItemName: name, inventoryItemId: null, unitAmount: null,
      })
    );
  }

  function setIngRowProduct(idx: number, p: InventoryItem) {
    // Auto-select first takaran option if the product has serving data
    const firstTakaran = p.takaran?.[0] ?? null;
    setFormIngredients((prev) =>
      prev.map((row, i) => i !== idx ? row : {
        ...row,
        inventoryItemId: p.id,
        inventoryItemName: p.name,
        unit: firstTakaran ? firstTakaran.name : (row.unit || p.unit),
        unitAmount: firstTakaran ? firstTakaran.amount : null,
      })
    );
  }

  function setIngRowQty(idx: number, qty: number) {
    setFormIngredients((prev) => prev.map((row, i) => i !== idx ? row : { ...row, quantity: qty }));
  }

  function setIngRowUnit(idx: number, unit: string) {
    setFormIngredients((prev) => prev.map((row, i) => i !== idx ? row : { ...row, unit, unitAmount: null }));
  }

  /** Called when user picks a takaran from the dropdown (linked product has serving data). */
  function setIngRowTakaran(idx: number, takaranName: string, linkedProduct: InventoryItem) {
    const t = linkedProduct.takaran?.find((tk) => tk.name === takaranName) ?? null;
    setFormIngredients((prev) =>
      prev.map((row, i) => i !== idx ? row : {
        ...row, unit: takaranName, unitAmount: t ? t.amount : null,
      })
    );
  }

  async function handleSaveRecipe() {
    if (!formName.trim()) { setRecipeError("Nama menu wajib diisi"); return; }
    const validIng = formIngredients.filter((i) => i.inventoryItemName.trim() && i.quantity > 0);
    if (validIng.length === 0) { setRecipeError("Minimal satu bahan wajib diisi"); return; }
    setSaving(true);
    setRecipeError("");
    // Only send prices if at least one tier has been set
    const hasPrices = Object.values(formPrices).some((v) => v > 0);
    const pricesPayload = hasPrices ? formPrices : null;

    try {
      if (selected === "new") {
        await callFunction("club_createRecipe", {
          ownerId, clubId, name: formName.trim(), ingredients: validIng,
          prices: pricesPayload,
        });
      } else if (selected) {
        await callFunction("club_updateRecipe", {
          ownerId, clubId,
          recipeId: (selected as Recipe).id,
          name: formName.trim(),
          ingredients: validIng,
          prices: pricesPayload,
        });
      }
      setSelected(null);
      loadData();
    } catch (e) {
      setRecipeError(e instanceof Error ? e.message : "Gagal menyimpan menu");
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteRecipe(recipeId: string) {
    setDeleting(true);
    try {
      await callFunction("club_deleteRecipe", { ownerId, clubId, recipeId });
      setRecipeDeleteTarget(null);
      if (selected !== "new" && (selected as Recipe | null)?.id === recipeId) setSelected(null);
      loadData();
    } catch (e) {
      setRecipeError(e instanceof Error ? e.message : "Gagal menghapus menu");
    } finally {
      setDeleting(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div className="flex gap-5 h-full min-h-0">

      {/* ── LEFT: menu list ────────────────────────────────────────────────────── */}
      <div className="w-64 shrink-0 flex flex-col gap-3 overflow-y-auto">
        <button
          type="button"
          onClick={openNew}
          className="w-full py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-xl hover:bg-blue-700 transition flex items-center justify-center gap-2 shrink-0"
        >
          <span className="text-base leading-none">+</span> Menu Baru
        </button>

        <div className="flex items-center justify-between px-0.5">
          <span className="text-xs text-slate-400">{recipes.length} menu</span>
          <button
            type="button"
            onClick={loadData}
            className="text-xs text-blue-600 hover:underline font-medium"
          >
            {loading ? "Memuat…" : "Refresh"}
          </button>
        </div>

        {recipes.length === 0 && !loading ? (
          <div className="text-center py-10 text-slate-400 text-sm">
            <p className="text-2xl mb-2">🍹</p>
            <p>Belum ada menu.</p>
            <p className="text-xs mt-1">Klik "+ Menu Baru" untuk mulai.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {recipes.map((r) => {
              const isSelected = selected !== "new" && (selected as Recipe | null)?.id === r.id;
              const stockLinked = r.ingredients.filter((i) => i.inventoryItemId).length;
              return (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => openEdit(r)}
                  className={`w-full text-left p-3.5 rounded-xl border transition ${
                    isSelected
                      ? "border-blue-400 bg-blue-50 shadow-sm"
                      : "border-slate-200 bg-white hover:border-blue-200 hover:bg-slate-50"
                  }`}
                >
                  <p className={`text-sm font-semibold ${isSelected ? "text-blue-800" : "text-slate-800"}`}>
                    {r.name}
                  </p>
                  {r.ingredients.length > 0 && (
                    <p className="text-xs text-slate-400 mt-1 leading-relaxed line-clamp-2">
                      {r.ingredients.map((i) => i.inventoryItemName).join(" · ")}
                    </p>
                  )}
                  <div className="flex items-center gap-2 mt-2 flex-wrap">
                    <span className="text-[10px] text-slate-400">{r.ingredients.length} bahan</span>
                    {stockLinked > 0 && (
                      <span className="text-[10px] px-1.5 py-0.5 bg-blue-50 text-blue-600 rounded-full font-semibold">
                        📦 {stockLinked} dari stok
                      </span>
                    )}
                    {r.prices ? (
                      <span className="text-[10px] px-1.5 py-0.5 bg-green-50 text-green-700 rounded-full font-semibold">
                        {fmtIdr(r.prices.retail)}
                      </span>
                    ) : (
                      <span className="text-[10px] px-1.5 py-0.5 bg-amber-50 text-amber-600 rounded-full font-semibold">
                        belum ada harga
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* ── RIGHT: form ────────────────────────────────────────────────────────── */}
      {selected !== null ? (
        <div className="flex-1 flex gap-4 min-h-0 overflow-y-auto">

          {/* Form card */}
          <div className="flex-1 bg-white rounded-xl border border-slate-200 p-5 flex flex-col gap-5">

            {/* Header */}
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-slate-800 text-base">
                {selected === "new" ? "🍹 Menu Baru" : "✏️ Edit Menu"}
              </h3>
              {selected !== "new" && (
                <button
                  type="button"
                  onClick={() => setRecipeDeleteTarget((selected as Recipe).id)}
                  className="text-xs text-red-400 hover:text-red-600 font-medium"
                >
                  Hapus Menu
                </button>
              )}
            </div>

            {recipeError && (
              <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 flex items-start gap-2">
                <span className="shrink-0">⚠</span>
                <span>{recipeError}</span>
              </div>
            )}

            {/* Nama Menu */}
            <div>
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide block mb-1.5">
                Nama Menu
              </label>
              <input
                autoFocus={selected === "new"}
                className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium"
                placeholder="Contoh: Shake Protein Vanila, Tropical Smoothie…"
                value={formName}
                onChange={(e) => { setFormName(e.target.value); if (recipeError) setRecipeError(""); }}
                onKeyDown={(e) => { if (e.key === "Enter") document.getElementById("first-ing-input")?.focus(); }}
              />
            </div>

            {/* Harga per Tier */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                  Harga Jual
                </label>
                <span className="text-[11px] text-slate-400">per tier pelanggan</span>
              </div>
              <div className="grid grid-cols-5 gap-1.5">
                {PRICE_TIERS.map((t) => (
                  <div key={t.key}>
                    <label className="block text-[10px] text-slate-400 mb-1 text-center">{t.label}</label>
                    <input
                      type="number"
                      min="0"
                      step="1000"
                      className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs text-right focus:outline-none focus:ring-2 focus:ring-blue-400"
                      placeholder="0"
                      value={formPrices[t.key] || ""}
                      onChange={(e) => setFormPrices((p) => ({ ...p, [t.key]: parseFloat(e.target.value) || 0 }))}
                    />
                  </div>
                ))}
              </div>
              {Object.values(formPrices).every((v) => v === 0) && (
                <p className="text-[11px] text-amber-600 mt-1.5">
                  ⚠ Menu tanpa harga tidak akan muncul di POS operator.
                </p>
              )}
            </div>

            {/* Bahan-bahan */}
            <div className="flex-1 flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                  Bahan-bahan
                </label>
                <span className="text-[11px] text-slate-400">
                  📦 = stok terpotong · ✏️ = bebas
                </span>
              </div>

              {/* Table */}
              <div className="rounded-xl border border-slate-200 overflow-visible">
                {/* Column headers */}
                <div className="grid grid-cols-[1fr_76px_86px_32px] bg-slate-50 border-b border-slate-200 rounded-t-xl">
                  <div className="px-3 py-2 text-[11px] font-semibold text-slate-400 uppercase tracking-wide">Bahan</div>
                  <div className="px-2 py-2 text-[11px] font-semibold text-slate-400 uppercase tracking-wide text-right">Jumlah</div>
                  <div className="px-2 py-2 text-[11px] font-semibold text-slate-400 uppercase tracking-wide">Satuan</div>
                  <div />
                </div>

                <div className="divide-y divide-slate-100">
                  {formIngredients.map((row, idx) => {
                    const suggestions = products.filter((p) =>
                      !row.inventoryItemName.trim()
                        ? true
                        : p.name.toLowerCase().includes(row.inventoryItemName.toLowerCase().trim())
                    );
                    const isLinked = !!row.inventoryItemId;
                    const linkedProduct = isLinked ? products.find((p) => p.id === row.inventoryItemId) : null;

                    return (
                      <div key={idx} className="grid grid-cols-[1fr_76px_86px_32px] items-center">
                        {/* Bahan — combobox */}
                        <div className="relative px-2 py-1.5">
                          <div className="relative">
                            <input
                              id={idx === 0 ? "first-ing-input" : undefined}
                              className={`w-full border rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 pr-12 ${
                                isLinked ? "border-blue-300 bg-blue-50/50" : "border-slate-200 bg-white"
                              }`}
                              placeholder="Ketik atau pilih…"
                              value={row.inventoryItemName}
                              onChange={(e) => { setIngRowName(idx, e.target.value); setIngDropdownOpenIdx(idx); }}
                              onFocus={() => setIngDropdownOpenIdx(idx)}
                              onBlur={() => setTimeout(() => setIngDropdownOpenIdx(null), 150)}
                              onKeyDown={(e) => { if (e.key === "Escape") setIngDropdownOpenIdx(null); }}
                            />
                            <span className={`absolute right-1.5 top-1/2 -translate-y-1/2 text-[10px] px-1 py-0.5 rounded-full font-bold whitespace-nowrap ${
                              isLinked ? "bg-blue-100 text-blue-600" : "bg-slate-100 text-slate-400"
                            }`}>
                              {isLinked
                                ? `📦${linkedProduct ? ` ${linkedProduct.currentStock}` : ""}`
                                : "✏️"}
                            </span>
                          </div>
                          {/* Dropdown suggestions */}
                          {ingDropdownOpenIdx === idx && suggestions.length > 0 && (
                            <div className="absolute z-30 left-2 right-2 top-full mt-1 bg-white border border-slate-200 rounded-xl shadow-xl max-h-48 overflow-y-auto">
                              <p className="text-[10px] text-slate-400 px-3 pt-2 pb-1 font-semibold uppercase tracking-wide">
                                Stok produk club
                              </p>
                              {suggestions.map((p) => (
                                <button
                                  key={p.id}
                                  type="button"
                                  onMouseDown={() => { setIngRowProduct(idx, p); setIngDropdownOpenIdx(null); }}
                                  className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50 flex items-center justify-between gap-2"
                                >
                                  <span className="font-medium text-slate-800">{p.name}</span>
                                  <span className="text-xs text-slate-400 shrink-0">
                                    stok {p.currentStock} {p.unit}
                                  </span>
                                </button>
                              ))}
                            </div>
                          )}
                        </div>

                        {/* Jumlah */}
                        <div className="px-1.5 py-1.5">
                          <input
                            type="number"
                            min="0.001"
                            step="0.1"
                            className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm text-right focus:outline-none focus:ring-2 focus:ring-blue-400"
                            placeholder="0"
                            value={row.quantity}
                            onChange={(e) => setIngRowQty(idx, parseFloat(e.target.value) || 0)}
                          />
                        </div>

                        {/* Satuan — dropdown when linked product has takaran, else free-text */}
                        <div className="px-1.5 py-1.5">
                          {linkedProduct?.takaran?.length ? (() => {
                            // Check if current unit matches a known takaran option
                            const unitMatchesTakaran = linkedProduct.takaran.some(
                              (t) => t.name === row.unit
                            );
                            return (
                              <select
                                className="w-full border border-blue-200 rounded-lg px-2 py-1.5 text-sm bg-blue-50/50 focus:outline-none focus:ring-2 focus:ring-blue-400"
                                value={row.unit}
                                onChange={(e) => setIngRowTakaran(idx, e.target.value, linkedProduct)}
                              >
                                <option value="">Pilih takaran…</option>
                                {linkedProduct.takaran.map((t) => (
                                  <option key={t.name} value={t.name}>
                                    {t.name} ({t.amount}{linkedProduct.baseUnit ?? "g"})
                                  </option>
                                ))}
                                {/* Preserve old unit value that doesn't match any takaran */}
                                {row.unit && !unitMatchesTakaran && (
                                  <option value={row.unit} disabled>
                                    {row.unit} ⚠ bukan takaran standar
                                  </option>
                                )}
                              </select>
                            );
                          })() : (
                            <input
                              className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                              placeholder="gram, ml…"
                              value={row.unit}
                              onChange={(e) => setIngRowUnit(idx, e.target.value)}
                            />
                          )}
                        </div>

                        {/* Hapus */}
                        <div className="flex justify-center">
                          <button
                            type="button"
                            onClick={() => removeIngredientRow(idx)}
                            disabled={formIngredients.length === 1}
                            className="text-slate-300 hover:text-red-400 disabled:opacity-20 transition p-1"
                            title="Hapus bahan"
                          >
                            ×
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Add row */}
              <button
                type="button"
                onClick={addIngredientRow}
                className="w-full py-2 border border-dashed border-slate-300 rounded-xl text-sm text-slate-400 hover:border-blue-400 hover:text-blue-600 hover:bg-blue-50/50 transition font-medium"
              >
                + Tambah bahan
              </button>
            </div>

            {/* Actions */}
            <div className="flex gap-3 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="border border-slate-200 text-slate-600 rounded-xl px-5 py-2.5 text-sm font-semibold hover:bg-slate-50"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleSaveRecipe}
                disabled={saving}
                className="flex-1 bg-blue-600 text-white rounded-xl py-2.5 text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {saving && <span className="inline-block w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                {saving ? "Menyimpan…" : "Simpan Menu"}
              </button>
            </div>
          </div>

          {/* Cara Pakai */}
          <div className="w-40 shrink-0">
            <div className="bg-green-50 border border-green-200 rounded-xl p-4 sticky top-0">
              <p className="text-sm font-bold text-green-800 mb-3">Cara Pakai</p>
              <ol className="text-xs text-green-700 space-y-2.5">
                {[
                  "Isi nama menu",
                  "Ketik nama bahan — pilih dari stok club (📦) agar stok terpotong otomatis, atau ketik bebas (✏️)",
                  "Isi jumlah & satuan",
                  "Tambah bahan berikutnya",
                  "Simpan",
                ].map((step, i) => (
                  <li key={i} className="flex items-start gap-1.5">
                    <span className="shrink-0 w-4 h-4 bg-green-200 text-green-800 rounded-full text-[10px] font-bold flex items-center justify-center mt-0.5">
                      {i + 1}
                    </span>
                    <span>{step}</span>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-slate-300">
          <span className="text-5xl">🍹</span>
          <p className="text-sm font-medium">Pilih menu untuk diedit</p>
          <p className="text-xs">atau klik <strong className="text-blue-400">+ Menu Baru</strong></p>
        </div>
      )}

      {/* Delete confirm */}
      {recipeDeleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-xs mx-4">
            <p className="font-bold text-slate-900 mb-2">Hapus Menu?</p>
            <p className="text-sm text-slate-500 mb-5">
              Menu ini akan dihapus. Stok bahan tidak akan terpotong lagi saat menu ini terjual.
            </p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setRecipeDeleteTarget(null)}
                className="flex-1 border border-slate-200 rounded-xl py-2.5 text-sm font-semibold"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={() => handleDeleteRecipe(recipeDeleteTarget)}
                disabled={deleting}
                className="flex-1 bg-red-600 text-white rounded-xl py-2.5 text-sm font-semibold disabled:opacity-50"
              >
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
