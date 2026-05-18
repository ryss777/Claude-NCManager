import { View, Text, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export default function MembershipScreen() {
  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>Keanggotaan</Text>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f8fafc", padding: 16 },
  title: { fontSize: 22, fontWeight: "700", color: "#1e293b" },
});
