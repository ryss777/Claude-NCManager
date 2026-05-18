import { Redirect, Tabs } from "expo-router";
import { useAuthStore } from "@/store/auth.store";
import { useSyncEngine } from "@/hooks/useSyncEngine";

export default function AppLayout() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  // Start/stop sync engine with app lifecycle
  useSyncEngine();

  if (!isAuthenticated) {
    return <Redirect href="/(auth)/login" />;
  }

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: "#2563eb",
        tabBarInactiveTintColor: "#94a3b8",
        tabBarStyle: { borderTopColor: "#e2e8f0" },
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Beranda" }} />
      <Tabs.Screen name="pos" options={{ title: "Kasir" }} />
      <Tabs.Screen name="shift" options={{ title: "Shift" }} />
      <Tabs.Screen name="membership" options={{ title: "Member" }} />
      <Tabs.Screen name="inventory" options={{ title: "Stok" }} />
    </Tabs>
  );
}
