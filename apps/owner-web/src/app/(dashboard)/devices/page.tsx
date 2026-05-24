"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function DevicesRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace("/operators"); }, [router]);
  return null;
}
