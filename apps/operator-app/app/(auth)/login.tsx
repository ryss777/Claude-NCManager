import { useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useOperatorLogin } from "@/hooks/useOperatorLogin";

const PIN_LENGTH = 6;

export default function LoginScreen() {
  const { login, loading } = useOperatorLogin();

  const [ownerId, setOwnerId] = useState("");
  const [clubId, setClubId] = useState("");
  const [operatorId, setOperatorId] = useState("");
  const [deviceId, setDeviceId] = useState("");
  const [pin, setPin] = useState("");

  async function handleLogin() {
    if (!ownerId || !clubId || !operatorId || !deviceId) {
      Alert.alert("Error", "Semua field wajib diisi");
      return;
    }
    if (pin.length !== PIN_LENGTH) {
      Alert.alert("Error", `PIN harus ${PIN_LENGTH} digit`);
      return;
    }

    const result = await login({ ownerId, clubId, operatorId, pin, deviceId });

    if (result.success) {
      router.replace("/(app)");
    } else {
      Alert.alert("Login Gagal", result.error ?? "Periksa PIN dan coba lagi");
      setPin("");
    }
  }

  function handlePinKey(key: string) {
    if (pin.length < PIN_LENGTH) {
      setPin((p) => p + key);
    }
  }

  function handlePinDelete() {
    setPin((p) => p.slice(0, -1));
  }

  const pinKeys = [
    ["1", "2", "3"],
    ["4", "5", "6"],
    ["7", "8", "9"],
    ["", "0", "⌫"],
  ];

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.inner}
      >
        <Text style={styles.title}>NC Manager</Text>
        <Text style={styles.subtitle}>Login Operator</Text>

        <View style={styles.fields}>
          <TextInput
            style={styles.input}
            placeholder="Owner ID"
            value={ownerId}
            onChangeText={setOwnerId}
            autoCapitalize="none"
          />
          <TextInput
            style={styles.input}
            placeholder="Club ID"
            value={clubId}
            onChangeText={setClubId}
            autoCapitalize="none"
          />
          <TextInput
            style={styles.input}
            placeholder="Operator ID"
            value={operatorId}
            onChangeText={setOperatorId}
            autoCapitalize="none"
          />
          <TextInput
            style={styles.input}
            placeholder="Device ID"
            value={deviceId}
            onChangeText={setDeviceId}
            autoCapitalize="none"
          />
        </View>

        {/* PIN dots */}
        <View style={styles.pinRow}>
          {Array.from({ length: PIN_LENGTH }).map((_, i) => (
            <View
              key={i}
              style={[styles.pinDot, i < pin.length && styles.pinDotFilled]}
            />
          ))}
        </View>

        {/* PIN pad */}
        <View style={styles.pinPad}>
          {pinKeys.map((row, ri) => (
            <View key={ri} style={styles.pinPadRow}>
              {row.map((key, ki) => (
                <TouchableOpacity
                  key={ki}
                  style={[styles.pinKey, !key && styles.pinKeyEmpty]}
                  onPress={() => {
                    if (!key) return;
                    if (key === "⌫") handlePinDelete();
                    else handlePinKey(key);
                  }}
                  disabled={!key || loading}
                >
                  <Text style={styles.pinKeyText}>{key}</Text>
                </TouchableOpacity>
              ))}
            </View>
          ))}
        </View>

        <TouchableOpacity
          style={[styles.loginBtn, loading && styles.loginBtnDisabled]}
          onPress={handleLogin}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.loginBtnText}>Masuk</Text>
          )}
        </TouchableOpacity>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f8fafc" },
  inner: { flex: 1, paddingHorizontal: 24, justifyContent: "center" },
  title: { fontSize: 28, fontWeight: "700", color: "#1e293b", textAlign: "center", marginBottom: 4 },
  subtitle: { fontSize: 16, color: "#64748b", textAlign: "center", marginBottom: 24 },
  fields: { gap: 12, marginBottom: 24 },
  input: {
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16,
    backgroundColor: "#fff",
    color: "#1e293b",
  },
  pinRow: { flexDirection: "row", justifyContent: "center", gap: 16, marginBottom: 24 },
  pinDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: "#94a3b8",
    backgroundColor: "transparent",
  },
  pinDotFilled: { backgroundColor: "#2563eb", borderColor: "#2563eb" },
  pinPad: { gap: 12, marginBottom: 24 },
  pinPadRow: { flexDirection: "row", justifyContent: "center", gap: 16 },
  pinKey: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#e2e8f0",
    alignItems: "center",
    justifyContent: "center",
  },
  pinKeyEmpty: { backgroundColor: "transparent", borderColor: "transparent" },
  pinKeyText: { fontSize: 24, fontWeight: "600", color: "#1e293b" },
  loginBtn: {
    backgroundColor: "#2563eb",
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: "center",
  },
  loginBtnDisabled: { opacity: 0.6 },
  loginBtnText: { color: "#fff", fontSize: 18, fontWeight: "700" },
});
