import { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { v4 as uuidv4 } from "uuid";
import { useAuthStore } from "@/store/auth.store";
import { useEnqueue } from "@/hooks/useEnqueue";

type MovementType = "restock" | "sale" | "waste" | "transfer_in" | "transfer_out" | "opening_stock" | "reversal";

const MOVEMENT_TYPES: { key: MovementType; label: string }[] = [
  { key: "restock", label: "Restock" },
  { key: "sale", label: "Penjualan" },
  { key: "waste", label: "Terbuang" },
  { key: "transfer_in", label: "Masuk" },
  { key: "transfer_out", label: "Keluar" },
  { key: "opening_stock", label: "Stok Awal" },
];

export default function InventoryScreen() {
  const { ownerId, clubId, operatorId } = useAuthStore();
  const enqueue = useEnqueue();

  const [itemId, setItemId] = useState("");
  const [qty, setQty] = useState("");
  const [movementType, setMovementType] = useState<MovementType>("restock");
  const [notes, setNotes] = useState("");

  function handleCreateMovement() {
    if (!itemId || !qty) {
      Alert.alert("Error", "Isi ID item dan jumlah");
      return;
    }
    const quantity = parseInt(qty, 10);
    if (isNaN(quantity) || quantity < 1) {
      Alert.alert("Error", "Jumlah tidak valid");
      return;
    }
    if (!ownerId || !clubId || !operatorId) return;

    const operationId = uuidv4();
    const requestId = uuidv4();

    enqueue({
      operationId,
      requestId,
      functionName: "inventory_createMovement",
      payload: {
        ownerId,
        clubId,
        operatorId,
        requestId,
        operationId,
        itemId,
        movementType,
        qty: quantity,
        notes: notes || undefined,
      },
    });

    Alert.alert("Berhasil", `Pergerakan stok dijadwalkan (${movementType})`);
    setItemId("");
    setQty("");
    setNotes("");
  }

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>Inventaris</Text>

      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Catat Pergerakan Stok</Text>
          <TextInput style={styles.input} placeholder="ID Item" value={itemId} onChangeText={setItemId} autoCapitalize="none" />
          <TextInput style={styles.input} placeholder="Jumlah" value={qty} onChangeText={setQty} keyboardType="numeric" />

          <Text style={styles.label}>Jenis Pergerakan</Text>
          <View style={styles.typeGrid}>
            {MOVEMENT_TYPES.map((t) => (
              <TouchableOpacity
                key={t.key}
                style={[styles.typeBtn, movementType === t.key && styles.typeBtnActive]}
                onPress={() => setMovementType(t.key)}
              >
                <Text style={[styles.typeBtnText, movementType === t.key && styles.typeBtnTextActive]}>
                  {t.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <TextInput
            style={styles.input}
            placeholder="Catatan (opsional)"
            value={notes}
            onChangeText={setNotes}
            multiline
          />

          <TouchableOpacity style={styles.submitBtn} onPress={handleCreateMovement}>
            <Text style={styles.submitBtnText}>Simpan Pergerakan</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f8fafc" },
  title: { fontSize: 22, fontWeight: "700", color: "#1e293b", padding: 16, paddingBottom: 8 },
  scroll: { padding: 16, paddingTop: 0, gap: 16 },
  section: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 16,
    gap: 12,
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  sectionTitle: { fontSize: 16, fontWeight: "600", color: "#374151" },
  label: { fontSize: 14, color: "#64748b", marginBottom: -4 },
  input: {
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: "#1e293b",
    backgroundColor: "#f8fafc",
  },
  typeGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  typeBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    backgroundColor: "#f8fafc",
  },
  typeBtnActive: { borderColor: "#ea580c", backgroundColor: "#fff7ed" },
  typeBtnText: { fontSize: 13, color: "#64748b" },
  typeBtnTextActive: { color: "#ea580c", fontWeight: "700" },
  submitBtn: {
    backgroundColor: "#ea580c",
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
  },
  submitBtnText: { color: "#fff", fontSize: 16, fontWeight: "700" },
});
