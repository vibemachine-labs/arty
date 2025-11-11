// Set up required globals for Expo
global.__DEV__ = false;

// Import and run the test
import('./modules/vm-webrtc/src/toolkit_functions/__tests__/web-manual-test.ts').catch(error => {
  console.error('Failed to run test:', error);
  process.exit(1);
});
