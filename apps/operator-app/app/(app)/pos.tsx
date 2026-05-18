import { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  Alert,
  ScrollView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { v4 as uuidv4 } from "uuid";
import { useAuthStore } from "@/store/auth.store";
import { useEnqueue } from "@/hooks/useEnqueue";

type PaymentMethod = "cash" | "transfer" | "member_balance";

interface CartItem {
  productId: string;
  productName: string;
  qty: number;
  unitPrice: number;
}

export default function PosScreen() {
  const { ownerId, clubId, operatorId } = useAuthStore();
  const enqueue = useEnqueue();

  const [customerId, setCustomerId] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [cart, setCart] = useState<CartItem[]>([]);

  // Quick-add form
  const [productId, setProductId] = useState("");
  const [productName, setProductName] = useState("");
  const [qty, setQty] = useState("1");
  const [unitPrice, setUnitPrice] = useState("");

  const total = cart.reduce((sum, item) => sum + item.qty * item.unitPrice, 0);

  function addToCart() {
    if (!productId || !productName || !unitPrice) {
      Alert.alert("Error", "Isi ID produk, nama, dan harga");
      return;
    }
    const price = parseFloat(unitPrice);
    const quantity = parseInt(qty, 10);
    if (isNaN(price) || isNaN(quantity) || quantity < 1) {
      Alert.alert("Error", "Harga dan jumlah tidak valid");
      return;
    }

    setCart((c) => {
      const existing = c.findIndex((i) => i.productId === productId);
      if (existing >= 0) {
        return c.map((item, i) =>
          i === existing ? { ...item, qty: item.qty + quantity } : item
        );
      }
      return [...c, { productId, productName, qty: quantity, unitPrice: price }];
    });

    setProductId("");
    setProductName("");
    setQty("1");
    setUnitPrice("");
  }

  function removeFromCart(productId: string) {
    setCart((c) => c.filter((i) => i.productId !== productId));
  }

  async function submitTransaction() {
    if (cart.length === 0) {
      Alert.alert("Error", "Keranjang kosong");
      return;
    }
    if (!ownerId || !clubId || !operatorId) {
      Alert.alert("Error", "Sesi tidak valid, silakan login ulang");
      return;
    }

    const transactionId = uuidv4();
    const operationId = uuidv4();
    const requestId = uuidv4();

    enqueue({
      operationId,
      requestId,
      functionName: "pos_completeTransaction",
      payload: {
        ownerId,
        clubId,
        operatorId,
        requestId,
        operationId,
        transactionId,
        customerId: customerId || undefined,
        paymentMethod,
        items: cart.map((item) => ({
          productId: item.productId,
          productName: item.productName,
          qty: item.qty,
          unitPrice: item.unitPrice,
        })),
        totalAmount: total,
        notes: undefined,
      },
    });

    Alert.alert("Berhasil", `Transaksi Rp ${total.toLocaleString("id-ID")} dijadwalkan`);
    setCart([]);
    setCustomerId("");
    setPaymentMethod("cash");
  }

  const paymentOptions: { key: PaymentMethod; label: string }[] = [
    { key: "cash", label: "Tunai" },
    { key: "transfer", label: "Transfer" },
    { key: "member_balance", label: "Saldo" },
  ];

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>Kasir</Text>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Add item */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Tambah Produk</Text>
          <TextInput style={styles.input} placeholder="ID Produk" value={productId} onChangeText={setProductId} />
          <TextInput style={styles.input} placeholder="Nama Produk" value={productName} onChangeText={setProductName} />
          <View style={styles.row}>
            <TextInput
              style={[styles.input, styles.flex1]}
              placeholder="Jumlah"
              value={qty}
              onChangeText={setQty}
              keyboardType="numeric"
            />
            <TextInput
              style={[styles.input, styles.flex2]}
              placeholder="Harga Satuan"
              value={unitPrice}
              onChangeText={setUnitPrice}
              keyboardType="numeric"
            />
          </View>
          <TouchableOpacity style={styles.addBtn} onPress={addToCart}>
            <Text style={styles.addBtnText}>+ Tambah ke Keranjang</Text>
          </TouchableOpacity>
        </View>

        {/* Cart */}
        {cart.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Keranjang</Text>
            {cart.map((item) => (
              <View key={item.productId} style={styles.cartItem}>
                <View style={styles.flex1}>
                  <Text style={styles.cartItemName}>{item.productName}</Text>
                  <Text style={styles.cartItemMeta}>
                    {item.qty} × Rp {item.unitPrice.toLocaleString("id-ID")}
                  </Text>
                </View>
                <Text style={styles.cartItemTotal}>
                  Rp {(item.qty * item.unitPrice).toLocaleString("id-ID")}
                </Text>
                <TouchableOpacity onPress={() => removeFromCart(item.productId)} style={styles.removeBtn}>
                  <Text style={styles.removeBtnText}>✕</Text>
                </TouchableOpacity>
              </View>
            ))}
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Total</Text>
              <Text style={styles.totalAmount}>Rp {total.toLocaleString("id-ID")}</Text>
            </View>
          </View>
        )}

        {/* Customer + Payment */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Pembayaran</Text>
          <TextInput
            style={styles.input}
            placeholder="ID Customer (opsional)"
            value={customerId}
            onChangeText={setCustomerId}
            autoCapitalize="none"
          />
          <View style={styles.row}>
            {paymentOptions.map((opt) => (
              <TouchableOpacity
                key={opt.key}
                style={[styles.paymentBtn, paymentMethod === opt.key && styles.paymentBtnActive]}
                onPress={() => setPaymentMethod(opt.key)}
              >
                <Text
                  style={[styles.paymentBtnText, paymentMethod === opt.key && styles.paymentBtnTextActive]}
                >
                  {opt.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <TouchableOpacity
          style={[styles.submitBtn, cart.length === 0 && styles.submitBtnDisabled]}
          onPress={submitTransaction}
          disabled={cart.length === 0}
        >
          <Text style={styles.submitBtnText}>
            Bayar Rp {total.toLocaleString("id-ID")}
          </Text>
        </TouchableOpacity>
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
  sectionTitle: { fontSize: 15, fontWeight: "600", color: "#374151", marginBottom: 4 },
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
  flex2: { flex: 2 },
  addBtn: {
    backgroundColor: "#eff6ff",
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#bfdbfe",
  },
  addBtnText: { color: "#2563eb", fontWeight: "600", fontSize: 15 },
  cartItem: { flexDirection: "row", alignItems: "center", gap: 8 },
  cartItemName: { fontSize: 14, fontWeight: "600", color: "#1e293b" },
  cartItemMeta: { fontSize: 12, color: "#64748b" },
  cartItemTotal: { fontSize: 14, fontWeight: "600", color: "#1e293b", marginRight: 4 },
  removeBtn: { padding: 4 },
  removeBtnText: { color: "#dc2626", fontSize: 16, fontWeight: "700" },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: "#e2e8f0",
  },
  totalLabel: { fontSize: 16, fontWeight: "700", color: "#374151" },
  totalAmount: { fontSize: 16, fontWeight: "700", color: "#2563eb" },
  paymentBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    alignItems: "center",
  },
  paymentBtnActive: { borderColor: "#2563eb", backgroundColor: "#eff6ff" },
  paymentBtnText: { fontSize: 14, color: "#64748b", fontWeight: "500" },
  paymentBtnTextActive: { color: "#2563eb", fontWeight: "700" },
  submitBtn: {
    backgroundColor: "#2563eb",
    borderRadius: 12,
    paddingVertical: 18,
    alignItems: "center",
  },
  submitBtnDisabled: { opacity: 0.4 },
  submitBtnText: { color: "#fff", fontSize: 18, fontWeight: "700" },
});
