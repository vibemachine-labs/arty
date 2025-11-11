import { stripHtml } from 'string-strip-html';
import { log } from '../../../../lib/logger';
import { fetch } from 'expo/fetch';

/**
 * Fetches content from a URL, strips HTML tags, and truncates to approximately 1K characters.
 */
export async function getContentsFromUrl(
  params: { url: string },
  context_params?: { maxLength?: number; minHtmlForBody?: number; maxRawBytes?: number }
): Promise<string> {
  log.info('[web] getContentsFromUrl starting', {}, { url: params.url });

  try {
    const { url } = params;

    // Validate URL format and protocol
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
      log.info('[web] URL parsed successfully', {}, {
        protocol: parsedUrl.protocol,
        hostname: parsedUrl.hostname,
        pathname: parsedUrl.pathname,
      });
    } catch (error) {
      log.error('[web] Invalid URL format', {}, { url, error });
      return 'Error: Invalid URL format';
    }

    // Only allow HTTP and HTTPS protocols
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      log.error('[web] Unsupported protocol', {}, { protocol: parsedUrl.protocol });
      return 'Error: Only HTTP and HTTPS protocols are supported';
    }
    log.info('[web] Protocol allowed', {}, { protocol: parsedUrl.protocol });

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
      log.error('[web] Blocked private/internal URL', {}, { hostname });
      return 'Error: Access to private/internal URLs is not allowed';
    }
    log.info('[web] Hostname allowed', {}, { hostname });

    // Fetch with 10 second timeout
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => {
      log.warn('[web] Timeout reached, aborting fetch', {}, { url });
      abortController.abort();
    }, 10000);

    log.info('[web] Starting fetch request', {}, { url });
    const response = await fetch(url, { signal: abortController.signal });
    clearTimeout(timeoutId);
    log.info('[web] Fetch completed', {}, {
      status: response.status,
      statusText: response.statusText,
      ok: response.ok,
    });

    if (!response.ok) {
      log.error('[web] HTTP error', {}, {
        url,
        status: response.status,
        statusText: response.statusText,
      });
      return `Error fetching URL: ${response.status} ${response.statusText}`;
    }

    // Validate Content-Type
    const contentType = response.headers.get('content-type') || '';
    log.info('[web] Checking content type', {}, { contentType });
    const allowedTypes = ['text/', 'application/json', 'application/xml', 'application/xhtml'];

    if (!allowedTypes.some(type => contentType.toLowerCase().includes(type))) {
      log.error('[web] Unsupported content type', {}, { contentType });
      return `Error: Unsupported content type '${contentType}'. Only text-based content is supported.`;
    }

    // Fetch content in chunks until we have enough stripped text
    log.info('[web] Starting chunked content reading', {}, {});

    // Provide default values if context_params is undefined
    const {
      maxLength = 1500,
      minHtmlForBody = 15000,
      maxRawBytes = 3000000
    } = context_params || {};

    if (!response.body) {
      log.error('[web] Response body not available', {}, { url });
      return 'Error: Response body is not available';
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let rawHtml = '';
    let totalBytesRead = 0;
    let chunkCount = 0;

    try {
      while (true) {
        const { done, value } = await reader.read();
        chunkCount++;

        if (done) {
          log.info('[web] Stream finished', {}, {
            totalChunks: chunkCount,
            totalBytes: totalBytesRead,
            rawHtmlLength: rawHtml.length,
          });
          break;
        }

        totalBytesRead += value.length;
        rawHtml += decoder.decode(value, { stream: true });

        log.debug('[web] Chunk received', {}, {
          chunkNumber: chunkCount,
          chunkSize: value.length,
          totalBytesRead,
          rawHtmlLength: rawHtml.length,
        });

        // Check if we have enough HTML to find body content
        const hasBodyTag = rawHtml.includes('<body');
        const hasClosingBodyTag = rawHtml.includes('</body>');

        // Safety limit: stop if we've read too much raw HTML
        // But make sure we've read at least minHtmlForBody or found the closing body tag
        if (totalBytesRead >= maxRawBytes) {
          log.warn('[web] Reached max raw bytes limit', {}, { totalBytesRead, maxRawBytes });
          break;
        }

        // If we've read minimum amount and have complete body, we can stop
        if (totalBytesRead >= minHtmlForBody && hasBodyTag && hasClosingBodyTag) {
          log.info('[web] Have complete body content, stopping read', {}, {
            totalBytesRead,
            hasBodyTag,
            hasClosingBodyTag,
          });
          break;
        }
      }

      // Simple, robust approach: Remove unwanted content with regex, then strip all HTML
      // This works with any HTML structure, including malformed HTML
      log.debug('[web] Removing unwanted content', {}, {
        htmlLength: rawHtml.length,
      });

      // codacy-disable Security/DetectUnsafeHTML
      let cleaned = rawHtml;

      // Remove script tags and their content
      cleaned = cleaned.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
      log.debug('[web] Removed scripts', {}, { length: cleaned.length });

      // Remove style tags and their content
      cleaned = cleaned.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');
      log.debug('[web] Removed styles', {}, { length: cleaned.length });

      // Remove other non-content tags (head, nav, header, footer, etc.)
      cleaned = cleaned.replace(/<(head|nav|header|footer|aside|noscript)\b[^<]*(?:(?!<\/\1>)<[^<]*)*<\/\1>/gi, '');
      log.debug('[web] Removed structural elements', {}, { length: cleaned.length });

      // Remove self-closing non-content tags (meta, link, svg, iframe)
      cleaned = cleaned.replace(/<(meta|link|svg|iframe)\b[^>]*\/?>/gi, '');
      log.debug('[web] Removed self-closing tags', {}, { length: cleaned.length });

      // Strip all remaining HTML tags to get plain text
      log.debug('[web] Stripping remaining HTML tags', {}, {});
      const cleanedText = stripHtml(cleaned).result.trim();
      // codacy-enable Security/DetectUnsafeHTML

      log.debug('[web] Completed text cleaning', {}, {
        totalChunks: chunkCount,
        totalBytes: totalBytesRead,
        cleanedTextLength: cleanedText.length,
        cleanedTextType: typeof cleanedText,
        preview: cleanedText.substring(0, 200),
        isEmpty: cleanedText.length === 0,
      });

      // Check if we got any content
      if (cleanedText.length === 0) {
        log.warn('[web] No content extracted from page', {}, {
          url,
          htmlLength: rawHtml.length,
          cleanedLength: cleaned.length,
        });
        return 'Error: No readable content found on page';
      }

      // Truncate if necessary
      if (cleanedText.length > maxLength) {
        const truncated = cleanedText.substring(0, maxLength) + '... (truncated)';
        log.debug('[web] Truncating content', {}, {
          originalLength: cleanedText.length,
          truncatedLength: truncated.length,
        });
        return truncated;
      }

      log.info('[web] Returning full content', {}, { length: cleanedText.length });
      return cleanedText;
    } catch (streamError) {
      // Handle streaming errors
      log.error('[web] Stream error', {}, {
        url,
        error: streamError instanceof Error ? streamError.message : String(streamError),
        stack: streamError instanceof Error ? streamError.stack : undefined,
      });
      throw streamError;
    } finally {
      // Only release lock if we still have it
      try {
        log.debug('[web] Releasing reader lock', {}, {});
        reader.releaseLock();
      } catch (releaseError) {
        // Lock may already be released, which is fine
        log.info('[web] Reader lock already released', {}, {});
      }
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      log.error('[web] Request timeout', {}, { url: params.url });
      return 'Error fetching URL: Request timeout';
    }
    if (error instanceof Error) {
      log.error('[web] Error occurred', {}, {
        url: params.url,
        name: error.name,
        message: error.message,
        stack: error.stack,
      });
      return `Error fetching URL: ${error.message}`;
    }
    log.error('[web] Unknown error', {}, { url: params.url, error });
    return 'Error fetching URL: Unknown error';
  }
}
