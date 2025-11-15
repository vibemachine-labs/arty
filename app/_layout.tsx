import { Stack } from "expo-router";
import { useEffect } from "react";
import { log } from "../lib/logger";
import { initializeSecureStorageCache } from "../lib/secure-storage";
import { preloadToolkitDefinitions } from "../modules/vm-webrtc/src/ToolkitManager";

export default function RootLayout() {
  // Initialize logging and secure storage cache on app startup
  useEffect(() => {
    const initialize = async () => {
      await log.initialize();
      // Initialize SecureStore cache during foreground app launch
      // This prevents "User interaction is not allowed" errors when screen is locked
      await initializeSecureStorageCache();
      await preloadToolkitDefinitions();
      log.info("Vibemachine app initialized", {});
    };
    void initialize();
  }, []);

  return <Stack screenOptions={{ headerShown: false }} />;
}
