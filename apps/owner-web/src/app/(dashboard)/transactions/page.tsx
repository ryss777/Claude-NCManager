"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { collection, getDocs, orderBy, query, where, limit } from "firebase/firestore";
import { v4 as uuidv4 } from "uuid";
import { useOwnerAuthStore } from "@/store/auth.store";
import { callFunction, firebaseDb } from "@/firebase/firebase";
import Link from "next/link";

// ── Shared types ──────────────────────────────────────────────────────────────

interface TxItem {
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  subtotal: number;
}

interface ProductTx {
  kind: "product";
  id: string;
  createdAt: string;
  customerId: string | null;
  items: TxItem[];
  total: number;
  amountPaid: number;
  change: number;
  paymentMethod: string;
  status: string;
  notes: string | null;
  debtId: string | null;
  operatorId: string | null;
  createdBy: string | null;
}

interface MembershipTx {
  kind: "membership";
  id: string;
  createdAt: string;
  customerId: string;
  planName: string;
  planType: string;
  tier: string;
  visitQuota: number;
  hasExpiry: boolean;
  durationDays: number | null;
  expiresAt: string | null;
  activatedAt: string | null;
  status: string;
  debtId: string | null;
  createdBy: string | null;
  operatorId: string | null;
  // Present when there is a paid transaction doc for this membership
  total?: number;
  amountPaid?: number;
  paymentMethod?: string;
}

interface DebtPaymentTx {
  kind: "debt_payment";
  id: string;
  createdAt: string;
  customerId: string | null;
  debtId: string;
  referenceLabel: string;
  total: number;
  amountPaid: number;
  paymentMethod: string;
  notes: string | null;
  createdBy: string | null;
  operatorId: string | null;
}

interface TransferTx {
  kind: "transfer";
  id: string;
  createdAt: string;
  customerId: null;
  transferId: string;
  direction: "in";
  sourceLabel: string;
  items: TxItem[];
  total: number;
  paymentType: "bayar" | "pinjam";
  priceTier: string;
  notes: string | null;
  status: string;
  createdBy: string | null;
  operatorId: string | null;
}

interface ExchangeItem {
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  subtotal: number;
}

interface ExchangeTx {
  kind: "exchange";
  id: string;
  createdAt: string;
  customerId: string | null;
  originalTransactionId: string;
  returnItems: ExchangeItem[];
  newItems: ExchangeItem[];
  returnTotal: number;
  newTotal: number;
  diffAmount: number;
  notes: string | null;
  status: string;
  createdBy: string | null;
  operatorId: string | null;
}

type CustomerTier = "retail" | "ds" | "sc" | "sbQp" | "spv";
const TIER_LABELS: Record<CustomerTier, string> = { retail: "Retail", ds: "DS", sc: "SC", sbQp: "SB-QP", spv: "SPV" };

interface PriceTiers { retail: number; ds: number; sc: number; sbQp: number; spv: number; }

interface OwnerProduct {
  id: string;
  name: string;
  prices: PriceTiers;
  currentStock: number;
}

type HistoryItem = ProductTx | MembershipTx | DebtPaymentTx | TransferTx | ExchangeTx;

// ── Debts types ───────────────────────────────────────────────────────────────

interface Debt {
  id: string;
  customerId: string;
  source: string;
  referenceLabel: string;
  totalAmount: number;
  paidAmount: number;
  remainingAmount: number;
  status: "unpaid" | "outstanding" | "partial" | "paid";
  payments: { amount: number; paymentMethod: string; notes: string | null; paidAt: string }[];
  createdAt: string;
  updatedAt: string;
}

interface DebtCustomer {
  id: string;
  displayName: string;
  phone: string | null;
}

type DebtStatusFilter = "all" | "unpaid" | "partial" | "paid";

// ── Finance types ─────────────────────────────────────────────────────────────

type AccountCode = "1001" | "1002" | "2001" | "4001" | "4002" | "5001" | "6001";
type DatePreset = "today" | "7d" | "30d" | "month" | "custom";
type ManualEntryType = "adjustment" | "expense" | "cash_in" | "cash_out";

interface JournalEntry {
  id: string;
  entryType: string;
  debitAccount: string;
  creditAccount: string;
  amount: number;
  description: string;
  createdAt: string;
  referenceId?: string;
  shiftId?: string;
}

// ── Finance lookup tables ─────────────────────────────────────────────────────

const ACCOUNT_OPTIONS: { code: AccountCode; label: string }[] = [
  { code: "1001", label: "1001 · Kas" },
  { code: "1002", label: "1002 · Saldo Member" },
  { code: "2001", label: "2001 · Pendapatan Ditangguhkan" },
  { code: "4001", label: "4001 · Pendapatan Penjualan" },
  { code: "4002", label: "4002 · Pendapatan Keanggotaan" },
  { code: "5001", label: "5001 · HPP" },
  { code: "6001", label: "6001 · Beban Operasional" },
];

const ACCOUNT_NAMES: Record<string, string> = {
  "1001": "Kas",                 CASH: "Kas",
  "1002": "Saldo Member",        MEMBER_BALANCE: "Saldo Member",
  "2001": "Hutang Belum Terima", UNEARNED_LIABILITY: "Hutang Belum Terima",
  "4001": "Pend. Penjualan",     SALES_REVENUE: "Pend. Penjualan",
  "4002": "Pend. Keanggotaan",   MEMBERSHIP_REVENUE: "Pend. Keanggotaan",
  "5001": "HPP",                 COGS: "HPP",
  "6001": "Beban Operasional",   OPERATING_EXPENSE: "Beban Operasional",
  EQUITY: "Ekuitas",
};

const ENTRY_TYPE_LABELS: Record<string, string> = {
  sale:               "Penjualan",
  reversal:           "Pembatalan",
  expense:            "Pengeluaran",
  shift_close:        "Tutup Shift",
  adjustment:         "Penyesuaian",
  membership_payment: "Keanggotaan",
  cash_in:            "Kas Masuk",
  cash_out:           "Kas Keluar",
};

const ENTRY_TYPE_STYLE: Record<string, string> = {
  sale:               "bg-green-50 text-green-700",
  membership_payment: "bg-blue-50 text-blue-700",
  reversal:           "bg-red-50 text-red-600",
  shift_close:        "bg-slate-100 text-slate-600",
  expense:            "bg-orange-50 text-orange-700",
  adjustment:         "bg-purple-50 text-purple-700",
  cash_in:            "bg-teal-50 text-teal-700",
  cash_out:           "bg-pink-50 text-pink-700",
};

const MANUAL_ENTRY_TYPES: { key: ManualEntryType; label: string }[] = [
  { key: "adjustment", label: "Penyesuaian" },
  { key: "expense",    label: "Pengeluaran" },
  { key: "cash_in",    label: "Kas Masuk" },
  { key: "cash_out",   label: "Kas Keluar" },
];

const REVENUE_CREDITS = new Set(["4001", "4002", "SALES_REVENUE", "MEMBERSHIP_REVENUE"]);
const EXPENSE_DEBITS  = new Set(["5001", "6001", "COGS", "OPERATING_EXPENSE"]);
const CASH_ACCOUNTS   = new Set(["1001", "CASH"]);

const JOURNAL_PRESETS: { key: DatePreset; label: string }[] = [
  { key: "today", label: "Hari Ini" },
  { key: "7d",    label: "7 Hari" },
  { key: "30d",   label: "30 Hari" },
  { key: "month", label: "Bulan Ini" },
  { key: "custom", label: "Custom" },
];

// ── Finance date helpers ──────────────────────────────────────────────────────

function isoDate(d: Date) { return d.toISOString().slice(0, 10); }
function startOfDay(date: string) { return `${date}T00:00:00.000Z`; }
function endOfDay(date: string)   { return `${date}T23:59:59.999Z`; }

function presetDates(p: DatePreset): { from: string; to: string } {
  const today = new Date();
  const todayStr = isoDate(today);
  if (p === "today") return { from: todayStr, to: todayStr };
  if (p === "7d") { const d = new Date(today); d.setDate(d.getDate() - 6); return { from: isoDate(d), to: todayStr }; }
  if (p === "30d") { const d = new Date(today); d.setDate(d.getDate() - 29); return { from: isoDate(d), to: todayStr }; }
  if (p === "month") { const d = new Date(today.getFullYear(), today.getMonth(), 1); return { from: isoDate(d), to: todayStr }; }
  return { from: todayStr, to: todayStr };
}

// ── Shared helpers ────────────────────────────────────────────────────────────

const fmtIdr = (n: number) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleString("id-ID", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });

const fmtDateShort = (iso: string) =>
  new Date(iso).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });

function parseWalkIn(notes: string | null): { isWalkIn: boolean; name: string | null } {
  if (!notes) return { isWalkIn: false, name: null };
  if (notes === "Walk-in" || notes.startsWith("Walk-in · ")) return { isWalkIn: true, name: null };
  if (notes.startsWith("Walk-in: ")) {
    const rest = notes.slice(9);
    const dotIdx = rest.indexOf(" · ");
    return { isWalkIn: true, name: dotIdx >= 0 ? rest.slice(0, dotIdx) : rest };
  }
  return { isWalkIn: false, name: null };
}

function downloadCsv(entries: JournalEntry[], from: string, to: string) {
  const header = ["Tanggal", "Tipe", "Debit", "Kredit", "Jumlah", "Deskripsi", "Referensi"];
  const rows = entries.map((e) => [
    e.createdAt.slice(0, 16).replace("T", " "),
    e.entryType,
    ACCOUNT_NAMES[e.debitAccount] ?? e.debitAccount,
    ACCOUNT_NAMES[e.creditAccount] ?? e.creditAccount,
    e.amount,
    `"${(e.description ?? "").replace(/"/g, '""')}"`,
    e.referenceId ?? "",
  ]);
  const csv = [header, ...rows].map((r) => r.join(",")).join("\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `jurnal_${from}_${to}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Component ─────────────────────────────────────────────────────────────────

type MainTab = "transaksi" | "utang" | "jurnal";

export default function TransactionsPage() {
  const { ownerId, clubId } = useOwnerAuthStore();
  const [mainTab, setMainTab] = useState<MainTab>("transaksi");

  // ── Transactions tab state ────────────────────────────────────────────────

  const [items, setItems] = useState<HistoryItem[]>([]);
  const [customers, setCustomers] = useState<Record<string, string>>({});
  const [operators, setOperators] = useState<Record<string, string>>({});
  const [debtRemaining, setDebtRemaining] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<HistoryItem | null>(null);
  const [typeFilter, setTypeFilter] = useState<"all" | "product" | "membership" | "debt_payment" | "transfer" | "exchange">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const [reverseDialog, setReverseDialog] = useState<{ transactionId: string; total: number } | null>(null);
  const [reverseReason, setReverseReason] = useState("");
  const [reversing, setReversing] = useState(false);
  const [reverseError, setReverseError] = useState("");

  const [exchangeDialog, setExchangeDialog] = useState<{
    transactionId: string;
    originalItems: TxItem[];
    customerId: string | null;
  } | null>(null);
  const [ownerProducts, setOwnerProducts] = useState<OwnerProduct[]>([]);
  const [exchangeLoadingProducts, setExchangeLoadingProducts] = useState(false);
  const [returnQtys, setReturnQtys] = useState<Record<string, number>>({});
  const [exchangeNewItems, setExchangeNewItems] = useState<{
    productId: string; productName: string; quantity: number; unitPrice: number;
  }[]>([]);
  const [exchangeTier, setExchangeTier] = useState<CustomerTier>("retail");
  const [exchanging, setExchanging] = useState(false);
  const [exchangeError, setExchangeError] = useState("");
  const [exchangeReceipt, setExchangeReceipt] = useState<{
    exchangeId: string;
    returnItems: ExchangeItem[];
    newItems: ExchangeItem[];
    returnTotal: number;
    newTotal: number;
    diffAmount: number;
    customerName: string | null;
  } | null>(null);

  // ── Debts tab state ───────────────────────────────────────────────────────

  const [debts, setDebts] = useState<Debt[]>([]);
  const [debtCustomers, setDebtCustomers] = useState<Map<string, DebtCustomer>>(new Map());
  const [debtsLoading, setDebtsLoading] = useState(false);
  const [debtStatusFilter, setDebtStatusFilter] = useState<DebtStatusFilter>("all");
  const [payDialog, setPayDialog] = useState<{
    debtId: string; remaining: number; label: string; customerId: string;
  } | null>(null);
  const [payAmount, setPayAmount] = useState("");
  const [payMethod, setPayMethod] = useState<"cash" | "transfer">("cash");
  const [payNotes, setPayNotes] = useState("");
  const [paying, setPaying] = useState(false);
  const [payError, setPayError] = useState("");

  // ── Finance tab state ─────────────────────────────────────────────────────

  const [journalPreset, setJournalPreset] = useState<DatePreset>("30d");
  const [journalFrom, setJournalFrom] = useState(() => presetDates("30d").from);
  const [journalTo, setJournalTo] = useState(() => presetDates("30d").to);
  const [journalTypeFilter, setJournalTypeFilter] = useState<string[]>([]);
  const [showBalance, setShowBalance] = useState(false);
  const [allEntries, setAllEntries] = useState<JournalEntry[]>([]);
  const [journalLoading, setJournalLoading] = useState(false);

  const [entryType, setEntryType] = useState<ManualEntryType>("adjustment");
  const [debitAccount, setDebitAccount] = useState<AccountCode>("1001");
  const [creditAccount, setCreditAccount] = useState<AccountCode>("4001");
  const [entryAmount, setEntryAmount] = useState("");
  const [entryDescription, setEntryDescription] = useState("");
  const [entrySaving, setEntrySaving] = useState(false);
  const [entryFeedback, setEntryFeedback] = useState<{ type: "ok" | "err"; msg: string } | undefined>();

  // ── Effects ───────────────────────────────────────────────────────────────

  const loadData = useCallback(async () => {
    if (!ownerId || !clubId) return;
    setLoading(true);
    try {
      const db = firebaseDb();
      const base = `owners/${ownerId}/clubs/${clubId}`;

      const [txSnap, memSnap, custSnap, debtSnap, opSnap] = await Promise.all([
        getDocs(query(collection(db, `${base}/transactions`), orderBy("createdAt", "desc"))),
        getDocs(query(collection(db, `${base}/memberships`), orderBy("createdAt", "desc"))),
        getDocs(collection(db, `${base}/customers`)),
        getDocs(collection(db, `${base}/debts`)),
        getDocs(collection(db, `${base}/operators`)),
      ]);

      const custMap: Record<string, string> = {};
      custSnap.docs.forEach((d) => { custMap[d.id] = (d.data()["displayName"] as string) ?? d.id; });
      setCustomers(custMap);

      const opMap: Record<string, string> = {};
      opSnap.docs.forEach((d) => { opMap[d.id] = (d.data()["displayName"] as string) ?? d.id; });
      setOperators(opMap);

      const debtMap: Record<string, number> = {};
      debtSnap.docs.forEach((d) => { debtMap[d.id] = (d.data()["remainingAmount"] as number) ?? 0; });
      setDebtRemaining(debtMap);

      // Build a map: membershipId → { total, amountPaid, paymentMethod } from paid membership txs
      const memTxMap = new Map<string, { total: number; amountPaid: number; paymentMethod: string }>();
      txSnap.docs.forEach((d) => {
        const data = d.data();
        if (data["type"] === "membership" && data["membershipId"]) {
          memTxMap.set(data["membershipId"] as string, {
            total: (data["total"] as number) ?? 0,
            amountPaid: (data["amountPaid"] as number) ?? 0,
            paymentMethod: (data["paymentMethod"] as string) ?? "cash",
          });
        }
      });

      const txItems: (ProductTx | DebtPaymentTx | TransferTx | ExchangeTx)[] = txSnap.docs
        .filter((d) => {
          const data = d.data();
          if (data["status"] === "reversed") return false;
          // Skip membership type — we surface these through the memberships collection
          if (data["type"] === "membership") return false;
          return true;
        })
        .map((d) => {
          const data = d.data();
          if (data["type"] === "debt_payment") return { kind: "debt_payment" as const, id: d.id, ...data } as DebtPaymentTx;
          if (data["type"] === "transfer")     return { kind: "transfer" as const, id: d.id, ...data } as TransferTx;
          if (data["type"] === "exchange")     return { kind: "exchange" as const, id: d.id, ...data } as ExchangeTx;
          return { kind: "product" as const, id: d.id, ...data } as ProductTx;
        });

      const memItems: MembershipTx[] = memSnap.docs.map((d) => {
        const base = { kind: "membership" as const, id: d.id, ...d.data() } as MembershipTx;
        // Enrich with payment data from the transactions collection
        const txData = memTxMap.get(d.id);
        if (txData) return { ...base, ...txData };
        return base;
      });

      setItems(
        [...txItems, ...memItems].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      );
    } finally {
      setLoading(false);
    }
  }, [ownerId, clubId]);

  useEffect(() => { loadData(); }, [loadData]);

  useEffect(() => {
    if (!exchangeDialog || !ownerId) return;
    setExchangeTier("retail");
    setExchangeLoadingProducts(true);
    getDocs(query(collection(firebaseDb(), `owners/${ownerId}/inventoryItems`), where("currentStock", ">", 0)))
      .then((snap) => {
        setOwnerProducts(snap.docs.map((d) => ({
          id: d.id,
          name: d.data()["name"] as string,
          prices: d.data()["prices"] as PriceTiers,
          currentStock: d.data()["currentStock"] as number,
        })));
      })
      .finally(() => setExchangeLoadingProducts(false));
  }, [exchangeDialog, ownerId]);

  useEffect(() => {
    if (mainTab === "utang") loadDebts();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mainTab, ownerId, clubId]);

  useEffect(() => {
    if (mainTab === "jurnal" && ownerId && clubId) loadEntries();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mainTab, ownerId, clubId, journalFrom, journalTo]);

  // ── Transactions functions ────────────────────────────────────────────────

  async function handleExchange() {
    if (!exchangeDialog || !ownerId || !clubId) return;
    const returnItems: ExchangeItem[] = exchangeDialog.originalItems
      .filter((item) => (returnQtys[item.productId] ?? 0) > 0)
      .map((item) => {
        const qty = returnQtys[item.productId]!;
        return { productId: item.productId, productName: item.productName, quantity: qty, unitPrice: item.unitPrice, subtotal: qty * item.unitPrice };
      });
    if (returnItems.length === 0) { setExchangeError("Pilih minimal 1 item untuk ditukar/diretur"); return; }
    const newItems: ExchangeItem[] = exchangeNewItems
      .filter((it) => it.quantity > 0)
      .map((it) => ({ productId: it.productId, productName: it.productName, quantity: it.quantity, unitPrice: it.unitPrice, subtotal: it.quantity * it.unitPrice }));
    setExchanging(true);
    setExchangeError("");
    try {
      const result = await callFunction("pos_exchangeItems", {
        ownerId, clubId,
        requestId: uuidv4(), operationId: uuidv4(),
        transactionId: exchangeDialog.transactionId,
        returnItems,
        newItems: newItems.length > 0 ? newItems : null,
        notes: null,
      }) as { exchangeId: string; returnTotal: number; newTotal: number; diffAmount: number };
      const custName = exchangeDialog.customerId ? (customers[exchangeDialog.customerId] ?? null) : null;
      setExchangeReceipt({ exchangeId: result.exchangeId, returnItems, newItems, returnTotal: result.returnTotal, newTotal: result.newTotal, diffAmount: result.diffAmount, customerName: custName });
      setExchangeDialog(null);
      setReturnQtys({});
      setExchangeNewItems([]);
      setSelected(null);
      loadData();
    } catch (err) {
      setExchangeError(err instanceof Error ? err.message : "Gagal memproses penukaran");
    } finally {
      setExchanging(false);
    }
  }

  async function handleReverse() {
    if (!reverseDialog || !ownerId || !clubId) return;
    if (reverseReason.trim().length < 10) { setReverseError("Alasan minimal 10 karakter"); return; }
    setReversing(true);
    setReverseError("");
    try {
      await callFunction("pos_reverseTransaction", {
        ownerId, clubId,
        requestId: uuidv4(), operationId: uuidv4(),
        transactionId: reverseDialog.transactionId,
        reason: reverseReason.trim(),
      });
      setReverseDialog(null);
      setReverseReason("");
      setSelected(null);
      loadData();
    } catch (err) {
      setReverseError(err instanceof Error ? err.message : "Gagal membatalkan transaksi");
    } finally {
      setReversing(false);
    }
  }

  const filtered = items.filter((item) => {
    if (typeFilter !== "all" && item.kind !== typeFilter) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      const name = item.customerId
        ? (customers[item.customerId] ?? "").toLowerCase()
        : item.kind === "product"
        ? (() => { const wi = parseWalkIn(item.notes); return wi.isWalkIn ? ("walk-in " + (wi.name ?? "")).trim() : ""; })()
        : "";
      const extra = item.kind === "product"
        ? item.items?.map((i) => i.productName.toLowerCase()).join(" ") ?? ""
        : item.kind === "membership"
        ? item.planName?.toLowerCase() ?? ""
        : item.kind === "transfer"
        ? item.items?.map((i) => i.productName.toLowerCase()).join(" ") ?? ""
        : item.kind === "exchange"
        ? [...item.returnItems.map((i) => i.productName.toLowerCase()), ...item.newItems.map((i) => i.productName.toLowerCase())].join(" ")
        : item.referenceLabel?.toLowerCase() ?? "";
      if (!name.includes(q) && !extra.includes(q)) return false;
    }
    const ts = new Date(item.createdAt).getTime();
    if (dateFrom && ts < new Date(dateFrom).getTime()) return false;
    if (dateTo) { const end = new Date(dateTo); end.setHours(23, 59, 59, 999); if (ts > end.getTime()) return false; }
    return true;
  });

  const hasActiveFilter = searchQuery.trim() !== "" || dateFrom !== "" || dateTo !== "";
  function clearFilters() { setSearchQuery(""); setDateFrom(""); setDateTo(""); }

  function creatorBadge(createdBy: string | null, operatorId: string | null) {
    if (createdBy === "owner" || (!createdBy && !operatorId)) {
      return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-violet-100 text-violet-700">👑 Owner</span>;
    }
    const name = operatorId ? (operators[operatorId] ?? "Operator") : "Operator";
    return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-orange-100 text-orange-700">🧑‍💼 {name}</span>;
  }

  // ── Debts functions ───────────────────────────────────────────────────────

  async function loadDebts() {
    if (!ownerId || !clubId) return;
    setDebtsLoading(true);
    try {
      const db = firebaseDb();
      const base = `owners/${ownerId}/clubs/${clubId}`;
      const [debtSnap, custSnap] = await Promise.all([
        getDocs(collection(db, `${base}/debts`)),
        getDocs(collection(db, `${base}/customers`)),
      ]);
      setDebts(debtSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Debt)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
      const custMap = new Map<string, DebtCustomer>();
      custSnap.docs.forEach((d) => custMap.set(d.id, { id: d.id, ...d.data() } as DebtCustomer));
      setDebtCustomers(custMap);
    } finally {
      setDebtsLoading(false);
    }
  }

  const filteredDebts = useMemo(() => {
    if (debtStatusFilter === "all") return debts.filter((d) => d.status !== "paid");
    // Legacy "outstanding" rows are equivalent to "unpaid" — treat them together.
    if (debtStatusFilter === "unpaid") {
      return debts.filter((d) => d.status === "unpaid" || d.status === "outstanding");
    }
    return debts.filter((d) => d.status === debtStatusFilter);
  }, [debts, debtStatusFilter]);

  const totalOutstanding = useMemo(() => debts.filter((d) => d.status !== "paid").reduce((s, d) => s + d.remainingAmount, 0), [debts]);
  const activeDebtCount  = useMemo(() => debts.filter((d) => d.status !== "paid").length, [debts]);

  async function handlePay() {
    if (!payDialog) return;
    const amount = parseFloat(payAmount);
    if (isNaN(amount) || amount <= 0 || amount > payDialog.remaining) return;
    setPaying(true);
    setPayError("");
    try {
      await callFunction("debt_recordPayment", {
        ownerId, clubId,
        requestId: uuidv4(), operationId: uuidv4(),
        debtId: payDialog.debtId,
        amount,
        paymentMethod: payMethod,
        notes: payNotes.trim() || undefined,
      });
      setPayDialog(null);
      setPayAmount("");
      setPayNotes("");
      loadDebts();
    } catch (err) {
      setPayError(err instanceof Error ? err.message : "Gagal mencatat pembayaran");
    } finally {
      setPaying(false);
    }
  }

  // ── Finance functions ─────────────────────────────────────────────────────

  async function loadEntries() {
    if (!ownerId || !clubId) return;
    setJournalLoading(true);
    try {
      const snap = await getDocs(
        query(
          collection(firebaseDb(), `owners/${ownerId}/clubs/${clubId}/financeJournal`),
          where("createdAt", ">=", startOfDay(journalFrom)),
          where("createdAt", "<=", endOfDay(journalTo)),
          orderBy("createdAt", "desc"),
          limit(200)
        )
      );
      setAllEntries(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<JournalEntry, "id">) })));
    } finally {
      setJournalLoading(false);
    }
  }

  function applyJournalPreset(p: DatePreset) {
    setJournalPreset(p);
    if (p !== "custom") {
      const { from, to } = presetDates(p);
      setJournalFrom(from);
      setJournalTo(to);
    }
  }

  const journalEntries = useMemo(
    () => journalTypeFilter.length === 0 ? allEntries : allEntries.filter((e) => journalTypeFilter.includes(e.entryType)),
    [allEntries, journalTypeFilter]
  );

  const availableTypes = useMemo(() => Array.from(new Set(allEntries.map((e) => e.entryType))).sort(), [allEntries]);

  const kpi = useMemo(() => {
    let revenue = 0, expense = 0, cashIn = 0, cashOut = 0;
    journalEntries.forEach((e) => {
      if (REVENUE_CREDITS.has(e.creditAccount)) revenue += e.amount;
      if (EXPENSE_DEBITS.has(e.debitAccount))   expense += e.amount;
      if (CASH_ACCOUNTS.has(e.debitAccount))    cashIn  += e.amount;
      if (CASH_ACCOUNTS.has(e.creditAccount))   cashOut += e.amount;
    });
    return { revenue, expense, profit: revenue - expense, netCash: cashIn - cashOut };
  }, [journalEntries]);

  const trialBalance = useMemo(() => {
    const bal: Record<string, { debit: number; credit: number }> = {};
    journalEntries.forEach((e) => {
      bal[e.debitAccount]  ??= { debit: 0, credit: 0 };
      bal[e.creditAccount] ??= { debit: 0, credit: 0 };
      bal[e.debitAccount]!.debit   += e.amount;
      bal[e.creditAccount]!.credit += e.amount;
    });
    return Object.entries(bal)
      .map(([code, { debit, credit }]) => ({ code, name: ACCOUNT_NAMES[code] ?? code, debit, credit, balance: debit - credit }))
      .sort((a, b) => a.code.localeCompare(b.code));
  }, [journalEntries]);

  async function handleCreateEntry() {
    const amt = parseFloat(entryAmount);
    if (!entryDescription || isNaN(amt) || amt <= 0) {
      setEntryFeedback({ type: "err", msg: "Isi deskripsi dan jumlah yang valid" });
      return;
    }
    if (debitAccount === creditAccount) {
      setEntryFeedback({ type: "err", msg: "Akun debit dan kredit tidak boleh sama" });
      return;
    }
    setEntrySaving(true);
    setEntryFeedback(undefined);
    try {
      await callFunction("finance_createJournalEntry", {
        ownerId, clubId,
        requestId: uuidv4(), operationId: uuidv4(),
        entryType,
        debitAccount,
        creditAccount,
        amount: amt,
        description: entryDescription,
      });
      setEntryFeedback({ type: "ok", msg: "Entri berhasil dicatat" });
      setEntryAmount("");
      setEntryDescription("");
      loadEntries();
    } catch (err) {
      setEntryFeedback({ type: "err", msg: err instanceof Error ? err.message : "Gagal" });
    } finally {
      setEntrySaving(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full min-h-0">

      {/* ── Main tab switcher ── */}
      <div className="flex gap-1 bg-slate-100 p-1 rounded-xl mb-4 shrink-0 self-start">
        {([
          { key: "transaksi", label: "📋 Transaksi" },
          { key: "utang",     label: "💳 Utang" },
          { key: "jurnal",    label: "📊 Jurnal" },
        ] as { key: MainTab; label: string }[]).map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setMainTab(key)}
            className={`py-2 px-5 rounded-lg text-sm font-semibold transition ${
              mainTab === key ? "bg-white shadow text-slate-900" : "text-slate-500 hover:text-slate-700"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ══════════════════════════════════════════════════════════════════════
          TAB: TRANSAKSI
          ══════════════════════════════════════════════════════════════════ */}
      {mainTab === "transaksi" && (
        <div className="flex gap-6 flex-1 min-h-0">

          {/* ── Reversal dialog ── */}
          {reverseDialog && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
              <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm mx-4">
                <div className="flex items-start gap-3 mb-4">
                  <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center shrink-0">
                    <span className="text-lg">⚠️</span>
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-slate-900">Batalkan Transaksi</h3>
                    <p className="text-sm text-slate-500 mt-0.5">{fmtIdr(reverseDialog.total)} akan dikembalikan ke stok.</p>
                  </div>
                </div>
                {reverseError && <div className="mb-3 text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{reverseError}</div>}
                <div className="mb-4">
                  <label className="text-xs text-slate-500 block mb-1">Alasan pembatalan (min 10 karakter)</label>
                  <textarea
                    rows={3}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm resize-none"
                    placeholder="Contoh: Pelanggan salah pesan, produk dikembalikan..."
                    value={reverseReason}
                    onChange={(e) => setReverseReason(e.target.value)}
                  />
                </div>
                <div className="flex gap-3">
                  <button onClick={() => { setReverseDialog(null); setReverseReason(""); setReverseError(""); }}
                    className="flex-1 border border-slate-200 text-slate-600 rounded-xl py-2.5 text-sm font-semibold hover:bg-slate-50 transition">
                    Batal
                  </button>
                  <button onClick={handleReverse} disabled={reversing}
                    className="flex-1 bg-red-600 text-white rounded-xl py-2.5 text-sm font-semibold hover:bg-red-700 disabled:opacity-50 transition">
                    {reversing ? "Memproses…" : "Ya, Batalkan"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ── List ── */}
          <div className="flex-1 min-w-0 flex flex-col gap-4">

            <div className="flex items-center justify-between">
              <h1 className="text-2xl font-bold text-slate-900">Riwayat Transaksi</h1>
              {loading && <span className="text-xs text-slate-400">Memuat…</span>}
            </div>

            {/* Type filter */}
            <div className="flex flex-wrap gap-2 items-center">
              {([
                { key: "all",          label: "Semua" },
                { key: "product",      label: "Penjualan Produk" },
                { key: "membership",   label: "Membership" },
                { key: "debt_payment", label: "Cicilan Utang" },
                { key: "transfer",     label: "Transfer Masuk" },
                { key: "exchange",     label: "Tukar/Retur" },
              ] as { key: typeof typeFilter; label: string }[]).map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => setTypeFilter(key)}
                  className={`px-4 py-1.5 rounded-full text-sm font-medium border transition ${
                    typeFilter === key ? "bg-slate-800 text-white border-slate-800" : "border-slate-200 text-slate-500 hover:border-slate-400"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* Search & date */}
            <div className="flex flex-wrap gap-3 items-center">
              <div className="relative flex-1 min-w-52">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm pointer-events-none">🔍</span>
                <input
                  type="text"
                  placeholder="Cari nama pelanggan atau produk…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-lg bg-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
              <div className="flex items-center gap-1.5">
                <label className="text-xs text-slate-400 whitespace-nowrap">Dari</label>
                <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
                  className="text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
              </div>
              <div className="flex items-center gap-1.5">
                <label className="text-xs text-slate-400 whitespace-nowrap">Sampai</label>
                <input type="date" value={dateTo} min={dateFrom || undefined} onChange={(e) => setDateTo(e.target.value)}
                  className="text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
              </div>
              {hasActiveFilter && (
                <button onClick={clearFilters} className="text-xs text-slate-400 hover:text-slate-700 transition flex items-center gap-1">
                  ✕ Reset
                </button>
              )}
              <span className="text-xs text-slate-400 ml-auto whitespace-nowrap">{filtered.length} transaksi</span>
            </div>

            {/* Table */}
            {filtered.length === 0 && !loading ? (
              <div className="flex-1 flex flex-col items-center justify-center gap-2 text-slate-400 text-sm py-16">
                {hasActiveFilter || typeFilter !== "all" ? (
                  <>
                    <span className="text-2xl">🔍</span>
                    <p>Tidak ada transaksi yang cocok.</p>
                    <button onClick={() => { clearFilters(); setTypeFilter("all"); }} className="text-blue-500 hover:underline text-xs">Reset semua filter</button>
                  </>
                ) : <p>Belum ada transaksi.</p>}
              </div>
            ) : (
              <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
                    <tr>
                      <th className="px-4 py-3 text-left">Waktu</th>
                      <th className="px-4 py-3 text-left">Jenis</th>
                      <th className="px-4 py-3 text-left">Dibuat oleh</th>
                      <th className="px-4 py-3 text-left">Pelanggan</th>
                      <th className="px-4 py-3 text-left">Ringkasan</th>
                      <th className="px-4 py-3 text-right">Jumlah</th>
                      <th className="px-4 py-3 text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filtered.map((item) => {
                      const customerName = item.customerId ? (customers[item.customerId] ?? item.customerId) : "—";
                      const isSelected = selected?.id === item.id;

                      if (item.kind === "product") {
                        const summary = item.items?.length === 1 ? item.items[0]!.productName : `${item.items?.length ?? 0} produk`;
                        const wi = !item.customerId ? parseWalkIn(item.notes) : { isWalkIn: false, name: null };
                        return (
                          <tr key={item.id} onClick={() => setSelected(isSelected ? null : item)} className={`cursor-pointer transition ${isSelected ? "bg-blue-50" : "hover:bg-slate-50"}`}>
                            <td className="px-4 py-3 text-slate-500 whitespace-nowrap text-xs">{fmtDate(item.createdAt)}</td>
                            <td className="px-4 py-3"><span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-green-100 text-green-700">Produk</span></td>
                            <td className="px-4 py-3">{creatorBadge(item.createdBy, item.operatorId)}</td>
                            <td className="px-4 py-3 font-medium text-slate-800">
                              {item.customerId ? customerName : wi.isWalkIn
                                ? <span className="text-slate-500">🚶 {wi.name ? `Walk-in: ${wi.name}` : "Walk-in"}</span>
                                : <span className="text-slate-400">—</span>}
                            </td>
                            <td className="px-4 py-3 text-slate-500 truncate max-w-xs">{summary}</td>
                            <td className="px-4 py-3 text-right font-semibold text-slate-800">{fmtIdr(item.total)}</td>
                            <td className="px-4 py-3 text-center">
                              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${item.status === "completed" ? "bg-green-100 text-green-700" : item.status === "pending" ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-600"}`}>
                                {item.status}
                              </span>
                            </td>
                          </tr>
                        );
                      }

                      if (item.kind === "debt_payment") return (
                        <tr key={item.id} onClick={() => setSelected(isSelected ? null : item)} className={`cursor-pointer transition ${isSelected ? "bg-amber-50" : "hover:bg-slate-50"}`}>
                          <td className="px-4 py-3 text-slate-500 whitespace-nowrap text-xs">{fmtDate(item.createdAt)}</td>
                          <td className="px-4 py-3"><span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-700">Cicilan</span></td>
                          <td className="px-4 py-3">{creatorBadge(item.createdBy, item.operatorId)}</td>
                          <td className="px-4 py-3 font-medium text-slate-800">{customerName}</td>
                          <td className="px-4 py-3 text-slate-500 truncate max-w-xs">{item.referenceLabel}</td>
                          <td className="px-4 py-3 text-right font-semibold text-slate-800">{fmtIdr(item.amountPaid)}</td>
                          <td className="px-4 py-3 text-center"><span className="px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">lunas</span></td>
                        </tr>
                      );

                      if (item.kind === "transfer") {
                        const summary = item.items.length === 1 ? `${item.items[0]!.quantity}× ${item.items[0]!.productName}` : `${item.items.length} produk`;
                        return (
                          <tr key={item.id} onClick={() => setSelected(isSelected ? null : item)} className={`cursor-pointer transition ${isSelected ? "bg-purple-50" : "hover:bg-slate-50"}`}>
                            <td className="px-4 py-3 text-slate-500 whitespace-nowrap text-xs">{fmtDate(item.createdAt)}</td>
                            <td className="px-4 py-3"><span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-purple-100 text-purple-700">Transfer</span></td>
                            <td className="px-4 py-3"><span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-violet-100 text-violet-700">👑 Owner</span></td>
                            <td className="px-4 py-3 text-slate-400 text-xs">—</td>
                            <td className="px-4 py-3 text-slate-500 truncate max-w-xs">{summary}</td>
                            <td className="px-4 py-3 text-right font-semibold text-slate-800">
                              {item.paymentType === "pinjam" ? <span className="text-amber-600 text-xs font-medium">Gratis</span> : fmtIdr(item.total)}
                            </td>
                            <td className="px-4 py-3 text-center"><span className="px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">selesai</span></td>
                          </tr>
                        );
                      }

                      if (item.kind === "exchange") {
                        const retSummary = item.returnItems.length === 1 ? `Retur: ${item.returnItems[0]!.quantity}× ${item.returnItems[0]!.productName}` : `Retur: ${item.returnItems.length} produk`;
                        return (
                          <tr key={item.id} onClick={() => setSelected(isSelected ? null : item)} className={`cursor-pointer transition ${isSelected ? "bg-teal-50" : "hover:bg-slate-50"}`}>
                            <td className="px-4 py-3 text-slate-500 whitespace-nowrap text-xs">{fmtDate(item.createdAt)}</td>
                            <td className="px-4 py-3"><span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-teal-100 text-teal-700">Tukar/Retur</span></td>
                            <td className="px-4 py-3">{creatorBadge(item.createdBy, item.operatorId)}</td>
                            <td className="px-4 py-3 font-medium text-slate-800">{customerName}</td>
                            <td className="px-4 py-3 text-slate-500 truncate max-w-xs">{retSummary}</td>
                            <td className="px-4 py-3 text-right font-semibold">
                              {item.diffAmount === 0 ? <span className="text-teal-600 text-xs font-medium">Swap</span> : item.diffAmount > 0 ? <span className="text-green-700">+{fmtIdr(item.diffAmount)}</span> : <span className="text-red-600">{fmtIdr(item.diffAmount)}</span>}
                            </td>
                            <td className="px-4 py-3 text-center"><span className="px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">selesai</span></td>
                          </tr>
                        );
                      }

                      if (item.kind === "membership") return (
                        <tr key={item.id} onClick={() => setSelected(isSelected ? null : item)} className={`cursor-pointer transition ${isSelected ? "bg-blue-50" : "hover:bg-slate-50"}`}>
                          <td className="px-4 py-3 text-slate-500 whitespace-nowrap text-xs">{fmtDate(item.createdAt)}</td>
                          <td className="px-4 py-3"><span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-100 text-blue-700">Membership</span></td>
                          <td className="px-4 py-3">{creatorBadge(item.createdBy ?? null, item.operatorId ?? null)}</td>
                          <td className="px-4 py-3 font-medium text-slate-800">{customerName}</td>
                          <td className="px-4 py-3 text-slate-500 truncate max-w-xs">{item.planName}</td>
                          <td className="px-4 py-3 text-right font-semibold text-slate-800">
                            {item.total != null && item.total > 0 ? fmtIdr(item.total) : <span className="text-slate-300 text-xs">—</span>}
                          </td>
                          <td className="px-4 py-3 text-center">
                            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${item.status === "active" ? "bg-green-100 text-green-700" : item.status === "expired" ? "bg-slate-100 text-slate-500" : item.status === "pending_next" ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-600"}`}>
                              {item.status === "pending_next" ? "antrian" : item.status}
                            </span>
                          </td>
                        </tr>
                      );

                      return null;
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* ── Exchange dialog ── */}
          {exchangeDialog && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
              <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col">
                <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between shrink-0">
                  <h3 className="text-base font-bold text-slate-900">🔄 Tukar / Retur Produk</h3>
                  <button onClick={() => setExchangeDialog(null)} className="text-slate-400 hover:text-slate-700 text-xl leading-none">×</button>
                </div>
                <div className="p-6 space-y-5 overflow-y-auto flex-1 text-sm">
                  <div>
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">1. Produk yang dikembalikan</p>
                    <div className="space-y-2">
                      {exchangeDialog.originalItems.map((item) => {
                        const qty = returnQtys[item.productId] ?? 0;
                        return (
                          <div key={item.productId} className="flex items-center gap-3 bg-slate-50 rounded-lg px-3 py-2">
                            <div className="flex-1 min-w-0">
                              <p className="font-medium text-slate-800 truncate">{item.productName}</p>
                              <p className="text-xs text-slate-400">Dibeli: {item.quantity}× · {fmtIdr(item.unitPrice)}/pcs</p>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <button onClick={() => setReturnQtys((p) => ({ ...p, [item.productId]: Math.max(0, (p[item.productId] ?? 0) - 1) }))} className="w-7 h-7 rounded-full border border-slate-300 text-slate-600 flex items-center justify-center text-sm hover:bg-slate-100">−</button>
                              <span className={`w-6 text-center font-bold text-sm ${qty > 0 ? "text-red-600" : "text-slate-300"}`}>{qty}</span>
                              <button onClick={() => setReturnQtys((p) => ({ ...p, [item.productId]: Math.min(item.quantity, (p[item.productId] ?? 0) + 1) }))} className="w-7 h-7 rounded-full border border-slate-300 text-slate-600 flex items-center justify-center text-sm hover:bg-slate-100">+</button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">2. Produk pengganti (opsional)</p>
                      <div className="flex gap-1">
                        {(Object.keys(TIER_LABELS) as CustomerTier[]).map((tier) => (
                          <button key={tier} onClick={() => { setExchangeTier(tier); setExchangeNewItems((prev) => prev.map((it) => { const prod = ownerProducts.find((p) => p.id === it.productId); if (!prod) return it; return { ...it, unitPrice: prod.prices[tier] ?? prod.prices.retail }; })); }}
                            className={`px-2 py-0.5 rounded text-xs font-semibold transition ${exchangeTier === tier ? "bg-teal-600 text-white" : "bg-slate-100 text-slate-500 hover:bg-slate-200"}`}>
                            {TIER_LABELS[tier]}
                          </button>
                        ))}
                      </div>
                    </div>
                    {exchangeLoadingProducts ? <p className="text-xs text-slate-400">Memuat produk…</p> : (
                      <>
                        {exchangeNewItems.length > 0 && (
                          <div className="space-y-2 mb-3">
                            {exchangeNewItems.map((it, idx) => (
                              <div key={idx} className="flex items-center gap-3 bg-teal-50 rounded-lg px-3 py-2">
                                <div className="flex-1 min-w-0">
                                  <p className="font-medium text-teal-800 truncate">{it.productName}</p>
                                  <p className="text-xs text-teal-500">{fmtIdr(it.unitPrice)}/pcs · {TIER_LABELS[exchangeTier]}</p>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                  <button onClick={() => setExchangeNewItems((p) => p.map((x, i) => i === idx ? { ...x, quantity: Math.max(1, x.quantity - 1) } : x))} className="w-7 h-7 rounded-full border border-teal-300 text-teal-700 flex items-center justify-center text-sm hover:bg-teal-100">−</button>
                                  <span className="w-6 text-center font-bold text-sm text-teal-700">{it.quantity}</span>
                                  <button onClick={() => setExchangeNewItems((p) => p.map((x, i) => i === idx ? { ...x, quantity: x.quantity + 1 } : x))} className="w-7 h-7 rounded-full border border-teal-300 text-teal-700 flex items-center justify-center text-sm hover:bg-teal-100">+</button>
                                  <button onClick={() => setExchangeNewItems((p) => p.filter((_, i) => i !== idx))} className="w-7 h-7 rounded-full border border-red-200 text-red-400 flex items-center justify-center text-xs hover:bg-red-50">✕</button>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                        <select className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white text-slate-700" value=""
                          onChange={(e) => {
                            if (!e.target.value) return;
                            const prod = ownerProducts.find((p) => p.id === e.target.value);
                            if (!prod) return;
                            const unitPrice = prod.prices[exchangeTier] ?? prod.prices.retail;
                            setExchangeNewItems((p) => {
                              const existing = p.findIndex((x) => x.productId === prod.id);
                              if (existing >= 0) return p.map((x, i) => i === existing ? { ...x, quantity: x.quantity + 1, unitPrice } : x);
                              return [...p, { productId: prod.id, productName: prod.name, quantity: 1, unitPrice }];
                            });
                            e.target.value = "";
                          }}>
                          <option value="">+ Tambah produk pengganti…</option>
                          {ownerProducts.map((p) => <option key={p.id} value={p.id}>{p.name} — {fmtIdr(p.prices[exchangeTier] ?? p.prices.retail)} (stok: {p.currentStock})</option>)}
                        </select>
                      </>
                    )}
                  </div>
                  {Object.values(returnQtys).some((q) => q > 0) && (() => {
                    const returnTotal = exchangeDialog.originalItems.reduce((s, it) => s + (returnQtys[it.productId] ?? 0) * it.unitPrice, 0);
                    const newTotal = exchangeNewItems.reduce((s, it) => s + it.quantity * it.unitPrice, 0);
                    const diff = newTotal - returnTotal;
                    return (
                      <div className="bg-slate-50 rounded-xl p-4 space-y-2 text-xs">
                        <p className="font-semibold text-slate-600 mb-1">Ringkasan</p>
                        <div className="flex justify-between text-slate-500"><span>Nilai diretur</span><span className="text-red-500">−{fmtIdr(returnTotal)}</span></div>
                        {newTotal > 0 && <div className="flex justify-between text-slate-500"><span>Nilai produk baru</span><span className="text-green-600">+{fmtIdr(newTotal)}</span></div>}
                        <div className={`flex justify-between font-bold text-sm border-t border-slate-200 pt-2 ${diff === 0 ? "text-slate-700" : diff > 0 ? "text-green-700" : "text-red-600"}`}>
                          <span>{diff === 0 ? "Tukar sama rata" : diff > 0 ? "Pelanggan bayar tambahan" : "Owner kembalikan uang"}</span>
                          <span>{diff === 0 ? "—" : fmtIdr(Math.abs(diff))}</span>
                        </div>
                      </div>
                    );
                  })()}
                  {exchangeError && <div className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{exchangeError}</div>}
                </div>
                <div className="px-6 py-4 border-t border-slate-100 flex gap-3 shrink-0">
                  <button onClick={() => setExchangeDialog(null)} className="flex-1 border border-slate-200 text-slate-600 rounded-xl py-2.5 text-sm font-semibold hover:bg-slate-50 transition">Batal</button>
                  <button onClick={handleExchange} disabled={exchanging || !Object.values(returnQtys).some((q) => q > 0)} className="flex-1 bg-teal-600 text-white rounded-xl py-2.5 text-sm font-semibold hover:bg-teal-700 disabled:opacity-50 transition">
                    {exchanging ? "Memproses…" : "Konfirmasi"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ── Exchange receipt ── */}
          {exchangeReceipt && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
              <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm">
                <div className="px-6 py-5 text-center border-b border-slate-100">
                  <div className="text-3xl mb-2">✅</div>
                  <h3 className="text-base font-bold text-slate-900">Penukaran Berhasil</h3>
                  {exchangeReceipt.customerName && <p className="text-sm text-slate-500 mt-0.5">{exchangeReceipt.customerName}</p>}
                </div>
                <div className="px-6 py-4 space-y-3 text-sm">
                  {exchangeReceipt.returnItems.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-red-400 uppercase mb-1">Diretur</p>
                      {exchangeReceipt.returnItems.map((it, i) => <div key={i} className="flex justify-between text-slate-600 text-xs"><span>{it.quantity}× {it.productName}</span><span>−{fmtIdr(it.subtotal)}</span></div>)}
                    </div>
                  )}
                  {exchangeReceipt.newItems.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-green-500 uppercase mb-1">Produk Baru</p>
                      {exchangeReceipt.newItems.map((it, i) => <div key={i} className="flex justify-between text-slate-600 text-xs"><span>{it.quantity}× {it.productName}</span><span>+{fmtIdr(it.subtotal)}</span></div>)}
                    </div>
                  )}
                  <div className="border-t border-slate-100 pt-3">
                    {exchangeReceipt.diffAmount === 0 ? (
                      <p className="text-center text-teal-700 font-semibold">Tukar sama rata — tidak ada selisih harga</p>
                    ) : exchangeReceipt.diffAmount > 0 ? (
                      <div className="flex justify-between font-bold text-green-700"><span>Pelanggan bayar tambahan</span><span>{fmtIdr(exchangeReceipt.diffAmount)}</span></div>
                    ) : (
                      <div className="flex justify-between font-bold text-red-600"><span>Kembalikan ke pelanggan</span><span>{fmtIdr(Math.abs(exchangeReceipt.diffAmount))}</span></div>
                    )}
                  </div>
                  <p className="text-xs text-slate-300 font-mono text-center">#{exchangeReceipt.exchangeId.slice(0, 12).toUpperCase()}</p>
                </div>
                <div className="px-6 pb-5">
                  <button onClick={() => setExchangeReceipt(null)} className="w-full bg-teal-600 text-white rounded-xl py-2.5 text-sm font-semibold hover:bg-teal-700 transition">Tutup</button>
                </div>
              </div>
            </div>
          )}

          {/* ── Detail panel ── */}
          {selected && (
            <div className="w-80 shrink-0 flex flex-col gap-3">
              <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                <div className={`px-4 py-3 flex items-center justify-between ${
                  selected.kind === "product"      ? "bg-green-600" :
                  selected.kind === "debt_payment" ? "bg-amber-500" :
                  selected.kind === "transfer"     ? "bg-purple-600" :
                  selected.kind === "exchange"     ? "bg-teal-600" :
                  "bg-blue-600"
                }`}>
                  <div>
                    <p className="text-sm font-bold text-white">
                      {selected.kind === "product" ? "Penjualan Produk" : selected.kind === "debt_payment" ? "Cicilan Utang" : selected.kind === "transfer" ? "Transfer Masuk" : selected.kind === "exchange" ? "Tukar / Retur Produk" : "Aktivasi Membership"}
                    </p>
                    <p className="text-xs text-white/70 mt-0.5">{fmtDate(selected.createdAt)}</p>
                  </div>
                  <button onClick={() => setSelected(null)} className="text-white/60 hover:text-white text-xl leading-none">×</button>
                </div>

                <div className="p-4 space-y-4 text-sm">
                  {selected.kind !== "transfer" && selected.kind !== "exchange" && (
                    <div>
                      <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">Pelanggan</p>
                      {selected.customerId ? (
                        <Link href={`/customers/${selected.customerId}`} className="font-semibold text-blue-600 hover:underline">
                          {customers[selected.customerId] ?? selected.customerId}
                        </Link>
                      ) : (() => {
                        const wi = selected.kind === "product" ? parseWalkIn(selected.notes) : { isWalkIn: false, name: null };
                        return wi.isWalkIn ? (
                          <p className="font-semibold text-slate-700">🚶 {wi.name ? `Walk-in: ${wi.name}` : "Walk-in"}<span className="ml-1.5 text-xs font-normal text-slate-400">(tanpa akun)</span></p>
                        ) : <p className="text-slate-400 text-sm">Tanpa pelanggan</p>;
                      })()}
                    </div>
                  )}

                  <div>
                    <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">Dibuat oleh</p>
                    {creatorBadge(selected.createdBy ?? null, selected.operatorId ?? null)}
                  </div>

                  {selected.kind === "product" && (
                    <>
                      <div>
                        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Item</p>
                        <div className="space-y-1.5">
                          {selected.items?.map((item, i) => (
                            <div key={i} className="flex justify-between text-slate-700">
                              <span className="flex-1 mr-2">{item.quantity}× {item.productName}</span>
                              <span className="font-medium shrink-0">{fmtIdr(item.subtotal)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                      <div className="border-t border-slate-100 pt-3 space-y-1.5">
                        <div className="flex justify-between font-bold text-slate-800"><span>Total</span><span>{fmtIdr(selected.total)}</span></div>
                        <div className="flex justify-between text-slate-500"><span>Dibayar</span><span>{fmtIdr(selected.amountPaid)}</span></div>
                        {selected.debtId && (debtRemaining[selected.debtId] ?? 0) > 0 ? (
                          <div className="flex justify-between text-amber-600 font-semibold"><span>Utang</span><span>{fmtIdr(debtRemaining[selected.debtId] ?? 0)}</span></div>
                        ) : (
                          <div className="flex justify-between text-slate-500"><span>Kembalian</span><span>{fmtIdr(selected.change)}</span></div>
                        )}
                        <div className="flex justify-between text-slate-500"><span>Metode</span><span className="capitalize">{selected.paymentMethod === "cash" ? "Tunai" : "Transfer"}</span></div>
                      </div>
                      {(() => {
                        if (!selected.notes) return null;
                        const wi = parseWalkIn(selected.notes);
                        const dotIdx = selected.notes.indexOf(" · ");
                        const extraNote = wi.isWalkIn && dotIdx >= 0 ? selected.notes.slice(dotIdx + 3) : wi.isWalkIn ? null : selected.notes;
                        if (!extraNote) return null;
                        return <div className="bg-slate-50 rounded-lg px-3 py-2 text-slate-600 text-xs">{extraNote}</div>;
                      })()}
                    </>
                  )}

                  {selected.kind === "debt_payment" && (
                    <div className="space-y-1.5">
                      <div className="flex justify-between text-slate-700"><span className="text-slate-400">Untuk</span><span className="font-semibold text-right">{selected.referenceLabel}</span></div>
                      <div className="border-t border-slate-100 pt-2 space-y-1.5">
                        <div className="flex justify-between font-bold text-slate-800"><span>Dibayar</span><span className="text-amber-700">{fmtIdr(selected.amountPaid)}</span></div>
                        <div className="flex justify-between text-slate-500"><span>Metode</span><span>{selected.paymentMethod === "cash" ? "Tunai" : "Transfer"}</span></div>
                        {selected.debtId && (
                          <div className="flex justify-between text-slate-500"><span>Sisa utang</span>
                            <span className={`font-semibold ${(debtRemaining[selected.debtId] ?? 0) > 0 ? "text-amber-600" : "text-green-600"}`}>
                              {(debtRemaining[selected.debtId] ?? 0) > 0 ? fmtIdr(debtRemaining[selected.debtId]!) : "Lunas ✓"}
                            </span>
                          </div>
                        )}
                      </div>
                      {selected.notes && <div className="bg-slate-50 rounded-lg px-3 py-2 text-slate-600 text-xs mt-1">{selected.notes}</div>}
                    </div>
                  )}

                  {selected.kind === "transfer" && (
                    <>
                      <div><p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">Asal Transfer</p><p className="text-sm font-medium text-slate-700">{selected.sourceLabel}</p></div>
                      <div>
                        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Item</p>
                        <div className="space-y-1.5">
                          {selected.items.map((it, i) => (
                            <div key={i} className="flex justify-between text-slate-700">
                              <span className="flex-1 mr-2">{it.quantity}× {it.productName}</span>
                              {selected.paymentType === "bayar" && <span className="font-medium shrink-0">{fmtIdr(it.subtotal)}</span>}
                            </div>
                          ))}
                        </div>
                      </div>
                      <div className="border-t border-slate-100 pt-3 space-y-1.5">
                        <div className="flex justify-between text-slate-500"><span>Jenis</span><span className={`font-semibold ${selected.paymentType === "pinjam" ? "text-amber-600" : "text-blue-600"}`}>{selected.paymentType === "bayar" ? "Bayar" : "Pinjam (Gratis)"}</span></div>
                        {selected.paymentType === "bayar" && <>
                          <div className="flex justify-between text-slate-500"><span>Tier Harga</span><span className="font-medium uppercase">{selected.priceTier}</span></div>
                          <div className="flex justify-between font-bold text-slate-800"><span>Total</span><span>{fmtIdr(selected.total)}</span></div>
                        </>}
                      </div>
                      {selected.notes && <div className="bg-slate-50 rounded-lg px-3 py-2 text-slate-600 text-xs">{selected.notes}</div>}
                    </>
                  )}

                  {selected.kind === "membership" && (
                    <div className="space-y-1.5 text-sm">
                      <div className="flex justify-between text-slate-700"><span className="text-slate-400">Paket</span><span className="font-semibold">{selected.planName}</span></div>
                      {selected.tier && <div className="flex justify-between text-slate-700"><span className="text-slate-400">Tier</span><span className="capitalize">{selected.tier}</span></div>}
                      {selected.planType !== "locker" && <>
                        <div className="flex justify-between text-slate-700"><span className="text-slate-400">Kuota</span><span>{selected.visitQuota}× kunjungan</span></div>
                        <div className="flex justify-between text-slate-700"><span className="text-slate-400">Durasi</span><span>{selected.hasExpiry && selected.durationDays ? `${selected.durationDays} hari` : "Tidak ada expired"}</span></div>
                        {selected.expiresAt && <div className="flex justify-between text-slate-700"><span className="text-slate-400">Kadaluarsa</span><span>{fmtDateShort(selected.expiresAt)}</span></div>}
                      </>}
                      <div className="flex justify-between text-slate-700"><span className="text-slate-400">Status</span>
                        <span className={`font-semibold ${selected.status === "active" ? "text-green-600" : selected.status === "expired" ? "text-slate-400" : "text-amber-600"}`}>
                          {selected.status === "pending_next" ? "Antrian" : selected.status}
                        </span>
                      </div>
                      {selected.total != null && selected.total > 0 && (
                        <div className="border-t border-slate-100 pt-2 space-y-1.5 mt-2">
                          <div className="flex justify-between font-bold text-slate-800"><span>Total</span><span>{fmtIdr(selected.total)}</span></div>
                          {selected.amountPaid != null && <div className="flex justify-between text-slate-500"><span>Dibayar</span><span>{fmtIdr(selected.amountPaid)}</span></div>}
                          {selected.paymentMethod && <div className="flex justify-between text-slate-500"><span>Metode</span><span>{selected.paymentMethod === "cash" ? "Tunai" : "Transfer"}</span></div>}
                        </div>
                      )}
                      {selected.debtId && (debtRemaining[selected.debtId] ?? 0) > 0 && (
                        <div className="mt-2 px-3 py-2 bg-amber-50 rounded-lg text-amber-700 text-xs font-medium">Ada utang — cek tab Utang di profil pelanggan</div>
                      )}
                    </div>
                  )}

                  {selected.kind === "exchange" && (
                    <>
                      {selected.customerId && (
                        <div><p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">Pelanggan</p>
                          <Link href={`/customers/${selected.customerId}`} className="font-semibold text-blue-600 hover:underline">{customers[selected.customerId] ?? selected.customerId}</Link>
                        </div>
                      )}
                      <div><p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">Transaksi Asal</p><p className="text-xs text-slate-500 font-mono">#{selected.originalTransactionId.slice(0, 12).toUpperCase()}</p></div>
                      {selected.returnItems.length > 0 && (
                        <div>
                          <p className="text-xs font-semibold text-red-400 uppercase tracking-wide mb-1.5">↩ Diretur</p>
                          <div className="space-y-1">{selected.returnItems.map((it, i) => <div key={i} className="flex justify-between text-slate-700 text-xs"><span>{it.quantity}× {it.productName}</span><span className="text-red-500">−{fmtIdr(it.subtotal)}</span></div>)}</div>
                        </div>
                      )}
                      {selected.newItems.length > 0 && (
                        <div>
                          <p className="text-xs font-semibold text-green-500 uppercase tracking-wide mb-1.5">↪ Produk Baru</p>
                          <div className="space-y-1">{selected.newItems.map((it, i) => <div key={i} className="flex justify-between text-slate-700 text-xs"><span>{it.quantity}× {it.productName}</span><span className="text-green-600">+{fmtIdr(it.subtotal)}</span></div>)}</div>
                        </div>
                      )}
                      <div className="border-t border-slate-100 pt-3 space-y-1.5">
                        <div className="flex justify-between text-slate-500 text-xs"><span>Nilai retur</span><span className="text-red-500">{fmtIdr(selected.returnTotal)}</span></div>
                        {selected.newItems.length > 0 && <div className="flex justify-between text-slate-500 text-xs"><span>Nilai produk baru</span><span className="text-green-600">{fmtIdr(selected.newTotal)}</span></div>}
                        <div className={`flex justify-between font-bold text-sm ${selected.diffAmount === 0 ? "text-slate-600" : selected.diffAmount > 0 ? "text-green-700" : "text-red-600"}`}>
                          <span>{selected.diffAmount === 0 ? "Swap (tidak ada selisih)" : selected.diffAmount > 0 ? "Pelanggan bayar tambahan" : "Owner kembalikan"}</span>
                          <span>{selected.diffAmount === 0 ? "—" : fmtIdr(Math.abs(selected.diffAmount))}</span>
                        </div>
                      </div>
                      {selected.notes && <div className="bg-slate-50 rounded-lg px-3 py-2 text-slate-600 text-xs">{selected.notes}</div>}
                    </>
                  )}

                  {selected.kind === "product" && selected.status === "completed" && (
                    <div className="border-t border-slate-100 pt-3 flex flex-col gap-2">
                      {selected.createdBy === "owner" && !(selected as unknown as Record<string, unknown>)["hasExchange"] && (
                        <button
                          onClick={() => { setReturnQtys({}); setExchangeNewItems([]); setExchangeError(""); setExchangeDialog({ transactionId: selected.id, originalItems: selected.items ?? [], customerId: selected.customerId }); }}
                          className="w-full border border-teal-300 text-teal-700 rounded-lg py-2 text-xs font-semibold hover:bg-teal-50 transition"
                        >
                          🔄 Tukar / Retur Produk
                        </button>
                      )}
                      <button onClick={() => setReverseDialog({ transactionId: selected.id, total: selected.total })} className="w-full border border-red-200 text-red-600 rounded-lg py-2 text-xs font-semibold hover:bg-red-50 transition">
                        Batalkan Transaksi
                      </button>
                    </div>
                  )}

                  <p className="text-xs text-slate-300 font-mono pt-1">#{selected.id.slice(0, 12).toUpperCase()}</p>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          TAB: UTANG
          ══════════════════════════════════════════════════════════════════ */}
      {mainTab === "utang" && (
        <div className="flex-1 overflow-y-auto">

          {/* Pay dialog */}
          {payDialog && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
              <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm mx-4">
                <h3 className="text-base font-bold text-slate-900 mb-1">Catat Pembayaran Utang</h3>
                <p className="text-sm text-slate-500 mb-1">{payDialog.label}</p>
                <p className="text-sm text-slate-400 mb-4">{debtCustomers.get(payDialog.customerId)?.displayName ?? ""}</p>
                <div className="bg-slate-50 rounded-xl p-3 mb-4 flex justify-between text-sm">
                  <span className="text-slate-500">Sisa utang</span>
                  <span className="font-bold text-red-600">{fmtIdr(payDialog.remaining)}</span>
                </div>
                {payError && <div className="mb-3 text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{payError}</div>}
                <div className="space-y-3">
                  <div>
                    <label className="text-xs text-slate-500 block mb-1">Jumlah Bayar</label>
                    <input type="number" min="1" max={payDialog.remaining} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} />
                  </div>
                  <div>
                    <label className="text-xs text-slate-500 block mb-1">Metode</label>
                    <div className="flex gap-2">
                      {(["cash", "transfer"] as const).map((m) => (
                        <button key={m} onClick={() => setPayMethod(m)} className={`flex-1 py-2 rounded-lg text-sm font-medium border transition ${payMethod === m ? "border-blue-500 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-500"}`}>
                          {m === "cash" ? "Tunai" : "Transfer"}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-slate-500 block mb-1">Catatan (opsional)</label>
                    <input className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" placeholder="Catatan pembayaran" value={payNotes} onChange={(e) => setPayNotes(e.target.value)} />
                  </div>
                </div>
                <div className="flex gap-3 mt-5">
                  <button onClick={() => { setPayDialog(null); setPayError(""); }} className="flex-1 border border-slate-200 text-slate-600 rounded-xl py-2.5 text-sm font-semibold hover:bg-slate-50 transition">Batal</button>
                  <button onClick={handlePay} disabled={paying || !payAmount || parseFloat(payAmount) <= 0} className="flex-1 bg-blue-600 text-white rounded-xl py-2.5 text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition">
                    {paying ? "Menyimpan…" : "Simpan"}
                  </button>
                </div>
              </div>
            </div>
          )}

          <div className="mb-6 flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-slate-900">Utang Piutang</h1>
              <p className="text-sm text-slate-500 mt-0.5">Tagihan dari pembayaran membership parsial</p>
            </div>
            <button onClick={loadDebts} className="text-xs text-blue-600 hover:underline">Refresh</button>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 p-5 mb-6 flex items-center gap-8">
            <div>
              <p className="text-xs text-slate-500 uppercase tracking-wide">Total Belum Lunas</p>
              <p className="text-2xl font-bold text-red-600 mt-0.5">{fmtIdr(totalOutstanding)}</p>
            </div>
            <div className="h-10 w-px bg-slate-200" />
            <div>
              <p className="text-xs text-slate-500 uppercase tracking-wide">Tagihan Aktif</p>
              <p className="text-2xl font-bold text-slate-800 mt-0.5">{activeDebtCount}</p>
            </div>
          </div>

          <div className="flex gap-2 mb-4">
            {([
              { key: "all",         label: "Belum Lunas" },
              { key: "unpaid",      label: "Belum Bayar" },
              { key: "partial",     label: "Sebagian" },
              { key: "paid",        label: "Lunas" },
            ] as { key: DebtStatusFilter; label: string }[]).map((f) => (
              <button key={f.key} onClick={() => setDebtStatusFilter(f.key)}
                className={`px-4 py-1.5 rounded-full text-sm font-medium border transition ${debtStatusFilter === f.key ? "bg-slate-800 text-white border-slate-800" : "border-slate-200 text-slate-500 hover:border-slate-400"}`}>
                {f.label}
              </button>
            ))}
          </div>

          {debtsLoading ? (
            <p className="text-sm text-slate-400">Memuat…</p>
          ) : filteredDebts.length === 0 ? (
            <div className="bg-white rounded-xl border border-slate-200 p-8 text-center">
              <p className="text-slate-400">{debtStatusFilter === "paid" ? "Tidak ada utang yang sudah lunas." : "Tidak ada utang yang belum lunas."}</p>
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-500 text-xs">
                  <tr>
                    <th className="px-4 py-2.5 text-left">Pelanggan</th>
                    <th className="px-4 py-2.5 text-left">Paket</th>
                    <th className="px-4 py-2.5 text-right">Total</th>
                    <th className="px-4 py-2.5 text-right">Terbayar</th>
                    <th className="px-4 py-2.5 text-right">Sisa</th>
                    <th className="px-4 py-2.5 text-center">Status</th>
                    <th className="px-4 py-2.5 text-left">Tgl</th>
                    <th className="px-4 py-2.5 text-center">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredDebts.map((debt) => {
                    const cust = debtCustomers.get(debt.customerId);
                    return (
                      <tr key={debt.id} className="hover:bg-slate-50">
                        <td className="px-4 py-3">
                          <Link href={`/customers/${debt.customerId}`} className="font-medium text-slate-800 hover:text-blue-600 transition">
                            {cust?.displayName ?? debt.customerId.slice(0, 8)}
                          </Link>
                          {cust?.phone && <p className="text-xs text-slate-400">{cust.phone}</p>}
                        </td>
                        <td className="px-4 py-3 text-slate-600">{debt.referenceLabel}</td>
                        <td className="px-4 py-3 text-right font-mono text-slate-700 text-xs">{fmtIdr(debt.totalAmount)}</td>
                        <td className="px-4 py-3 text-right font-mono text-green-700 text-xs">{fmtIdr(debt.paidAmount)}</td>
                        <td className="px-4 py-3 text-right font-mono font-bold text-red-600">{fmtIdr(debt.remainingAmount)}</td>
                        <td className="px-4 py-3 text-center">
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${debt.status === "paid" ? "bg-green-50 text-green-700" : debt.status === "partial" ? "bg-amber-50 text-amber-700" : "bg-red-50 text-red-600"}`}>
                            {debt.status === "paid" ? "Lunas" : debt.status === "partial" ? "Sebagian" : "Belum Bayar"}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-slate-400 text-xs">{debt.createdAt.slice(0, 10)}</td>
                        <td className="px-4 py-3 text-center">
                          {debt.status !== "paid" && (
                            <button
                              onClick={() => { setPayDialog({ debtId: debt.id, remaining: debt.remainingAmount, label: debt.referenceLabel, customerId: debt.customerId }); setPayAmount(String(debt.remainingAmount)); setPayMethod("cash"); setPayNotes(""); setPayError(""); }}
                              className="px-3 py-1 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition font-medium"
                            >
                              Bayar
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          TAB: JURNAL
          ══════════════════════════════════════════════════════════════════ */}
      {mainTab === "jurnal" && (
        <div className="flex-1 overflow-y-auto">
          <h2 className="text-2xl font-bold text-slate-900 mb-6">Jurnal Keuangan</h2>

          {/* Filter bar */}
          <div className="bg-white rounded-xl border border-slate-200 p-4 mb-6">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex rounded-lg border border-slate-200 overflow-hidden text-sm">
                {JOURNAL_PRESETS.map(({ key, label }) => (
                  <button key={key} onClick={() => applyJournalPreset(key)}
                    className={`px-3 py-1.5 font-medium transition ${journalPreset === key ? "bg-blue-600 text-white" : "text-slate-500 hover:bg-slate-50"}`}>
                    {label}
                  </button>
                ))}
              </div>
              {journalPreset === "custom" && (
                <div className="flex items-center gap-2">
                  <input type="date" value={journalFrom} onChange={(e) => setJournalFrom(e.target.value)} className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm" />
                  <span className="text-slate-400 text-sm">–</span>
                  <input type="date" value={journalTo} onChange={(e) => setJournalTo(e.target.value)} className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm" />
                </div>
              )}
              <button onClick={loadEntries} className="text-xs text-blue-600 hover:underline ml-auto">Refresh</button>
            </div>
            {availableTypes.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t border-slate-100 items-center">
                <span className="text-xs text-slate-400">Filter tipe:</span>
                {availableTypes.map((t) => (
                  <button key={t} onClick={() => setJournalTypeFilter((prev) => prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t])}
                    className={`text-xs px-2.5 py-1 rounded-full font-medium border transition ${journalTypeFilter.includes(t) ? "bg-blue-600 text-white border-blue-600" : "border-slate-200 text-slate-500 hover:border-slate-300"}`}>
                    {ENTRY_TYPE_LABELS[t] ?? t}
                  </button>
                ))}
                {journalTypeFilter.length > 0 && <button onClick={() => setJournalTypeFilter([])} className="text-xs text-red-500 hover:underline">Reset</button>}
              </div>
            )}
          </div>

          {/* KPI cards */}
          {!journalLoading && (
            <div className="grid grid-cols-4 gap-4 mb-6">
              {[
                { label: "Total Pendapatan",  value: fmtIdr(kpi.revenue),  color: "border-t-green-500",  sub: "kredit akun revenue" },
                { label: "Total Pengeluaran", value: fmtIdr(kpi.expense),  color: "border-t-red-500",    sub: "debit akun beban" },
                { label: "Laba Kotor",        value: fmtIdr(kpi.profit),   color: "border-t-blue-500",   sub: "pendapatan − pengeluaran" },
                { label: "Net Kas",           value: fmtIdr(kpi.netCash),  color: "border-t-indigo-500", sub: "kas masuk − keluar" },
              ].map((c) => (
                <div key={c.label} className={`bg-white rounded-xl border border-slate-200 border-t-2 p-5 ${c.color}`}>
                  <p className="text-xs text-slate-400 mb-1">{c.label}</p>
                  <p className={`text-lg font-bold ${c.label === "Laba Kotor" && kpi.profit < 0 ? "text-red-600" : "text-slate-900"}`}>{c.value}</p>
                  <p className="text-xs text-slate-400 mt-1">{c.sub}</p>
                </div>
              ))}
            </div>
          )}

          {/* Trial balance */}
          {!journalLoading && trialBalance.length > 0 && (
            <div className="bg-white rounded-xl border border-slate-200 mb-6 overflow-hidden">
              <button className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-50 transition text-left" onClick={() => setShowBalance((v) => !v)}>
                <h3 className="font-semibold text-slate-800 text-sm">Neraca Saldo — {journalFrom} s/d {journalTo}</h3>
                <span className="text-slate-400 text-xs">{showBalance ? "▲ Tutup" : "▼ Lihat"}</span>
              </button>
              {showBalance && (
                <table className="w-full text-sm border-t border-slate-100">
                  <thead className="bg-slate-50 text-slate-500 text-xs">
                    <tr>
                      <th className="px-4 py-2 text-left">Akun</th>
                      <th className="px-4 py-2 text-right">Total Debit</th>
                      <th className="px-4 py-2 text-right">Total Kredit</th>
                      <th className="px-4 py-2 text-right">Saldo</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {trialBalance.map((row) => (
                      <tr key={row.code} className="hover:bg-slate-50">
                        <td className="px-4 py-2.5"><span className="font-mono text-xs text-slate-400 mr-2">{row.code}</span><span className="text-slate-700 font-medium">{row.name}</span></td>
                        <td className="px-4 py-2.5 text-right text-blue-600 font-medium">{fmtIdr(row.debit)}</td>
                        <td className="px-4 py-2.5 text-right text-green-600 font-medium">{fmtIdr(row.credit)}</td>
                        <td className={`px-4 py-2.5 text-right font-bold ${row.balance < 0 ? "text-red-600" : "text-slate-800"}`}>
                          {row.balance < 0 ? `(${fmtIdr(Math.abs(row.balance))})` : fmtIdr(row.balance)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* Journal table */}
          <div className="bg-white rounded-xl border border-slate-200 mb-8 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
              <h3 className="font-semibold text-slate-800">
                Jurnal <span className="text-slate-400 font-normal text-sm">({journalEntries.length} entri{allEntries.length === 200 && " — limit 200, perkecil rentang tanggal"})</span>
              </h3>
              <button onClick={() => downloadCsv(journalEntries, journalFrom, journalTo)} className="text-xs text-blue-600 hover:text-blue-800 font-medium border border-blue-200 rounded-lg px-3 py-1.5 hover:bg-blue-50 transition">
                Export CSV
              </button>
            </div>
            {journalLoading ? (
              <p className="text-sm text-slate-400 p-4">Memuat…</p>
            ) : journalEntries.length === 0 ? (
              <p className="text-sm text-slate-400 p-4">Tidak ada entri untuk periode dan filter ini.</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-500 text-xs">
                  <tr>
                    <th className="px-4 py-2 text-left">Tanggal</th>
                    <th className="px-4 py-2 text-left">Tipe</th>
                    <th className="px-4 py-2 text-left">Debit</th>
                    <th className="px-4 py-2 text-left">Kredit</th>
                    <th className="px-4 py-2 text-right">Jumlah</th>
                    <th className="px-4 py-2 text-left">Deskripsi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {journalEntries.map((e) => (
                    <tr key={e.id} className="hover:bg-slate-50">
                      <td className="px-4 py-2 text-slate-400 text-xs whitespace-nowrap">{e.createdAt?.slice(0, 16).replace("T", " ")}</td>
                      <td className="px-4 py-2"><span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ENTRY_TYPE_STYLE[e.entryType] ?? "bg-slate-100 text-slate-600"}`}>{ENTRY_TYPE_LABELS[e.entryType] ?? e.entryType}</span></td>
                      <td className="px-4 py-2 text-blue-700 text-xs font-medium whitespace-nowrap">{ACCOUNT_NAMES[e.debitAccount] ?? e.debitAccount}</td>
                      <td className="px-4 py-2 text-green-700 text-xs font-medium whitespace-nowrap">{ACCOUNT_NAMES[e.creditAccount] ?? e.creditAccount}</td>
                      <td className="px-4 py-2 text-right font-semibold text-slate-800 whitespace-nowrap">{fmtIdr(e.amount)}</td>
                      <td className="px-4 py-2 text-slate-500 text-xs max-w-xs truncate">{e.description}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t-2 border-slate-200 bg-slate-50">
                  <tr>
                    <td colSpan={4} className="px-4 py-2.5 text-xs font-semibold text-slate-600 text-right">Total ({journalEntries.length} entri)</td>
                    <td className="px-4 py-2.5 text-right font-bold text-slate-900">{fmtIdr(journalEntries.reduce((s, e) => s + e.amount, 0))}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            )}
          </div>

          {/* Manual entry form */}
          <div className="max-w-md bg-white rounded-xl border border-slate-200 p-6">
            <h3 className="font-semibold text-slate-800 mb-1">Entri Jurnal Manual</h3>
            <p className="text-xs text-slate-400 mb-4">Untuk penyesuaian dan koreksi di luar sistem otomatis.</p>
            {entryFeedback && (
              <div className={`mb-4 text-sm rounded-lg px-4 py-3 ${entryFeedback.type === "ok" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"}`}>
                {entryFeedback.msg}
              </div>
            )}
            <div className="space-y-3">
              <div>
                <span className="text-xs text-slate-500 block mb-1.5">Tipe Entri</span>
                <div className="flex flex-wrap gap-2">
                  {MANUAL_ENTRY_TYPES.map(({ key, label }) => (
                    <button key={key} onClick={() => setEntryType(key)}
                      className={`text-xs px-3 py-1.5 rounded-full font-medium border transition ${entryType === key ? "bg-blue-600 text-white border-blue-600" : "border-slate-200 text-slate-500 hover:border-slate-300"}`}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-xs text-slate-500">Debit</span>
                  <select className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" value={debitAccount} onChange={(e) => setDebitAccount(e.target.value as AccountCode)}>
                    {ACCOUNT_OPTIONS.map((a) => <option key={a.code} value={a.code}>{a.label}</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className="text-xs text-slate-500">Kredit</span>
                  <select className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" value={creditAccount} onChange={(e) => setCreditAccount(e.target.value as AccountCode)}>
                    {ACCOUNT_OPTIONS.map((a) => <option key={a.code} value={a.code}>{a.label}</option>)}
                  </select>
                </label>
              </div>
              <label className="block">
                <span className="text-xs text-slate-500">Jumlah (Rp)</span>
                <input type="number" placeholder="0" className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" value={entryAmount} onChange={(e) => setEntryAmount(e.target.value)} />
              </label>
              <label className="block">
                <span className="text-xs text-slate-500">Deskripsi</span>
                <input type="text" placeholder="Keterangan entri jurnal" className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" value={entryDescription} onChange={(e) => setEntryDescription(e.target.value)} />
              </label>
              <button onClick={handleCreateEntry} disabled={entrySaving} className="w-full bg-blue-600 text-white rounded-lg py-2.5 text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition">
                {entrySaving ? "Menyimpan…" : "Simpan Entri"}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
