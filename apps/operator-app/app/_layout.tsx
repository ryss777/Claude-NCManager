import "react-native-get-random-values";
import { useEffect, useState } from "react";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { initFirebase } from "@/firebase/firebase";
import { restoreSession } from "@/hooks/useOperatorLogin";

SplashScreen.preventAutoHideAsync();
initFirebase();

export default function RootLayout() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    restoreSession().finally(() => {
      setReady(true);
      SplashScreen.hideAsync();
    });
  }, []);

  if (!ready) return null;

  return (
    <SafeAreaProvider>
      <Stack screenOptions={{ headerShown: false }} />
    </SafeAreaProvider>
  );
}
