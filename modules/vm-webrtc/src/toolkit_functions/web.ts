import { stripHtml } from 'string-strip-html';

/**
 * Fetches content from a URL, strips HTML tags, and truncates to approximately 1K characters.
 */
export async function getContentsFromUrl(params: { url: string }): Promise<string> {
  try {
    const { url } = params;

    // Validate URL format and protocol
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      return 'Error: Invalid URL format';
    }

    // Only allow HTTP and HTTPS protocols
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      return 'Error: Only HTTP and HTTPS protocols are supported';
    }

    // Block private IP ranges and localhost to prevent SSRF
    const hostname = parsedUrl.hostname.toLowerCase();
    const blockedPatterns = [
      /^localhost$/i,
      /^127\./,
      /^10\./,
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
      /^192\.168\./,
      /^169\.254\./, // Cloud metadata endpoint
      /^::1$/, // IPv6 localhost
      /^fc00:/, // IPv6 private
    ];

    if (blockedPatterns.some(pattern => pattern.test(hostname))) {
      return 'Error: Access to private/internal URLs is not allowed';
    }

    // Fetch the URL
    const response = await fetch(url);

    if (!response.ok) {
      return `Error fetching URL: ${response.status} ${response.statusText}`;
    }

    // Validate Content-Type
    const contentType = response.headers.get('content-type') || '';
    const allowedTypes = ['text/', 'application/json', 'application/xml', 'application/xhtml'];
    
    if (!allowedTypes.some(type => contentType.toLowerCase().includes(type))) {
      return `Error: Unsupported content type '${contentType}'. Only text-based content is supported.`;
    }

    // Get the content as text
    const html = await response.text();

    // Strip HTML tags
    const strippedContent = stripHtml(html).result;

    // Truncate to approximately 1K characters
    const MAX_LENGTH = 1000;
    if (strippedContent.length > MAX_LENGTH) {
      return strippedContent.substring(0, MAX_LENGTH) + '... (truncated)';
    }

    return strippedContent;
  } catch (error) {
    if (error instanceof Error) {
      return `Error fetching URL: ${error.message}`;
    }
    return 'Error fetching URL: Unknown error';
  }
}
