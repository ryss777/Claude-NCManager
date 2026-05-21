import { useState, useEffect } from "react";
import { View, Text, TouchableOpacity, StyleSheet, Alert, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { collection, doc, getDoc, query, where, limit, onSnapshot } from "firebase/firestore";
import { useAuthStore } from "@/store/auth.store";
import { clearSession } from "@/hooks/useOperatorLogin";
import { firebaseDb } from "@/firebase/firebase";
import { COLLECTIONS } from "@nc-manager/shared-constants";

function getGreeting() {
  const h = new Date().getHours();
  if (h < 11) return "Selamat pagi";
  if (h < 15) return "Selamat siang";
  if (h < 18) return "Selamat sore";
  return "Selamat malam";
}

interface ShiftStatus {
  id: string;
  status: "open" | "closed";
  openedAt: string;
  totalTransactions: number;
  totalRevenue: number;
}

export default function DashboardScreen() {
  const { operatorId, ownerId, clubId } = useAuthStore();
  const [operatorName, setOperatorName] = useState<string | null>(null);
  const [activeShift, setActiveShift] = useState<ShiftStatus | null | undefined>(undefined);

  // Fetch operator display name once
  useEffect(() => {
    if (!ownerId || !clubId || !operatorId) return;
    getDoc(doc(firebaseDb(), COLLECTIONS.OPERATORS(ownerId, clubId), operatorId))
      .then((snap) => {
        if (snap.exists()) {
          setOperatorName((snap.data()["displayName"] as string) ?? null);
        }
      })
      .catch(() => {});
  }, [ownerId, clubId, operatorId]);

  // Real-time shift status
  useEffect(() => {
    if (!ownerId || !clubId || !operatorId) return;

    const q = query(
      collection(firebaseDb(), COLLECTIONS.SHIFTS(ownerId, clubId)),
      where("operatorId", "==", operatorId),
      where("status", "==", "open"),
      limit(1)
    );

    const unsub = onSnapshot(q, (snap) => {
      if (snap.empty) {
        setActiveShift(null);
      } else {
        const d = snap.docs[0]!;
        setActiveShift({ id: d.id, ...(d.data() as Omit<ShiftStatus, "id">) });
      }
    }, () => setActiveShift(null));

    return unsub;
  }, [ownerId, clubId, operatorId]);

  async function handleLogout() {
    Alert.alert("Keluar", "Apakah Anda yakin ingin keluar?", [
      { text: "Batal", style: "cancel" },
      {
        text: "Keluar",
        style: "destructive",
        onPress: async () => {
          await clearSession();
          router.replace("/(auth)/login");
        },
      },
    ]);
  }

  const name = operatorName ?? operatorId ?? "Operator";

  return (
    <SafeAreaView style={styles.container}>
      {/* ── Header ── */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={styles.greeting}>{getGreeting()},</Text>
          <Text style={styles.operatorName}>{name}</Text>
          <Text style={styles.clubInfo}>{ownerId} / {clubId}</Text>
        </View>
        <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout}>
          <Text style={styles.logoutText}>Keluar</Text>
        </TouchableOpacity>
      </View>

      {/* ── Shift status pill ── */}
      <View style={styles.shiftBanner}>
        {activeShift === undefined ? (
          <ActivityIndicator size="small" color="#94a3b8" />
        ) : activeShift ? (
          <TouchableOpacity
            style={styles.shiftPillOpen}
            onPress={() => router.push("/(app)/shift")}
          >
            <Text style={styles.shiftDot}>●</Text>
            <View>
              <Text style={styles.shiftPillTitle}>Shift Sedang Berjalan</Text>
              <Text style={styles.shiftPillMeta}>
                {activeShift.totalTransactions} transaksi ·{" "}
                Rp {activeShift.totalRevenue.toLocaleString("id-ID")}
              </Text>
            </View>
            <Text style={styles.shiftArrow}>›</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={styles.shiftPillClosed}
            onPress={() => router.push("/(app)/shift")}
          >
            <Text style={styles.shiftPillClosedText}>⚠ Shift belum dibuka — Ketuk untuk membuka</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* ── Quick-access grid ── */}
      <View style={styles.grid}>
        <QuickCard
          label="Kasir"
          description="Proses transaksi"
          color="#2563eb"
          icon="🖥️"
          onPress={() => router.push("/(app)/pos")}
        />
        <QuickCard
          label="Shift"
          description={activeShift ? "Tutup shift" : "Buka shift"}
          color="#16a34a"
          icon="⏱"
          onPress={() => router.push("/(app)/shift")}
        />
        <QuickCard
          label="Member"
          description="Check-in / aktivasi"
          color="#9333ea"
          icon="⭐"
          onPress={() => router.push("/(app)/membership")}
        />
        <QuickCard
          label="Stok"
          description="Catat pergerakan"
          color="#ea580c"
          icon="📦"
          onPress={() => router.push("/(app)/inventory")}
        />
      </View>
    </SafeAreaView>
  );
}

function QuickCard({
  label,
  description,
  color,
  icon,
  onPress,
}: {
  label: string;
  description: string;
  color: string;
  icon: string;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={[styles.card, { borderLeftColor: color }]}
      onPress={onPress}
      activeOpacity={0.8}
    >
      <Text style={styles.cardIcon}>{icon}</Text>
      <Text style={[styles.cardLabel, { color }]}>{label}</Text>
      <Text style={styles.cardDesc}>{description}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f8fafc", padding: 16 },

  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 16,
  },
  headerLeft: { flex: 1 },
  greeting: { fontSize: 13, color: "#64748b" },
  operatorName: { fontSize: 22, fontWeight: "700", color: "#1e293b", marginTop: 2 },
  clubInfo: { fontSize: 11, color: "#94a3b8", marginTop: 3 },
  logoutBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: "#fee2e2",
  },
  logoutText: { color: "#dc2626", fontWeight: "600", fontSize: 14 },

  shiftBanner: { marginBottom: 20 },
  shiftPillOpen: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "#f0fdf4",
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: "#bbf7d0",
  },
  shiftDot: { fontSize: 16, color: "#16a34a" },
  shiftPillTitle: { fontSize: 13, fontWeight: "700", color: "#166534" },
  shiftPillMeta: { fontSize: 12, color: "#4ade80", marginTop: 1 },
  shiftArrow: { marginLeft: "auto", fontSize: 20, color: "#4ade80" },
  shiftPillClosed: {
    backgroundColor: "#fef3c7",
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: "#fcd34d",
    alignItems: "center",
  },
  shiftPillClosedText: { fontSize: 13, fontWeight: "600", color: "#92400e" },

  grid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  card: {
    width: "47%",
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 16,
    borderLeftWidth: 4,
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
    gap: 4,
  },
  cardIcon: { fontSize: 24, marginBottom: 4 },
  cardLabel: { fontSize: 17, fontWeight: "700" },
  cardDesc: { fontSize: 12, color: "#64748b" },
});
