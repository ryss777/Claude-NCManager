"use client";

import { useEffect, useState, useCallback } from "react";
import {
  collection, getDocs, query, orderBy, updateDoc, doc, writeBatch,
} from "firebase/firestore";
import { useOwnerAuthStore } from "@/store/auth.store";
import { firebaseDb } from "@/firebase/firebase";

// ── Types ──────────────────────────────────────────────────────────────────────

type NotifType =
  | "incoming_transfer"
  | "transfer_accepted"
  | "transfer_rejected"
  | "competition_ended"
  | string;

interface Notification {
  id: string;
  type: NotifType;
  title: string;
  message: string;
  isRead: boolean;
  createdAt: string;
  data?: Record<string, unknown>;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const TYPE_ICON: Record<string, string> = {
  incoming_transfer:  "↔️",
  transfer_accepted:  "✅",
  transfer_rejected:  "❌",
  competition_ended:  "🏆",
};

function fmtDate(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const diffMs  = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  const diffH   = Math.floor(diffMin / 60);
  const diffD   = Math.floor(diffH / 24);
  if (diffMin < 1)  return "Baru saja";
  if (diffMin < 60) return `${diffMin} menit lalu`;
  if (diffH   < 24) return `${diffH} jam lalu`;
  if (diffD   < 7)  return `${diffD} hari lalu`;
  return d.toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function NotificationsPage() {
  const { ownerId } = useOwnerAuthStore();

  const [notifs, setNotifs]     = useState<Notification[]>([]);
  const [loading, setLoading]   = useState(true);
  const [markingAll, setMarkingAll] = useState(false);

  const load = useCallback(async () => {
    if (!ownerId) return;
    setLoading(true);
    try {
      const snap = await getDocs(
        query(
          collection(firebaseDb(), `owners/${ownerId}/notifications`),
          orderBy("createdAt", "desc")
        )
      );
      setNotifs(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Notification, "id">) })));
    } finally { setLoading(false); }
  }, [ownerId]);

  useEffect(() => { load(); }, [load]);

  async function markRead(id: string) {
    if (!ownerId) return;
    await updateDoc(doc(firebaseDb(), `owners/${ownerId}/notifications/${id}`), { isRead: true });
    setNotifs((prev) => prev.map((n) => n.id === id ? { ...n, isRead: true } : n));
  }

  async function markAllRead() {
    if (!ownerId) return;
    const unread = notifs.filter((n) => !n.isRead);
    if (unread.length === 0) return;
    setMarkingAll(true);
    try {
      const db    = firebaseDb();
      const batch = writeBatch(db);
      unread.forEach((n) => {
        batch.update(doc(db, `owners/${ownerId}/notifications/${n.id}`), { isRead: true });
      });
      await batch.commit();
      setNotifs((prev) => prev.map((n) => ({ ...n, isRead: true })));
    } finally { setMarkingAll(false); }
  }

  const unreadCount = notifs.filter((n) => !n.isRead).length;

  return (
    <div className="max-w-3xl">

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">🔔 Notifikasi</h1>
          {!loading && (
            <p className="text-sm text-slate-400 mt-0.5">
              {unreadCount > 0 ? `${unreadCount} belum dibaca` : "Semua sudah dibaca"}
            </p>
          )}
        </div>
        <div className="flex gap-2">
          {unreadCount > 0 && (
            <button
              onClick={markAllRead}
              disabled={markingAll}
              className="text-sm font-semibold text-blue-600 border border-blue-200 bg-blue-50 px-4 py-2 rounded-xl hover:bg-blue-100 disabled:opacity-50 transition"
            >
              {markingAll ? "Menandai…" : "✓ Tandai Semua Dibaca"}
            </button>
          )}
          <button
            onClick={load}
            className="text-sm text-slate-400 hover:text-blue-600 border border-slate-200 px-3 py-2 rounded-xl hover:bg-slate-50 transition"
          >
            ↻
          </button>
        </div>
      </div>

      {/* Body */}
      {loading ? (
        <div className="flex flex-col items-center gap-3 py-20 text-slate-400">
          <div className="w-8 h-8 border-2 border-slate-200 border-t-blue-500 rounded-full animate-spin" />
          <p className="text-sm">Memuat notifikasi…</p>
        </div>
      ) : notifs.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 py-20 flex flex-col items-center gap-3 text-slate-400">
          <span className="text-5xl">🔕</span>
          <p className="text-sm font-medium">Belum ada notifikasi</p>
          <p className="text-xs text-slate-300">Notifikasi masuk dan transfer produk akan muncul di sini</p>
        </div>
      ) : (
        <div className="space-y-2">
          {notifs.map((n) => (
            <div
              key={n.id}
              onClick={() => !n.isRead && markRead(n.id)}
              className={`flex gap-4 px-5 py-4 rounded-2xl border transition cursor-default ${
                n.isRead
                  ? "bg-white border-slate-200 opacity-70"
                  : "bg-blue-50 border-blue-200 cursor-pointer hover:bg-blue-100"
              }`}
            >
              {/* Icon */}
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-xl shrink-0 ${
                n.isRead ? "bg-slate-100" : "bg-white shadow-sm"
              }`}>
                {TYPE_ICON[n.type] ?? "📢"}
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2">
                  <p className={`text-sm font-semibold ${n.isRead ? "text-slate-600" : "text-slate-900"}`}>
                    {n.title}
                  </p>
                  <span className="text-xs text-slate-400 shrink-0 mt-0.5">{fmtDate(n.createdAt)}</span>
                </div>
                <p className={`text-sm mt-0.5 leading-relaxed ${n.isRead ? "text-slate-400" : "text-slate-600"}`}>
                  {n.message}
                </p>
              </div>

              {/* Unread dot */}
              {!n.isRead && (
                <div className="w-2 h-2 bg-blue-500 rounded-full shrink-0 mt-2" />
              )}
            </div>
          ))}
        </div>
      )}

      {/* Footer hint */}
      {!loading && notifs.length > 0 && (
        <p className="text-center text-xs text-slate-300 mt-6">
          Menampilkan {notifs.length} notifikasi terbaru
        </p>
      )}
    </div>
  );
}
