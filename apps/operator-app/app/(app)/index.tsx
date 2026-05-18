import { View, Text, TouchableOpacity, StyleSheet, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useAuthStore } from "@/store/auth.store";
import { clearSession } from "@/hooks/useOperatorLogin";

export default function DashboardScreen() {
  const { operatorId, ownerId, clubId } = useAuthStore();

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

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.greeting}>Selamat datang</Text>
          <Text style={styles.operatorName}>{operatorId ?? "Operator"}</Text>
          <Text style={styles.clubInfo}>
            {ownerId} / {clubId}
          </Text>
        </View>
        <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout}>
          <Text style={styles.logoutText}>Keluar</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.grid}>
        <QuickCard
          label="Kasir"
          description="Proses transaksi"
          color="#2563eb"
          onPress={() => router.push("/(app)/pos")}
        />
        <QuickCard
          label="Shift"
          description="Buka / tutup shift"
          color="#16a34a"
          onPress={() => router.push("/(app)/shift")}
        />
        <QuickCard
          label="Member"
          description="Kelola keanggotaan"
          color="#9333ea"
          onPress={() => router.push("/(app)/membership")}
        />
        <QuickCard
          label="Stok"
          description="Cek inventaris"
          color="#ea580c"
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
  onPress,
}: {
  label: string;
  description: string;
  color: string;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={[styles.card, { borderLeftColor: color }]}
      onPress={onPress}
      activeOpacity={0.8}
    >
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
    marginBottom: 24,
  },
  greeting: { fontSize: 14, color: "#64748b" },
  operatorName: { fontSize: 22, fontWeight: "700", color: "#1e293b" },
  clubInfo: { fontSize: 12, color: "#94a3b8", marginTop: 2 },
  logoutBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: "#fee2e2",
  },
  logoutText: { color: "#dc2626", fontWeight: "600", fontSize: 14 },
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
  },
  cardLabel: { fontSize: 18, fontWeight: "700", marginBottom: 4 },
  cardDesc: { fontSize: 13, color: "#64748b" },
});
