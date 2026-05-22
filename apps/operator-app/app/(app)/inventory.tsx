import { useState, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ScrollView,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { collection, query, where, onSnapshot } from "firebase/firestore";
import { v4 as uuidv4 } from "uuid";
import { useAuthStore } from "@/store/auth.store";
import { callableFn, firebaseDb } from "@/firebase/firebase";
import { COLLECTIONS } from "@nc-manager/shared-constants";

type MovementType = "restock" | "sale" | "waste" | "transfer_in" | "transfer_out";

const MOVEMENT_OPTIONS: { key: MovementType; label: string; icon: string; color: string }[] = [
  { key: "restock",      label: "Restock",   icon: "↑", color: "#16a34a" },
  { key: "sale",         label: "Penjualan", icon: "₿", color: "#2563eb" },
  { key: "waste",        label: "Terbuang",  icon: "✕", color: "#dc2626" },
  { key: "transfer_in",  label: "Masuk",     icon: "→", color: "#7c3aed" },
  { key: "transfer_out", label: "Keluar",    icon: "←", color: "#ea580c" },
];

interface InventoryItem {
  id: string;
  name: string;
  category: string | null;
  unit: string;
  currentStock: number;
  minimumStock: number;
  isActive: boolean;
}

function fmt(n: number | undefined | null) {
  return (n ?? 0).toLocaleString("id-ID");
}

export default function InventoryScreen() {
  const { ownerId, clubId, operatorId } = useAuthStore();

  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loadingItems, setLoadingItems] = useState(true);

  const [selected, setSelected] = useState<InventoryItem | null>(null);
  const [movementType, setMovementType] = useState<MovementType>("restock");
  const [quantity, setQuantity] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Real-time stock listener
  useEffect(() => {
    if (!ownerId || !clubId) return;

    const q = query(
      collection(firebaseDb(), COLLECTIONS.INVENTORY_ITEMS(ownerId, clubId)),
      where("isActive", "==", true)
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        const list = snap.docs
          .map((d) => ({ id: d.id, ...(d.data() as Omit<InventoryItem, "id">) }))
          .sort((a, b) => a.name.localeCompare(b.name));
        setItems(list);
        setLoadingItems(false);

        // Keep selected item in sync with latest stock
        setSelected((prev) =>
          prev ? (list.find((i) => i.id === prev.id) ?? null) : null
        );
      },
      () => setLoadingItems(false)
    );

    return unsub;
  }, [ownerId, clubId]);

  function selectItem(item: InventoryItem) {
    setSelected(item);
    setMovementType("restock");
    setQuantity("");
    setUnitCost("");
    setNotes("");
  }

  function clearSelection() {
    setSelected(null);
    setQuantity("");
    setUnitCost("");
    setNotes("");
  }

  async function handleSubmit() {
    if (!selected || !ownerId || !clubId || !operatorId) return;

    const qty = parseFloat(quantity);
    if (isNaN(qty) || qty <= 0) {
      Alert.alert("Error", "Masukkan jumlah yang valid");
      return;
    }

    const cost = parseFloat(unitCost);
    if (isNaN(cost) || cost < 0) {
      Alert.alert("Error", "Harga per unit tidak valid");
      return;
    }

    const opt = MOVEMENT_OPTIONS.find((o) => o.key === movementType)!;
    const isSubtraction = ["sale", "waste", "transfer_out"].includes(movementType);

    if (isSubtraction && qty > selected.currentStock) {
      Alert.alert(
        "Stok Tidak Cukup",
        `Stok saat ini: ${selected.currentStock} ${selected.unit}\nDiminta: ${qty} ${selected.unit}`
      );
      return;
    }

    Alert.alert(
      "Konfirmasi Pergerakan Stok",
      `${selected.name}\n${opt.label}: ${qty} ${selected.unit}\nStok sesudah: ${
        isSubtraction
          ? selected.currentStock - qty
          : selected.currentStock + qty
      } ${selected.unit}`,
      [
        { text: "Batal", style: "cancel" },
        {
          text: "Simpan",
          onPress: async () => {
            setSubmitting(true);
            try {
              const result = await callableFn("inventory_createMovement", {
                ownerId,
                clubId,
                operatorId,
                operationId: uuidv4(),
                requestId: uuidv4(),
                inventoryItemId: selected.id,
                movementType,
                quantity: qty,
                unitCost: cost,
                referenceType: "manual",
                notes: notes.trim() || undefined,
              }) as { movementId: string; stockBefore: number; stockAfter: number };

              Alert.alert(
                "Berhasil ✓",
                `${selected.name}\nStok: ${result.stockBefore} → ${result.stockAfter} ${selected.unit}`
              );
              setQuantity("");
              setNotes("");
            } catch (err) {
              Alert.alert("Gagal", err instanceof Error ? err.message : "Terjadi kesalahan");
            } finally {
              setSubmitting(false);
            }
          },
        },
      ]
    );
  }

  const lowStockItems = items.filter((i) => i.currentStock <= i.minimumStock);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Inventaris</Text>
        {loadingItems && <ActivityIndicator size="small" color="#94a3b8" />}
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">

        {/* ── Low-stock warning ── */}
        {lowStockItems.length > 0 && (
          <View style={styles.lowStockBanner}>
            <Text style={styles.lowStockBannerTitle}>
              ⚠ {lowStockItems.length} item stok menipis
            </Text>
            <Text style={styles.lowStockBannerList} numberOfLines={2}>
              {lowStockItems.map((i) => i.name).join(", ")}
            </Text>
          </View>
        )}

        {/* ── Stock list ── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            Daftar Stok ({items.length} produk)
          </Text>

          {loadingItems ? (
            <ActivityIndicator color="#94a3b8" style={{ paddingVertical: 16 }} />
          ) : items.length === 0 ? (
            <Text style={styles.emptyText}>Belum ada item inventaris.</Text>
          ) : (
            items.map((item) => {
              const isLow = item.currentStock <= item.minimumStock;
              const isSelected = selected?.id === item.id;

              return (
                <TouchableOpacity
                  key={item.id}
                  style={[
                    styles.itemRow,
                    isSelected && styles.itemRowSelected,
                    isLow && !isSelected && styles.itemRowLow,
                  ]}
                  onPress={() => isSelected ? clearSelection() : selectItem(item)}
                >
                  <View style={styles.itemInfo}>
                    <Text style={styles.itemName}>{item.name}</Text>
                    <Text style={styles.itemSku}>{item.category ?? ""}</Text>
                  </View>
                  <View style={styles.itemStock}>
                    <Text style={[styles.stockNum, isLow && styles.stockNumLow]}>
                      {fmt(item.currentStock)}
                    </Text>
                    <Text style={styles.stockUnit}>{item.unit}</Text>
                    {isLow && (
                      <View style={styles.lowBadge}>
                        <Text style={styles.lowBadgeText}>RENDAH</Text>
                      </View>
                    )}
                  </View>
                </TouchableOpacity>
              );
            })
          )}
        </View>

        {/* ── Movement form ── */}
        {selected && (
          <View style={styles.section}>
            <View style={styles.selectedHeader}>
              <View>
                <Text style={styles.selectedLabel}>Item Dipilih</Text>
                <Text style={styles.selectedName}>{selected.name}</Text>
                <Text style={styles.selectedStock}>
                  Stok saat ini: {fmt(selected.currentStock)} {selected.unit}
                </Text>
              </View>
              <TouchableOpacity onPress={clearSelection} style={styles.clearBtn}>
                <Text style={styles.clearBtnText}>Batal</Text>
              </TouchableOpacity>
            </View>

            {/* Movement type */}
            <Text style={styles.fieldLabel}>Jenis Pergerakan</Text>
            <View style={styles.typeRow}>
              {MOVEMENT_OPTIONS.map((opt) => (
                <TouchableOpacity
                  key={opt.key}
                  style={[
                    styles.typeChip,
                    movementType === opt.key && { borderColor: opt.color, backgroundColor: opt.color + "15" },
                  ]}
                  onPress={() => setMovementType(opt.key)}
                >
                  <Text style={[
                    styles.typeChipText,
                    movementType === opt.key && { color: opt.color, fontWeight: "700" },
                  ]}>
                    {opt.icon} {opt.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Quantity */}
            <Text style={styles.fieldLabel}>Jumlah ({selected.unit})</Text>
            <TextInput
              style={styles.input}
              placeholder={`Contoh: 10`}
              value={quantity}
              onChangeText={setQuantity}
              keyboardType="numeric"
            />

            {/* Unit cost */}
            <Text style={styles.fieldLabel}>
              {["restock", "transfer_in", "opening_stock"].includes(movementType)
                ? "Harga Beli per Unit (Rp)"
                : "Harga per Unit (Rp)"}
            </Text>
            <TextInput
              style={styles.input}
              placeholder="0"
              value={unitCost}
              onChangeText={setUnitCost}
              keyboardType="numeric"
            />

            {/* Notes */}
            <Text style={styles.fieldLabel}>Catatan (opsional)</Text>
            <TextInput
              style={[styles.input, styles.inputMulti]}
              placeholder="Misal: restock dari supplier ABC..."
              value={notes}
              onChangeText={setNotes}
              multiline
              numberOfLines={2}
            />

            {/* Stock preview */}
            {quantity && parseFloat(quantity) > 0 && (
              <View style={styles.previewRow}>
                <Text style={styles.previewLabel}>Stok sesudah</Text>
                <Text style={styles.previewValue}>
                  {(() => {
                    const qty = parseFloat(quantity) || 0;
                    const isSubtraction = ["sale", "waste", "transfer_out"].includes(movementType);
                    const after = isSubtraction
                      ? selected.currentStock - qty
                      : selected.currentStock + qty;
                    return `${fmt(after)} ${selected.unit}`;
                  })()}
                </Text>
              </View>
            )}

            <TouchableOpacity
              style={[styles.submitBtn, submitting && styles.disabledBtn]}
              onPress={handleSubmit}
              disabled={submitting}
            >
              {submitting ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.submitBtnText}>Simpan Pergerakan</Text>
              )}
            </TouchableOpacity>
          </View>
        )}

        <View style={{ height: 24 }} />
      </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f8fafc" },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4,
  },
  title: { fontSize: 22, fontWeight: "700", color: "#1e293b" },
  scroll: { padding: 16, paddingTop: 8, gap: 12 },

  lowStockBanner: {
    backgroundColor: "#fef3c7", borderRadius: 10, padding: 12,
    borderLeftWidth: 4, borderLeftColor: "#f59e0b", gap: 2,
  },
  lowStockBannerTitle: { fontSize: 13, fontWeight: "700", color: "#92400e" },
  lowStockBannerList: { fontSize: 12, color: "#b45309" },

  section: {
    backgroundColor: "#fff", borderRadius: 12, padding: 14, gap: 10,
    shadowColor: "#000", shadowOpacity: 0.05, shadowRadius: 4, elevation: 2,
  },
  sectionTitle: {
    fontSize: 13, fontWeight: "600", color: "#64748b",
    textTransform: "uppercase", letterSpacing: 0.5,
  },
  emptyText: { color: "#94a3b8", fontSize: 14, textAlign: "center", paddingVertical: 8 },

  itemRow: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingVertical: 10, paddingHorizontal: 10, borderRadius: 8,
    borderWidth: 1, borderColor: "#f1f5f9",
  },
  itemRowSelected: { borderColor: "#2563eb", backgroundColor: "#eff6ff" },
  itemRowLow: { borderColor: "#fcd34d", backgroundColor: "#fffbeb" },
  itemInfo: { flex: 1 },
  itemName: { fontSize: 14, fontWeight: "600", color: "#1e293b" },
  itemSku: { fontSize: 11, color: "#94a3b8", marginTop: 1 },
  itemStock: { flexDirection: "row", alignItems: "center", gap: 4 },
  stockNum: { fontSize: 15, fontWeight: "700", color: "#1e293b" },
  stockNumLow: { color: "#dc2626" },
  stockUnit: { fontSize: 12, color: "#94a3b8" },
  lowBadge: {
    backgroundColor: "#fef2f2", borderRadius: 4, paddingHorizontal: 5, paddingVertical: 2,
  },
  lowBadgeText: { fontSize: 9, fontWeight: "700", color: "#dc2626", letterSpacing: 0.5 },

  selectedHeader: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start",
    backgroundColor: "#f0fdf4", borderRadius: 8, padding: 12,
  },
  selectedLabel: { fontSize: 11, color: "#16a34a", fontWeight: "600", textTransform: "uppercase" },
  selectedName: { fontSize: 15, fontWeight: "700", color: "#166534", marginTop: 2 },
  selectedStock: { fontSize: 12, color: "#4ade80", marginTop: 2 },
  clearBtn: { paddingHorizontal: 8, paddingVertical: 4 },
  clearBtnText: { fontSize: 13, color: "#94a3b8" },

  fieldLabel: { fontSize: 13, color: "#64748b" },
  typeRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  typeChip: {
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20,
    borderWidth: 1.5, borderColor: "#e2e8f0",
  },
  typeChipText: { fontSize: 13, color: "#64748b" },

  input: {
    borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 15, color: "#1e293b", backgroundColor: "#f8fafc",
  },
  inputMulti: { minHeight: 60, textAlignVertical: "top" },

  previewRow: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    backgroundColor: "#f0f9ff", borderRadius: 8, padding: 12,
  },
  previewLabel: { fontSize: 13, color: "#0369a1" },
  previewValue: { fontSize: 15, fontWeight: "700", color: "#0284c7" },

  submitBtn: {
    backgroundColor: "#ea580c", borderRadius: 10, paddingVertical: 14, alignItems: "center",
  },
  submitBtnText: { color: "#fff", fontSize: 15, fontWeight: "700" },
  disabledBtn: { opacity: 0.5 },
});
