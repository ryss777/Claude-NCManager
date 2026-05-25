import { redirect } from "next/navigation";

// Fitur paket membership sudah dipindah ke tab "Paket Member" di halaman Pelanggan & Member.
export default function MembershipPage() {
  redirect("/customers");
}
