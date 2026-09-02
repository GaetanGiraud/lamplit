/**
 * Minimal SSE reader for `text/event-stream` bodies.
 *
 * Yields the concatenated `data:` payload of each event. Comment lines (`:`)
 * and non-data fields are ignored, `\r\n` and `\n` framing both work, and a
 * trailing event without its blank-line terminator is still delivered.
 */
export async function* readSseData(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      buffer = buffer.replace(/\r\n/g, '\n');

      let boundary = buffer.indexOf('\n\n');
      while (boundary !== -1) {
        const payload = dataOf(buffer.slice(0, boundary));
        buffer = buffer.slice(boundary + 2);
        if (payload !== null) yield payload;
        boundary = buffer.indexOf('\n\n');
      }
    }
    buffer += decoder.decode();
    const tail = dataOf(buffer.replace(/\r\n/g, '\n').trim());
    if (tail !== null) yield tail;
  } finally {
    reader.releaseLock();
  }
}

/** Joins the `data:` lines of one event, or null when the event carries none. */
function dataOf(event: string): string | null {
  const lines: string[] = [];
  for (const line of event.split('\n')) {
    if (!line.startsWith('data:')) continue;
    lines.push(line.slice(5).replace(/^ /, ''));
  }
  return lines.length ? lines.join('\n') : null;
}
