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
import { collection, query, where, onSnapshot, limit } from "firebase/firestore";
import { v4 as uuidv4 } from "uuid";
import { useAuthStore } from "@/store/auth.store";
import { callableFn, firebaseDb } from "@/firebase/firebase";
import { COLLECTIONS } from "@nc-manager/shared-constants";

interface Shift {
  id: string;
  operatorId: string;
  deviceId: string;
  openingCash: number;
  status: "open" | "closed";
  totalTransactions: number;
  totalRevenue: number;
  openedAt: string;
  closedAt: string | null;
  actualCash?: number;
  expectedCash?: number;
  cashDiscrepancy?: number;
  notes?: string | null;
}

function fmt(n: number | undefined | null) {
  return (n ?? 0).toLocaleString("id-ID");
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function ShiftScreen() {
  const { ownerId, clubId, operatorId, deviceId } = useAuthStore();

  // undefined = loading, null = no active shift, Shift = active shift
  const [activeShift, setActiveShift] = useState<Shift | null | undefined>(undefined);
  const [openingCash, setOpeningCash] = useState("");
  const [actualCash, setActualCash] = useState("");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [lastClosed, setLastClosed] = useState<{
    totalTransactions: number;
    totalRevenue: number;
    cashDiscrepancy: number;
    hasDiscrepancy: boolean;
    actualCash: number;
    expectedCash: number;
  } | null>(null);

  // Real-time listener for active shift belonging to this operator
  useEffect(() => {
    if (!ownerId || !clubId || !operatorId) return;

    const q = query(
      collection(firebaseDb(), COLLECTIONS.SHIFTS(ownerId, clubId)),
      where("operatorId", "==", operatorId),
      where("status", "==", "open"),
      limit(1)
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        if (snap.empty) {
          setActiveShift(null);
        } else {
          const doc = snap.docs[0]!;
          setActiveShift({ id: doc.id, ...(doc.data() as Omit<Shift, "id">) });
        }
      },
      (err) => {
        console.error("[Shift] listener error:", err);
        setActiveShift(null);
      }
    );

    return unsub;
  }, [ownerId, clubId, operatorId]);

  async function handleOpenShift() {
    const cash = parseFloat(openingCash);
    if (isNaN(cash) || cash < 0) {
      Alert.alert("Error", "Masukkan saldo kas awal yang valid");
      return;
    }
    if (!ownerId || !clubId || !operatorId || !deviceId) {
      Alert.alert("Error", "Sesi tidak valid, silakan login ulang");
      return;
    }

    setLoading(true);
    try {
      await callableFn("finance_openShift", {
        ownerId,
        clubId,
        operatorId,
        deviceId,
        openingCash: cash,
        operationId: uuidv4(),
        requestId: uuidv4(),
      });
      setOpeningCash("");
      setLastClosed(null);
    } catch (err) {
      Alert.alert("Gagal Membuka Shift", err instanceof Error ? err.message : "Terjadi kesalahan");
    } finally {
      setLoading(false);
    }
  }

  async function handleCloseShift() {
    if (!activeShift) return;
    const cash = parseFloat(actualCash);
    if (isNaN(cash) || cash < 0) {
      Alert.alert("Error", "Masukkan jumlah kas aktual yang valid");
      return;
    }
    if (!ownerId || !clubId || !operatorId) return;

    setLoading(true);
    try {
      const result = await callableFn("finance_closeShift", {
        ownerId,
        clubId,
        operatorId,
        shiftId: activeShift.id,
        actualCash: cash,
        notes: notes.trim() || undefined,
        operationId: uuidv4(),
        requestId: uuidv4(),
      }) as { shiftId: string; cashDiscrepancy: number; hasDiscrepancy: boolean };

      const expectedCash = activeShift.openingCash + activeShift.totalRevenue;
      setLastClosed({
        totalTransactions: activeShift.totalTransactions,
        totalRevenue: activeShift.totalRevenue,
        cashDiscrepancy: result.cashDiscrepancy,
        hasDiscrepancy: result.hasDiscrepancy,
        actualCash: cash,
        expectedCash,
      });
      setActualCash("");
      setNotes("");
    } catch (err) {
      Alert.alert("Gagal Menutup Shift", err instanceof Error ? err.message : "Terjadi kesalahan");
    } finally {
      setLoading(false);
    }
  }

  if (activeShift === undefined) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator size="large" color="#2563eb" style={{ flex: 1 }} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>Manajemen Shift</Text>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">

        {/* Shift summary after close */}
        {lastClosed && !activeShift && (
          <View style={styles.summaryCard}>
            <Text style={styles.summaryTitle}>Ringkasan Shift Terakhir</Text>
            <Row label="Total Transaksi" value={String(lastClosed.totalTransactions)} />
            <Row label="Total Pendapatan" value={`Rp ${fmt(lastClosed.totalRevenue)}`} />
            <Row label="Kas Diharapkan" value={`Rp ${fmt(lastClosed.expectedCash)}`} />
            <Row label="Kas Aktual" value={`Rp ${fmt(lastClosed.actualCash)}`} />
            <View style={styles.divider} />
            <View style={styles.row}>
              <Text style={styles.rowLabel}>Selisih Kas</Text>
              <Text style={[
                styles.rowValue,
                { color: lastClosed.hasDiscrepancy ? "#dc2626" : "#16a34a" },
              ]}>
                {lastClosed.cashDiscrepancy >= 0 ? "+" : ""}Rp {fmt(lastClosed.cashDiscrepancy)}
                {lastClosed.hasDiscrepancy ? " ⚠️" : " ✓"}
              </Text>
            </View>
          </View>
        )}

        {activeShift ? (
          /* ── Active shift ── */
          <View>
            {/* Info card */}
            <View style={styles.activeCard}>
              <View style={styles.badgeRow}>
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>● Shift Aktif</Text>
                </View>
                <Text style={styles.shiftId}>#{activeShift.id.slice(0, 8)}</Text>
              </View>

              <Row label="Dibuka" value={formatTime(activeShift.openedAt)} />
              <Row label="Kas Awal" value={`Rp ${fmt(activeShift.openingCash)}`} />

              <View style={styles.divider} />

              <Row label="Transaksi" value={String(activeShift.totalTransactions)} />
              <Row label="Pendapatan" value={`Rp ${fmt(activeShift.totalRevenue)}`} />
              <Row
                label="Perkiraan Kas"
                value={`Rp ${fmt(activeShift.openingCash + activeShift.totalRevenue)}`}
                highlight
              />
            </View>

            {/* Close shift form */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Tutup Shift</Text>

              <Text style={styles.label}>Kas Aktual (hitung fisik)</Text>
              <TextInput
                style={styles.input}
                placeholder="Jumlah kas di tangan"
                value={actualCash}
                onChangeText={setActualCash}
                keyboardType="numeric"
              />

              <Text style={styles.label}>Catatan (opsional)</Text>
              <TextInput
                style={[styles.input, styles.inputMulti]}
                placeholder="Misal: ada selisih karena kembalian..."
                value={notes}
                onChangeText={setNotes}
                multiline
                numberOfLines={3}
              />

              <TouchableOpacity
                style={[styles.closeBtn, loading && styles.disabledBtn]}
                onPress={handleCloseShift}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.closeBtnText}>Tutup Shift</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          /* ── Open shift form ── */
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Buka Shift Baru</Text>
            <Text style={styles.hint}>
              Hitung uang kas di laci, masukkan jumlahnya sebelum mulai bertransaksi.
            </Text>

            <Text style={styles.label}>Saldo Kas Awal</Text>
            <TextInput
              style={styles.input}
              placeholder="Contoh: 500000"
              value={openingCash}
              onChangeText={setOpeningCash}
              keyboardType="numeric"
            />

            <TouchableOpacity
              style={[styles.openBtn, loading && styles.disabledBtn]}
              onPress={handleOpenShift}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.openBtnText}>Buka Shift</Text>
              )}
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Row({
  label,
  value,
  highlight = false,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, highlight && styles.rowValueHighlight]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f8fafc" },
  title: { fontSize: 22, fontWeight: "700", color: "#1e293b", padding: 16, paddingBottom: 8 },
  scroll: { padding: 16, paddingTop: 8, gap: 12 },

  section: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 16,
    gap: 10,
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  sectionTitle: { fontSize: 16, fontWeight: "600", color: "#374151" },
  hint: { fontSize: 13, color: "#94a3b8", lineHeight: 18 },
  label: { fontSize: 13, color: "#64748b" },

  activeCard: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 16,
    gap: 8,
    borderLeftWidth: 4,
    borderLeftColor: "#16a34a",
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
    marginBottom: 12,
  },
  badgeRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 4 },
  badge: {
    backgroundColor: "#dcfce7",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
  },
  badgeText: { color: "#16a34a", fontWeight: "700", fontSize: 13 },
  shiftId: { fontSize: 12, color: "#94a3b8", fontFamily: "monospace" },

  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  rowLabel: { fontSize: 14, color: "#64748b" },
  rowValue: { fontSize: 14, color: "#1e293b", fontWeight: "500" },
  rowValueHighlight: { color: "#2563eb", fontWeight: "700" },

  divider: { height: 1, backgroundColor: "#f1f5f9", marginVertical: 4 },

  summaryCard: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 16,
    gap: 8,
    borderLeftWidth: 4,
    borderLeftColor: "#2563eb",
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  summaryTitle: { fontSize: 15, fontWeight: "700", color: "#1e293b", marginBottom: 4 },

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
  inputMulti: {
    minHeight: 72,
    textAlignVertical: "top",
  },

  openBtn: {
    backgroundColor: "#16a34a",
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 4,
  },
  openBtnText: { color: "#fff", fontSize: 16, fontWeight: "700" },

  closeBtn: {
    backgroundColor: "#dc2626",
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 4,
  },
  closeBtnText: { color: "#fff", fontSize: 16, fontWeight: "700" },

  disabledBtn: { opacity: 0.6 },
});
