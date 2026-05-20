"use client";

import { useEffect, useState } from "react";
import { collection, getDocs, query, where, orderBy } from "firebase/firestore";
import { v4 as uuidv4 } from "uuid";
import { useOwnerAuthStore } from "@/store/auth.store";
import { callFunction, firebaseDb } from "@/firebase/firebase";

type PaymentType = "bayar" | "pinjam";

interface TransferItem {
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  subtotal: number;
}

interface IncomingTransfer {
  id: string;
  transferId: string;
  sourceOwnerId: string;
  sourceClubId: string;
  paymentType: PaymentType;
  priceTier: string;
  items: TransferItem[];
  total: number;
  notes: string | null;
  status: "pending" | "accepted";
  createdAt: string;
}

interface Club { id: string; name: string; }

interface AcceptReceipt {
  transferId: string;
  total: number;
  paymentType: PaymentType;
  sourceOwnerId: string;
  destinationClubId: string;
  items: TransferItem[];
  timestamp: string;
}

const fmtIdr = (n: number) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleString("id-ID", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

export default function TransferPage() {
  const { ownerId } = useOwnerAuthStore();
  const [transfers, setTransfers] = useState<IncomingTransfer[]>([]);
  const [clubs, setClubs] = useState<Club[]>([]);
  const [loading, setLoading] = useState(true);

  // Per-transfer club selection state
  const [selectedClub, setSelectedClub] = useState<Record<string, string>>({});

  // Loading state per transfer
  const [accepting, setAccepting] = useState<Record<string, boolean>>({});

  // Receipt shown after acceptance
  const [receipt, setReceipt] = useState<AcceptReceipt | null>(null);

  async function loadData() {
    if (!ownerId) return;
    setLoading(true);
    const db = firebaseDb();
    const [notifSnap, clubsSnap] = await Promise.all([
      getDocs(
        query(
          collection(db, `owners/${ownerId}/notifications`),
          where("type", "==", "transfer_incoming"),
          orderBy("createdAt", "desc")
        )
      ),
      getDocs(collection(db, `owners/${ownerId}/clubs`)),
    ]);

    const all = notifSnap.docs.map((d) => ({ id: d.id, ...d.data() } as IncomingTransfer));
    setTransfers(all);
    setClubs(clubsSnap.docs.map((d) => ({ id: d.id, name: d.data()["name"] as string })));
    setLoading(false);
  }

  useEffect(() => { loadData(); }, [ownerId]);

  async function handleAccept(t: IncomingTransfer) {
    const clubId = selectedClub[t.transferId];
    if (!clubId) { alert("Pilih club tujuan terlebih dahulu"); return; }
    if (!ownerId) return;

    setAccepting((prev) => ({ ...prev, [t.transferId]: true }));
    try {
      await callFunction("productTransfer_accept", {
        ownerId,
        sourceOwnerId: t.sourceOwnerId,
        transferId: t.transferId,
        destinationClubId: clubId,
        requestId: uuidv4(),
        operationId: uuidv4(),
      });
      const clubName = clubs.find((c) => c.id === clubId)?.name ?? clubId;
      setReceipt({
        transferId: t.transferId,
        total: t.total,
        paymentType: t.paymentType,
        sourceOwnerId: t.sourceOwnerId,
        destinationClubId: clubName,
        items: t.items,
        timestamp: new Date().toLocaleString("id-ID"),
      });
      loadData();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Gagal menerima transfer");
    } finally {
      setAccepting((prev) => ({ ...prev, [t.transferId]: false }));
    }
  }

  function shareReceipt(r: AcceptReceipt) {
    const isFree = r.paymentType === "pinjam";
    const lines = [
      "*KONFIRMASI TERIMA TRANSFER - NC Manager*",
      `Tanggal: ${r.timestamp}`,
      `Dari Owner: ${r.sourceOwnerId}`,
      `Masuk ke Club: ${r.destinationClubId}`,
      `Jenis: ${r.paymentType === "bayar" ? "Bayar" : "Pinjam (Gratis)"}`,
      "───────────────────────",
      ...r.items.map((i) => `- ${i.productName} ×${i.quantity}${isFree ? "" : ` = ${fmtIdr(i.subtotal)}`}`),
      "───────────────────────",
      `Total: ${isFree ? "Rp 0 (Gratis)" : fmtIdr(r.total)}`,
      `Ref: ${r.transferId.slice(0, 8).toUpperCase()}`,
      "Status: Diterima",
    ];
    window.open(`https://wa.me/?text=${encodeURIComponent(lines.join("\n"))}`, "_blank");
  }

  const pending = transfers.filter((t) => t.status === "pending");
  const accepted = transfers.filter((t) => t.status === "accepted");

  return (
    <div>
      {/* Receipt modal */}
      {receipt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm mx-4 overflow-hidden">
            <div className="bg-green-600 px-5 py-4">
              <p className="font-bold text-white text-base">Transfer Diterima!</p>
              <p className="text-xs text-white/80 mt-0.5">{receipt.timestamp}</p>
            </div>
            <div className="p-5 space-y-3">
              <div className="text-xs text-slate-500 space-y-1">
                <div className="flex justify-between">
                  <span>Dari Owner</span>
                  <span className="font-medium text-slate-700">{receipt.sourceOwnerId}</span>
                </div>
                <div className="flex justify-between">
                  <span>Masuk ke Club</span>
                  <span className="font-medium text-slate-700">{receipt.destinationClubId}</span>
                </div>
                <div className="flex justify-between">
                  <span>Jenis</span>
                  <span className={`font-semibold ${receipt.paymentType === "pinjam" ? "text-amber-600" : "text-blue-600"}`}>
                    {receipt.paymentType === "bayar" ? "Bayar" : "Pinjam (Gratis)"}
                  </span>
                </div>
              </div>
              <div className="border-t border-slate-100 pt-2 space-y-1">
                {receipt.items.map((item, i) => (
                  <div key={i} className="flex justify-between text-xs text-slate-600">
                    <span className="truncate mr-2">{item.quantity}× {item.productName}</span>
                    {receipt.paymentType === "bayar" && <span className="shrink-0">{fmtIdr(item.subtotal)}</span>}
                  </div>
                ))}
              </div>
              <div className="border-t border-slate-100 pt-2 flex justify-between font-bold text-sm">
                <span>Total</span>
                <span className={receipt.paymentType === "pinjam" ? "text-amber-600" : "text-slate-900"}>
                  {receipt.paymentType === "pinjam" ? "Rp 0 (Gratis)" : fmtIdr(receipt.total)}
                </span>
              </div>
              <p className="text-xs text-slate-400 font-mono">Ref: {receipt.transferId.slice(0, 8).toUpperCase()}</p>
              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => shareReceipt(receipt)}
                  className="flex-1 bg-green-500 hover:bg-green-600 text-white rounded-xl py-2.5 text-sm font-semibold transition"
                >
                  Kirim ke WhatsApp
                </button>
                <button
                  onClick={() => setReceipt(null)}
                  className="px-4 text-sm text-slate-400 hover:text-slate-600 font-medium"
                >
                  Tutup
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <h2 className="text-2xl font-bold text-slate-900 mb-6">Transfer Masuk</h2>

      {loading ? (
        <p className="text-sm text-slate-400">Memuat…</p>
      ) : (
        <div className="space-y-8 max-w-2xl">

          {/* Pending */}
          <section>
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">
              Menunggu Konfirmasi ({pending.length})
            </p>
            {pending.length === 0 ? (
              <div className="bg-slate-50 rounded-xl px-5 py-6 text-center">
                <p className="text-sm text-slate-400">Tidak ada transfer yang menunggu.</p>
              </div>
            ) : (
              <div className="space-y-4">
                {pending.map((t) => (
                  <div key={t.id} className="bg-white rounded-xl border border-amber-200 shadow-sm overflow-hidden">
                    <div className="bg-amber-50 px-4 py-3 flex items-center justify-between">
                      <div>
                        <p className="text-sm font-semibold text-amber-800">Dari Owner: {t.sourceOwnerId}</p>
                        <p className="text-xs text-amber-600 mt-0.5">{fmtDate(t.createdAt)}</p>
                      </div>
                      <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${
                        t.paymentType === "pinjam"
                          ? "bg-amber-100 text-amber-700"
                          : "bg-blue-100 text-blue-700"
                      }`}>
                        {t.paymentType === "bayar" ? "Bayar" : "Pinjam — Gratis"}
                      </span>
                    </div>

                    <div className="px-4 py-3 space-y-2">
                      {t.items.map((item, i) => (
                        <div key={i} className="flex justify-between text-sm">
                          <span className="text-slate-700">{item.quantity}× {item.productName}</span>
                          {t.paymentType === "bayar" && (
                            <span className="text-slate-500 text-xs">{fmtIdr(item.subtotal)}</span>
                          )}
                        </div>
                      ))}
                      {t.paymentType === "bayar" && (
                        <div className="border-t border-slate-100 pt-2 flex justify-between font-semibold text-sm">
                          <span className="text-slate-600">Total</span>
                          <span className="text-slate-900">{fmtIdr(t.total)}</span>
                        </div>
                      )}
                      {t.notes && (
                        <p className="text-xs text-slate-400 italic">Catatan: {t.notes}</p>
                      )}
                    </div>

                    <div className="px-4 py-3 border-t border-slate-100 flex items-center gap-3">
                      <select
                        className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white"
                        value={selectedClub[t.transferId] ?? ""}
                        onChange={(e) =>
                          setSelectedClub((prev) => ({ ...prev, [t.transferId]: e.target.value }))
                        }
                      >
                        <option value="">— Masuk ke Club —</option>
                        {clubs.map((c) => (
                          <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                      </select>
                      <button
                        onClick={() => handleAccept(t)}
                        disabled={accepting[t.transferId] || !selectedClub[t.transferId]}
                        className="bg-green-600 hover:bg-green-700 text-white rounded-lg px-5 py-2 text-sm font-semibold disabled:opacity-40 transition whitespace-nowrap"
                      >
                        {accepting[t.transferId] ? "Memproses…" : "Konfirmasi"}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Accepted history */}
          {accepted.length > 0 && (
            <section>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">
                Sudah Diterima ({accepted.length})
              </p>
              <div className="space-y-2">
                {accepted.map((t) => (
                  <div key={t.id} className="bg-white rounded-xl border border-slate-200 px-4 py-3 flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-slate-700">Dari Owner: {t.sourceOwnerId}</p>
                      <p className="text-xs text-slate-400 mt-0.5">
                        {t.items.length} produk ·{" "}
                        {t.paymentType === "pinjam" ? "Pinjam (Gratis)" : fmtIdr(t.total)} ·{" "}
                        {fmtDate(t.createdAt)}
                      </p>
                    </div>
                    <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-green-50 text-green-700">
                      Diterima
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
