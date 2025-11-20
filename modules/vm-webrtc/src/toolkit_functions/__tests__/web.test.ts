import { getContentsFromUrl } from '../web';

describe('web.ts - getContentsFromUrl', () => {
  // Increase timeout for network requests
  jest.setTimeout(30000);

  it('should fetch and extract non-empty content from a real URL', async () => {
    const testUrl = 'https://roblillack.net/i-accidentally-built-a-web-browser';

    console.log(`Testing URL: ${testUrl}`);

    const result = await getContentsFromUrl(
      { url: testUrl },
      { maxLength: 15000, minHtmlForBody: 150000, maxRawBytes: 3000000 }
    );

    const resultStr = result.result;
    console.log('Result length:', resultStr.length);
    console.log('Result preview (first 500 chars):', resultStr.substring(0, 500));
    console.log('Result type:', typeof resultStr);

    // Verify result is non-empty
    expect(resultStr).toBeTruthy();
    expect(resultStr.length).toBeGreaterThan(0);
    expect(typeof resultStr).toBe('string');

    // Should not be an error message
    expect(resultStr).not.toMatch(/^Error:/);

    // Should contain some actual text content (not just whitespace)
    expect(resultStr.trim().length).toBeGreaterThan(0);

    console.log('✅ Test passed - content extracted successfully');
  });

  it('should handle invalid URLs gracefully', async () => {
    const result = await getContentsFromUrl(
      { url: 'not-a-valid-url' },
      { maxLength: 15000, minHtmlForBody: 150000, maxRawBytes: 3000000 }
    );

    expect(result.result).toMatch(/Error:/);
    console.log('✅ Test passed - invalid URL handled correctly');
  });

  it('should handle private URLs', async () => {
    const result = await getContentsFromUrl(
      { url: 'http://localhost:3000' },
      { maxLength: 15000, minHtmlForBody: 150000, maxRawBytes: 3000000 }
    );

    expect(result.result).toMatch(/Error.*private/i);
    console.log('✅ Test passed - private URL blocked correctly');
  });
});
