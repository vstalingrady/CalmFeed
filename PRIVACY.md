# Privacy

CalmFeed has no backend, accounts, analytics, or database.

The extension stores these values in `chrome.storage.local`:

- your Gemini API key,
- session length,
- filtering sensitivity,
- cached prototype embeddings,
- current session end time.

When text classification is uncertain, the extension may send compressed media directly to Google's Gemini Embedding API:

- tweet images are resized to at most 1280 px and compressed as JPEG,
- full videos are not uploaded,
- up to two locally captured, compressed video frames may be sent,
- total media is capped per post.

CalmFeed does not receive or store post text or media outside your browser.

Uninstalling the extension removes its local extension storage. You can revoke your Gemini API key from Google at any time.
