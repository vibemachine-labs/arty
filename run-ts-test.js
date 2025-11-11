// Set up required globals before importing anything
global.__DEV__ = false;

// Now import tsx's register and load the test
require('tsx/cjs').register();
require('./modules/vm-webrtc/src/toolkit_functions/__tests__/web-manual-test.ts');
