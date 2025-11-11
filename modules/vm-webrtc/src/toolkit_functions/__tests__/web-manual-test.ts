// Manual test runner for web.ts
import { getContentsFromUrl } from '../web';

async function runTests() {
  console.log('🧪 Starting web.ts manual tests...\n');

  // Test 1: Real URL with content
  console.log('Test 1: Fetching real URL');
  console.log('URL: https://roblillack.net/i-accidentally-built-a-web-browser\n');

  try {
    const result = await getContentsFromUrl(
      { url: 'https://roblillack.net/i-accidentally-built-a-web-browser' },
      { maxLength: 15000, minHtmlForBody: 150000, maxRawBytes: 3000000 }
    );

    console.log('✅ Request completed');
    console.log('📊 Result stats:');
    console.log('  - Length:', result.length);
    console.log('  - Type:', typeof result);
    console.log('  - Is empty?:', result.length === 0);
    console.log('  - Starts with "Error"?:', result.startsWith('Error'));
    console.log('\n📄 Content preview (first 500 chars):');
    console.log('---');
    console.log(result.substring(0, 500));
    console.log('---\n');

    // Assertions
    if (result.length === 0) {
      console.error('❌ FAIL: Result is empty');
      process.exit(1);
    }

    if (result.startsWith('Error')) {
      console.error('❌ FAIL: Result is an error message:', result);
      process.exit(1);
    }

    if (result.trim().length === 0) {
      console.error('❌ FAIL: Result contains only whitespace');
      process.exit(1);
    }

    console.log('✅ PASS: Content extracted successfully\n');

  } catch (error) {
    console.error('❌ FAIL: Exception thrown');
    console.error('Error:', error);
    process.exit(1);
  }

  // Test 2: Invalid URL
  console.log('\nTest 2: Invalid URL');
  try {
    const result = await getContentsFromUrl(
      { url: 'not-a-valid-url' },
      { maxLength: 15000, minHtmlForBody: 150000, maxRawBytes: 3000000 }
    );
    if (result.includes('Error')) {
      console.log('✅ PASS: Invalid URL handled correctly:', result);
    } else {
      console.error('❌ FAIL: Should return error for invalid URL');
      process.exit(1);
    }
  } catch (error) {
    console.error('❌ FAIL: Should not throw exception for invalid URL');
    process.exit(1);
  }

  // Test 3: Private URL (localhost)
  console.log('\nTest 3: Private URL (localhost)');
  try {
    const result = await getContentsFromUrl(
      { url: 'http://localhost:3000' },
      { maxLength: 15000, minHtmlForBody: 150000, maxRawBytes: 3000000 }
    );
    if (result.includes('Error') && result.toLowerCase().includes('private')) {
      console.log('✅ PASS: Private URL blocked correctly:', result);
    } else {
      console.error('❌ FAIL: Should block private URLs');
      process.exit(1);
    }
  } catch (error) {
    console.error('❌ FAIL: Should not throw exception for private URL');
    process.exit(1);
  }

  console.log('\n🎉 All tests passed!\n');
}

// Run tests
runTests().catch(error => {
  console.error('💥 Unhandled error:', error);
  process.exit(1);
});
