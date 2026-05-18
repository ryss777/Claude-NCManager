import { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { v4 as uuidv4 } from "uuid";
import { useAuthStore } from "@/store/auth.store";
import { useEnqueue } from "@/hooks/useEnqueue";

export default function MembershipScreen() {
  const { ownerId, clubId, operatorId } = useAuthStore();
  const enqueue = useEnqueue();

  // Activate membership
  const [customerId, setCustomerId] = useState("");
  const [planId, setPlanId] = useState("");
  const [planName, setPlanName] = useState("");
  const [visitQuota, setVisitQuota] = useState("");
  const [durationDays, setDurationDays] = useState("");
  const [price, setPrice] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "transfer">("cash");

  // Deduct visit
  const [visitMembershipId, setVisitMembershipId] = useState("");
  const [visitCustomerId, setVisitCustomerId] = useState("");

  function handleActivate() {
    if (!customerId || !planId || !planName || !visitQuota || !durationDays || !price) {
      Alert.alert("Error", "Semua field wajib diisi");
      return;
    }
    if (!ownerId || !clubId || !operatorId) return;

    const membershipId = uuidv4();
    const operationId = uuidv4();
    const requestId = uuidv4();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + parseInt(durationDays, 10) * 86400000).toISOString();

    enqueue({
      operationId,
      requestId,
      functionName: "membership_activate",
      payload: {
        ownerId,
        clubId,
        operatorId,
        requestId,
        operationId,
        membershipId,
        customerId,
        planId,
        planName,
        visitQuota: parseInt(visitQuota, 10),
        durationDays: parseInt(durationDays, 10),
        price: parseFloat(price),
        paymentMethod,
        startDate: now.toISOString(),
        expiresAt,
      },
    });

    Alert.alert("Berhasil", `Membership ${membershipId.slice(0, 8)}… dijadwalkan`);
    setCustomerId("");
    setPlanId("");
    setPlanName("");
    setVisitQuota("");
    setDurationDays("");
    setPrice("");
  }

  function handleDeductVisit() {
    if (!visitMembershipId || !visitCustomerId) {
      Alert.alert("Error", "Masukkan ID membership dan ID customer");
      return;
    }
    if (!ownerId || !clubId || !operatorId) return;

    const operationId = uuidv4();
    const requestId = uuidv4();

    enqueue({
      operationId,
      requestId,
      functionName: "membership_deductVisit",
      payload: {
        ownerId,
        clubId,
        operatorId,
        requestId,
        operationId,
        membershipId: visitMembershipId,
        customerId: visitCustomerId,
      },
    });

    Alert.alert("Check-in", "Kunjungan dicatat dan dijadwalkan ke server");
    setVisitMembershipId("");
    setVisitCustomerId("");
  }

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>Keanggotaan</Text>

      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Activate */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Aktifkan Membership</Text>
          <TextInput style={styles.input} placeholder="ID Customer" value={customerId} onChangeText={setCustomerId} autoCapitalize="none" />
          <TextInput style={styles.input} placeholder="ID Paket" value={planId} onChangeText={setPlanId} autoCapitalize="none" />
          <TextInput style={styles.input} placeholder="Nama Paket" value={planName} onChangeText={setPlanName} />
          <View style={styles.row}>
            <TextInput style={[styles.input, styles.flex1]} placeholder="Kuota Kunjungan" value={visitQuota} onChangeText={setVisitQuota} keyboardType="numeric" />
            <TextInput style={[styles.input, styles.flex1]} placeholder="Durasi (hari)" value={durationDays} onChangeText={setDurationDays} keyboardType="numeric" />
          </View>
          <TextInput style={styles.input} placeholder="Harga" value={price} onChangeText={setPrice} keyboardType="numeric" />
          <View style={styles.row}>
            {(["cash", "transfer"] as const).map((m) => (
              <TouchableOpacity
                key={m}
                style={[styles.payBtn, paymentMethod === m && styles.payBtnActive]}
                onPress={() => setPaymentMethod(m)}
              >
                <Text style={[styles.payBtnText, paymentMethod === m && styles.payBtnTextActive]}>
                  {m === "cash" ? "Tunai" : "Transfer"}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <TouchableOpacity style={styles.primaryBtn} onPress={handleActivate}>
            <Text style={styles.primaryBtnText}>Aktifkan</Text>
          </TouchableOpacity>
        </View>

        {/* Check-in */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Check-in Kunjungan</Text>
          <TextInput style={styles.input} placeholder="ID Membership" value={visitMembershipId} onChangeText={setVisitMembershipId} autoCapitalize="none" />
          <TextInput style={styles.input} placeholder="ID Customer" value={visitCustomerId} onChangeText={setVisitCustomerId} autoCapitalize="none" />
          <TouchableOpacity style={styles.secondaryBtn} onPress={handleDeductVisit}>
            <Text style={styles.secondaryBtnText}>Catat Kunjungan</Text>
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
    gap: 10,
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  sectionTitle: { fontSize: 16, fontWeight: "600", color: "#374151", marginBottom: 4 },
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
  row: { flexDirection: "row", gap: 8 },
  flex1: { flex: 1 },
  payBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    alignItems: "center",
  },
  payBtnActive: { borderColor: "#9333ea", backgroundColor: "#faf5ff" },
  payBtnText: { fontSize: 14, color: "#64748b" },
  payBtnTextActive: { color: "#9333ea", fontWeight: "700" },
  primaryBtn: {
    backgroundColor: "#9333ea",
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
  },
  primaryBtnText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  secondaryBtn: {
    backgroundColor: "#6366f1",
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
  },
  secondaryBtnText: { color: "#fff", fontSize: 16, fontWeight: "700" },
});
