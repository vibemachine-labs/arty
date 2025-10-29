import { Stack } from "expo-router";
import { useEffect } from "react";
import { log } from "../lib/logger";
import { loadIntoMemory } from "../lib/secure-storage";

export default function RootLayout() {
  // Initialize logging and load secure storage cache on app startup
  useEffect(() => {
    const initialize = async () => {
      await log.initialize();
      await loadIntoMemory();
      log.info("Vibemachine app initialized", {});
    };
    void initialize();
  }, []);

  return <Stack screenOptions={{ headerShown: false }} />;
}
