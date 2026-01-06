import { ToolCallPayload } from "./types.ts";

export const extractToolCalls = (
  text: string
): { toolCalls: ToolCallPayload[]; message: string } => {
  const matches = Array.from(
    text.matchAll(/<start_function_call>([\s\S]*?)<end_function_call>/g)
  );
  const toolCalls: ToolCallPayload[] = [];

  for (const match of matches) {
    try {
      const parsed = extractFunctionGemmaToolCall(match[1]);
      if (parsed && typeof parsed.name === "string") {
        toolCalls.push(parsed);
      }
    } catch {
      // ignore malformed tool call payloads
    }
  }

  // Remove both complete and incomplete tool calls
  // Complete: <start_function_call>...<end_function_call>
  // Incomplete: <start_function_call>... (no closing tag yet)
  const message = text
    .replace(/<start_function_call>[\s\S]*?(?:<end_function_call>|$)/g, "")
    .trim();

  return { toolCalls, message };
};

const extractFunctionGemmaToolCall = (text: string): ToolCallPayload | null => {
  try {
    const trimmed = text.trim();

    // Check if it starts with "call:"
    if (!trimmed.startsWith("call:")) return null;

    // Extract function name (everything between "call:" and "{")
    const braceIndex = trimmed.indexOf("{");
    if (braceIndex === -1) return null;

    const name = trimmed.substring(5, braceIndex); // 5 = "call:".length

    // Extract JSON-like string starting from "{"
    let argsStr = trimmed.substring(braceIndex);

    // Sanitize to valid JSON
    argsStr = argsStr
      .replace(/<escape>(.*?)<escape>/g, '"$1"') // Handle string escapes
      .replace(/(\w+):/g, '"$1":'); // Quote keys

    console.log(argsStr);

    const args = JSON.parse(argsStr);
    console.log(args);

    return {
      name,
      arguments: args,
      id: JSON.stringify({ name, arguments: args }),
    };
  } catch (error) {
    console.error("Error parsing FunctionGemma tool call:", error);
    return null;
  }
};
