import { getContentsFromUrl } from '../web';

describe('web.ts - getContentsFromUrl', () => {
  // Increase timeout for network requests
  jest.setTimeout(30000);

  it('should fetch and extract non-empty content from a real URL', async () => {
    const testUrl = 'https://roblillack.net/i-accidentally-built-a-web-browser';

    console.log(`Testing URL: ${testUrl}`);

    const result = await getContentsFromUrl({ url: testUrl });

    console.log('Result length:', result.length);
    console.log('Result preview (first 500 chars):', result.substring(0, 500));
    console.log('Result type:', typeof result);

    // Verify result is non-empty
    expect(result).toBeTruthy();
    expect(result.length).toBeGreaterThan(0);
    expect(typeof result).toBe('string');

    // Should not be an error message
    expect(result).not.toMatch(/^Error:/);

    // Should contain some actual text content (not just whitespace)
    expect(result.trim().length).toBeGreaterThan(0);

    console.log('✅ Test passed - content extracted successfully');
  });

  it('should handle invalid URLs gracefully', async () => {
    const result = await getContentsFromUrl({ url: 'not-a-valid-url' });

    expect(result).toMatch(/Error:/);
    console.log('✅ Test passed - invalid URL handled correctly');
  });

  it('should handle private URLs', async () => {
    const result = await getContentsFromUrl({ url: 'http://localhost:3000' });

    expect(result).toMatch(/Error.*private/i);
    console.log('✅ Test passed - private URL blocked correctly');
  });
});
