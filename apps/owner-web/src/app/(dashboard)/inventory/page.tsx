"use client";

import { useEffect, useState, useMemo } from "react";
import { collection, getDocs, query, orderBy, limit, doc, updateDoc } from "firebase/firestore";
import { useOwnerAuthStore } from "@/store/auth.store";
import { callFunction, firebaseDb } from "@/firebase/firebase";
import { v4 as uuidv4 } from "uuid";

// ── Types ─────────────────────────────────────────────────────────────────────

interface PriceTiers {
  retail: number; ds: number; sc: number; sbQp: number; spv: number;
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
  id: string; name: string; category: string; prices: PriceTiers;
}

interface InventoryMovement {
  id: string;
  inventoryItemId: string;
  itemName: string;
  movementType: string;
  quantity: number;
  stockBefore: number;
  stockAfter: number;
  referenceId: string | null;
  referenceType: string | null;
  notes: string | null;
  createdAt: string;
}

interface Replenishment {
  id: string;
  items: { productId: string; productName: string; quantity: number; unitPrice: number; subtotal: number }[];
  totalCost: number;
  notes: string | null;
  createdAt: string;
}


// ── Constants ─────────────────────────────────────────────────────────────────

const TIER_LABELS: { key: keyof PriceTiers; label: string }[] = [
  { key: "retail", label: "Retail" },
  { key: "ds", label: "DS" },
  { key: "sc", label: "SC" },
  { key: "sbQp", label: "SB-QP" },
  { key: "spv", label: "SPV" },
];

const MOVEMENT_TYPE_LABEL: Record<string, string> = {
  sale: "Penjualan",
  restock: "Restok",
  adjustment: "Penyesuaian",
  waste: "Susut",
  transfer_in: "Transfer Masuk",
  transfer_out: "Transfer Keluar",
  opening_stock: "Stok Awal",
  reversal: "Pembatalan",
};

const MOVEMENT_TYPE_COLOR: Record<string, string> = {
  sale:          "bg-red-50 text-red-600",
  restock:       "bg-green-50 text-green-700",
  adjustment:    "bg-blue-50 text-blue-600",
  waste:         "bg-orange-50 text-orange-600",
  transfer_in:   "bg-teal-50 text-teal-700",
  transfer_out:  "bg-orange-50 text-orange-600",
  opening_stock: "bg-slate-50 text-slate-600",
  reversal:      "bg-purple-50 text-purple-600",
};

const fmt = (n: number) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);

// ── StockTable component ──────────────────────────────────────────────────────

type SortState = "name_asc" | "name_desc" | "stock_desc" | "stock_asc" | null;

function cycleSort(prev: SortState, col: "name" | "stock"): SortState {
  if (col === "name") {
    if (prev === "name_asc") return "name_desc";
    if (prev === "name_desc") return null;
    return "name_asc";
  } else {
    if (prev === "stock_desc") return "stock_asc";
    if (prev === "stock_asc") return null;
    return "stock_desc";
  }
}

function SortIcon({ col, sort }: { col: "name" | "stock"; sort: SortState }) {
  if (col === "name") {
    if (sort === "name_asc") return <span>↑</span>;
    if (sort === "name_desc") return <span>↓</span>;
  } else {
    if (sort === "stock_desc") return <span>↓</span>;
    if (sort === "stock_asc") return <span>↑</span>;
  }
  return <span className="opacity-30">↕</span>;
}

function StockTable({
  items, loading, sort, onSort,
  selectedIds, onSelectionChange,
  detailItem, onSelect,
}: {
  items: InventoryItem[];
  loading: boolean;
  sort: SortState;
  onSort: (col: "name" | "stock") => void;
  selectedIds?: Set<string>;
  onSelectionChange?: (ids: Set<string>) => void;
  detailItem?: InventoryItem | null;
  onSelect?: (item: InventoryItem | null) => void;
}) {
  const sorted = useMemo(() => {
    if (!sort) return items;
    return [...items].sort((a, b) => {
      if (sort === "name_asc") return a.name.localeCompare(b.name, "id");
      if (sort === "name_desc") return b.name.localeCompare(a.name, "id");
      if (sort === "stock_desc") return b.currentStock - a.currentStock;
      return a.currentStock - b.currentStock;
    });
  }, [items, sort]);

  const selectable = !!(selectedIds && onSelectionChange);
  const allSelected = selectable && sorted.length > 0 && sorted.every((i) => selectedIds!.has(i.id));
  const someSelected = selectable && sorted.some((i) => selectedIds!.has(i.id));

  function toggleAll() {
    if (!onSelectionChange) return;
    if (allSelected) {
      const next = new Set(selectedIds);
      sorted.forEach((i) => next.delete(i.id));
      onSelectionChange(next);
    } else {
      const next = new Set(selectedIds);
      sorted.forEach((i) => next.add(i.id));
      onSelectionChange(next);
    }
  }

  function toggleOne(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    if (!onSelectionChange || !selectedIds) return;
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    onSelectionChange(next);
  }

  if (loading) return <p className="text-sm text-slate-400 p-4">Memuat…</p>;
  if (items.length === 0) return <p className="text-sm text-slate-400 p-4">Belum ada produk.</p>;

  return (
    <table className="w-full text-sm">
      <thead className="bg-slate-50 text-slate-500 text-xs">
        <tr>
          {selectable && (
            <th className="px-3 py-2.5 w-8">
              <input
                type="checkbox"
                checked={allSelected}
                ref={(el) => { if (el) el.indeterminate = someSelected && !allSelected; }}
                onChange={toggleAll}
                className="rounded"
              />
            </th>
          )}
          <th className="px-4 py-2.5 text-left">
            <button onClick={() => onSort("name")} className="inline-flex items-center gap-1 hover:text-blue-600 transition-colors">
              Nama <SortIcon col="name" sort={sort} />
            </button>
          </th>
          <th className="px-4 py-2.5 text-left">Kategori</th>
          <th className="px-4 py-2.5 text-left">Satuan</th>
          <th className="px-4 py-2.5 text-right">
            <button onClick={() => onSort("stock")} className="inline-flex items-center gap-1 hover:text-blue-600 transition-colors">
              Stok <SortIcon col="stock" sort={sort} />
            </button>
          </th>
          <th className="px-4 py-2.5 text-right">Min.</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100">
        {sorted.map((item) => {
          const low = item.currentStock <= item.minimumStock;
          const isChecked = selectable && selectedIds!.has(item.id);
          const isDetail = detailItem?.id === item.id;
          return (
            <tr
              key={item.id}
              onClick={() => onSelect?.(isDetail ? null : item)}
              className={`transition ${onSelect ? "cursor-pointer" : ""} ${
                isDetail
                  ? "bg-blue-50"
                  : isChecked
                  ? "bg-amber-50"
                  : low
                  ? "bg-red-50/30 hover:bg-red-50/60"
                  : "hover:bg-slate-50"
              }`}
            >
              {selectable && (
                <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => {}}
                    onClick={(e) => toggleOne(item.id, e)}
                    className="rounded"
                  />
                </td>
              )}
              <td className="px-4 py-2.5 font-medium text-slate-800">{item.name}</td>
              <td className="px-4 py-2.5 text-slate-500 text-xs">{item.category ?? "—"}</td>
              <td className="px-4 py-2.5 text-slate-500">{item.unit}</td>
              <td className={`px-4 py-2.5 text-right font-semibold ${low ? "text-red-600" : "text-slate-800"}`}>
                {item.currentStock}
                {low && <span className="ml-1 text-xs font-normal">!</span>}
              </td>
              <td className="px-4 py-2.5 text-right text-slate-400">{item.minimumStock}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

type PageTab = "owner" | "restock" | "movements";

export default function InventoryPage() {
  const { ownerId, clubId } = useOwnerAuthStore();

  const [activeTab, setActiveTab] = useState<PageTab>("owner");

  // ── Tab: owner inventory ────────────────────────────────────────────────────

  const [items, setItems] = useState<InventoryItem[]>([]);
  const [catalog, setCatalog] = useState<CatalogProduct[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [ownerSort, setOwnerSort] = useState<SortState>(null);

  // Detail panel (click a row)
  const [selectedItem, setSelectedItem] = useState<InventoryItem | null>(null);

  // Catalog picker
  const [selectedCatalogIds, setSelectedCatalogIds] = useState<Set<string>>(new Set());
  const [bulkUnit, setBulkUnit] = useState<"pcs" | "kaleng" | "botol">("pcs");
  const [bulkMinStock, setBulkMinStock] = useState("");
  const [addLoading, setAddLoading] = useState(false);
  const [addFeedback, setAddFeedback] = useState<{ type: "ok" | "err"; msg: string } | undefined>();

  // Inline adjust (in detail panel)
  const [newStock, setNewStock] = useState("");
  const [adjustLoading, setAdjustLoading] = useState(false);
  const [adjustFeedback, setAdjustFeedback] = useState<{ type: "ok" | "err"; msg: string } | undefined>();

  // Bulk / single remove
  const [removingItem, setRemovingItem] = useState<InventoryItem | null>(null);
  const [removeLoading, setRemoveLoading] = useState(false);
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());
  const [bulkRemoving, setBulkRemoving] = useState(false);
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false);

  // Reset adjust form when switching selected item
  useEffect(() => {
    setNewStock("");
    setAdjustFeedback(undefined);
  }, [selectedItem?.id]);

  async function deactivateItem(id: string) {
    const itemRef = doc(firebaseDb(), `owners/${ownerId}/inventoryItems/${id}`);
    await updateDoc(itemRef, { isActive: false, updatedAt: new Date().toISOString() });
  }

  async function handleRemove() {
    if (!removingItem || !ownerId) return;
    setRemoveLoading(true);
    try {
      await deactivateItem(removingItem.id);
      if (selectedItem?.id === removingItem.id) setSelectedItem(null);
      setRemovingItem(null);
      loadItems();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Gagal menghapus");
    } finally {
      setRemoveLoading(false);
    }
  }

  async function handleBulkRemove() {
    if (selectedItemIds.size === 0 || !ownerId) return;
    setBulkRemoving(true);
    try {
      await Promise.all([...selectedItemIds].map((id) => deactivateItem(id)));
      if (selectedItem && selectedItemIds.has(selectedItem.id)) setSelectedItem(null);
      setBulkConfirmOpen(false);
      setSelectedItemIds(new Set());
      loadItems();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Gagal menghapus sebagian item");
    } finally {
      setBulkRemoving(false);
    }
  }

  function toggleCatalogItem(id: string) {
    setSelectedCatalogIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleCategory(ids: string[], allSelected: boolean) {
    setSelectedCatalogIds((prev) => {
      const next = new Set(prev);
      if (allSelected) ids.forEach((id) => next.delete(id));
      else ids.forEach((id) => next.add(id));
      return next;
    });
  }

  async function handleBulkAdd() {
    if (selectedCatalogIds.size === 0 || !ownerId) return;
    setAddLoading(true); setAddFeedback(undefined);
    const ids = [...selectedCatalogIds];
    let ok = 0;
    let skipped = 0;
    const errors: string[] = [];
    try {
      for (const productCatalogId of ids) {
        try {
          await callFunction("inventory_addFromCatalog", {
            ownerId, clubId, productCatalogId,
            unit: bulkUnit,
            minimumStock: parseFloat(bulkMinStock) || 0,
          });
          ok++;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          // 409 = already-exists → skip silently, item already in inventory
          if (msg.includes("already-exists") || msg.includes("sudah ada")) {
            skipped++;
          } else {
            const name = catalog.find((p) => p.id === productCatalogId)?.name ?? productCatalogId;
            errors.push(`${name} (${msg})`);
          }
        }
      }
      const parts: string[] = [];
      if (ok > 0) parts.push(`${ok} produk ditambahkan`);
      if (skipped > 0) parts.push(`${skipped} sudah ada (dilewati)`);
      setAddFeedback(
        errors.length === 0
          ? { type: "ok", msg: parts.join(", ") || "Selesai" }
          : { type: "err", msg: `${parts.join(", ")}. Gagal: ${errors.join("; ")}` }
      );
      setSelectedCatalogIds(new Set());
      await loadItems();
    } finally {
      setAddLoading(false);
    }
  }

  async function handleAdjust() {
    if (!selectedItem) return;
    const qty = parseInt(newStock, 10);
    if (isNaN(qty) || qty < 0) {
      setAdjustFeedback({ type: "err", msg: "Isi stok baru yang valid" });
      return;
    }
    setAdjustLoading(true); setAdjustFeedback(undefined);
    try {
      await callFunction("inventory_adjustStock", {
        ownerId, clubId, requestId: uuidv4(), operationId: uuidv4(),
        inventoryItemId: selectedItem.id, quantity: qty, unitCost: 0,
      });
      setAdjustFeedback({ type: "ok", msg: `Stok diperbarui → ${qty}` });
      setNewStock("");
      await loadItems();
      // Refresh selectedItem with updated stock
      setSelectedItem((prev) => prev ? { ...prev, currentStock: qty } : null);
    } catch (err) {
      setAdjustFeedback({ type: "err", msg: err instanceof Error ? err.message : "Gagal" });
    } finally { setAdjustLoading(false); }
  }

  async function loadItems() {
    if (!ownerId) return;
    setLoadingList(true);
    try {
      const snap = await getDocs(
        collection(firebaseDb(), `owners/${ownerId}/inventoryItems`)
      );
      const all = snap.docs.map((d) => ({ id: d.id, ...d.data() } as InventoryItem));
      setItems(
        all
          .filter((i) => i.isActive !== false)
          .sort((a, b) => a.name.localeCompare(b.name, "id"))
      );
      setSelectedItemIds(new Set());
    } catch (err) {
      console.error("[inventory] loadItems failed:", err);
    } finally {
      setLoadingList(false);
    }
  }

  async function loadCatalog() {
    const snap = await getDocs(query(collection(firebaseDb(), "productCatalog"), orderBy("name")));
    setCatalog(snap.docs.map((d) => ({ id: d.id, ...d.data() } as CatalogProduct)));
  }

  useEffect(() => { loadItems(); loadCatalog(); }, [ownerId]);

  const addedIds = useMemo(
    () => new Set(
      items
        .filter((i) => i.isActive)
        .map((i) => (i as unknown as { productCatalogId?: string }).productCatalogId)
        .filter(Boolean) as string[]
    ),
    [items]
  );

  const catalogByCategory = useMemo(() => {
    const map = new Map<string, CatalogProduct[]>();
    for (const p of catalog) {
      const cat = p.category ?? "Lainnya";
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat)!.push(p);
    }
    return map;
  }, [catalog]);

  // ── Tab: restock ────────────────────────────────────────────────────────────

  const [restockQty, setRestockQty] = useState<Record<string, string>>({});
  const [restockCost, setRestockCost] = useState<Record<string, string>>({});
  const [restockNotes, setRestockNotes] = useState("");
  const [restocking, setRestocking] = useState(false);
  const [restockFeedback, setRestockFeedback] = useState<{ type: "ok" | "err"; msg: string } | undefined>();
  const [replenishments, setReplenishments] = useState<Replenishment[]>([]);
  const [loadingReplenishments, setLoadingReplenishments] = useState(false);

  const restockItems = useMemo(() =>
    items
      .filter((p) => p.isActive)
      .map((p) => {
        const qty = parseInt(restockQty[p.id] ?? "0", 10) || 0;
        const cost = parseFloat(restockCost[p.id] ?? "0") || 0;
        return { item: p, qty, cost, subtotal: qty * cost };
      })
      .filter((r) => r.qty > 0),
    [items, restockQty, restockCost]
  );

  const restockTotal = restockItems.reduce((s, r) => s + r.subtotal, 0);

  async function loadReplenishments() {
    if (!ownerId) return;
    setLoadingReplenishments(true);
    const snap = await getDocs(
      query(
        collection(firebaseDb(), `owners/${ownerId}/replenishments`),
        orderBy("createdAt", "desc"),
        limit(30)
      )
    );
    setReplenishments(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Replenishment)));
    setLoadingReplenishments(false);
  }

  useEffect(() => {
    if (activeTab === "restock") loadReplenishments();
  }, [activeTab, ownerId, clubId]);

  async function handleRestock() {
    if (restockItems.length === 0) return;
    setRestocking(true); setRestockFeedback(undefined);
    try {
      await callFunction("replenishment_complete", {
        ownerId, clubId,
        requestId: uuidv4(), operationId: uuidv4(),
        priceTier: "retail",
        notes: restockNotes.trim() || undefined,
        items: restockItems.map((r) => ({
          productId: r.item.id,
          productName: r.item.name,
          quantity: r.qty,
          unitPrice: r.cost,
          subtotal: r.subtotal,
        })),
      });
      setRestockFeedback({ type: "ok", msg: `Restok ${restockItems.length} produk berhasil dicatat` });
      setRestockQty({}); setRestockCost({}); setRestockNotes("");
      loadItems();
      loadReplenishments();
    } catch (err) {
      setRestockFeedback({ type: "err", msg: err instanceof Error ? err.message : "Gagal" });
    } finally { setRestocking(false); }
  }

  // ── Tab: movements ──────────────────────────────────────────────────────────

  const [movements, setMovements] = useState<InventoryMovement[]>([]);
  const [loadingMovements, setLoadingMovements] = useState(false);
  const [movementTypeFilter, setMovementTypeFilter] = useState("all");

  async function loadMovements() {
    if (!ownerId) return;
    setLoadingMovements(true);
    const snap = await getDocs(
      query(
        collection(firebaseDb(), `owners/${ownerId}/inventoryMovements`),
        orderBy("createdAt", "desc"),
        limit(100)
      )
    );
    setMovements(snap.docs.map((d) => ({ id: d.id, ...d.data() } as InventoryMovement)));
    setLoadingMovements(false);
  }

  useEffect(() => {
    if (activeTab === "movements") loadMovements();
  }, [activeTab, ownerId, clubId]);

  const filteredMovements = useMemo(() =>
    movementTypeFilter === "all"
      ? movements
      : movements.filter((m) => m.movementType === movementTypeFilter),
    [movements, movementTypeFilter]
  );

  // ── Render ──────────────────────────────────────────────────────────────────

  const TABS: { key: PageTab; label: string }[] = [
    { key: "owner",     label: "Produk & Stok" },
    { key: "restock",   label: "Restok" },
    { key: "movements", label: "Pergerakan Stok" },
  ];

  return (
    <div>
      <h2 className="text-2xl font-bold text-slate-900 mb-4">Produk &amp; Stok</h2>

      {/* Tab switcher */}
      <div className="flex items-center gap-1 border-b border-slate-200 mb-6">
        {TABS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={`px-5 py-2.5 text-sm font-semibold rounded-t-lg border-b-2 transition ${
              activeTab === key
                ? "border-blue-600 text-blue-700 bg-blue-50"
                : "border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-50"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── Tab: Produk & Stok ── */}
      {activeTab === "owner" && (
        <div className="flex gap-5">

          {/* Left: stock list */}
          <div className="flex-1 min-w-0">
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold text-slate-800">
                    Stok
                    {items.length > 0 && (
                      <span className="ml-1.5 text-xs font-normal text-slate-400">{items.length} produk</span>
                    )}
                  </h3>
                  {selectedItemIds.size > 0 && (
                    <span className="text-xs text-slate-400">· {selectedItemIds.size} dipilih</span>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  {selectedItemIds.size > 0 && (
                    <>
                      <button
                        onClick={() => setBulkConfirmOpen(true)}
                        disabled={bulkRemoving}
                        className="text-xs font-semibold text-red-600 hover:text-red-800 disabled:opacity-50 transition"
                      >
                        {bulkRemoving ? "Menghapus…" : `Hapus ${selectedItemIds.size}`}
                      </button>
                      <button onClick={() => setSelectedItemIds(new Set())} className="text-xs text-slate-400 hover:text-slate-600">
                        Batal
                      </button>
                    </>
                  )}
                  <button onClick={loadItems} className="text-xs text-blue-600 hover:underline">Refresh</button>
                </div>
              </div>
              <StockTable
                items={items}
                loading={loadingList}
                sort={ownerSort}
                onSort={(col) => setOwnerSort((p) => cycleSort(p, col))}
                selectedIds={selectedItemIds}
                onSelectionChange={setSelectedItemIds}
                detailItem={selectedItem}
                onSelect={setSelectedItem}
              />
            </div>
          </div>

          {/* Right: context panel */}
          <div className="w-72 shrink-0">
            {selectedItem ? (

              /* ── Item detail panel ── */
              <div className="bg-white rounded-xl border border-slate-200 overflow-hidden sticky top-4">
                {/* Header */}
                <div className="bg-slate-800 px-4 py-3 flex items-start justify-between">
                  <div className="min-w-0">
                    <p className="font-bold text-white text-sm leading-snug">{selectedItem.name}</p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {selectedItem.category ?? "Tanpa Kategori"} · {selectedItem.unit}
                    </p>
                  </div>
                  <button
                    onClick={() => setSelectedItem(null)}
                    className="text-slate-400 hover:text-white text-xl leading-none ml-3 shrink-0 mt-0.5"
                  >
                    ×
                  </button>
                </div>

                <div className="p-4 space-y-4 text-sm">

                  {/* Stock stats */}
                  <div className="flex gap-2">
                    <div className={`flex-1 rounded-xl px-3 py-3 text-center ${
                      selectedItem.currentStock <= selectedItem.minimumStock ? "bg-red-50" : "bg-slate-50"
                    }`}>
                      <p className={`text-2xl font-bold leading-none ${
                        selectedItem.currentStock <= selectedItem.minimumStock ? "text-red-600" : "text-slate-900"
                      }`}>
                        {selectedItem.currentStock}
                      </p>
                      <p className="text-xs text-slate-400 mt-1">Stok Saat Ini</p>
                    </div>
                    <div className="flex-1 bg-slate-50 rounded-xl px-3 py-3 text-center">
                      <p className="text-xl font-semibold text-slate-400 leading-none">{selectedItem.minimumStock}</p>
                      <p className="text-xs text-slate-400 mt-1">Minimum</p>
                    </div>
                  </div>

                  {/* Price tiers */}
                  {selectedItem.prices && (
                    <div>
                      <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Harga Jual</p>
                      <div className="space-y-0">
                        {TIER_LABELS.map((t) => (
                          <div key={t.key} className="flex justify-between py-1.5 border-b border-slate-50 last:border-0">
                            <span className="text-slate-500">{t.label}</span>
                            <span className="font-mono font-semibold text-slate-800 text-xs">
                              {fmt(selectedItem.prices[t.key])}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Adjust stock */}
                  <div>
                    <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Sesuaikan Stok</p>
                    {adjustFeedback && (
                      <div className={`mb-2 text-xs rounded-lg px-3 py-1.5 ${
                        adjustFeedback.type === "ok" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"
                      }`}>
                        {adjustFeedback.msg}
                      </div>
                    )}
                    <div className="flex gap-2">
                      <input
                        type="number"
                        min="0"
                        className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400"
                        placeholder={String(selectedItem.currentStock)}
                        value={newStock}
                        onChange={(e) => setNewStock(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && handleAdjust()}
                      />
                      <button
                        onClick={handleAdjust}
                        disabled={adjustLoading || !newStock}
                        className="bg-slate-700 text-white rounded-lg px-4 py-2 text-sm font-semibold hover:bg-slate-800 disabled:opacity-40 transition"
                      >
                        {adjustLoading ? "…" : "Set"}
                      </button>
                    </div>
                  </div>

                  {/* Remove */}
                  <button
                    onClick={() => setRemovingItem(selectedItem)}
                    className="w-full text-red-500 hover:text-red-700 text-sm font-medium py-2 border border-red-100 rounded-xl hover:bg-red-50 transition"
                  >
                    Hapus dari Stok
                  </button>
                </div>
              </div>

            ) : (

              /* ── Catalog picker panel ── */
              <div className="bg-white rounded-xl border border-slate-200 overflow-hidden sticky top-4">
                <div className="px-4 py-3 border-b border-slate-100">
                  <h3 className="font-semibold text-slate-800 text-sm">Tambah dari Katalog</h3>
                  <p className="text-xs text-slate-400 mt-0.5">Centang produk lalu klik Tambah.</p>
                </div>

                {/* Controls */}
                <div className="px-4 py-2.5 flex items-center gap-2 border-b border-slate-100 bg-slate-50">
                  <select
                    className="border border-slate-200 rounded-lg px-2 py-1.5 text-xs bg-white"
                    value={bulkUnit}
                    onChange={(e) => setBulkUnit(e.target.value as "pcs" | "kaleng" | "botol")}
                  >
                    <option value="pcs">pcs</option>
                    <option value="kaleng">kaleng</option>
                    <option value="botol">botol</option>
                  </select>
                  <input
                    type="number"
                    className="w-20 border border-slate-200 rounded-lg px-2 py-1.5 text-xs"
                    placeholder="Min. stok"
                    value={bulkMinStock}
                    onChange={(e) => setBulkMinStock(e.target.value)}
                  />
                  <button
                    onClick={handleBulkAdd}
                    disabled={addLoading || selectedCatalogIds.size === 0}
                    className="ml-auto bg-orange-600 text-white text-xs px-3 py-1.5 rounded-lg hover:bg-orange-700 disabled:opacity-40 transition font-semibold whitespace-nowrap"
                  >
                    {addLoading ? "…" : selectedCatalogIds.size > 0 ? `+ ${selectedCatalogIds.size} Produk` : "Tambah"}
                  </button>
                </div>

                {addFeedback && (
                  <div className={`mx-4 mt-3 text-xs rounded-lg px-3 py-2 ${
                    addFeedback.type === "ok" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"
                  }`}>
                    {addFeedback.msg}
                  </div>
                )}

                {catalog.length === 0 ? (
                  <p className="text-sm text-slate-400 p-4">Katalog kosong.</p>
                ) : (
                  <div className="divide-y divide-slate-100 max-h-[480px] overflow-y-auto">
                    {[...catalogByCategory.entries()].map(([cat, products]) => {
                      const availableInCat = products.filter((p) => !addedIds.has(p.id));
                      const selectedInCat = availableInCat.filter((p) => selectedCatalogIds.has(p.id));
                      const allCatSelected = availableInCat.length > 0 && selectedInCat.length === availableInCat.length;
                      return (
                        <div key={cat}>
                          <div className="flex items-center gap-2 px-4 py-2 bg-slate-50 sticky top-0 z-10">
                            <input
                              type="checkbox"
                              checked={allCatSelected}
                              disabled={availableInCat.length === 0}
                              onChange={() => toggleCategory(availableInCat.map((p) => p.id), allCatSelected)}
                              className="rounded"
                            />
                            <span className="text-xs font-bold text-slate-600 uppercase tracking-wide">{cat}</span>
                            {availableInCat.length > 0 && (
                              <span className="text-xs text-slate-400 ml-auto">{availableInCat.length} tersedia</span>
                            )}
                          </div>
                          {products.map((p) => {
                            const isAdded = addedIds.has(p.id);
                            const isSelected = selectedCatalogIds.has(p.id);
                            return (
                              <label
                                key={p.id}
                                className={`flex items-center gap-2.5 px-4 py-2 cursor-pointer transition ${
                                  isAdded ? "opacity-40 cursor-default" : isSelected ? "bg-orange-50" : "hover:bg-slate-50"
                                }`}
                              >
                                <input
                                  type="checkbox"
                                  checked={isAdded || isSelected}
                                  disabled={isAdded}
                                  onChange={() => !isAdded && toggleCatalogItem(p.id)}
                                  className="rounded shrink-0"
                                />
                                <span className="flex-1 text-xs font-medium text-slate-800 leading-snug">{p.name}</span>
                                {isAdded ? (
                                  <span className="text-xs text-green-600 shrink-0">✓</span>
                                ) : (
                                  <span className="text-xs text-slate-400 font-mono shrink-0">{fmt(p.prices.retail)}</span>
                                )}
                              </label>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

            )}
          </div>
        </div>
      )}

      {/* ── Tab: Restok ── */}
      {activeTab === "restock" && (
        <div className="flex gap-6">
          {/* Left: form */}
          <div className="flex-1 min-w-0 flex flex-col gap-4">
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-100">
                <h3 className="font-semibold text-slate-800">Input Restok</h3>
                <p className="text-xs text-slate-400 mt-0.5">Isi jumlah dan harga beli per produk yang datang dari supplier.</p>
              </div>
              {items.filter((i) => i.isActive).length === 0 ? (
                <p className="text-sm text-slate-400 p-4">Belum ada produk di inventaris.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-slate-500 text-xs">
                    <tr>
                      <th className="px-4 py-2 text-left">Produk</th>
                      <th className="px-4 py-2 text-right">Stok Saat Ini</th>
                      <th className="px-4 py-2 text-right w-32">Jumlah Masuk</th>
                      <th className="px-4 py-2 text-right w-36">Harga Beli/pcs</th>
                      <th className="px-4 py-2 text-right">Subtotal</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {items.filter((i) => i.isActive).map((p) => {
                      const qty = parseInt(restockQty[p.id] ?? "0", 10) || 0;
                      const cost = parseFloat(restockCost[p.id] ?? "0") || 0;
                      return (
                        <tr key={p.id} className={`hover:bg-slate-50 ${qty > 0 ? "bg-green-50/40" : ""}`}>
                          <td className="px-4 py-2">
                            <p className="font-medium text-slate-800">{p.name}</p>
                            <p className="text-xs text-slate-400">{p.category ?? ""}</p>
                          </td>
                          <td className={`px-4 py-2 text-right font-semibold text-sm ${p.currentStock <= p.minimumStock ? "text-red-600" : "text-slate-600"}`}>
                            {p.currentStock}
                          </td>
                          <td className="px-4 py-2 text-right">
                            <input
                              type="number" min="0"
                              className="w-24 border border-slate-200 rounded-lg px-2 py-1 text-sm text-right focus:border-green-400 focus:outline-none"
                              placeholder="0"
                              value={restockQty[p.id] ?? ""}
                              onChange={(e) => setRestockQty((prev) => ({ ...prev, [p.id]: e.target.value }))}
                            />
                          </td>
                          <td className="px-4 py-2 text-right">
                            <input
                              type="number" min="0" step="1000"
                              className="w-32 border border-slate-200 rounded-lg px-2 py-1 text-sm text-right focus:border-green-400 focus:outline-none"
                              placeholder="0"
                              value={restockCost[p.id] ?? ""}
                              onChange={(e) => setRestockCost((prev) => ({ ...prev, [p.id]: e.target.value }))}
                            />
                          </td>
                          <td className="px-4 py-2 text-right font-semibold text-slate-700 text-xs">
                            {qty > 0 ? fmt(qty * cost) : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          {/* Right: summary + submit */}
          <div className="w-72 shrink-0 flex flex-col gap-3">
            {restockFeedback && (
              <div className={`rounded-xl px-4 py-3 text-sm font-medium ${restockFeedback.type === "ok" ? "bg-green-50 border border-green-200 text-green-700" : "bg-red-50 border border-red-200 text-red-600"}`}>
                {restockFeedback.msg}
              </div>
            )}

            <div className="bg-white rounded-xl border border-slate-200 p-4 flex flex-col gap-2">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Ringkasan</p>
              {restockItems.length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-4">Isi jumlah produk<br />yang akan direstok</p>
              ) : (
                <div className="space-y-1">
                  {restockItems.map((r) => (
                    <div key={r.item.id} className="flex justify-between text-xs text-slate-600">
                      <span className="truncate mr-2">{r.qty}× {r.item.name}</span>
                      <span className="shrink-0 font-medium">{fmt(r.subtotal)}</span>
                    </div>
                  ))}
                  <div className="border-t border-slate-100 pt-2 flex justify-between text-sm font-semibold">
                    <span className="text-slate-700">Total Biaya</span>
                    <span className="text-slate-900">{fmt(restockTotal)}</span>
                  </div>
                </div>
              )}
            </div>

            <input
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm"
              placeholder="Catatan (opsional)"
              value={restockNotes}
              onChange={(e) => setRestockNotes(e.target.value)}
            />

            <button
              onClick={handleRestock}
              disabled={restocking || restockItems.length === 0}
              className="w-full bg-green-600 text-white rounded-xl py-3 text-sm font-bold hover:bg-green-700 disabled:opacity-40 transition"
            >
              {restocking ? "Menyimpan…" : restockItems.length === 0 ? "Isi jumlah dulu" : `Simpan Restok — ${fmt(restockTotal)}`}
            </button>

            {/* Replenishment history */}
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
                <p className="text-sm font-semibold text-slate-800">Riwayat Restok</p>
                <button onClick={loadReplenishments} className="text-xs text-blue-600 hover:underline">Refresh</button>
              </div>
              {loadingReplenishments ? (
                <p className="text-xs text-slate-400 p-3">Memuat…</p>
              ) : replenishments.length === 0 ? (
                <p className="text-xs text-slate-400 p-3">Belum ada riwayat restok.</p>
              ) : (
                <div className="divide-y divide-slate-100 max-h-80 overflow-y-auto">
                  {replenishments.map((r) => (
                    <div key={r.id} className="px-4 py-3">
                      <div className="flex justify-between items-start mb-1">
                        <p className="text-xs text-slate-400">{r.createdAt?.slice(0, 16).replace("T", " ")}</p>
                        <p className="text-xs font-bold text-slate-800">{fmt(r.totalCost)}</p>
                      </div>
                      <p className="text-xs text-slate-600">
                        {r.items.map((i) => `${i.productName} ×${i.quantity}`).join(", ")}
                      </p>
                      {r.notes && <p className="text-xs text-slate-400 italic mt-0.5">"{r.notes}"</p>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Tab: Pergerakan Stok ── */}
      {activeTab === "movements" && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <span className="text-sm font-medium text-slate-600">Filter:</span>
              <div className="flex gap-1.5 flex-wrap">
                {[["all", "Semua"], ...Object.entries(MOVEMENT_TYPE_LABEL)].map(([key, label]) => (
                  <button
                    key={key}
                    onClick={() => setMovementTypeFilter(key ?? "all")}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium border transition ${
                      movementTypeFilter === key
                        ? "bg-slate-800 text-white border-slate-800"
                        : "border-slate-200 text-slate-500 hover:border-slate-400"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <button onClick={loadMovements} className="text-xs text-blue-600 hover:underline">Refresh</button>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            {loadingMovements ? (
              <p className="text-sm text-slate-400 p-4">Memuat…</p>
            ) : filteredMovements.length === 0 ? (
              <p className="text-sm text-slate-400 p-4">Belum ada pergerakan stok.</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-500 text-xs">
                  <tr>
                    <th className="px-4 py-2 text-left">Tanggal</th>
                    <th className="px-4 py-2 text-left">Produk</th>
                    <th className="px-4 py-2 text-left">Tipe</th>
                    <th className="px-4 py-2 text-right">Jumlah</th>
                    <th className="px-4 py-2 text-right">Sebelum</th>
                    <th className="px-4 py-2 text-right">Sesudah</th>
                    <th className="px-4 py-2 text-left">Referensi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredMovements.map((m) => {
                    const isIn = ["restock", "transfer_in", "opening_stock", "reversal"].includes(m.movementType);
                    return (
                      <tr key={m.id} className="hover:bg-slate-50">
                        <td className="px-4 py-2 text-slate-400 text-xs whitespace-nowrap">
                          {m.createdAt?.slice(0, 16).replace("T", " ")}
                        </td>
                        <td className="px-4 py-2 font-medium text-slate-800">{m.itemName}</td>
                        <td className="px-4 py-2">
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${MOVEMENT_TYPE_COLOR[m.movementType] ?? "bg-slate-100 text-slate-600"}`}>
                            {MOVEMENT_TYPE_LABEL[m.movementType] ?? m.movementType}
                          </span>
                        </td>
                        <td className={`px-4 py-2 text-right font-bold ${isIn ? "text-green-600" : "text-red-600"}`}>
                          {isIn ? "+" : "−"}{m.quantity}
                        </td>
                        <td className="px-4 py-2 text-right text-slate-500 text-xs">{m.stockBefore}</td>
                        <td className="px-4 py-2 text-right font-semibold text-slate-800">{m.stockAfter}</td>
                        <td className="px-4 py-2 text-xs text-slate-400 font-mono">
                          {m.referenceId ? m.referenceId.slice(0, 8).toUpperCase() : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* ── Bulk remove confirmation modal ── */}
      {bulkConfirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm mx-4">
            <h3 className="text-base font-bold text-slate-900 mb-1">Hapus {selectedItemIds.size} Produk?</h3>
            <p className="text-sm text-slate-600 mb-3">Produk berikut akan dihapus dari stok club ini:</p>
            <ul className="mb-3 max-h-48 overflow-y-auto space-y-1">
              {items.filter((i) => selectedItemIds.has(i.id)).map((i) => (
                <li key={i.id} className="flex items-center justify-between text-sm px-3 py-1.5 bg-red-50 rounded-lg">
                  <span className="font-medium text-slate-800">{i.name}</span>
                  {i.currentStock > 0 && (
                    <span className="text-xs text-amber-600 font-semibold ml-2 shrink-0">stok: {i.currentStock}</span>
                  )}
                </li>
              ))}
            </ul>
            <p className="text-xs text-slate-400 mb-4">Produk bisa ditambahkan kembali dari katalog kapan saja.</p>
            <div className="flex gap-2">
              <button
                onClick={() => setBulkConfirmOpen(false)}
                disabled={bulkRemoving}
                className="flex-1 border border-slate-200 rounded-xl py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50 transition"
              >
                Batal
              </button>
              <button
                onClick={handleBulkRemove}
                disabled={bulkRemoving}
                className="flex-1 bg-red-600 text-white rounded-xl py-2.5 text-sm font-semibold hover:bg-red-700 disabled:opacity-50 transition"
              >
                {bulkRemoving ? "Menghapus…" : `Ya, Hapus ${selectedItemIds.size} Produk`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Remove confirmation modal ── */}
      {removingItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm mx-4">
            <h3 className="text-base font-bold text-slate-900 mb-1">Hapus dari Stok?</h3>
            <p className="text-sm text-slate-600 mb-1">
              <span className="font-semibold">{removingItem.name}</span> akan dihapus dari daftar stok club ini.
            </p>
            {removingItem.currentStock > 0 && (
              <div className="mt-2 mb-3 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-sm text-amber-700">
                Stok saat ini masih <span className="font-bold">{removingItem.currentStock}</span>. Hapus tetap lanjut?
              </div>
            )}
            <p className="text-xs text-slate-400 mb-4">Produk ini bisa ditambahkan kembali dari katalog kapan saja.</p>
            <div className="flex gap-2">
              <button
                onClick={() => setRemovingItem(null)}
                disabled={removeLoading}
                className="flex-1 border border-slate-200 rounded-xl py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50 transition"
              >
                Batal
              </button>
              <button
                onClick={() => handleRemove()}
                disabled={removeLoading}
                className="flex-1 bg-red-600 text-white rounded-xl py-2.5 text-sm font-semibold hover:bg-red-700 disabled:opacity-50 transition"
              >
                {removeLoading ? "Menghapus…" : "Ya, Hapus"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
