import { stripHtml } from 'string-strip-html';

/**
 * Fetches content from a URL, strips HTML tags, and truncates to approximately 1K characters.
 */
export async function getContentsFromUrl(params: { url: string }): Promise<string> {
  try {
    const { url } = params;

    // Fetch the URL
    const response = await fetch(url);

    if (!response.ok) {
      return `Error fetching URL: ${response.status} ${response.statusText}`;
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
