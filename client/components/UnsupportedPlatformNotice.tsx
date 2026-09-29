import React from "react";
import { StyleSheet, Text, View } from "react-native";

/**
 * Rendered on platforms GeoWake does not support.
 *
 * GeoWake is released as a **web** application: the map (Leaflet), geolocation
 * watching, alarm audio (Web Audio), settings persistence (`localStorage`) and
 * ringtone upload all require a browser. `app.json` declares
 * `"platforms": ["web"]`, so Expo will not start an iOS/Android target; this
 * screen is the second line of defence so a native bundle fails with a clear
 * message instead of a blank screen.
 */
export default function UnsupportedPlatformNotice() {
  return (
    <View style={styles.container}>
      <Text style={styles.icon}>🌐</Text>
      <Text style={styles.title}>GeoWake is a web app</Text>
      <Text style={styles.body}>
        This release uses browser-only features (Leaflet maps, Web Audio,{" "}
        <Text style={styles.code}>localStorage</Text> and the browser geolocation
        API). Please open it in a browser, or run{" "}
        <Text style={styles.code}>npm run web</Text> in the client folder.
      </Text>
      <Text style={styles.body}>
        A native build requires swapping in Expo SDK 57 native modules
        (<Text style={styles.code}>react-native-maps</Text>,{" "}
        <Text style={styles.code}>expo-location</Text>,{" "}
        <Text style={styles.code}>expo-audio</Text>,{" "}
        <Text style={styles.code}>expo-secure-store</Text>,{" "}
        <Text style={styles.code}>expo-document-picker</Text>).
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#030712",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    gap: 12,
  },
  icon: { fontSize: 48 },
  title: { color: "#06b6d4", fontSize: 20, fontWeight: "900" },
  body: { color: "#cbd5e1", fontSize: 13, textAlign: "center", lineHeight: 20 },
  code: { color: "#7dd3fc", fontWeight: "700" },
});
