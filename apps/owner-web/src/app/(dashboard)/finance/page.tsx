"use client";

import { useEffect, useState } from "react";
import { collection, getDocs, query, orderBy, limit } from "firebase/firestore";
import { useOwnerAuthStore } from "@/store/auth.store";
import { callFunction, firebaseDb } from "@/firebase/firebase";
import { v4 as uuidv4 } from "uuid";

type AccountCode = "CASH" | "MEMBER_BALANCE" | "SALES_REVENUE" | "COGS" | "OPERATING_EXPENSE" | "EQUITY";
const ACCOUNTS: AccountCode[] = ["CASH", "MEMBER_BALANCE", "SALES_REVENUE", "COGS", "OPERATING_EXPENSE", "EQUITY"];

interface JournalEntry {
  id: string;
  entryType: string;
  debitAccount: string;
  creditAccount: string;
  amount: number;
  description: string;
  createdAt: string;
}

export default function FinancePage() {
  const { ownerId, clubId } = useOwnerAuthStore();
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [loadingList, setLoadingList] = useState(true);

  const [debitAccount, setDebitAccount] = useState<AccountCode>("CASH");
  const [creditAccount, setCreditAccount] = useState<AccountCode>("SALES_REVENUE");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "ok" | "err"; msg: string } | undefined>();

  async function loadEntries() {
    if (!ownerId || !clubId) return;
    setLoadingList(true);
    const snap = await getDocs(
      query(
        collection(firebaseDb(), `owners/${ownerId}/clubs/${clubId}/financeJournal`),
        orderBy("createdAt", "desc"),
        limit(30)
      )
    );
    setEntries(snap.docs.map((d) => ({ id: d.id, ...d.data() } as JournalEntry)));
    setLoadingList(false);
  }

  useEffect(() => { loadEntries(); }, [ownerId, clubId]);

  async function handleCreateEntry() {
    const amt = parseFloat(amount);
    if (!description || isNaN(amt) || amt <= 0) {
      setFeedback({ type: "err", msg: "Isi deskripsi dan jumlah yang valid" });
      return;
    }
    setLoading(true);
    setFeedback(undefined);
    try {
      await callFunction("finance_createJournalEntry", {
        ownerId, clubId,
        requestId: uuidv4(),
        operationId: uuidv4(),
        debitAccount,
        creditAccount,
        amount: amt,
        description,
        referenceType: "manual",
      });
      setFeedback({ type: "ok", msg: "Jurnal berhasil dicatat" });
      setAmount(""); setDescription("");
      loadEntries();
    } catch (err) {
      setFeedback({ type: "err", msg: err instanceof Error ? err.message : "Gagal" });
    } finally { setLoading(false); }
  }

  const fmt = (n: number) => new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);

  return (
    <div>
      <h2 className="text-2xl font-bold text-slate-900 mb-6">Keuangan</h2>

      <div className="bg-white rounded-xl border border-slate-200 mb-6 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
          <h3 className="font-semibold text-slate-800">Jurnal Terbaru</h3>
          <button onClick={loadEntries} className="text-xs text-blue-600 hover:underline">Refresh</button>
        </div>
        {loadingList ? (
          <p className="text-sm text-slate-400 p-4">Memuat…</p>
        ) : entries.length === 0 ? (
          <p className="text-sm text-slate-400 p-4">Belum ada entri jurnal.</p>
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
                  <td className="px-4 py-2 text-slate-400 text-xs whitespace-nowrap">{e.createdAt?.slice(0, 10)}</td>
                  <td className="px-4 py-2 text-slate-500 text-xs">{e.entryType}</td>
                  <td className="px-4 py-2 text-blue-600 text-xs font-medium">{e.debitAccount}</td>
                  <td className="px-4 py-2 text-green-600 text-xs font-medium">{e.creditAccount}</td>
                  <td className="px-4 py-2 text-right font-semibold text-slate-800">{fmt(e.amount)}</td>
                  <td className="px-4 py-2 text-slate-500 text-xs max-w-xs truncate">{e.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="max-w-md bg-white rounded-xl border border-slate-200 p-6">
        <h3 className="font-semibold text-slate-800 mb-4">Entri Jurnal Manual</h3>
        {feedback && (
          <div className={`mb-4 text-sm rounded-lg px-4 py-3 ${feedback.type === "ok" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"}`}>
            {feedback.msg}
          </div>
        )}
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs text-slate-500">Debit</span>
              <select className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" value={debitAccount} onChange={(e) => setDebitAccount(e.target.value as AccountCode)}>
                {ACCOUNTS.map((a) => <option key={a}>{a}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-xs text-slate-500">Kredit</span>
              <select className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" value={creditAccount} onChange={(e) => setCreditAccount(e.target.value as AccountCode)}>
                {ACCOUNTS.map((a) => <option key={a}>{a}</option>)}
              </select>
            </label>
          </div>
          <label className="block">
            <span className="text-xs text-slate-500">Jumlah (Rp)</span>
            <input type="number" className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" placeholder="0" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </label>
          <label className="block">
            <span className="text-xs text-slate-500">Deskripsi</span>
            <input type="text" className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" placeholder="Keterangan entri jurnal" value={description} onChange={(e) => setDescription(e.target.value)} />
          </label>
          <button onClick={handleCreateEntry} disabled={loading} className="w-full bg-blue-600 text-white rounded-lg py-2.5 text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition">
            {loading ? "Menyimpan…" : "Simpan Entri"}
          </button>
        </div>
      </div>
    </div>
  );
}
