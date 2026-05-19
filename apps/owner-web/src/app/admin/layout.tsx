"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useOwnerAuthStore } from "@/store/auth.store";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading, isAdmin } = useOwnerAuthStore();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && (!isAuthenticated || !isAdmin)) {
      router.replace("/");
    }
  }, [isAuthenticated, isLoading, isAdmin, router]);

  if (isLoading || !isAdmin) return null;

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="bg-white border-b border-slate-200 px-6 py-4 flex items-center gap-4">
        <button onClick={() => router.push("/")} className="text-sm text-slate-500 hover:text-slate-800">
          ← Kembali ke Dashboard
        </button>
        <span className="text-slate-300">|</span>
        <h1 className="text-sm font-semibold text-slate-800">Super Admin</h1>
      </div>
      <div className="max-w-5xl mx-auto p-8">{children}</div>
    </div>
  );
}
