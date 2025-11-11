// Set up required globals for Expo
global.__DEV__ = false;

// Dynamic import to run the compiled test
async function run() {
  try {
    const { runTests } = await import('./modules/vm-webrtc/src/toolkit_functions/__tests__/web-manual-test.ts');
    // The module executes on import, so we just need to wait for it
  } catch (error) {
    console.error('Error running test:', error);
    process.exit(1);
  }
}

run();
