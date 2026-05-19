"use client";

import { useEffect, useState, useCallback } from "react";
import { collection, getDocs, query, where } from "firebase/firestore";
import { v4 as uuidv4 } from "uuid";
import { useOwnerAuthStore } from "@/store/auth.store";
import { callFunction, firebaseDb } from "@/firebase/firebase";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Product {
  id: string;
  name: string;
  category: string;
  sellingPrice: number;
}

interface Customer {
  id: string;
  displayName: string;
  phone: string | null;
  email: string | null;
}

interface CartItem {
  productId: string;
  productName: string;
  qty: number;
  unitPrice: number;
}

type PaymentMethod = "cash" | "transfer";

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmtIdr = (n: number) =>
  new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(n);

const CATEGORIES = ["Semua", "Minuman", "Makanan", "Suplemen", "Merchandise", "Lainnya"];

// ── Component ─────────────────────────────────────────────────────────────────

export default function OwnerPosPage() {
  const { ownerId, clubId } = useOwnerAuthStore();

  const [products, setProducts] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loadingData, setLoadingData] = useState(true);

  // Cart
  const [cart, setCart] = useState<CartItem[]>([]);

  // Filters
  const [categoryFilter, setCategoryFilter] = useState("Semua");
  const [productSearch, setProductSearch] = useState("");

  // Customer
  const [customerSearch, setCustomerSearch] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false);

  // Payment
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [amountPaid, setAmountPaid] = useState("");
  const [notes, setNotes] = useState("");

  // Submit
  const [submitting, setSubmitting] = useState(false);
  const [lastReceipt, setLastReceipt] = useState<{
    transactionId: string;
    total: number;
    change: number;
    items: CartItem[];
    customer: Customer | null;
    paymentMethod: PaymentMethod;
    amountPaid: number;
    timestamp: string;
  } | null>(null);

  const subtotal = cart.reduce((s, i) => s + i.qty * i.unitPrice, 0);
  const paid = parseFloat(amountPaid) || 0;
  const change = paid - subtotal;

  const filteredProducts = products.filter((p) => {
    const matchCat = categoryFilter === "Semua" || p.category === categoryFilter;
    const matchSearch =
      !productSearch || p.name.toLowerCase().includes(productSearch.toLowerCase());
    return matchCat && matchSearch;
  });

  const filteredCustomers =
    customerSearch.length >= 2
      ? customers.filter(
          (c) =>
            c.displayName.toLowerCase().includes(customerSearch.toLowerCase()) ||
            (c.phone ?? "").includes(customerSearch)
        )
      : [];

  const loadData = useCallback(async () => {
    if (!ownerId || !clubId) return;
    setLoadingData(true);
    try {
      const db = firebaseDb();
      const base = `owners/${ownerId}/clubs/${clubId}`;
      const [prodSnap, custSnap] = await Promise.all([
        getDocs(query(collection(db, `${base}/inventoryItems`), where("isActive", "==", true))),
        getDocs(collection(db, `${base}/customers`)),
      ]);
      setProducts(prodSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Product)));
      setCustomers(custSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Customer)));
    } finally {
      setLoadingData(false);
    }
  }, [ownerId, clubId]);

  useEffect(() => { loadData(); }, [loadData]);

  // ── Cart actions ────────────────────────────────────────────────────────────

  function addProduct(p: Product) {
    setCart((prev) => {
      const idx = prev.findIndex((i) => i.productId === p.id);
      if (idx >= 0)
        return prev.map((i, n) => n === idx ? { ...i, qty: i.qty + 1 } : i);
      return [...prev, { productId: p.id, productName: p.name, qty: 1, unitPrice: p.sellingPrice }];
    });
  }

  function setQty(productId: string, qty: number) {
    if (qty <= 0) {
      setCart((prev) => prev.filter((i) => i.productId !== productId));
    } else {
      setCart((prev) => prev.map((i) => i.productId === productId ? { ...i, qty } : i));
    }
  }

  function setPrice(productId: string, price: string) {
    const n = parseFloat(price);
    if (!isNaN(n) && n >= 0)
      setCart((prev) => prev.map((i) => i.productId === productId ? { ...i, unitPrice: n } : i));
  }

  function clearCart() {
    setCart([]);
    setSelectedCustomer(null);
    setCustomerSearch("");
    setAmountPaid("");
    setNotes("");
    setPaymentMethod("cash");
  }

  // ── Submit ──────────────────────────────────────────────────────────────────

  async function handleSubmit() {
    if (!ownerId || !clubId || cart.length === 0) return;
    if (paymentMethod === "cash" && paid < subtotal) return;

    setSubmitting(true);
    try {
      const result = await callFunction<{ transactionId: string; total: number; change: number }>(
        "pos_ownerSale",
        {
          ownerId,
          clubId,
          requestId: uuidv4(),
          operationId: uuidv4(),
          paymentMethod,
          amountPaid: paymentMethod === "cash" ? paid : subtotal,
          customerId: selectedCustomer?.id,
          discount: 0,
          notes: notes.trim() || undefined,
          items: cart.map((i) => ({
            productId: i.productId,
            productName: i.productName,
            modifierIds: [],
            modifierNames: [],
            quantity: i.qty,
            unitPrice: i.unitPrice,
            subtotal: i.qty * i.unitPrice,
          })),
        }
      );

      setLastReceipt({
        transactionId: result.transactionId,
        total: result.total,
        change: result.change,
        items: [...cart],
        customer: selectedCustomer,
        paymentMethod,
        amountPaid: paymentMethod === "cash" ? paid : subtotal,
        timestamp: new Date().toLocaleString("id-ID"),
      });
      clearCart();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Transaksi gagal");
    } finally {
      setSubmitting(false);
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="flex gap-6 h-full">

      {/* ── Left: product catalog ── */}
      <div className="flex-1 min-w-0 flex flex-col gap-4">

        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold text-slate-900">Kasir Owner</h2>
          {loadingData && <span className="text-xs text-slate-400">Memuat…</span>}
        </div>

        {/* Search + category filter */}
        <div className="flex gap-3">
          <input
            className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm"
            placeholder="Cari produk…"
            value={productSearch}
            onChange={(e) => setProductSearch(e.target.value)}
          />
          <div className="flex gap-1.5 flex-wrap">
            {CATEGORIES.map((c) => (
              <button
                key={c}
                onClick={() => setCategoryFilter(c)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium border transition ${
                  categoryFilter === c
                    ? "bg-slate-800 text-white border-slate-800"
                    : "border-slate-200 text-slate-500 hover:border-slate-400"
                }`}
              >
                {c}
              </button>
            ))}
          </div>
        </div>

        {/* Product grid */}
        {filteredProducts.length === 0 ? (
          <div className="flex-1 flex items-center justify-center text-slate-400 text-sm">
            {products.length === 0
              ? "Belum ada item. Tambahkan di halaman Inventaris."
              : "Tidak ada produk yang cocok."}
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-3 content-start">
            {filteredProducts.map((p) => {
              const inCart = cart.find((i) => i.productId === p.id);
              return (
                <button
                  key={p.id}
                  onClick={() => addProduct(p)}
                  className={`relative text-left rounded-xl border-2 p-4 transition hover:shadow-md ${
                    inCart
                      ? "border-blue-500 bg-blue-50"
                      : "border-slate-200 bg-white hover:border-slate-300"
                  }`}
                >
                  {inCart && (
                    <span className="absolute top-2 right-2 w-5 h-5 bg-blue-600 text-white text-xs rounded-full flex items-center justify-center font-bold">
                      {inCart.qty}
                    </span>
                  )}
                  <p className="text-xs text-slate-400 mb-1">{p.category}</p>
                  <p className="text-sm font-semibold text-slate-800 leading-tight mb-2">{p.name}</p>
                  <p className="text-base font-bold text-blue-700">{fmtIdr(p.sellingPrice)}</p>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Right: cart + checkout ── */}
      <div className="w-80 shrink-0 flex flex-col gap-3">

        {/* Receipt after successful transaction */}
        {lastReceipt && (
          <div className="bg-green-50 border border-green-200 rounded-xl p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-semibold text-green-800">Transaksi Berhasil ✓</p>
              <button
                onClick={() => setLastReceipt(null)}
                className="text-green-400 hover:text-green-600 text-lg leading-none"
              >
                ×
              </button>
            </div>
            <p className="text-xs text-green-600 font-mono mb-2">#{lastReceipt.transactionId.slice(0, 8)}</p>
            <div className="space-y-0.5 mb-2">
              {lastReceipt.items.map((i) => (
                <p key={i.productId} className="text-xs text-green-700">
                  {i.qty}× {i.productName} — {fmtIdr(i.qty * i.unitPrice)}
                </p>
              ))}
            </div>
            <div className="border-t border-green-200 pt-2 space-y-0.5">
              <p className="text-sm font-bold text-green-800">Total: {fmtIdr(lastReceipt.total)}</p>
              {lastReceipt.paymentMethod === "cash" && (
                <p className="text-xs text-green-600">Kembalian: {fmtIdr(lastReceipt.change)}</p>
              )}
              {lastReceipt.customer && (
                <p className="text-xs text-green-600">Pelanggan: {lastReceipt.customer.displayName}</p>
              )}
              <p className="text-xs text-green-500">{lastReceipt.timestamp}</p>
            </div>
          </div>
        )}

        {/* Cart */}
        <div className="bg-white rounded-xl border border-slate-200 flex-1 flex flex-col overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
            <p className="font-semibold text-slate-800">Keranjang ({cart.length})</p>
            {cart.length > 0 && (
              <button onClick={clearCart} className="text-xs text-red-400 hover:text-red-600">
                Kosongkan
              </button>
            )}
          </div>

          {cart.length === 0 ? (
            <div className="flex-1 flex items-center justify-center text-slate-400 text-sm p-8 text-center">
              Tap produk untuk ditambahkan
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {cart.map((item) => (
                <div key={item.productId} className="flex items-center gap-2 p-2 bg-slate-50 rounded-lg">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-slate-700 truncate">{item.productName}</p>
                    <input
                      type="number"
                      className="mt-0.5 w-full border-0 bg-transparent text-xs text-slate-500 p-0 focus:outline-none"
                      value={item.unitPrice}
                      onChange={(e) => setPrice(item.productId, e.target.value)}
                      title="Edit harga"
                    />
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => setQty(item.productId, item.qty - 1)}
                      className="w-6 h-6 rounded-full bg-slate-200 text-slate-600 text-sm font-bold flex items-center justify-center hover:bg-slate-300"
                    >
                      −
                    </button>
                    <span className="w-5 text-center text-sm font-bold text-slate-800">{item.qty}</span>
                    <button
                      onClick={() => setQty(item.productId, item.qty + 1)}
                      className="w-6 h-6 rounded-full bg-slate-200 text-slate-600 text-sm font-bold flex items-center justify-center hover:bg-slate-300"
                    >
                      +
                    </button>
                  </div>
                  <p className="text-xs font-bold text-slate-800 w-16 text-right shrink-0">
                    {fmtIdr(item.qty * item.unitPrice)}
                  </p>
                </div>
              ))}
            </div>
          )}

          {/* Subtotal */}
          {cart.length > 0 && (
            <div className="px-4 py-2.5 border-t border-slate-100 flex justify-between items-center">
              <span className="text-sm text-slate-500">Subtotal</span>
              <span className="text-base font-bold text-slate-900">{fmtIdr(subtotal)}</span>
            </div>
          )}
        </div>

        {/* Customer search */}
        <div className="bg-white rounded-xl border border-slate-200 p-3 relative">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
            Pelanggan (opsional)
          </p>
          {selectedCustomer ? (
            <div className="flex items-center justify-between bg-green-50 rounded-lg px-3 py-2">
              <div>
                <p className="text-sm font-semibold text-green-800">{selectedCustomer.displayName}</p>
                {selectedCustomer.phone && (
                  <p className="text-xs text-green-500">{selectedCustomer.phone}</p>
                )}
              </div>
              <button
                onClick={() => { setSelectedCustomer(null); setCustomerSearch(""); }}
                className="text-green-300 hover:text-green-500 text-lg"
              >
                ×
              </button>
            </div>
          ) : (
            <>
              <input
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
                placeholder="Cari nama / HP (min 2 karakter)"
                value={customerSearch}
                onChange={(e) => { setCustomerSearch(e.target.value); setShowCustomerDropdown(true); }}
                onFocus={() => setShowCustomerDropdown(true)}
              />
              {showCustomerDropdown && filteredCustomers.length > 0 && (
                <div className="absolute left-3 right-3 top-full z-10 bg-white border border-slate-200 rounded-lg shadow-lg overflow-hidden mt-1">
                  {filteredCustomers.slice(0, 6).map((c) => (
                    <button
                      key={c.id}
                      className="w-full text-left px-3 py-2 hover:bg-slate-50 border-b border-slate-100 last:border-0"
                      onClick={() => {
                        setSelectedCustomer(c);
                        setCustomerSearch(c.displayName);
                        setShowCustomerDropdown(false);
                      }}
                    >
                      <p className="text-sm text-slate-800 font-medium">{c.displayName}</p>
                      {c.phone && <p className="text-xs text-slate-400">{c.phone}</p>}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {/* Payment */}
        <div className="bg-white rounded-xl border border-slate-200 p-3 space-y-3">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
            Pembayaran
          </p>

          {/* Method toggle */}
          <div className="flex gap-2">
            {(["cash", "transfer"] as PaymentMethod[]).map((m) => (
              <button
                key={m}
                onClick={() => setPaymentMethod(m)}
                className={`flex-1 py-2 rounded-lg text-sm font-medium border transition ${
                  paymentMethod === m
                    ? "border-blue-500 bg-blue-50 text-blue-700"
                    : "border-slate-200 text-slate-500 hover:border-slate-300"
                }`}
              >
                {m === "cash" ? "Tunai" : "Transfer"}
              </button>
            ))}
          </div>

          {/* Amount paid (cash only) */}
          {paymentMethod === "cash" && (
            <div>
              <input
                type="number"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
                placeholder="Jumlah bayar"
                value={amountPaid}
                onChange={(e) => setAmountPaid(e.target.value)}
              />
              {paid > 0 && (
                <div className={`mt-2 flex justify-between text-sm px-3 py-2 rounded-lg ${
                  change >= 0 ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"
                }`}>
                  <span>{change >= 0 ? "Kembalian" : "Kurang"}</span>
                  <span className="font-bold">{fmtIdr(Math.abs(change))}</span>
                </div>
              )}
            </div>
          )}

          {/* Notes */}
          <input
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
            placeholder="Catatan (opsional)"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>

        {/* Submit button */}
        <button
          onClick={handleSubmit}
          disabled={
            submitting ||
            cart.length === 0 ||
            (paymentMethod === "cash" && paid < subtotal && paid > 0)
          }
          className="w-full bg-blue-600 text-white rounded-xl py-4 text-base font-bold hover:bg-blue-700 disabled:opacity-40 transition"
        >
          {submitting
            ? "Memproses…"
            : cart.length === 0
            ? "Pilih produk dulu"
            : `Bayar ${fmtIdr(subtotal)}`}
        </button>
      </div>
    </div>
  );
}
