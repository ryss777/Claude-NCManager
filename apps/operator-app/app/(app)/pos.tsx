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
import { collection, getDocs, query, where, onSnapshot, limit } from "firebase/firestore";
import { v4 as uuidv4 } from "uuid";
import { useAuthStore } from "@/store/auth.store";
import { callableFn, firebaseDb } from "@/firebase/firebase";
import { COLLECTIONS } from "@nc-manager/shared-constants";

type PaymentMethod = "cash" | "transfer" | "member_balance";

interface CartItem {
  productId: string;
  productName: string;
  qty: number;
  unitPrice: number;
}

type CustomerTier = "retail" | "ds" | "sc" | "sbQp" | "spv";
interface PriceTiers { retail: number; ds: number; sc: number; sbQp: number; spv: number; }

interface Product {
  id: string;
  name: string;
  category: string | null;
  prices: PriceTiers;
}

interface Customer {
  id: string;
  displayName: string;
  phone: string | null;
  tier: CustomerTier;
}

interface ActiveShift {
  id: string;
  openingCash: number;
  totalTransactions: number;
  totalRevenue: number;
}

export default function PosScreen() {
  const { ownerId, clubId, operatorId } = useAuthStore();

  // Active shift (undefined = loading, null = no open shift)
  const [activeShift, setActiveShift] = useState<ActiveShift | null | undefined>(undefined);

  // Data from Firestore
  const [products, setProducts] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // Cart
  const [cart, setCart] = useState<CartItem[]>([]);

  // Customer search
  const [customerSearch, setCustomerSearch] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [showCustomerList, setShowCustomerList] = useState(false);

  // Payment
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [amountPaid, setAmountPaid] = useState("");

  const total = cart.reduce((sum, i) => sum + i.qty * i.unitPrice, 0);
  const paid = parseFloat(amountPaid) || 0;
  const change = paid - total;

  const filteredCustomers = customerSearch.length >= 2
    ? customers.filter((c) =>
        c.displayName.toLowerCase().includes(customerSearch.toLowerCase()) ||
        (c.phone ?? "").includes(customerSearch)
      )
    : [];

  // Listen for active shift in real-time
  useEffect(() => {
    if (!ownerId || !clubId || !operatorId) return;
    const q = query(
      collection(firebaseDb(), COLLECTIONS.SHIFTS(ownerId, clubId)),
      where("operatorId", "==", operatorId),
      where("status", "==", "open"),
      limit(1)
    );
    return onSnapshot(
      q,
      (snap) => {
        if (snap.empty) {
          setActiveShift(null);
        } else {
          const d = snap.docs[0]!;
          setActiveShift({ id: d.id, ...(d.data() as Omit<ActiveShift, "id">) });
        }
      },
      () => setActiveShift(null)
    );
  }, [ownerId, clubId, operatorId]);

  useEffect(() => {
    if (!ownerId || !clubId) return;
    loadData();
  }, [ownerId, clubId]);

  async function loadData() {
    setLoadingData(true);
    try {
      const db = firebaseDb();
      const base = `owners/${ownerId}/clubs/${clubId}`;
      const [itemsSnap, custSnap] = await Promise.all([
        getDocs(query(collection(db, `${base}/inventoryItems`), where("isActive", "==", true))),
        getDocs(collection(db, `${base}/customers`)),
      ]);
      setProducts(itemsSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Product)));
      setCustomers(custSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Customer)));
    } catch {
      // Offline — use empty lists
    } finally {
      setLoadingData(false);
    }
  }

  const activeTier: CustomerTier = selectedCustomer?.tier ?? "retail";

  function tierPrice(p: Product): number {
    if (!p.prices) return 0;
    return p.prices[activeTier] ?? p.prices.retail ?? 0;
  }

  function addProduct(p: Product) {
    const unitPrice = tierPrice(p);
    setCart((c) => {
      const idx = c.findIndex((i) => i.productId === p.id);
      if (idx >= 0) {
        return c.map((item, i) => i === idx ? { ...item, qty: item.qty + 1 } : item);
      }
      return [...c, { productId: p.id, productName: p.name, qty: 1, unitPrice }];
    });
  }

  function updateQty(productId: string, delta: number) {
    setCart((c) =>
      c
        .map((i) => i.productId === productId ? { ...i, qty: i.qty + delta } : i)
        .filter((i) => i.qty > 0)
    );
  }

  function updatePrice(productId: string, price: string) {
    const n = parseFloat(price);
    if (!isNaN(n) && n >= 0) {
      setCart((c) => c.map((i) => i.productId === productId ? { ...i, unitPrice: n } : i));
    }
  }

  function selectCustomer(c: Customer) {
    setSelectedCustomer(c);
    setCustomerSearch(c.displayName);
    setShowCustomerList(false);
  }

  function clearCustomer() {
    setSelectedCustomer(null);
    setCustomerSearch("");
  }

  async function submitTransaction() {
    if (!activeShift) {
      Alert.alert("Shift Belum Dibuka", "Buka shift di tab Shift terlebih dahulu sebelum bertransaksi.");
      return;
    }
    if (cart.length === 0) {
      Alert.alert("Error", "Keranjang kosong");
      return;
    }
    if (paymentMethod === "cash" && paid < total) {
      Alert.alert("Error", "Jumlah bayar kurang dari total");
      return;
    }
    if (!ownerId || !clubId || !operatorId) return;

    setSubmitting(true);
    try {
      const operationId = uuidv4();
      const requestId = uuidv4();

      // 1. Create transaction record with shiftId
      const { transactionId } = await callableFn("pos_createTransaction", {
        ownerId,
        clubId,
        requestId,
        operationId,
        shiftId: activeShift.id,
        paymentMethod,
        amountPaid: paymentMethod === "cash" ? paid : total,
        customerId: selectedCustomer?.id,
        discount: 0,
        items: cart.map((i) => ({
          productId: i.productId,
          productName: i.productName,
          modifierIds: [],
          modifierNames: [],
          quantity: i.qty,
          unitPrice: i.unitPrice,
          subtotal: i.qty * i.unitPrice,
        })),
      }) as { transactionId: string };

      // 2. Complete transaction — writes journal & updates shift totals
      await callableFn("pos_completeTransaction", { transactionId, operatorId });

      Alert.alert(
        "Transaksi Berhasil ✓",
        paymentMethod === "cash"
          ? `Total: Rp ${fmt(total)}\nBayar: Rp ${fmt(paid)}\nKembalian: Rp ${fmt(change)}`
          : `Total: Rp ${fmt(total)}`,
        [{ text: "OK", onPress: resetForm }]
      );
    } catch (err) {
      Alert.alert("Transaksi Gagal", err instanceof Error ? err.message : "Terjadi kesalahan");
    } finally {
      setSubmitting(false);
    }
  }

  function resetForm() {
    setCart([]);
    setSelectedCustomer(null);
    setCustomerSearch("");
    setAmountPaid("");
    setPaymentMethod("cash");
  }

  const fmt = (n: number | undefined | null) => (n ?? 0).toLocaleString("id-ID");

  const paymentOptions: { key: PaymentMethod; label: string }[] = [
    { key: "cash", label: "Tunai" },
    { key: "transfer", label: "Transfer" },
    { key: "member_balance", label: "Saldo" },
  ];

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Kasir</Text>
        <View style={styles.headerRight}>
          {activeShift ? (
            <View style={styles.shiftActive}>
              <Text style={styles.shiftActiveText}>● Shift #{activeShift.id.slice(0, 6)}</Text>
            </View>
          ) : activeShift === null ? (
            <View style={styles.shiftClosed}>
              <Text style={styles.shiftClosedText}>Shift Belum Dibuka</Text>
            </View>
          ) : null}
          {loadingData && <ActivityIndicator size="small" color="#94a3b8" />}
        </View>
      </View>

      {/* No-shift warning banner */}
      {activeShift === null && (
        <View style={styles.noShiftBanner}>
          <Text style={styles.noShiftText}>
            ⚠ Buka shift di tab Shift sebelum bertransaksi
          </Text>
        </View>
      )}

      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">

        {/* Product grid */}
        {products.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Produk</Text>
            <View style={styles.productGrid}>
              {products.map((p) => (
                <TouchableOpacity key={p.id} style={styles.productCard} onPress={() => addProduct(p)}>
                  <Text style={styles.productName} numberOfLines={2}>{p.name}</Text>
                  <Text style={styles.productPrice}>Rp {fmt(tierPrice(p))}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

        {/* Cart */}
        {cart.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Keranjang</Text>
            {cart.map((item) => (
              <View key={item.productId} style={styles.cartRow}>
                <View style={styles.cartInfo}>
                  <Text style={styles.cartName}>{item.productName}</Text>
                  <View style={styles.cartPriceRow}>
                    <Text style={styles.cartMeta}>Harga: Rp </Text>
                    <TextInput
                      style={styles.priceInput}
                      value={item.unitPrice.toString()}
                      onChangeText={(v) => updatePrice(item.productId, v)}
                      keyboardType="numeric"
                    />
                  </View>
                </View>
                <View style={styles.qtyControl}>
                  <TouchableOpacity style={styles.qtyBtn} onPress={() => updateQty(item.productId, -1)}>
                    <Text style={styles.qtyBtnText}>−</Text>
                  </TouchableOpacity>
                  <Text style={styles.qtyText}>{item.qty}</Text>
                  <TouchableOpacity style={styles.qtyBtn} onPress={() => updateQty(item.productId, 1)}>
                    <Text style={styles.qtyBtnText}>+</Text>
                  </TouchableOpacity>
                </View>
                <Text style={styles.cartTotal}>Rp {fmt(item.qty * item.unitPrice)}</Text>
              </View>
            ))}
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Total</Text>
              <Text style={styles.totalAmount}>Rp {fmt(total)}</Text>
            </View>
          </View>
        )}

        {/* Customer */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Customer (opsional)</Text>
          {selectedCustomer ? (
            <View style={styles.selectedCustomer}>
              <View>
                <Text style={styles.customerName}>{selectedCustomer.displayName}</Text>
                {selectedCustomer.phone && (
                  <Text style={styles.customerPhone}>{selectedCustomer.phone}</Text>
                )}
              </View>
              <TouchableOpacity onPress={clearCustomer}>
                <Text style={styles.clearBtn}>Ganti</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View>
              <TextInput
                style={styles.input}
                placeholder="Cari nama / no. HP (min 2 karakter)"
                value={customerSearch}
                onChangeText={(v) => { setCustomerSearch(v); setShowCustomerList(true); }}
              />
              {showCustomerList && filteredCustomers.length > 0 && (
                <View style={styles.dropdown}>
                  {filteredCustomers.slice(0, 5).map((c) => (
                    <TouchableOpacity key={c.id} style={styles.dropdownItem} onPress={() => selectCustomer(c)}>
                      <Text style={styles.dropdownName}>{c.displayName}</Text>
                      {c.phone && <Text style={styles.dropdownPhone}>{c.phone}</Text>}
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </View>
          )}
        </View>

        {/* Payment */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Pembayaran</Text>
          <View style={styles.paymentRow}>
            {paymentOptions.map((opt) => (
              <TouchableOpacity
                key={opt.key}
                style={[styles.paymentBtn, paymentMethod === opt.key && styles.paymentBtnActive]}
                onPress={() => setPaymentMethod(opt.key)}
              >
                <Text style={[styles.paymentBtnText, paymentMethod === opt.key && styles.paymentBtnTextActive]}>
                  {opt.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {paymentMethod === "cash" && (
            <View style={styles.cashSection}>
              <TextInput
                style={styles.input}
                placeholder="Jumlah Bayar"
                value={amountPaid}
                onChangeText={setAmountPaid}
                keyboardType="numeric"
              />
              {paid > 0 && (
                <View style={[styles.changeRow, change < 0 && styles.changeRowInsufficient]}>
                  <Text style={styles.changeLabel}>
                    {change >= 0 ? "Kembalian" : "Kurang"}
                  </Text>
                  <Text style={[styles.changeAmount, change < 0 && styles.changeInsufficient]}>
                    Rp {fmt(Math.abs(change))}
                  </Text>
                </View>
              )}
            </View>
          )}
        </View>

        <TouchableOpacity
          style={[
            styles.submitBtn,
            (!activeShift || cart.length === 0 || submitting || (paymentMethod === "cash" && paid < total && paid > 0)) && styles.submitBtnDisabled,
          ]}
          onPress={submitTransaction}
          disabled={!activeShift || cart.length === 0 || submitting}
        >
          {submitting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.submitBtnText}>Bayar Rp {fmt(total)}</Text>
          )}
        </TouchableOpacity>

        <View style={{ height: 24 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f8fafc" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 },
  headerRight: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { fontSize: 22, fontWeight: "700", color: "#1e293b" },
  shiftActive: { backgroundColor: "#dcfce7", paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  shiftActiveText: { color: "#16a34a", fontWeight: "700", fontSize: 12 },
  shiftClosed: { backgroundColor: "#fef3c7", paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  shiftClosedText: { color: "#d97706", fontWeight: "600", fontSize: 12 },
  noShiftBanner: { backgroundColor: "#fef9c3", borderBottomWidth: 1, borderBottomColor: "#fde68a", paddingHorizontal: 16, paddingVertical: 10 },
  noShiftText: { color: "#92400e", fontSize: 13, fontWeight: "500" },
  scroll: { padding: 16, paddingTop: 8, gap: 12 },
  section: { backgroundColor: "#fff", borderRadius: 12, padding: 14, gap: 10, elevation: 2, shadowColor: "#000", shadowOpacity: 0.05, shadowRadius: 4 },
  sectionTitle: { fontSize: 13, fontWeight: "600", color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5 },
  productGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  productCard: { width: "30%", backgroundColor: "#f8fafc", borderRadius: 10, padding: 10, borderWidth: 1, borderColor: "#e2e8f0", alignItems: "center" },
  productName: { fontSize: 12, fontWeight: "600", color: "#1e293b", textAlign: "center", marginBottom: 4 },
  productPrice: { fontSize: 11, color: "#2563eb", fontWeight: "700" },
  cartRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 4 },
  cartInfo: { flex: 1 },
  cartName: { fontSize: 14, fontWeight: "600", color: "#1e293b" },
  cartPriceRow: { flexDirection: "row", alignItems: "center", marginTop: 2 },
  cartMeta: { fontSize: 12, color: "#64748b" },
  priceInput: { fontSize: 12, color: "#1e293b", borderBottomWidth: 1, borderBottomColor: "#e2e8f0", paddingVertical: 0, minWidth: 60 },
  qtyControl: { flexDirection: "row", alignItems: "center", gap: 8 },
  qtyBtn: { width: 28, height: 28, borderRadius: 14, backgroundColor: "#f1f5f9", alignItems: "center", justifyContent: "center" },
  qtyBtnText: { fontSize: 18, color: "#475569", lineHeight: 22 },
  qtyText: { fontSize: 15, fontWeight: "700", color: "#1e293b", minWidth: 20, textAlign: "center" },
  cartTotal: { fontSize: 13, fontWeight: "700", color: "#1e293b", minWidth: 70, textAlign: "right" },
  totalRow: { flexDirection: "row", justifyContent: "space-between", paddingTop: 8, borderTopWidth: 1, borderTopColor: "#e2e8f0" },
  totalLabel: { fontSize: 16, fontWeight: "700", color: "#374151" },
  totalAmount: { fontSize: 16, fontWeight: "700", color: "#2563eb" },
  input: { borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, color: "#1e293b", backgroundColor: "#f8fafc" },
  selectedCustomer: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", backgroundColor: "#f0fdf4", borderRadius: 8, padding: 12 },
  customerName: { fontSize: 14, fontWeight: "600", color: "#166534" },
  customerPhone: { fontSize: 12, color: "#4ade80" },
  clearBtn: { fontSize: 13, color: "#2563eb", fontWeight: "600" },
  dropdown: { backgroundColor: "#fff", borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 8, marginTop: 4, overflow: "hidden" },
  dropdownItem: { paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "#f1f5f9" },
  dropdownName: { fontSize: 14, color: "#1e293b", fontWeight: "500" },
  dropdownPhone: { fontSize: 12, color: "#94a3b8", marginTop: 1 },
  paymentRow: { flexDirection: "row", gap: 8 },
  paymentBtn: { flex: 1, paddingVertical: 10, borderRadius: 8, borderWidth: 1, borderColor: "#e2e8f0", alignItems: "center" },
  paymentBtnActive: { borderColor: "#2563eb", backgroundColor: "#eff6ff" },
  paymentBtnText: { fontSize: 14, color: "#64748b", fontWeight: "500" },
  paymentBtnTextActive: { color: "#2563eb", fontWeight: "700" },
  cashSection: { gap: 8 },
  changeRow: { flexDirection: "row", justifyContent: "space-between", backgroundColor: "#f0fdf4", borderRadius: 8, padding: 12 },
  changeRowInsufficient: { backgroundColor: "#fff1f2" },
  changeLabel: { fontSize: 14, fontWeight: "600", color: "#166534" },
  changeAmount: { fontSize: 16, fontWeight: "700", color: "#16a34a" },
  changeInsufficient: { color: "#dc2626" },
  submitBtn: { backgroundColor: "#2563eb", borderRadius: 12, paddingVertical: 18, alignItems: "center" },
  submitBtnDisabled: { opacity: 0.4 },
  submitBtnText: { color: "#fff", fontSize: 18, fontWeight: "700" },
});
