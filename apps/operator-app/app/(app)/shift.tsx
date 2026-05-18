import { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { v4 as uuidv4 } from "uuid";
import { useAuthStore } from "@/store/auth.store";
import { useEnqueue } from "@/hooks/useEnqueue";

export default function ShiftScreen() {
  const { ownerId, clubId, operatorId } = useAuthStore();
  const enqueue = useEnqueue();

  const [openingCash, setOpeningCash] = useState("");
  const [actualCash, setActualCash] = useState("");
  const [activeShiftId, setActiveShiftId] = useState<string | undefined>();

  function handleOpenShift() {
    const cash = parseFloat(openingCash);
    if (isNaN(cash) || cash < 0) {
      Alert.alert("Error", "Masukkan saldo kas awal yang valid");
      return;
    }
    if (!ownerId || !clubId || !operatorId) return;

    const shiftId = uuidv4();
    const operationId = uuidv4();
    const requestId = uuidv4();

    enqueue({
      operationId,
      requestId,
      functionName: "finance_openShift",
      payload: {
        ownerId,
        clubId,
        operatorId,
        requestId,
        operationId,
        shiftId,
        openingCash: cash,
      },
    });

    setActiveShiftId(shiftId);
    setOpeningCash("");
    Alert.alert("Shift Dibuka", `ID Shift: ${shiftId.slice(0, 8)}…`);
  }

  function handleCloseShift() {
    if (!activeShiftId) {
      Alert.alert("Error", "Tidak ada shift yang aktif");
      return;
    }
    const cash = parseFloat(actualCash);
    if (isNaN(cash) || cash < 0) {
      Alert.alert("Error", "Masukkan jumlah kas aktual yang valid");
      return;
    }
    if (!ownerId || !clubId || !operatorId) return;

    const operationId = uuidv4();
    const requestId = uuidv4();

    enqueue({
      operationId,
      requestId,
      functionName: "finance_closeShift",
      payload: {
        ownerId,
        clubId,
        operatorId,
        requestId,
        operationId,
        shiftId: activeShiftId,
        actualCash: cash,
      },
    });

    setActiveShiftId(undefined);
    setActualCash("");
    Alert.alert("Shift Ditutup", "Shift berhasil ditutup dan dijadwalkan ke server");
  }

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>Manajemen Shift</Text>

      <ScrollView contentContainerStyle={styles.scroll}>
        {activeShiftId ? (
          <View style={styles.section}>
            <View style={styles.shiftBadge}>
              <Text style={styles.shiftBadgeText}>Shift Aktif</Text>
            </View>
            <Text style={styles.shiftId}>ID: {activeShiftId.slice(0, 8)}…</Text>
            <Text style={styles.label}>Kas Aktual (saat tutup)</Text>
            <TextInput
              style={styles.input}
              placeholder="Jumlah kas di tangan"
              value={actualCash}
              onChangeText={setActualCash}
              keyboardType="numeric"
            />
            <TouchableOpacity style={styles.closeBtn} onPress={handleCloseShift}>
              <Text style={styles.closeBtnText}>Tutup Shift</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Buka Shift Baru</Text>
            <Text style={styles.label}>Saldo Kas Awal</Text>
            <TextInput
              style={styles.input}
              placeholder="Contoh: 500000"
              value={openingCash}
              onChangeText={setOpeningCash}
              keyboardType="numeric"
            />
            <TouchableOpacity style={styles.openBtn} onPress={handleOpenShift}>
              <Text style={styles.openBtnText}>Buka Shift</Text>
            </TouchableOpacity>
          </View>
        )}
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
  shiftBadge: {
    alignSelf: "flex-start",
    backgroundColor: "#dcfce7",
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 20,
  },
  shiftBadgeText: { color: "#16a34a", fontWeight: "700", fontSize: 13 },
  shiftId: { fontSize: 13, color: "#94a3b8", fontFamily: "monospace" },
  openBtn: {
    backgroundColor: "#16a34a",
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
  },
  openBtnText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  closeBtn: {
    backgroundColor: "#dc2626",
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
  },
  closeBtnText: { color: "#fff", fontSize: 16, fontWeight: "700" },
});
