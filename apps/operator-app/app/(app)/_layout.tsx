import { Redirect, Tabs } from "expo-router";
import { useAuthStore } from "@/store/auth.store";

export default function AppLayout() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  if (!isAuthenticated) {
    return <Redirect href="/(auth)/login" />;
  }

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: "#2563eb",
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
