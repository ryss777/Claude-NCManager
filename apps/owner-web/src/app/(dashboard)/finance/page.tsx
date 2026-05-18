"use client";

import { useState } from "react";
import { useOwnerAuthStore } from "@/store/auth.store";
import { callFunction } from "@/firebase/firebase";
import { v4 as uuidv4 } from "uuid";

type AccountCode =
  | "CASH"
  | "MEMBER_BALANCE"
  | "SALES_REVENUE"
  | "COGS"
  | "OPERATING_EXPENSE"
  | "EQUITY";

const ACCOUNTS: AccountCode[] = [
  "CASH",
  "MEMBER_BALANCE",
  "SALES_REVENUE",
  "COGS",
  "OPERATING_EXPENSE",
  "EQUITY",
];

export default function FinancePage() {
  const { ownerId, clubId } = useOwnerAuthStore();

  const [debitAccount, setDebitAccount] = useState<AccountCode>("CASH");
  const [creditAccount, setCreditAccount] = useState<AccountCode>("SALES_REVENUE");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "ok" | "err"; msg: string } | undefined>();

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
        ownerId,
        clubId,
        requestId: uuidv4(),
        operationId: uuidv4(),
        debitAccount,
        creditAccount,
        amount: amt,
        description,
        referenceType: "manual",
      });
      setFeedback({ type: "ok", msg: "Jurnal berhasil dicatat" });
      setAmount("");
      setDescription("");
    } catch (err) {
      setFeedback({ type: "err", msg: err instanceof Error ? err.message : "Gagal" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <h2 className="text-2xl font-bold text-slate-900 mb-6">Keuangan</h2>

      <div className="max-w-lg bg-white rounded-xl border border-slate-200 p-6">
        <h3 className="font-semibold text-slate-800 mb-4">Entri Jurnal Manual</h3>

        {feedback && (
          <div className={`mb-4 text-sm rounded-lg px-4 py-3 ${feedback.type === "ok" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"}`}>
            {feedback.msg}
          </div>
        )}

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs text-slate-500 font-medium">Debit</span>
              <select
                className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
                value={debitAccount}
                onChange={(e) => setDebitAccount(e.target.value as AccountCode)}
              >
                {ACCOUNTS.map((a) => <option key={a}>{a}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-xs text-slate-500 font-medium">Kredit</span>
              <select
                className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
                value={creditAccount}
                onChange={(e) => setCreditAccount(e.target.value as AccountCode)}
              >
                {ACCOUNTS.map((a) => <option key={a}>{a}</option>)}
              </select>
            </label>
          </div>

          <label className="block">
            <span className="text-xs text-slate-500 font-medium">Jumlah (Rp)</span>
            <input
              type="number"
              className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
              placeholder="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </label>

          <label className="block">
            <span className="text-xs text-slate-500 font-medium">Deskripsi</span>
            <input
              type="text"
              className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
              placeholder="Keterangan entri jurnal"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>

          <button
            onClick={handleCreateEntry}
            disabled={loading}
            className="w-full bg-blue-600 text-white rounded-lg py-2.5 text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition"
          >
            {loading ? "Menyimpan…" : "Simpan Entri"}
          </button>
        </div>
      </div>
    </div>
  );
}
