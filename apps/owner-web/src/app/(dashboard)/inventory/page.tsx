"use client";

import { useEffect, useRef, useState, useMemo } from "react";
import { collection, getDocs, query, orderBy, limit, doc, updateDoc, where } from "firebase/firestore";
import { useOwnerAuthStore } from "@/store/auth.store";
import { callFunction, firebaseDb } from "@/firebase/firebase";
import { v4 as uuidv4 } from "uuid";

// ── Types ─────────────────────────────────────────────────────────────────────

interface PriceTiers {
  retail: number; ds: number; sc: number; sbQp: number; spv: number;
}

interface TakaranOption { name: string; amount: number; }

interface InventoryItem {
  id: string;
  name: string;
  category: string | null;
  prices: PriceTiers;
  unit: string;
  currentStock: number;
  minimumStock: number;
  isActive: boolean;
  // Serving data — present when added from a catalog product with takaran
  netWeight?: number | null;
  baseUnit?: string | null;
  servingsPerContainer?: number | null;
  takaran?: TakaranOption[] | null;
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

const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString("id-ID", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });

// ── Transfer types (used by TransferKeluar / TransferMasuk sub-components) ────

type TransferPaymentType = "bayar" | "pinjam";
type TransferPriceTier  = "retail" | "ds" | "sc" | "sbQp" | "spv";
type DestType           = "club" | "owner";

const TRANSFER_TIER_LABELS: Record<TransferPriceTier, string> = {
  retail: "Retail", ds: "DS", sc: "SC", sbQp: "SB/QP", spv: "SPV",
};

interface WarehouseItem {
  id: string;
  name: string;
  category: string | null;
  unit: string;
  currentStock: number;
  productCatalogId: string | null;
  prices: Record<TransferPriceTier, number>;
  netWeight?: number | null;
  baseUnit?: string | null;
}

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
  paymentType: TransferPaymentType;
  priceTier: string;
  items: TransferItem[];
  total: number;
  notes: string | null;
  status: "pending" | "accepted";
  createdAt: string;
}

interface Club { id: string; name: string; }

interface AcceptReceipt {
  transferId: string;
  total: number;
  paymentType: TransferPaymentType;
  sourceOwnerId: string;
  destinationClubId: string;
  items: TransferItem[];
  timestamp: string;
}

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

type PageTab = "stok" | "transfer" | "restock" | "movements";

export default function InventoryPage() {
  const { ownerId, clubId } = useOwnerAuthStore();

  const [activeTab, setActiveTab] = useState<PageTab>("stok");
  // Counter that bumps every time the hero "Buat Transfer Baru" CTA is
  // pressed — TransferKeluar watches it and scrolls/focuses the Tujuan card.
  const [transferFocusKey, setTransferFocusKey] = useState(0);

  function startNewTransfer() {
    setActiveTab("transfer");
    setTransferFocusKey((k) => k + 1);
  }

  // ── Clubs (needed for transfer) — load on mount, always available now ────
  const [clubs, setClubs] = useState<Club[]>([]);

  useEffect(() => {
    if (!ownerId) return;
    getDocs(collection(firebaseDb(), `owners/${ownerId}/clubs`))
      .then((snap) => setClubs(snap.docs.map((d) => ({ id: d.id, name: d.data()["name"] as string }))))
      .catch(() => {});
  }, [ownerId]);

  // ── Incoming transfer pending count for the hero alert ───────────────────
  const [pendingIncoming, setPendingIncoming] = useState(0);

  useEffect(() => {
    if (!ownerId) return;
    getDocs(query(
      collection(firebaseDb(), `owners/${ownerId}/notifications`),
      where("type", "==", "transfer_incoming"),
    ))
      .then((snap) => {
        setPendingIncoming(snap.docs.filter((d) => (d.data()["status"] as string) === "pending").length);
      })
      .catch(() => {});
  }, [ownerId]);

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
  const [restockPriceTier, setRestockPriceTier] = useState<keyof PriceTiers | null>(null);
  // Track whether we've already applied the saved tier on initial load
  const tierAppliedRef = useRef(false);

  // On first items load: auto-apply the last saved tier from localStorage
  useEffect(() => {
    if (tierAppliedRef.current || items.length === 0) return;
    const saved = localStorage.getItem("nc_restock_tier") as keyof PriceTiers | null;
    if (saved && TIER_LABELS.some((t) => t.key === saved)) {
      tierAppliedRef.current = true;
      setRestockPriceTier(saved);
      const filled: Record<string, string> = {};
      items.filter((i) => i.isActive).forEach((p) => {
        filled[p.id] = String(p.prices[saved]);
      });
      setRestockCost(filled);
    }
  }, [items]);
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
      setRestockQty({}); setRestockNotes("");
      // Re-apply last tier so prices are pre-filled for the next restock
      const currentTier = restockPriceTier;
      if (currentTier) {
        const filled: Record<string, string> = {};
        items.filter((i) => i.isActive).forEach((p) => {
          filled[p.id] = String(p.prices[currentTier]);
        });
        setRestockCost(filled);
      } else {
        setRestockCost({});
      }
      loadItems();
      loadReplenishments();
    } catch (err) {
      setRestockFeedback({ type: "err", msg: err instanceof Error ? err.message : "Gagal" });
    } finally { setRestocking(false); }
  }

  function applyPriceTier(tier: keyof PriceTiers) {
    localStorage.setItem("nc_restock_tier", tier);
    setRestockPriceTier(tier);
    const filled: Record<string, string> = {};
    items.filter((i) => i.isActive).forEach((p) => {
      filled[p.id] = String(p.prices[tier]);
    });
    setRestockCost((prev) => ({ ...prev, ...filled }));
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

  // Derived metrics for the stat strip
  const activeItems   = items.filter((i) => i.isActive !== false);
  const lowStockCount = activeItems.filter((i) => (i.minimumStock ?? 0) > 0 && (i.currentStock ?? 0) <= (i.minimumStock ?? 0) && (i.currentStock ?? 0) > 0).length;
  const outStockCount = activeItems.filter((i) => (i.currentStock ?? 0) === 0).length;
  const lastRestock   = replenishments[0]?.createdAt ?? null;
  const lastRestokLabel = lastRestock
    ? (() => {
        const days = Math.floor((Date.now() - new Date(lastRestock).getTime()) / 86_400_000);
        if (days === 0) return "hari ini";
        if (days === 1) return "kemarin";
        return `${days} hari lalu`;
      })()
    : "—";

  const TABS: { key: PageTab; label: string; icon: string; badge?: number }[] = [
    { key: "stok",      label: "Stok Gudang",     icon: "📦" },
    {
      key: "transfer",  label: "Transfer",        icon: "↔️",
      ...(pendingIncoming > 0 ? { badge: pendingIncoming } : {}),
    },
    { key: "restock",   label: "Restok",          icon: "📥" },
    { key: "movements", label: "Pergerakan Stok", icon: "📊" },
  ];

  return (
    <div className="space-y-5">

      {/* ── Title ── */}
      <div>
        <h2 className="text-2xl font-bold text-slate-900">📦 Gudang Owner &amp; Transfer</h2>
        <p className="text-sm text-slate-500 mt-0.5">Kelola stok pusat dan kirim ke club</p>
      </div>

      {/* ── Hero: Transfer Hub (always visible) ── */}
      <div className="rounded-2xl bg-gradient-to-br from-teal-100 via-teal-50 to-cyan-100 ring-1 ring-teal-200/60 px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-slate-900">↔️ Transfer Produk ke Club</p>
            <p className="text-xs text-slate-600 mt-0.5">Satu-satunya jalan stok masuk ke club — kirim dari gudang owner ke club tujuan.</p>
          </div>
          <button
            onClick={startNewTransfer}
            className="inline-flex items-center gap-2 bg-slate-900 text-white px-4 py-2 rounded-xl text-sm font-bold hover:bg-slate-700 transition shadow-sm shrink-0"
          >
            + Buat Transfer Baru
          </button>
        </div>

        {pendingIncoming > 0 && (
          <button
            onClick={() => setActiveTab("transfer")}
            className="mt-3 w-full flex items-center gap-3 bg-amber-50 ring-1 ring-amber-200 rounded-xl px-3 py-2 hover:bg-amber-100 transition text-left"
          >
            <span className="text-xl">📥</span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-amber-800">{pendingIncoming} transfer masuk menunggu konfirmasi</p>
            </div>
            <span className="text-amber-500 text-lg shrink-0">›</span>
          </button>
        )}
      </div>

      {/* ── Stat strip ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Total Produk" value={String(activeItems.length)} loading={loadingList} accent="slate" />
        <StatCard label="Stok Rendah"  value={String(lowStockCount)}      loading={loadingList} accent={lowStockCount > 0 ? "amber" : "slate"} />
        <StatCard label="Habis"        value={String(outStockCount)}      loading={loadingList} accent={outStockCount > 0 ? "red" : "slate"} />
        <StatCard label="Restok Terakhir" value={lastRestokLabel}         loading={loadingReplenishments} accent="slate" small />
      </div>

      {/* ── Tab switcher — pick which section to view ── */}
      <div className="flex items-center gap-1 border-b border-slate-200 -mb-px overflow-x-auto">
        {TABS.map(({ key, label, icon, badge }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={`px-4 py-2.5 text-sm font-semibold border-b-2 transition whitespace-nowrap flex items-center gap-2 ${
              activeTab === key
                ? "border-blue-600 text-blue-700"
                : "border-transparent text-slate-500 hover:text-slate-700"
            }`}
          >
            <span>{icon}</span>
            {label}
            {badge !== undefined && (
              <span className="ml-0.5 bg-amber-100 text-amber-700 rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-none">
                {badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── Tab: Stok Gudang ── */}
      {activeTab === "stok" && (
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

                  {/* Serving info (takaran) */}
                  {selectedItem.netWeight && (
                    <div className="bg-blue-50 rounded-xl px-3 py-3">
                      <p className="text-xs font-semibold text-blue-600 uppercase tracking-wide mb-2">Info Takaran</p>
                      <div className="space-y-1 text-xs text-blue-800">
                        <div className="flex justify-between">
                          <span className="text-blue-500">Berat kemasan</span>
                          <span className="font-semibold">{selectedItem.netWeight} {selectedItem.baseUnit ?? "g"}</span>
                        </div>
                        {selectedItem.servingsPerContainer && (
                          <div className="flex justify-between">
                            <span className="text-blue-500">Sajian/kemasan</span>
                            <span className="font-semibold">{selectedItem.servingsPerContainer}×</span>
                          </div>
                        )}
                        {selectedItem.takaran?.map((t) => (
                          <div key={t.name} className="flex justify-between">
                            <span className="text-blue-500">1 {t.name}</span>
                            <span className="font-semibold">{t.amount} {selectedItem.baseUnit ?? "g"}</span>
                          </div>
                        ))}
                        <div className="border-t border-blue-200 pt-1.5 mt-1.5 flex justify-between">
                          <span className="text-blue-500">Stok saat ini</span>
                          <span className="font-bold">{selectedItem.currentStock} {selectedItem.unit}</span>
                        </div>
                        {selectedItem.takaran?.map((t) => (
                          <div key={`est-${t.name}`} className="flex justify-between">
                            <span className="text-blue-400">≈ {t.name} tersedia</span>
                            <span className="font-semibold">
                              {Math.floor(selectedItem.currentStock / t.amount)} {t.name}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

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

      {/* ── Tab: Transfer ── */}
      {activeTab === "transfer" && (
        <TransferPanel
          ownerId={ownerId}
          sourceClubId={clubId}
          clubs={clubs}
          keluarFocusKey={transferFocusKey}
        />
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

              {/* Tier quick-fill */}
              <div className="px-4 py-2.5 flex items-center gap-2 bg-slate-50 border-b border-slate-100 flex-wrap">
                <span className="text-xs text-slate-500 font-medium shrink-0">Harga otomatis:</span>
                <div className="flex gap-1.5 flex-wrap">
                  {TIER_LABELS.map((t) => (
                    <button
                      key={t.key}
                      onClick={() => applyPriceTier(t.key)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-semibold border transition ${
                        restockPriceTier === t.key
                          ? "bg-blue-600 text-white border-blue-600"
                          : "bg-white border-slate-200 text-slate-600 hover:border-blue-400 hover:text-blue-600"
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
                {restockPriceTier && (
                  <span className="ml-1 text-xs text-blue-600 font-medium">
                    · Harga tier {TIER_LABELS.find((t) => t.key === restockPriceTier)?.label} diaplikasikan
                  </span>
                )}
                <span className="text-xs text-slate-400 ml-auto">atau isi manual per baris</span>
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
                              onChange={(e) => {
                                setRestockPriceTier(null);
                                setRestockCost((prev) => ({ ...prev, [p.id]: e.target.value }));
                              }}
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

// ─────────────────────────────────────────────────────────────────────────────
// StatCard — compact metric tile for the top-of-page stat strip
// ─────────────────────────────────────────────────────────────────────────────

function StatCard({
  label, value, loading, accent = "slate", small = false,
}: {
  label: string;
  value: string;
  loading?: boolean;
  accent?: "slate" | "amber" | "red";
  small?: boolean;
}) {
  const accentStyle = {
    slate: "text-slate-900",
    amber: "text-amber-600",
    red:   "text-red-600",
  }[accent];
  return (
    <div className="bg-white rounded-2xl border border-slate-200 px-4 py-3">
      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">{label}</p>
      <p className={`${small ? "text-base" : "text-2xl"} font-bold mt-1 tabular-nums ${accentStyle}`}>
        {loading ? <span className="inline-block w-16 h-7 bg-slate-100 rounded animate-pulse" /> : value}
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TransferPanel — wrapper that owns the keluar/masuk sub-tab state
// ─────────────────────────────────────────────────────────────────────────────

function TransferPanel({
  ownerId, sourceClubId, clubs, keluarFocusKey,
}: {
  ownerId: string | undefined;
  sourceClubId: string | undefined;
  clubs: Club[];
  keluarFocusKey?: number;
}) {
  const [tab, setTab] = useState<"keluar" | "masuk">("keluar");

  // When the parent bumps keluarFocusKey (e.g. from the hero "Buat Transfer
  // Baru" CTA), ensure we're on the Keluar sub-tab so the focus actually
  // lands on the Tujuan card.
  useEffect(() => {
    if (keluarFocusKey !== undefined && keluarFocusKey > 0) setTab("keluar");
  }, [keluarFocusKey]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-1 bg-slate-100 rounded-xl p-1 self-start">
        {([
          { key: "keluar", label: "→ Transfer Keluar" },
          { key: "masuk",  label: "← Transfer Masuk" },
        ] as { key: "keluar" | "masuk"; label: string }[]).map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-5 py-2 rounded-lg text-sm font-semibold transition ${
              tab === key ? "bg-white shadow text-slate-900" : "text-slate-500 hover:text-slate-700"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "keluar"
        ? <TransferKeluar ownerId={ownerId} sourceClubId={sourceClubId} clubs={clubs} focusKey={keluarFocusKey} />
        : <TransferMasuk ownerId={ownerId} clubs={clubs} />}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TransferKeluar
// ─────────────────────────────────────────────────────────────────────────────

function TransferKeluar({
  ownerId, sourceClubId, clubs, focusKey,
}: {
  ownerId: string | undefined;
  sourceClubId: string | undefined;
  clubs: Club[];
  focusKey: number | undefined;
}) {
  const [destType, setDestType]       = useState<DestType>("club");
  const [destClubId, setDestClubId]   = useState("");
  const [destOwnerId, setDestOwnerId] = useState("");
  const [paymentType, setPaymentType] = useState<TransferPaymentType>("bayar");
  const [priceTier, setPriceTier]     = useState<TransferPriceTier>("retail");
  const [notes, setNotes]             = useState("");
  const [search, setSearch]           = useState("");

  // Refs + transient highlight for the "scroll to Tujuan" UX.
  const tujuanRef = useRef<HTMLDivElement>(null);
  const destClubSelectRef = useRef<HTMLSelectElement>(null);
  const destOwnerInputRef = useRef<HTMLInputElement>(null);
  const [tujuanHighlight, setTujuanHighlight] = useState(false);

  const destClubs = clubs;

  useEffect(() => {
    if (destType === "club" && destClubs.length > 0 && !destClubId) {
      setDestClubId(destClubs[0]!.id);
    }
  }, [destType, destClubs]);

  // When the parent bumps focusKey, scroll the Tujuan card into view,
  // flash a brief highlight ring, and focus the most relevant input
  // (club picker if multiple clubs, owner-id input for cross-owner).
  useEffect(() => {
    if (focusKey === undefined || focusKey === 0) return;
    tujuanRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    setTujuanHighlight(true);
    const t = setTimeout(() => setTujuanHighlight(false), 1800);
    // Focus the actual control after the scroll settles
    setTimeout(() => {
      if (destType === "owner") {
        destOwnerInputRef.current?.focus();
      } else if (destClubs.length > 1) {
        destClubSelectRef.current?.focus();
      }
    }, 320);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusKey]);

  const [inventory, setInventory]   = useState<WarehouseItem[]>([]);
  const [loadingInv, setLoadingInv] = useState(false);
  const [qtyMap, setQtyMap]         = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError]           = useState<string | null>(null);
  const [successTransferId, setSuccessTransferId] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!ownerId) { setInventory([]); return; }
    setLoadingInv(true);
    setQtyMap({});
    getDocs(query(
      collection(firebaseDb(), `owners/${ownerId}/inventoryItems`),
      where("isActive", "==", true),
    ))
      .then((snap) => {
        setInventory(
          snap.docs
            .map((d) => ({ id: d.id, ...(d.data() as Omit<WarehouseItem, "id">) }))
            .filter((i) => (i.currentStock ?? 0) > 0)
            .sort((a, b) => a.name.localeCompare(b.name, "id"))
        );
      })
      .catch(() => {})
      .finally(() => setLoadingInv(false));
  }, [ownerId]);

  const filtered = useMemo(() =>
    search.trim() ? inventory.filter((i) => i.name.toLowerCase().includes(search.toLowerCase())) : inventory,
    [inventory, search]
  );

  const cartItems: TransferItem[] = useMemo(() =>
    inventory
      .filter((item) => { const q = parseInt(qtyMap[item.id] ?? ""); return !isNaN(q) && q > 0; })
      .map((item) => {
        const qty = parseInt(qtyMap[item.id]!);
        const unitPrice = paymentType === "pinjam" ? 0 : (item.prices[priceTier] ?? 0);
        return { productId: item.id, productCatalogId: item.productCatalogId ?? null, productName: item.name, quantity: qty, unitPrice, subtotal: qty * unitPrice };
      }),
    [inventory, qtyMap, paymentType, priceTier]
  );

  const total = cartItems.reduce((s, i) => s + i.subtotal, 0);

  async function handleSend() {
    if (!ownerId) { setError("Data owner tidak ditemukan"); return; }
    if (destType === "club" && !destClubId) { setError("Pilih club tujuan"); return; }
    if (destType === "owner" && !destOwnerId.trim()) { setError("Masukkan Owner ID tujuan"); return; }
    if (cartItems.length === 0) { setError("Pilih setidaknya 1 produk"); return; }
    const overStock = cartItems.find((ci) => { const inv = inventory.find((i) => i.id === ci.productId); return inv && ci.quantity > inv.currentStock; });
    if (overStock) { setError(`Stok ${overStock.productName} tidak cukup`); return; }

    setError(null);
    setSubmitting(true);
    try {
      const result = await callFunction("productTransfer_create", {
        ownerId,
        destinationType: destType,
        ...(destType === "club" ? { destinationClubId: destClubId } : { destinationOwnerId: destOwnerId.trim() }),
        paymentType, priceTier,
        items: cartItems,
        notes: notes.trim() || undefined,
        requestId: uuidv4(), operationId: uuidv4(),
      }) as { transferId: string; total: number; status: string };

      const destLabel = destType === "club" ? clubs.find((c) => c.id === destClubId)?.name ?? destClubId : destOwnerId;
      setSuccessTransferId(result.transferId);
      setSuccessMsg(
        result.status === "completed"
          ? `Transfer ke ${destLabel} berhasil — ${cartItems.length} produk, ${fmt(result.total)}`
          : `Transfer ke ${destLabel} dikirim — menunggu konfirmasi penerima`
      );
      const sentItems = cartItems;
      setQtyMap({});
      setNotes("");
      setInventory((prev) => prev.map((item) => { const ci = sentItems.find((c) => c.productId === item.id); if (!ci) return item; return { ...item, currentStock: item.currentStock - ci.quantity }; }).filter((item) => item.currentStock > 0));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal mengirim transfer");
    } finally {
      setSubmitting(false);
    }
  }

  const sourceClubName = clubs.find((c) => c.id === sourceClubId)?.name ?? "—";
  const canSend = cartItems.length > 0 && (destType === "club" ? !!destClubId : !!destOwnerId.trim()) && !submitting;

  return (
    <div className="flex gap-5 h-full min-h-0">
      {/* Left: product picker */}
      <div className="flex-1 min-w-0 flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <div className="relative flex-1">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm pointer-events-none">🔍</span>
            <input type="text" placeholder="Cari produk…" value={search} onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          {loadingInv ? <span className="text-xs text-slate-400">Memuat…</span> : <span className="text-xs text-slate-400 whitespace-nowrap">{inventory.length} produk · {cartItems.length} dipilih</span>}
          {cartItems.length > 0 && <button onClick={() => setQtyMap({})} className="text-xs text-slate-400 hover:text-red-500 transition whitespace-nowrap">Reset pilihan</button>}
        </div>

        {loadingInv ? (
          <div className="flex-1 flex items-center justify-center text-slate-400 text-sm">Memuat stok…</div>
        ) : !sourceClubId ? (
          <div className="flex-1 flex items-center justify-center text-slate-400 text-sm">Memuat data club…</div>
        ) : inventory.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center text-slate-400 gap-2"><span className="text-3xl">📦</span><p className="text-sm">Belum ada stok di inventaris Anda.</p></div>
        ) : (
          <div className="flex-1 bg-white rounded-xl border border-slate-200 overflow-hidden flex flex-col min-h-0">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide sticky top-0 z-10">
                <tr>
                  <th className="px-4 py-2.5 text-left">Produk</th>
                  <th className="px-4 py-2.5 text-right">Stok</th>
                  {paymentType === "bayar" && <th className="px-4 py-2.5 text-right">Harga ({TRANSFER_TIER_LABELS[priceTier]})</th>}
                  <th className="px-4 py-2.5 text-center w-28">Jumlah Kirim</th>
                  {paymentType === "bayar" && <th className="px-4 py-2.5 text-right">Subtotal</th>}
                </tr>
              </thead>
            </table>
            <div className="overflow-y-auto flex-1">
              <table className="w-full text-sm">
                <tbody className="divide-y divide-slate-100">
                  {filtered.length === 0 ? (
                    <tr><td className="px-4 py-8 text-center text-slate-400 text-sm" colSpan={5}>Tidak ada produk yang cocok.</td></tr>
                  ) : filtered.map((item) => {
                    const unitPrice = paymentType === "pinjam" ? 0 : (item.prices[priceTier] ?? 0);
                    const qty = parseInt(qtyMap[item.id] ?? "") || 0;
                    const isOver = qty > item.currentStock;
                    const hasQty = qty > 0;
                    return (
                      <tr key={item.id} className={`transition ${hasQty ? "bg-blue-50/60" : "hover:bg-slate-50"}`}>
                        <td className="px-4 py-2.5">
                          <p className={`font-medium ${hasQty ? "text-blue-800" : "text-slate-800"}`}>{item.name}</p>
                          {item.category && <p className="text-xs text-slate-400">{item.category}</p>}
                        </td>
                        <td className={`px-4 py-2.5 text-right text-sm font-semibold ${isOver ? "text-red-500" : "text-slate-600"}`}>
                          {item.currentStock}<span className="text-xs font-normal text-slate-400 ml-1">{item.unit}</span>
                        </td>
                        {paymentType === "bayar" && <td className="px-4 py-2.5 text-right text-xs text-slate-500 font-mono">{fmt(unitPrice)}</td>}
                        <td className="px-4 py-2.5 text-center">
                          <input type="number" min={0} max={item.currentStock}
                            className={`w-20 border rounded-lg px-2 py-1.5 text-sm text-center focus:outline-none focus:ring-2 focus:ring-blue-500 transition ${isOver ? "border-red-400 bg-red-50 text-red-700" : hasQty ? "border-blue-300 bg-white" : "border-slate-200 bg-white"}`}
                            placeholder="0" value={qtyMap[item.id] ?? ""}
                            onChange={(e) => setQtyMap((prev) => ({ ...prev, [item.id]: e.target.value }))}
                          />
                          {item.netWeight && item.baseUnit && qty > 0 && (
                            <p className="text-[10px] text-blue-500 mt-0.5 whitespace-nowrap">→ {qty * item.netWeight} {item.baseUnit} di club</p>
                          )}
                        </td>
                        {paymentType === "bayar" && <td className="px-4 py-2.5 text-right text-sm font-semibold text-slate-700">{qty > 0 ? fmt(qty * unitPrice) : <span className="text-slate-300">—</span>}</td>}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Right: config + summary */}
      <div className="w-80 shrink-0 flex flex-col gap-3 overflow-y-auto">
        {error && <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700 flex items-start gap-2"><span className="shrink-0 mt-0.5">⚠️</span><span>{error}</span></div>}
        {successMsg && (
          <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 flex gap-2">
            <span className="text-green-600 shrink-0">✓</span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-green-800">{successMsg}</p>
              {successTransferId && <p className="text-xs text-green-600 font-mono mt-0.5">Ref: {successTransferId.slice(0, 8).toUpperCase()}</p>}
            </div>
            <button onClick={() => { setSuccessMsg(null); setSuccessTransferId(null); }} className="text-green-400 hover:text-green-600 shrink-0">✕</button>
          </div>
        )}

        {/* Tujuan — colored card, scroll/highlight target for the hero CTA */}
        <div
          ref={tujuanRef}
          className={`rounded-2xl p-4 space-y-3 transition-all duration-300 bg-gradient-to-br from-blue-100 via-indigo-50 to-blue-50 ring-1 scroll-mt-4 ${
            tujuanHighlight ? "ring-4 ring-blue-400 shadow-lg" : "ring-blue-200/70"
          }`}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-lg">🎯</span>
              <p className="text-sm font-bold text-slate-800 uppercase tracking-wide">Tujuan</p>
            </div>
            <span className="text-xs text-slate-500">dari: <span className="font-medium text-slate-700">{sourceClubName}</span></span>
          </div>
          <div className="flex gap-2">
            {(["club", "owner"] as DestType[]).map((dt) => (
              <button
                key={dt}
                onClick={() => { setDestType(dt); setDestClubId(""); setDestOwnerId(""); }}
                className={`flex-1 py-2.5 rounded-xl border-2 text-sm font-bold transition ${
                  destType === dt
                    ? "border-blue-600 bg-white text-blue-700 shadow-sm"
                    : "border-transparent bg-white/60 text-slate-500 hover:bg-white hover:text-slate-700"
                }`}
              >
                {dt === "club" ? "🏢 Club" : "👤 Owner Lain"}
              </button>
            ))}
          </div>
          {destType === "club" ? (
            destClubs.length === 0 ? (
              <p className="text-xs text-slate-500 bg-white/70 rounded-lg px-3 py-2">Tidak ada club lain. Tambahkan club baru terlebih dahulu.</p>
            ) : destClubs.length === 1 ? (
              <div className="flex items-center gap-2 bg-white border-2 border-blue-300 rounded-xl px-3 py-2.5">
                <span className="text-lg">🏢</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-blue-900">{destClubs[0]!.name}</p>
                  <p className="text-xs text-blue-500">Club tujuan</p>
                </div>
              </div>
            ) : (
              <select
                ref={destClubSelectRef}
                className="w-full border-2 border-blue-300 rounded-xl px-3 py-2.5 text-sm font-semibold bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                value={destClubId}
                onChange={(e) => setDestClubId(e.target.value)}
              >
                {destClubs.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            )
          ) : (
            <div>
              <input
                ref={destOwnerInputRef}
                className="w-full border-2 border-blue-300 rounded-xl px-3 py-2.5 text-sm font-semibold bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 placeholder:font-normal placeholder:text-slate-400"
                placeholder="Owner ID tujuan"
                value={destOwnerId}
                onChange={(e) => setDestOwnerId(e.target.value)}
              />
              <p className="text-xs text-slate-500 mt-1.5">Transfer akan menunggu konfirmasi penerima.</p>
            </div>
          )}
        </div>

        {/* Pembayaran */}
        <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Pembayaran</p>
          <div className="flex gap-2">
            {(["bayar", "pinjam"] as TransferPaymentType[]).map((pt) => (
              <button key={pt} onClick={() => setPaymentType(pt)}
                className={`flex-1 py-2 rounded-lg border text-sm font-medium transition ${paymentType === pt ? "border-blue-500 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-500 hover:border-slate-300"}`}>
                {pt === "bayar" ? "💰 Bayar" : "🤝 Pinjam"}
              </button>
            ))}
          </div>
          {paymentType === "pinjam" && <p className="text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2">Stok dikirim tanpa biaya. Jika ke owner lain, dicatat sebagai titipan.</p>}
          {paymentType === "bayar" && (
            <div>
              <p className="text-xs text-slate-500 mb-1.5">Tier Harga</p>
              <div className="flex gap-1.5 flex-wrap">
                {(Object.keys(TRANSFER_TIER_LABELS) as TransferPriceTier[]).map((t) => (
                  <button key={t} onClick={() => setPriceTier(t)}
                    className={`px-3 py-1 rounded-lg border text-xs font-semibold transition ${priceTier === t ? "border-blue-500 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-500 hover:border-slate-300"}`}>
                    {TRANSFER_TIER_LABELS[t]}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Cart summary */}
        <div className="bg-white rounded-xl border border-slate-200 p-4 flex-1 flex flex-col gap-2 min-h-0">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide shrink-0">
            Ringkasan {cartItems.length > 0 && <span className="ml-1 bg-blue-100 text-blue-700 rounded-full px-1.5 py-0.5 text-xs">{cartItems.length}</span>}
          </p>
          {cartItems.length === 0 ? (
            <div className="flex-1 flex items-center justify-center text-center"><p className="text-sm text-slate-400">Isi jumlah produk<br />yang akan dikirim</p></div>
          ) : (
            <div className="overflow-y-auto flex-1 space-y-1 pr-1">
              {cartItems.map((ci) => (
                <div key={ci.productId} className="flex items-center justify-between text-sm gap-2">
                  <div className="flex items-center gap-1.5 min-w-0"><span className="text-blue-500 font-bold shrink-0 text-xs">{ci.quantity}×</span><span className="text-slate-700 truncate">{ci.productName}</span></div>
                  {paymentType === "bayar" && <span className="text-slate-500 shrink-0 text-xs">{fmt(ci.subtotal)}</span>}
                </div>
              ))}
            </div>
          )}
          {cartItems.length > 0 && paymentType === "bayar" && (
            <div className="border-t border-slate-100 pt-2 flex justify-between font-bold text-sm shrink-0"><span className="text-slate-600">Total</span><span className="text-slate-900">{fmt(total)}</span></div>
          )}
        </div>

        <textarea className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm resize-none bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 shrink-0"
          rows={2} placeholder="Catatan (opsional)…" value={notes} onChange={(e) => setNotes(e.target.value)} />

        <button onClick={handleSend} disabled={!canSend}
          className={`w-full rounded-xl py-3.5 text-sm font-bold transition shrink-0 ${canSend ? "bg-blue-600 hover:bg-blue-700 text-white" : "bg-slate-100 text-slate-400 cursor-not-allowed"}`}>
          {submitting ? "Mengirim…" : cartItems.length === 0 ? "Pilih produk dulu" : destType === "club" && !destClubId ? "Pilih club tujuan" : destType === "owner" && !destOwnerId.trim() ? "Masukkan Owner ID" : paymentType === "bayar" ? `Kirim ${cartItems.length} produk — ${fmt(total)}` : `Kirim ${cartItems.length} produk (Gratis)`}
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TransferMasuk
// ─────────────────────────────────────────────────────────────────────────────

function TransferMasuk({ ownerId, clubs }: { ownerId: string | undefined; clubs: Club[] }) {
  const [transfers, setTransfers]   = useState<IncomingTransfer[]>([]);
  const [loading, setLoading]       = useState(true);
  const [selectedClub, setSelectedClub] = useState<Record<string, string>>({});
  const [accepting, setAccepting]   = useState<Record<string, boolean>>({});
  const [receipt, setReceipt]       = useState<AcceptReceipt | null>(null);
  const [errors, setErrors]         = useState<Record<string, string>>({});

  async function loadData() {
    if (!ownerId) return;
    setLoading(true);
    try {
      const snap = await getDocs(query(
        collection(firebaseDb(), `owners/${ownerId}/notifications`),
        where("type", "==", "transfer_incoming"),
        orderBy("createdAt", "desc"),
      ));
      setTransfers(snap.docs.map((d) => ({ id: d.id, ...d.data() } as IncomingTransfer)));
    } catch { /* offline */ } finally { setLoading(false); }
  }

  useEffect(() => { loadData(); }, [ownerId]);

  async function handleAccept(t: IncomingTransfer) {
    const clubId = selectedClub[t.transferId];
    if (!clubId) { setErrors((p) => ({ ...p, [t.transferId]: "Pilih club tujuan terlebih dahulu" })); return; }
    if (!ownerId) return;
    setErrors((p) => { const n = { ...p }; delete n[t.transferId]; return n; });
    setAccepting((prev) => ({ ...prev, [t.transferId]: true }));
    try {
      await callFunction("productTransfer_accept", {
        ownerId, sourceOwnerId: t.sourceOwnerId, transferId: t.transferId,
        destinationClubId: clubId, requestId: uuidv4(), operationId: uuidv4(),
      });
      const clubName = clubs.find((c) => c.id === clubId)?.name ?? clubId;
      setReceipt({ transferId: t.transferId, total: t.total, paymentType: t.paymentType, sourceOwnerId: t.sourceOwnerId, destinationClubId: clubName, items: t.items, timestamp: new Date().toLocaleString("id-ID") });
      loadData();
    } catch (err) {
      setErrors((p) => ({ ...p, [t.transferId]: err instanceof Error ? err.message : "Gagal menerima transfer" }));
    } finally {
      setAccepting((prev) => ({ ...prev, [t.transferId]: false }));
    }
  }

  function shareReceipt(r: AcceptReceipt) {
    const isFree = r.paymentType === "pinjam";
    const lines = [
      "*KONFIRMASI TERIMA TRANSFER - NC Manager*",
      `Tanggal: ${r.timestamp}`, `Dari Owner: ${r.sourceOwnerId}`, `Masuk ke Club: ${r.destinationClubId}`,
      `Jenis: ${r.paymentType === "bayar" ? "Bayar" : "Pinjam (Gratis)"}`, "───────────────────────",
      ...r.items.map((i) => `- ${i.productName} ×${i.quantity}${isFree ? "" : ` = ${fmt(i.subtotal)}`}`),
      "───────────────────────",
      `Total: ${isFree ? "Rp 0 (Gratis)" : fmt(r.total)}`, `Ref: ${r.transferId.slice(0, 8).toUpperCase()}`, "Status: Diterima",
    ];
    window.open(`https://wa.me/?text=${encodeURIComponent(lines.join("\n"))}`, "_blank");
  }

  const pending  = transfers.filter((t) => t.status === "pending");
  const accepted = transfers.filter((t) => t.status === "accepted");

  return (
    <div className="max-w-2xl space-y-6">
      {receipt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm mx-4 overflow-hidden">
            <div className="bg-green-600 px-5 py-4"><p className="font-bold text-white text-base">✓ Transfer Diterima!</p><p className="text-xs text-white/80 mt-0.5">{receipt.timestamp}</p></div>
            <div className="p-5 space-y-3">
              <div className="bg-slate-50 rounded-xl p-3 space-y-1.5 text-xs text-slate-600">
                <div className="flex justify-between"><span className="text-slate-400">Dari Owner</span><span className="font-medium text-slate-700 font-mono">{receipt.sourceOwnerId}</span></div>
                <div className="flex justify-between"><span className="text-slate-400">Masuk ke Club</span><span className="font-medium text-slate-700">{receipt.destinationClubId}</span></div>
                <div className="flex justify-between"><span className="text-slate-400">Jenis</span><span className={`font-semibold ${receipt.paymentType === "pinjam" ? "text-amber-600" : "text-blue-600"}`}>{receipt.paymentType === "bayar" ? "Bayar" : "Pinjam (Gratis)"}</span></div>
              </div>
              <div className="space-y-1">
                {receipt.items.map((item, i) => (
                  <div key={i} className="flex justify-between text-sm">
                    <span className="text-slate-700">{item.quantity}× {item.productName}</span>
                    {receipt.paymentType === "bayar" && <span className="text-slate-500 text-xs">{fmt(item.subtotal)}</span>}
                  </div>
                ))}
              </div>
              {receipt.paymentType === "bayar" && <div className="border-t border-slate-100 pt-2 flex justify-between font-bold text-sm"><span>Total</span><span>{fmt(receipt.total)}</span></div>}
              <p className="text-xs text-slate-400 font-mono">Ref: {receipt.transferId.slice(0, 8).toUpperCase()}</p>
              <div className="flex gap-2 pt-1">
                <button onClick={() => shareReceipt(receipt)} className="flex-1 bg-green-500 hover:bg-green-600 text-white rounded-xl py-2.5 text-sm font-semibold transition">WhatsApp</button>
                <button onClick={() => setReceipt(null)} className="px-4 text-sm text-slate-400 hover:text-slate-600 font-medium">Tutup</button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
            Menunggu Konfirmasi
            {pending.length > 0 && <span className="ml-2 bg-amber-100 text-amber-700 rounded-full px-2 py-0.5 text-xs normal-case font-bold">{pending.length}</span>}
          </p>
        </div>
        <button onClick={loadData} className="text-xs text-blue-600 hover:underline font-medium">Refresh</button>
      </div>

      {loading ? (
        <div className="text-center py-12 text-slate-400 text-sm">Memuat…</div>
      ) : (
        <>
          {pending.length === 0 ? (
            <div className="bg-slate-50 rounded-2xl px-6 py-10 text-center"><p className="text-2xl mb-2">📭</p><p className="text-sm font-medium text-slate-600">Tidak ada transfer yang menunggu</p><p className="text-xs text-slate-400 mt-1">Transfer masuk dari owner lain akan muncul di sini.</p></div>
          ) : (
            <div className="space-y-4">
              {pending.map((t) => (
                <div key={t.id} className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                  <div className="bg-amber-50 border-b border-amber-100 px-4 py-3 flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-bold text-slate-800">Transfer dari Owner</p>
                      <p className="text-xs text-slate-400 font-mono mt-0.5">{t.sourceOwnerId}</p>
                      <p className="text-xs text-slate-400 mt-0.5">{fmtDateTime(t.createdAt)}</p>
                    </div>
                    <span className={`text-xs font-semibold px-2.5 py-1 rounded-full shrink-0 ${t.paymentType === "pinjam" ? "bg-amber-100 text-amber-700" : "bg-blue-100 text-blue-700"}`}>
                      {t.paymentType === "bayar" ? "💰 Bayar" : "🤝 Pinjam — Gratis"}
                    </span>
                  </div>
                  <div className="px-4 py-3 space-y-1.5">
                    {t.items.map((item, i) => (
                      <div key={i} className="flex justify-between text-sm">
                        <span className="text-slate-700">{item.quantity}× {item.productName}</span>
                        {t.paymentType === "bayar" && <span className="text-slate-500 text-xs">{fmt(item.subtotal)}</span>}
                      </div>
                    ))}
                    {t.paymentType === "bayar" && <div className="border-t border-slate-100 pt-2 mt-1 flex justify-between font-semibold text-sm"><span className="text-slate-600">Total</span><span className="text-slate-900">{fmt(t.total)}</span></div>}
                    {t.notes && <p className="text-xs text-slate-400 italic bg-slate-50 rounded-lg px-2.5 py-1.5 mt-1">📝 {t.notes}</p>}
                  </div>
                  <div className="px-4 py-3 border-t border-slate-100 bg-slate-50 space-y-2">
                    {errors[t.transferId] && <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-1.5">{errors[t.transferId]}</p>}
                    <div className="flex items-center gap-2">
                      <select className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-green-500"
                        value={selectedClub[t.transferId] ?? ""} onChange={(e) => setSelectedClub((prev) => ({ ...prev, [t.transferId]: e.target.value }))}>
                        <option value="">— Masuk ke Club mana? —</option>
                        {clubs.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                      <button onClick={() => handleAccept(t)} disabled={accepting[t.transferId] || !selectedClub[t.transferId]}
                        className="bg-green-600 hover:bg-green-700 text-white rounded-lg px-5 py-2 text-sm font-semibold disabled:opacity-40 transition whitespace-nowrap">
                        {accepting[t.transferId] ? "Memproses…" : "✓ Konfirmasi"}
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
          {accepted.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Sudah Diterima ({accepted.length})</p>
              <div className="space-y-2">
                {accepted.map((t) => (
                  <div key={t.id} className="bg-white rounded-xl border border-slate-200 px-4 py-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-700 truncate">Dari <span className="font-mono text-xs text-slate-500">{t.sourceOwnerId}</span></p>
                      <p className="text-xs text-slate-400 mt-0.5">{t.items.length} produk · {t.paymentType === "pinjam" ? "Pinjam" : fmt(t.total)} · {fmtDateTime(t.createdAt)}</p>
                    </div>
                    <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-green-50 text-green-700 shrink-0">✓ Diterima</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
