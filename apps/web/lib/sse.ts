import type { AssistantStreamEvent, ChatStreamEvent } from "./types";

/**
 * Parse Server-Sent Events from a fetch Response body.
 *
 * The standard EventSource API only supports GET requests. We POST chat
 * payloads, so we read the response body as a stream and split on the
 * SSE frame boundary (`\n\n`), then parse each `data: <json>` line.
 *
 * Yields each parsed event in order. Stops on `done` or `error` event,
 * or when the stream closes.
 */
export async function* parseSseStream(
  response: Response
): AsyncGenerator<ChatStreamEvent> {
  if (!response.ok) {
    let detail: string | undefined;
    try {
      detail = await response.text();
    } catch {
      // ignore
    }
    yield {
      type: "error",
      message: `HTTP ${response.status}: ${detail?.slice(0, 200) ?? response.statusText}`,
    };
    return;
  }

  if (!response.body) {
    yield { type: "error", message: "no response body" };
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const frames = buffer.split("\n\n");
      buffer = frames.pop() ?? "";

      for (const frame of frames) {
        const lines = frame.split("\n");
        for (const line of lines) {
          const trimmed = line.trimStart();
          if (!trimmed.startsWith("data:")) continue;
          const data = trimmed.slice(5).trim();
          if (!data) continue;
          try {
            const event = JSON.parse(data) as ChatStreamEvent;
            yield event;
            if (event.type === "done" || event.type === "error") return;
          } catch {
            // malformed frame — ignore and continue
          }
        }
      }
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      // ignore
    }
  }
}

/**
 * Same SSE protocol but typed for the top-level assistant's richer event
 * union (text + tool_call + tool_result + done + error).
 */
export async function* parseAssistantStream(
  response: Response
): AsyncGenerator<AssistantStreamEvent> {
  if (!response.ok) {
    let detail: string | undefined;
    try {
      detail = await response.text();
    } catch {
      // ignore
    }
    yield {
      type: "error",
      message: `HTTP ${response.status}: ${detail?.slice(0, 200) ?? response.statusText}`,
    };
    return;
  }
  if (!response.body) {
    yield { type: "error", message: "no response body" };
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const frames = buffer.split("\n\n");
      buffer = frames.pop() ?? "";
      for (const frame of frames) {
        for (const line of frame.split("\n")) {
          const trimmed = line.trimStart();
          if (!trimmed.startsWith("data:")) continue;
          const data = trimmed.slice(5).trim();
          if (!data) continue;
          try {
            const event = JSON.parse(data) as AssistantStreamEvent;
            yield event;
            if (event.type === "done" || event.type === "error") return;
          } catch {
            // ignore malformed frames
          }
        }
      }
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      // ignore
    }
  }
}
