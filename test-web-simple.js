// Simple Node.js test for web functionality
// Set up required globals
global.__DEV__ = false;

// Import required modules
const striptags = require('striptags');
// Use built-in Node.js fetch (available in Node 18+)

async function getContentsFromUrl(url) {
  console.log(`[web] Starting fetch for: ${url}`);

  try {
    const parsedUrl = new URL(url);
    console.log(`[web] URL parsed: ${parsedUrl.protocol}//${parsedUrl.hostname}${parsedUrl.pathname}`);

    // Protocol check
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      return `Error: Only HTTP and HTTPS protocols are supported`;
    }

    // SSRF check
    const hostname = parsedUrl.hostname.toLowerCase();
    const blockedPatterns = [
      /^localhost$/i,
      /^127\./,
      /^10\./,
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
      /^192\.168\./,
      /^169\.254\./,
      /^::1$/,
      /^fc00:/,
    ];

    if (blockedPatterns.some(pattern => pattern.test(hostname))) {
      return 'Error: Access to private/internal URLs is not allowed';
    }

    // Fetch
    const response = await fetch(url);
    console.log(`[web] Fetch completed: ${response.status} ${response.statusText}`);

    if (!response.ok) {
      return `Error fetching URL: ${response.status} ${response.statusText}`;
    }

    // Content-Type check
    const contentType = response.headers.get('content-type') || '';
    const allowedTypes = ['text/', 'application/json', 'application/xml', 'application/xhtml'];
    if (!allowedTypes.some(type => contentType.toLowerCase().includes(type))) {
      return `Error: Unsupported content type '${contentType}'`;
    }

    // Read response
    if (!response.body) {
      return 'Error: Response body not available';
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let rawHtml = '';
    let totalBytes = 0;
    const MIN_HTML_FOR_BODY = 150000;
    const MAX_RAW_BYTES = 3000000;
    const MAX_LENGTH = 15000;

    try {
      let chunkNum = 0;
      while (true) {
        const { done, value } = await reader.read();
        chunkNum++;

        if (done) {
          console.log(`[web] Stream done after ${chunkNum} chunks, ${totalBytes} total bytes`);
          break;
        }

        totalBytes += value.length;
        rawHtml += decoder.decode(value, { stream: true });

        // Check if we have body content
        const hasBodyTag = rawHtml.includes('<body');
        const hasClosingBodyTag = rawHtml.includes('</body>');

        if (totalBytes >= MAX_RAW_BYTES) {
          console.log(`[web] Reached max bytes limit: ${totalBytes}`);
          break;
        }

        // If we have complete body and read enough, we can stop
        if (totalBytes >= MIN_HTML_FOR_BODY && hasBodyTag && hasClosingBodyTag) {
          console.log(`[web] Have complete body content at ${totalBytes} bytes`);
          break;
        }
      }

      console.log(`[web] Total bytes read: ${totalBytes}, HTML length: ${rawHtml.length}`);
      console.log(`[web] HTML preview:`, rawHtml.substring(0, 200));

      // Simple approach: Remove unwanted content with regex, then strip all HTML tags
      console.log(`[web] Removing unwanted content with regex...`);

      let cleaned = rawHtml;

      // Remove script tags and their content
      cleaned = cleaned.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
      console.log(`[web] After removing scripts: ${cleaned.length} chars`);

      // Remove style tags and their content
      cleaned = cleaned.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');
      console.log(`[web] After removing styles: ${cleaned.length} chars`);

      // Remove other non-content tags
      cleaned = cleaned.replace(/<(head|nav|header|footer|aside|noscript)\b[^<]*(?:(?!<\/\1>)<[^<]*)*<\/\1>/gi, '');
      console.log(`[web] After removing structural elements: ${cleaned.length} chars`);

      // Remove self-closing non-content tags (meta, link, etc.)
      cleaned = cleaned.replace(/<(meta|link|svg|iframe)\b[^>]*\/?>/gi, '');
      console.log(`[web] After removing self-closing tags: ${cleaned.length} chars`);

      // Now strip all remaining HTML tags to get plain text
      console.log(`[web] Stripping remaining HTML tags...`);
      const cleanedText = striptags(cleaned).trim();
      console.log(`[web] Cleaned text length: ${cleanedText.length}`);
      console.log(`[web] Cleaned text preview:`, cleanedText.substring(0, 200));

      if (cleanedText.length === 0) {
        return 'Error: No readable content found on page';
      }

      // Truncate if needed
      if (cleanedText.length > MAX_LENGTH) {
        return cleanedText.substring(0, MAX_LENGTH) + '... (truncated)';
      }

      return cleanedText;
    } finally {
      try {
        reader.releaseLock();
      } catch (e) {
        // Ignore
      }
    }
  } catch (error) {
    console.error(`[web] Error:`, error.message);
    return `Error fetching URL: ${error.message}`;
  }
}

// Run test
async function runTest() {
  console.log('🧪 Testing web content extraction\n');
  console.log('=' .repeat(80));

  const testUrl = 'https://roblillack.net/i-accidentally-built-a-web-browser';
  console.log(`\nTest URL: ${testUrl}\n`);

  const result = await getContentsFromUrl(testUrl);

  console.log('\n' + '='.repeat(80));
  console.log('\n📊 TEST RESULTS:\n');
  console.log(`Result length: ${result.length}`);
  console.log(`Result type: ${typeof result}`);
  console.log(`Is empty: ${result.length === 0}`);
  console.log(`Starts with Error: ${result.startsWith('Error')}`);
  console.log(`\n📄 Full result (first 1000 chars):\n`);
  console.log('-'.repeat(80));
  console.log(result.substring(0, 1000));
  console.log('-'.repeat(80));

  // Check test criteria
  if (result.length === 0) {
    console.log('\n❌ FAIL: Result is empty');
    process.exit(1);
  }

  if (result.startsWith('Error')) {
    console.log('\n❌ FAIL: Result is an error:', result);
    process.exit(1);
  }

  console.log('\n✅ PASS: Content extracted successfully!');
  console.log(`\n✅ Extracted ${result.length} characters of clean text\n`);
}

runTest().catch(error => {
  console.error('\n💥 Test failed with exception:', error);
  process.exit(1);
});
