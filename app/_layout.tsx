import { Stack } from "expo-router";
import { useEffect } from "react";
import { log } from "../lib/logger";

export default function RootLayout() {
  // Initialize logging on app startup
  useEffect(() => {
    const initialize = async () => {
      await log.initialize();
      log.info("Vibemachine app initialized", {});
    };
    void initialize();
  }, []);

  return <Stack screenOptions={{ headerShown: false }} />;
}
