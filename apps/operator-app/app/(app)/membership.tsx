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
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { collection, getDocs, query, where, limit } from "firebase/firestore";
import { v4 as uuidv4 } from "uuid";
import { useAuthStore } from "@/store/auth.store";
import { callableFn, firebaseDb } from "@/firebase/firebase";
import { COLLECTIONS } from "@nc-manager/shared-constants";

interface Customer {
  id: string;
  displayName: string;
  phone: string | null;
  activeMembershipId: string | null;
}

interface Plan {
  id: string;
  name: string;
  tier: string;
  price: number;
  visitQuota: number;
  hasExpiry: boolean;
  durationDays: number | null;
  benefits: string[];
}

interface Membership {
  id: string;
  planName: string;
  planType?: "regular" | "locker";
  tier: string;
  status: string;
  visitRemaining: number;
  visitUsed: number;
  visitQuota: number;
  expiresAt: string | null;
  activatedAt: string;
  blendingCredits?: number;
  blendingFeePerSession?: number;
}

const TIER_COLOR: Record<string, { bg: string; text: string; border: string }> = {
  basic:    { bg: "#f8fafc", text: "#475569", border: "#cbd5e1" },
  silver:   { bg: "#f1f5f9", text: "#334155", border: "#94a3b8" },
  gold:     { bg: "#fffbeb", text: "#92400e", border: "#fcd34d" },
  platinum: { bg: "#eff6ff", text: "#1d4ed8", border: "#93c5fd" },
};

function fmt(n: number) {
  return n.toLocaleString("id-ID");
}

function daysLeft(expiresAt: string | null): number | null {
  if (!expiresAt) return null;
  const diff = new Date(expiresAt).getTime() - Date.now();
  return Math.max(0, Math.ceil(diff / 86_400_000));
}

export default function MembershipScreen() {
  const { ownerId, clubId, operatorId } = useAuthStore();

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loadingData, setLoadingData] = useState(true);

  // Customer search
  const [customerSearch, setCustomerSearch] = useState("");
  const [showDropdown, setShowDropdown] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);

  // Active membership for selected customer
  const [membership, setMembership] = useState<Membership | null | undefined>(undefined);
  const [loadingMembership, setLoadingMembership] = useState(false);

  // Plan selection
  const [selectedPlan, setSelectedPlan] = useState<Plan | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "transfer">("cash");

  // Loading states
  const [activating, setActivating] = useState(false);
  const [checkingIn, setCheckingIn] = useState(false);

  // Locker visit recording
  const [lockerGuestCount, setLockerGuestCount] = useState(1);
  const [lockerPayType, setLockerPayType] = useState<"credits" | "cash">("credits");
  const [recordingVisit, setRecordingVisit] = useState(false);

  const filteredCustomers =
    customerSearch.length >= 2
      ? customers.filter(
          (c) =>
            c.displayName.toLowerCase().includes(customerSearch.toLowerCase()) ||
            (c.phone ?? "").includes(customerSearch)
        )
      : [];

  useEffect(() => {
    if (!ownerId || !clubId) return;
    loadData();
  }, [ownerId, clubId]);

  useEffect(() => {
    if (!selectedCustomer || !ownerId || !clubId) {
      setMembership(undefined);
      return;
    }
    loadActiveMembership(selectedCustomer.id);
  }, [selectedCustomer?.id]);

  async function loadData() {
    setLoadingData(true);
    try {
      const db = firebaseDb();
      const base = `owners/${ownerId}/clubs/${clubId}`;
      const [custSnap, planSnap] = await Promise.all([
        getDocs(collection(db, `${base}/customers`)),
        getDocs(query(collection(db, `${base}/membershipPlans`), where("isActive", "==", true))),
      ]);
      setCustomers(custSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Customer, "id">) })));
      setPlans(planSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Plan, "id">) })));
    } catch {
      // Offline
    } finally {
      setLoadingData(false);
    }
  }

  async function loadActiveMembership(customerId: string) {
    if (!ownerId || !clubId) return;
    setLoadingMembership(true);
    setMembership(undefined);
    try {
      const snap = await getDocs(
        query(
          collection(firebaseDb(), COLLECTIONS.MEMBERSHIPS(ownerId, clubId)),
          where("customerId", "==", customerId),
          where("status", "==", "active"),
          limit(1)
        )
      );
      setMembership(
        snap.empty ? null : { id: snap.docs[0]!.id, ...(snap.docs[0]!.data() as Omit<Membership, "id">) }
      );
    } catch {
      setMembership(null);
    } finally {
      setLoadingMembership(false);
    }
  }

  function selectCustomer(c: Customer) {
    setSelectedCustomer(c);
    setCustomerSearch(c.displayName);
    setShowDropdown(false);
    setSelectedPlan(null);
  }

  function clearCustomer() {
    setSelectedCustomer(null);
    setCustomerSearch("");
    setMembership(undefined);
    setSelectedPlan(null);
  }

  async function handleCheckIn() {
    if (!selectedCustomer || !membership || !ownerId || !clubId || !operatorId) return;

    Alert.alert(
      "Konfirmasi Check-in",
      `${selectedCustomer.displayName} — sisa ${membership.visitRemaining} kunjungan`,
      [
        { text: "Batal", style: "cancel" },
        {
          text: "Check-in",
          onPress: async () => {
            setCheckingIn(true);
            try {
              const result = await callableFn("membership_deductVisit", {
                ownerId,
                clubId,
                operatorId,
                operationId: uuidv4(),
                requestId: uuidv4(),
                membershipId: membership.id,
                customerId: selectedCustomer.id,
                transactionId: uuidv4(),
              }) as { visitId: string; visitsRemaining: number };

              Alert.alert(
                "Check-in Berhasil ✓",
                `Sisa kunjungan: ${result.visitsRemaining}`
              );
              loadActiveMembership(selectedCustomer.id);
            } catch (err) {
              Alert.alert("Gagal", err instanceof Error ? err.message : "Terjadi kesalahan");
            } finally {
              setCheckingIn(false);
            }
          },
        },
      ]
    );
  }

  async function handleActivate() {
    if (!selectedCustomer || !selectedPlan || !ownerId || !clubId) return;

    const action = membership ? "Perpanjang" : "Aktifkan";
    Alert.alert(
      `${action} Membership`,
      `${selectedCustomer.displayName}\nPaket: ${selectedPlan.name}\nHarga: Rp ${fmt(selectedPlan.price)}`,
      [
        { text: "Batal", style: "cancel" },
        {
          text: action,
          onPress: async () => {
            setActivating(true);
            try {
              const result = await callableFn("membership_activate", {
                ownerId,
                clubId,
                operationId: uuidv4(),
                requestId: uuidv4(),
                customerId: selectedCustomer.id,
                planId: selectedPlan.id,
                transactionId: uuidv4(),
              }) as { membershipId: string; expiresAt: string | null };

              const expires = result.expiresAt ? result.expiresAt.slice(0, 10) : "Tidak ada expired";
              Alert.alert("Berhasil!", `Membership aktif${result.expiresAt ? ` s/d ${expires}` : ` — ${expires}`}`);
              loadActiveMembership(selectedCustomer.id);
              setSelectedPlan(null);
            } catch (err) {
              Alert.alert("Gagal", err instanceof Error ? err.message : "Terjadi kesalahan");
            } finally {
              setActivating(false);
            }
          },
        },
      ]
    );
  }

  async function handleLockerVisit() {
    if (!selectedCustomer || !membership || !ownerId || !clubId) return;

    const fee = membership.blendingFeePerSession ?? 0;
    const totalCharge = lockerPayType === "cash" ? lockerGuestCount * fee : 0;
    const creditsAfter = lockerPayType === "credits"
      ? (membership.blendingCredits ?? 0) - lockerGuestCount
      : membership.blendingCredits ?? 0;

    const confirmMsg = lockerPayType === "credits"
      ? `${lockerGuestCount} tamu — potong ${lockerGuestCount} kredit\nSisa: ${creditsAfter} kredit`
      : `${lockerGuestCount} tamu — bayar tunai Rp ${totalCharge.toLocaleString("id-ID")}`;

    Alert.alert("Konfirmasi Kunjungan Blender", confirmMsg, [
      { text: "Batal", style: "cancel" },
      {
        text: "Catat",
        onPress: async () => {
          setRecordingVisit(true);
          try {
            const result = await callableFn("locker_recordVisit", {
              ownerId, clubId,
              operationId: uuidv4(),
              requestId: uuidv4(),
              membershipId: membership.id,
              customerId: selectedCustomer.id,
              guestCount: lockerGuestCount,
              paymentType: lockerPayType,
            }) as { creditsAfter: number; guestCount: number };

            const msg = lockerPayType === "credits"
              ? `Kredit terpotong ${result.guestCount}. Sisa: ${result.creditsAfter} sesi`
              : `Kunjungan dicatat. Tagih Rp ${totalCharge.toLocaleString("id-ID")}`;
            Alert.alert("Berhasil ✓", msg);
            loadActiveMembership(selectedCustomer.id);
          } catch (err) {
            Alert.alert("Gagal", err instanceof Error ? err.message : "Terjadi kesalahan");
          } finally {
            setRecordingVisit(false);
          }
        },
      },
    ]);
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Keanggotaan</Text>
        {loadingData && <ActivityIndicator size="small" color="#94a3b8" />}
      </View>

      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">

        {/* ── Customer search ── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Cari Pelanggan</Text>
          {selectedCustomer ? (
            <View style={styles.selectedCustomer}>
              <View style={styles.customerAvatar}>
                <Text style={styles.customerAvatarText}>
                  {selectedCustomer.displayName.charAt(0).toUpperCase()}
                </Text>
              </View>
              <View style={styles.customerInfo}>
                <Text style={styles.customerName}>{selectedCustomer.displayName}</Text>
                {selectedCustomer.phone && (
                  <Text style={styles.customerPhone}>{selectedCustomer.phone}</Text>
                )}
              </View>
              <TouchableOpacity onPress={clearCustomer} style={styles.clearBtn}>
                <Text style={styles.clearBtnText}>Ganti</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View>
              <TextInput
                style={styles.input}
                placeholder="Ketik nama / no. HP (min 2 karakter)"
                value={customerSearch}
                onChangeText={(v) => { setCustomerSearch(v); setShowDropdown(true); }}
              />
              {showDropdown && filteredCustomers.length > 0 && (
                <View style={styles.dropdown}>
                  {filteredCustomers.slice(0, 6).map((c) => (
                    <TouchableOpacity
                      key={c.id}
                      style={styles.dropdownItem}
                      onPress={() => selectCustomer(c)}
                    >
                      <Text style={styles.dropdownName}>{c.displayName}</Text>
                      {c.phone && <Text style={styles.dropdownPhone}>{c.phone}</Text>}
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </View>
          )}
        </View>

        {/* ── Membership status ── */}
        {selectedCustomer && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Status Membership</Text>

            {loadingMembership || membership === undefined ? (
              <ActivityIndicator color="#94a3b8" style={{ paddingVertical: 12 }} />
            ) : membership === null ? (
              <View style={styles.noMembership}>
                <Text style={styles.noMembershipText}>Belum punya membership aktif</Text>
              </View>
            ) : membership.planType === "locker" ? (
              <View>
                {/* Locker card */}
                <View style={styles.lockerCard}>
                  <View style={styles.membershipCardHeader}>
                    <Text style={styles.lockerBadge}>LOKER</Text>
                    <Text style={styles.membershipPlanName}>{membership.planName}</Text>
                  </View>
                  <View style={styles.lockerCreditsRow}>
                    <Text style={styles.lockerCreditsLabel}>Kredit Sesi</Text>
                    <Text style={styles.lockerCreditsValue}>{membership.blendingCredits ?? 0}</Text>
                  </View>
                  <Text style={styles.lockerFeeText}>
                    Rp {(membership.blendingFeePerSession ?? 0).toLocaleString("id-ID")} / sesi
                    {membership.expiresAt ? `  ·  s/d ${membership.expiresAt.slice(0, 10)}` : ""}
                  </Text>
                </View>

                {/* Guest count + pay type */}
                <View style={styles.lockerControls}>
                  <Text style={styles.lockerControlLabel}>Jumlah Tamu</Text>
                  <View style={styles.guestCountRow}>
                    {[1, 2, 3, 4, 5].map((n) => (
                      <TouchableOpacity
                        key={n}
                        style={[styles.guestBtn, lockerGuestCount === n && styles.guestBtnActive]}
                        onPress={() => setLockerGuestCount(n)}
                      >
                        <Text style={[styles.guestBtnText, lockerGuestCount === n && styles.guestBtnTextActive]}>
                          {n}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  <View style={styles.paymentRow}>
                    {(["credits", "cash"] as const).map((pt) => (
                      <TouchableOpacity
                        key={pt}
                        style={[styles.payBtn, lockerPayType === pt && styles.payBtnActive]}
                        onPress={() => setLockerPayType(pt)}
                      >
                        <Text style={[styles.payBtnText, lockerPayType === pt && styles.payBtnTextActive]}>
                          {pt === "credits" ? "Kredit" : "Tunai"}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>

                <TouchableOpacity
                  style={[
                    styles.checkInBtn,
                    { backgroundColor: "#9333ea" },
                    (recordingVisit || (lockerPayType === "credits" && (membership.blendingCredits ?? 0) < lockerGuestCount)) && styles.disabledBtn,
                  ]}
                  onPress={handleLockerVisit}
                  disabled={recordingVisit || (lockerPayType === "credits" && (membership.blendingCredits ?? 0) < lockerGuestCount)}
                >
                  {recordingVisit ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.checkInBtnText}>
                      {lockerPayType === "credits" && (membership.blendingCredits ?? 0) < lockerGuestCount
                        ? "Kredit Tidak Cukup"
                        : `Catat ${lockerGuestCount} Tamu — ${lockerPayType === "credits" ? `${lockerGuestCount} Kredit` : `Rp ${(lockerGuestCount * (membership.blendingFeePerSession ?? 0)).toLocaleString("id-ID")}`}`}
                    </Text>
                  )}
                </TouchableOpacity>
              </View>
            ) : (
              <View>
                {/* Regular membership card */}
                <View style={[
                  styles.membershipCard,
                  { borderColor: TIER_COLOR[membership.tier]?.border ?? "#e2e8f0" },
                  { backgroundColor: TIER_COLOR[membership.tier]?.bg ?? "#f8fafc" },
                ]}>
                  <View style={styles.membershipCardHeader}>
                    <Text style={[styles.tierBadge, { color: TIER_COLOR[membership.tier]?.text ?? "#475569" }]}>
                      ★ {membership.tier.toUpperCase()}
                    </Text>
                    <Text style={styles.membershipPlanName}>{membership.planName}</Text>
                  </View>
                  <View style={styles.visitBarWrap}>
                    <View style={styles.visitBarBg}>
                      <View
                        style={[
                          styles.visitBarFill,
                          { width: `${Math.min(((membership.visitRemaining ?? 0) / (membership.visitQuota || 1)) * 100, 100)}%` },
                        ]}
                      />
                    </View>
                    <Text style={styles.visitText}>
                      {membership.visitRemaining} / {membership.visitQuota} kunjungan tersisa
                    </Text>
                  </View>
                  <View style={styles.membershipMeta}>
                    {membership.expiresAt ? (
                      <>
                        <Text style={styles.metaText}>Berlaku s/d {membership.expiresAt.slice(0, 10)}</Text>
                        <Text style={[styles.daysLeft, (daysLeft(membership.expiresAt) ?? 99) <= 7 && styles.daysLeftWarning]}>
                          {daysLeft(membership.expiresAt)} hari lagi
                        </Text>
                      </>
                    ) : (
                      <Text style={styles.noExpiry}>∞ Tidak ada expired</Text>
                    )}
                  </View>
                </View>
                <TouchableOpacity
                  style={[styles.checkInBtn, ((membership.visitRemaining ?? 0) <= 0 || checkingIn) && styles.disabledBtn]}
                  onPress={handleCheckIn}
                  disabled={(membership.visitRemaining ?? 0) <= 0 || checkingIn}
                >
                  {checkingIn ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.checkInBtnText}>
                      {(membership.visitRemaining ?? 0) <= 0 ? "Kuota Habis" : "✓ Check-in Kunjungan"}
                    </Text>
                  )}
                </TouchableOpacity>
              </View>
            )}
          </View>
        )}

        {/* ── Plan selection ── */}
        {selectedCustomer && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>
              {membership ? "Perpanjang / Ganti Paket" : "Pilih Paket Membership"}
            </Text>

            {plans.length === 0 ? (
              <Text style={styles.emptyText}>Belum ada paket tersedia.</Text>
            ) : (
              <View style={styles.planGrid}>
                {plans.map((plan) => {
                  const tc = TIER_COLOR[plan.tier] ?? TIER_COLOR.basic!;
                  const isSelected = selectedPlan?.id === plan.id;
                  return (
                    <TouchableOpacity
                      key={plan.id}
                      style={[
                        styles.planCard,
                        { borderColor: isSelected ? "#2563eb" : tc.border },
                        { backgroundColor: isSelected ? "#eff6ff" : tc.bg },
                      ]}
                      onPress={() => setSelectedPlan(isSelected ? null : plan)}
                    >
                      <Text style={[styles.planTier, { color: tc.text }]}>
                        {plan.tier.toUpperCase()}
                      </Text>
                      <Text style={styles.planName} numberOfLines={2}>{plan.name}</Text>
                      <Text style={styles.planPrice}>Rp {fmt(plan.price)}</Text>
                      <Text style={styles.planMeta}>
                        {plan.visitQuota}x
                        {plan.hasExpiry && plan.durationDays ? ` · ${plan.durationDays} hari` : " · ∞"}
                      </Text>
                      {isSelected && (
                        <View style={styles.selectedMark}>
                          <Text style={styles.selectedMarkText}>✓</Text>
                        </View>
                      )}
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}

            {selectedPlan && (
              <View style={styles.activatePanel}>
                <Text style={styles.activatePlanLabel}>
                  {selectedPlan.name} — Rp {fmt(selectedPlan.price)}
                </Text>

                <View style={styles.paymentRow}>
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

                <TouchableOpacity
                  style={[styles.activateBtn, activating && styles.disabledBtn]}
                  onPress={handleActivate}
                  disabled={activating}
                >
                  {activating ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.activateBtnText}>
                      {membership ? "Perpanjang Membership" : "Aktifkan Membership"}
                    </Text>
                  )}
                </TouchableOpacity>
              </View>
            )}
          </View>
        )}

        <View style={{ height: 24 }} />
      </ScrollView>
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

  section: {
    backgroundColor: "#fff", borderRadius: 12, padding: 16, gap: 10,
    shadowColor: "#000", shadowOpacity: 0.05, shadowRadius: 4, elevation: 2,
  },
  sectionTitle: {
    fontSize: 13, fontWeight: "600", color: "#64748b",
    textTransform: "uppercase", letterSpacing: 0.5,
  },

  // Customer search
  input: {
    borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 10, fontSize: 15,
    color: "#1e293b", backgroundColor: "#f8fafc",
  },
  dropdown: {
    backgroundColor: "#fff", borderWidth: 1, borderColor: "#e2e8f0",
    borderRadius: 8, marginTop: 4, overflow: "hidden",
  },
  dropdownItem: {
    paddingHorizontal: 12, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: "#f1f5f9",
  },
  dropdownName: { fontSize: 14, color: "#1e293b", fontWeight: "500" },
  dropdownPhone: { fontSize: 12, color: "#94a3b8", marginTop: 1 },

  selectedCustomer: {
    flexDirection: "row", alignItems: "center", gap: 12,
    backgroundColor: "#f0fdf4", borderRadius: 10, padding: 12,
  },
  customerAvatar: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: "#16a34a", alignItems: "center", justifyContent: "center",
  },
  customerAvatarText: { color: "#fff", fontWeight: "700", fontSize: 16 },
  customerInfo: { flex: 1 },
  customerName: { fontSize: 15, fontWeight: "600", color: "#166534" },
  customerPhone: { fontSize: 12, color: "#4ade80", marginTop: 1 },
  clearBtn: { paddingHorizontal: 10, paddingVertical: 6 },
  clearBtnText: { fontSize: 13, color: "#2563eb", fontWeight: "600" },

  // Membership card
  noMembership: {
    backgroundColor: "#f8fafc", borderRadius: 8, padding: 16, alignItems: "center",
  },
  noMembershipText: { color: "#94a3b8", fontSize: 14 },

  membershipCard: {
    borderWidth: 1.5, borderRadius: 12, padding: 14, gap: 10, marginBottom: 10,
  },
  membershipCardHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  tierBadge: { fontSize: 12, fontWeight: "700", letterSpacing: 0.5 },
  membershipPlanName: { fontSize: 15, fontWeight: "700", color: "#1e293b" },

  visitBarWrap: { gap: 4 },
  visitBarBg: { height: 8, backgroundColor: "#e2e8f0", borderRadius: 4, overflow: "hidden" },
  visitBarFill: { height: "100%", backgroundColor: "#16a34a", borderRadius: 4 },
  visitText: { fontSize: 12, color: "#475569" },

  membershipMeta: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  metaText: { fontSize: 12, color: "#64748b" },
  daysLeft: { fontSize: 12, fontWeight: "600", color: "#16a34a" },
  daysLeftWarning: { color: "#dc2626" },
  noExpiry: { fontSize: 12, fontWeight: "600", color: "#16a34a" },

  checkInBtn: {
    backgroundColor: "#16a34a", borderRadius: 10, paddingVertical: 14, alignItems: "center",
  },
  checkInBtnText: { color: "#fff", fontSize: 15, fontWeight: "700" },

  // Plan grid
  emptyText: { color: "#94a3b8", fontSize: 14, textAlign: "center", paddingVertical: 8 },
  planGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  planCard: {
    width: "47%", borderWidth: 1.5, borderRadius: 10, padding: 12, gap: 4, position: "relative",
  },
  planTier: { fontSize: 10, fontWeight: "700", letterSpacing: 0.5 },
  planName: { fontSize: 13, fontWeight: "700", color: "#1e293b" },
  planPrice: { fontSize: 14, fontWeight: "700", color: "#2563eb" },
  planMeta: { fontSize: 11, color: "#94a3b8" },
  selectedMark: {
    position: "absolute", top: 6, right: 8,
    width: 20, height: 20, borderRadius: 10,
    backgroundColor: "#2563eb", alignItems: "center", justifyContent: "center",
  },
  selectedMarkText: { color: "#fff", fontSize: 11, fontWeight: "700" },

  // Activate panel
  activatePanel: {
    backgroundColor: "#f8fafc", borderRadius: 10, padding: 14, gap: 10,
    borderWidth: 1, borderColor: "#e2e8f0",
  },
  activatePlanLabel: { fontSize: 14, fontWeight: "600", color: "#1e293b" },
  paymentRow: { flexDirection: "row", gap: 8 },
  payBtn: {
    flex: 1, paddingVertical: 10, borderRadius: 8,
    borderWidth: 1, borderColor: "#e2e8f0", alignItems: "center",
  },
  payBtnActive: { borderColor: "#9333ea", backgroundColor: "#faf5ff" },
  payBtnText: { fontSize: 14, color: "#64748b" },
  payBtnTextActive: { color: "#9333ea", fontWeight: "700" },

  activateBtn: {
    backgroundColor: "#9333ea", borderRadius: 10, paddingVertical: 14, alignItems: "center",
  },
  activateBtnText: { color: "#fff", fontSize: 15, fontWeight: "700" },

  disabledBtn: { opacity: 0.5 },
});
