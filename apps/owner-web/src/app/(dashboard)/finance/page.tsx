"use client";

import { useEffect, useState, useMemo } from "react";
import { collection, getDocs, query, orderBy, limit, where } from "firebase/firestore";
import { useOwnerAuthStore } from "@/store/auth.store";
import { callFunction, firebaseDb } from "@/firebase/firebase";
import { v4 as uuidv4 } from "uuid";

// ── Types ────────────────────────────────────────────────────────────────────

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

// ── Lookup tables ─────────────────────────────────────────────────────────────

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

const REVENUE_CREDITS  = new Set(["4001", "4002", "SALES_REVENUE", "MEMBERSHIP_REVENUE"]);
const EXPENSE_DEBITS   = new Set(["5001", "6001", "COGS", "OPERATING_EXPENSE"]);
const CASH_ACCOUNTS    = new Set(["1001", "CASH"]);

// ── Date helpers ──────────────────────────────────────────────────────────────

function isoDate(d: Date) { return d.toISOString().slice(0, 10); }
function startOfDay(date: string) { return `${date}T00:00:00.000Z`; }
function endOfDay(date: string)   { return `${date}T23:59:59.999Z`; }

function presetDates(p: DatePreset): { from: string; to: string } {
  const today = new Date();
  const todayStr = isoDate(today);
  if (p === "today") return { from: todayStr, to: todayStr };
  if (p === "7d") {
    const d = new Date(today); d.setDate(d.getDate() - 6);
    return { from: isoDate(d), to: todayStr };
  }
  if (p === "30d") {
    const d = new Date(today); d.setDate(d.getDate() - 29);
    return { from: isoDate(d), to: todayStr };
  }
  if (p === "month") {
    const d = new Date(today.getFullYear(), today.getMonth(), 1);
    return { from: isoDate(d), to: todayStr };
  }
  return { from: todayStr, to: todayStr };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmt = (n: number) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);

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

export default function FinancePage() {
  const { ownerId, clubId } = useOwnerAuthStore();

  // Filter
  const [preset, setPreset]         = useState<DatePreset>("30d");
  const [fromDate, setFromDate]     = useState(() => presetDates("30d").from);
  const [toDate, setToDate]         = useState(() => presetDates("30d").to);
  const [typeFilter, setTypeFilter] = useState<string[]>([]);
  const [showBalance, setShowBalance] = useState(false);

  // Data
  const [allEntries, setAllEntries] = useState<JournalEntry[]>([]);
  const [loading, setLoading]       = useState(true);

  // Manual entry form
  const [entryType, setEntryType]       = useState<ManualEntryType>("adjustment");
  const [debitAccount, setDebitAccount] = useState<AccountCode>("1001");
  const [creditAccount, setCreditAccount] = useState<AccountCode>("4001");
  const [amount, setAmount]         = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving]         = useState(false);
  const [feedback, setFeedback]     = useState<{ type: "ok" | "err"; msg: string } | undefined>();

  useEffect(() => { if (ownerId && clubId) loadEntries(); }, [ownerId, clubId, fromDate, toDate]);

  async function loadEntries() {
    setLoading(true);
    try {
      const snap = await getDocs(
        query(
          collection(firebaseDb(), `owners/${ownerId}/clubs/${clubId}/financeJournal`),
          where("createdAt", ">=", startOfDay(fromDate)),
          where("createdAt", "<=", endOfDay(toDate)),
          orderBy("createdAt", "desc"),
          limit(200)
        )
      );
      setAllEntries(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<JournalEntry, "id">) })));
    } finally {
      setLoading(false);
    }
  }

  function applyPreset(p: DatePreset) {
    setPreset(p);
    if (p !== "custom") {
      const { from, to } = presetDates(p);
      setFromDate(from);
      setToDate(to);
    }
  }

  // Filtered entries (type filter is client-side)
  const entries = useMemo(
    () => typeFilter.length === 0 ? allEntries : allEntries.filter((e) => typeFilter.includes(e.entryType)),
    [allEntries, typeFilter]
  );

  const availableTypes = useMemo(() => Array.from(new Set(allEntries.map((e) => e.entryType))).sort(), [allEntries]);

  // KPIs
  const kpi = useMemo(() => {
    let revenue = 0, expense = 0, cashIn = 0, cashOut = 0;
    entries.forEach((e) => {
      if (REVENUE_CREDITS.has(e.creditAccount)) revenue += e.amount;
      if (EXPENSE_DEBITS.has(e.debitAccount))   expense += e.amount;
      if (CASH_ACCOUNTS.has(e.debitAccount))    cashIn  += e.amount;
      if (CASH_ACCOUNTS.has(e.creditAccount))   cashOut += e.amount;
    });
    return { revenue, expense, profit: revenue - expense, netCash: cashIn - cashOut };
  }, [entries]);

  // Trial balance
  const trialBalance = useMemo(() => {
    const bal: Record<string, { debit: number; credit: number }> = {};
    entries.forEach((e) => {
      bal[e.debitAccount]  ??= { debit: 0, credit: 0 };
      bal[e.creditAccount] ??= { debit: 0, credit: 0 };
      bal[e.debitAccount]!.debit  += e.amount;
      bal[e.creditAccount]!.credit += e.amount;
    });
    return Object.entries(bal)
      .map(([code, { debit, credit }]) => ({
        code, name: ACCOUNT_NAMES[code] ?? code, debit, credit, balance: debit - credit,
      }))
      .sort((a, b) => a.code.localeCompare(b.code));
  }, [entries]);

  async function handleCreateEntry() {
    const amt = parseFloat(amount);
    if (!description || isNaN(amt) || amt <= 0) {
      setFeedback({ type: "err", msg: "Isi deskripsi dan jumlah yang valid" });
      return;
    }
    if (debitAccount === creditAccount) {
      setFeedback({ type: "err", msg: "Akun debit dan kredit tidak boleh sama" });
      return;
    }
    setSaving(true);
    setFeedback(undefined);
    try {
      await callFunction("finance_createJournalEntry", {
        ownerId, clubId,
        requestId: uuidv4(),
        operationId: uuidv4(),
        entryType,
        debitAccount,
        creditAccount,
        amount: amt,
        description,
      });
      setFeedback({ type: "ok", msg: "Entri berhasil dicatat" });
      setAmount(""); setDescription("");
      loadEntries();
    } catch (err) {
      setFeedback({ type: "err", msg: err instanceof Error ? err.message : "Gagal" });
    } finally { setSaving(false); }
  }

  const PRESETS: { key: DatePreset; label: string }[] = [
    { key: "today", label: "Hari Ini" },
    { key: "7d",    label: "7 Hari"  },
    { key: "30d",   label: "30 Hari" },
    { key: "month", label: "Bulan Ini" },
    { key: "custom", label: "Custom" },
  ];

  return (
    <div>
      <h2 className="text-2xl font-bold text-slate-900 mb-6">Keuangan</h2>

      {/* ── Filter bar ── */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 mb-6">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex rounded-lg border border-slate-200 overflow-hidden text-sm">
            {PRESETS.map(({ key, label }) => (
              <button
                key={key}
                onClick={() => applyPreset(key)}
                className={`px-3 py-1.5 font-medium transition ${
                  preset === key ? "bg-blue-600 text-white" : "text-slate-500 hover:bg-slate-50"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {preset === "custom" && (
            <div className="flex items-center gap-2">
              <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)}
                className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm" />
              <span className="text-slate-400 text-sm">–</span>
              <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)}
                className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm" />
            </div>
          )}

          <button onClick={loadEntries} className="text-xs text-blue-600 hover:underline ml-auto">
            Refresh
          </button>
        </div>

        {availableTypes.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t border-slate-100 items-center">
            <span className="text-xs text-slate-400">Filter tipe:</span>
            {availableTypes.map((t) => (
              <button
                key={t}
                onClick={() => setTypeFilter((prev) =>
                  prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]
                )}
                className={`text-xs px-2.5 py-1 rounded-full font-medium border transition ${
                  typeFilter.includes(t)
                    ? "bg-blue-600 text-white border-blue-600"
                    : "border-slate-200 text-slate-500 hover:border-slate-300"
                }`}
              >
                {ENTRY_TYPE_LABELS[t] ?? t}
              </button>
            ))}
            {typeFilter.length > 0 && (
              <button onClick={() => setTypeFilter([])} className="text-xs text-red-500 hover:underline">
                Reset
              </button>
            )}
          </div>
        )}
      </div>

      {/* ── KPI cards ── */}
      {!loading && (
        <div className="grid grid-cols-4 gap-4 mb-6">
          {[
            { label: "Total Pendapatan",  value: fmt(kpi.revenue),  color: "border-t-green-500",  sub: "kredit akun revenue" },
            { label: "Total Pengeluaran", value: fmt(kpi.expense),  color: "border-t-red-500",    sub: "debit akun beban" },
            { label: "Laba Kotor",        value: fmt(kpi.profit),   color: "border-t-blue-500",   sub: "pendapatan − pengeluaran" },
            { label: "Net Kas",           value: fmt(kpi.netCash),  color: "border-t-indigo-500", sub: "kas masuk − keluar" },
          ].map((c) => (
            <div key={c.label} className={`bg-white rounded-xl border border-slate-200 border-t-2 p-5 ${c.color}`}>
              <p className="text-xs text-slate-400 mb-1">{c.label}</p>
              <p className={`text-lg font-bold ${c.label === "Laba Kotor" && kpi.profit < 0 ? "text-red-600" : "text-slate-900"}`}>
                {c.value}
              </p>
              <p className="text-xs text-slate-400 mt-1">{c.sub}</p>
            </div>
          ))}
        </div>
      )}

      {/* ── Trial balance (collapsible) ── */}
      {!loading && trialBalance.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 mb-6 overflow-hidden">
          <button
            className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-50 transition text-left"
            onClick={() => setShowBalance((v) => !v)}
          >
            <h3 className="font-semibold text-slate-800 text-sm">
              Neraca Saldo — {fromDate} s/d {toDate}
            </h3>
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
                    <td className="px-4 py-2.5">
                      <span className="font-mono text-xs text-slate-400 mr-2">{row.code}</span>
                      <span className="text-slate-700 font-medium">{row.name}</span>
                    </td>
                    <td className="px-4 py-2.5 text-right text-blue-600 font-medium">{fmt(row.debit)}</td>
                    <td className="px-4 py-2.5 text-right text-green-600 font-medium">{fmt(row.credit)}</td>
                    <td className={`px-4 py-2.5 text-right font-bold ${row.balance < 0 ? "text-red-600" : "text-slate-800"}`}>
                      {row.balance < 0 ? `(${fmt(Math.abs(row.balance))})` : fmt(row.balance)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ── Journal table ── */}
      <div className="bg-white rounded-xl border border-slate-200 mb-8 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
          <h3 className="font-semibold text-slate-800">
            Jurnal{" "}
            <span className="text-slate-400 font-normal text-sm">
              ({entries.length} entri
              {allEntries.length === 200 && " — limit 200, perkecil rentang tanggal"})
            </span>
          </h3>
          <button
            onClick={() => downloadCsv(entries, fromDate, toDate)}
            className="text-xs text-blue-600 hover:text-blue-800 font-medium border border-blue-200 rounded-lg px-3 py-1.5 hover:bg-blue-50 transition"
          >
            Export CSV
          </button>
        </div>

        {loading ? (
          <p className="text-sm text-slate-400 p-4">Memuat…</p>
        ) : entries.length === 0 ? (
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
              {entries.map((e) => (
                <tr key={e.id} className="hover:bg-slate-50">
                  <td className="px-4 py-2 text-slate-400 text-xs whitespace-nowrap">
                    {e.createdAt?.slice(0, 16).replace("T", " ")}
                  </td>
                  <td className="px-4 py-2">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ENTRY_TYPE_STYLE[e.entryType] ?? "bg-slate-100 text-slate-600"}`}>
                      {ENTRY_TYPE_LABELS[e.entryType] ?? e.entryType}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-blue-700 text-xs font-medium whitespace-nowrap">
                    {ACCOUNT_NAMES[e.debitAccount] ?? e.debitAccount}
                  </td>
                  <td className="px-4 py-2 text-green-700 text-xs font-medium whitespace-nowrap">
                    {ACCOUNT_NAMES[e.creditAccount] ?? e.creditAccount}
                  </td>
                  <td className="px-4 py-2 text-right font-semibold text-slate-800 whitespace-nowrap">
                    {fmt(e.amount)}
                  </td>
                  <td className="px-4 py-2 text-slate-500 text-xs max-w-xs truncate">{e.description}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t-2 border-slate-200 bg-slate-50">
              <tr>
                <td colSpan={4} className="px-4 py-2.5 text-xs font-semibold text-slate-600 text-right">
                  Total ({entries.length} entri)
                </td>
                <td className="px-4 py-2.5 text-right font-bold text-slate-900">
                  {fmt(entries.reduce((s, e) => s + e.amount, 0))}
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        )}
      </div>

      {/* ── Manual entry form ── */}
      <div className="max-w-md bg-white rounded-xl border border-slate-200 p-6">
        <h3 className="font-semibold text-slate-800 mb-1">Entri Jurnal Manual</h3>
        <p className="text-xs text-slate-400 mb-4">Untuk penyesuaian dan koreksi di luar sistem otomatis.</p>

        {feedback && (
          <div className={`mb-4 text-sm rounded-lg px-4 py-3 ${feedback.type === "ok" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"}`}>
            {feedback.msg}
          </div>
        )}

        <div className="space-y-3">
          {/* Entry type */}
          <div>
            <span className="text-xs text-slate-500 block mb-1.5">Tipe Entri</span>
            <div className="flex flex-wrap gap-2">
              {MANUAL_ENTRY_TYPES.map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => setEntryType(key)}
                  className={`text-xs px-3 py-1.5 rounded-full font-medium border transition ${
                    entryType === key
                      ? "bg-blue-600 text-white border-blue-600"
                      : "border-slate-200 text-slate-500 hover:border-slate-300"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs text-slate-500">Debit</span>
              <select className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
                value={debitAccount} onChange={(e) => setDebitAccount(e.target.value as AccountCode)}>
                {ACCOUNT_OPTIONS.map((a) => <option key={a.code} value={a.code}>{a.label}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-xs text-slate-500">Kredit</span>
              <select className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
                value={creditAccount} onChange={(e) => setCreditAccount(e.target.value as AccountCode)}>
                {ACCOUNT_OPTIONS.map((a) => <option key={a.code} value={a.code}>{a.label}</option>)}
              </select>
            </label>
          </div>

          <label className="block">
            <span className="text-xs text-slate-500">Jumlah (Rp)</span>
            <input type="number" placeholder="0"
              className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
              value={amount} onChange={(e) => setAmount(e.target.value)} />
          </label>

          <label className="block">
            <span className="text-xs text-slate-500">Deskripsi</span>
            <input type="text" placeholder="Keterangan entri jurnal"
              className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
              value={description} onChange={(e) => setDescription(e.target.value)} />
          </label>

          <button onClick={handleCreateEntry} disabled={saving}
            className="w-full bg-blue-600 text-white rounded-lg py-2.5 text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition">
            {saving ? "Menyimpan…" : "Simpan Entri"}
          </button>
        </div>
      </div>
    </div>
  );
}
