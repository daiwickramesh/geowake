import React, { useEffect, useState } from "react";
import { StyleSheet, Text, View, ActivityIndicator } from "react-native";

export default function App() {
  const [serverStatus, setServerStatus] = useState<string>(
    "Connecting to backend...",
  );
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    // Fetch live status from our backend server
    fetch("http://localhost:5000/api/health")
      .then((res) => res.json())
      .then((data) => {
        setServerStatus(data.message);
        setLoading(false);
      })
      .catch((err) => {
        setServerStatus("❌ Could not connect to backend.");  
        setLoading(false);
      });
  }, []);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>📍 GeoWake Smart Alarm</Text>
      <Text style={styles.subtitle}>Full-Stack Connection Test</Text>

      <View style={styles.card}>
        {loading ? (
          <ActivityIndicator size="large" color="#0066cc" />
        ) : (
          <Text style={styles.statusText}>{serverStatus}</Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0f172a",
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
  },
  title: {
    fontSize: 28,
    fontWeight: "bold",
    color: "#ffffff",
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: "#94a3b8",
    marginBottom: 30,
  },
  card: {
    backgroundColor: "#1e293b",
    padding: 24,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#334155",
    minWidth: 320,
    alignItems: "center",
  },
  statusText: {
    color: "#38bdf8",
    fontSize: 16,
    fontWeight: "600",
    textAlign: "center",
  },
});
