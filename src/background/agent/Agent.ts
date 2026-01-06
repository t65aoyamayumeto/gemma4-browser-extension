import {
  AutoModelForCausalLM,
  AutoTokenizer,
  Message,
  PreTrainedModel,
  PreTrainedTokenizer,
  TextStreamer,
} from "@huggingface/transformers";

import { MODELS, TEXT_GENERATION_MODEL } from "../../shared/constants.ts";
import { ChatMessage, ChatMessageAssistant } from "../../shared/types.ts";
import { calculateDownloadProgress } from "../utils/calculateDownloadProgress.ts";
import { extractToolCalls } from "./extractToolCalls.ts";
import { ToolCallPayload } from "./types.ts";
import {
  WebMCPTool,
  executeWebMCPTool,
  webMCPToolToChatTemplateTool,
} from "./webMcp.tsx";

interface Pipeline {
  tokenizer: PreTrainedTokenizer;
  model: PreTrainedModel;
}

let pipeline: Pipeline = null;
const getTextGenerationPipeline = async (
  onDownloadProgress: (id: string, percentage: number) => void = () => {}
): Promise<Pipeline> => {
  if (pipeline) return pipeline;

  try {
    const m = MODELS[TEXT_GENERATION_MODEL];

    const tokenizer = await AutoTokenizer.from_pretrained(m.modelId);

    const model = await AutoModelForCausalLM.from_pretrained(m.modelId, {
      dtype: m.dtype,
      device: "webgpu",
      progress_callback: calculateDownloadProgress(({ percentage }) =>
        onDownloadProgress(m.modelId, percentage >= 99.9 ? 99.9 : percentage)
      ),
    });
    onDownloadProgress(m.modelId, 100);
    pipeline = { tokenizer, model };
    return pipeline;
  } catch (error) {
    console.error("Failed to initialize feature extraction pipeline:", error);
    throw error;
  }
};

const SYSTEM = {
  role: "developer",
  content:
    "You are a helpful assistant. You are a model that can do function calling with the following functions:",
};

class Agent {
  private pastKeyValues: any = null;
  private messages: Array<Message> = [SYSTEM];
  private _chatMessages: Array<ChatMessage> = [];
  private chatMessagesListener: Array<
    (chatMessages: Array<ChatMessage>) => void
  > = [];
  private tools: Array<WebMCPTool> = [];

  constructor() {}

  get chatMessages() {
    return this._chatMessages;
  }

  set chatMessages(chatMessages: Array<ChatMessage>) {
    this._chatMessages = chatMessages;
    this.chatMessagesListener.forEach((listener) => listener(chatMessages));
  }

  public onChatMessageUpdate(callback: (messages: Array<ChatMessage>) => void) {
    this.chatMessagesListener.push(callback);
  }

  public setTool = (tool: WebMCPTool) => {
    this.tools = [...this.tools, tool];
  };

  public getTextGenerationPipeline = getTextGenerationPipeline;

  public generateText = async (
    input: string | Array<{ name: string; content: string }>,
    onResponseUpdate: (response: string) => void = () => {}
  ): Promise<string> => {
    if (typeof input === "string") {
      this.messages = [...this.messages, { role: "user", content: input }];
    } else {
      for (const toolResponse of input) {
        this.messages.push({
          role: "tool",
          name: toolResponse.name,
          content: toolResponse.content,
        } as Message);
      }
    }

    const { tokenizer, model } = await this.getTextGenerationPipeline();

    console.log("apply_chat_template", this.messages);
    const tokenizerInput = tokenizer.apply_chat_template(this.messages, {
      tools: this.tools.map(webMCPToolToChatTemplateTool),
      add_generation_prompt: true,
      return_dict: true,
    }) as Object;

    let response = "";

    this.messages.push({ role: "assistant", content: "" });

    const removeEosToken = (content: string): string =>
      content.replace(tokenizer.eos_token, "");

    const streamer = new TextStreamer(tokenizer, {
      skip_prompt: true,
      skip_special_tokens: false,
      callback_function: (token: string) => {
        response = response + token;
        this.messages = this.messages.map((message, index, all) => ({
          ...message,
          content: index === all.length - 1 ? response : message.content,
        }));
        onResponseUpdate(removeEosToken(response));
      },
    });

    // Generate the response
    const output: any = await model.generate({
      ...tokenizerInput,
      // @ts-ignore
      past_key_values: this.pastKeyValues,
      max_new_tokens: 1024,
      do_sample: false,
      streamer,
      return_dict_in_generate: true,
    });
    const { sequences, past_key_values } = output;
    this.pastKeyValues = past_key_values;

    const template = tokenizer.batch_decode(sequences, {
      skip_special_tokens: false,
    })[0];
    console.log(template);

    const inputIds = (tokenizerInput as any).input_ids;
    response = tokenizer
      .batch_decode(sequences.slice(null, [inputIds.dims[1], null]), {
        skip_special_tokens: false,
      })[0]
      .replace(/<\|end_of_text\|>$/, "");

    // Extract tool calls from response and update assistant message
    const { toolCalls, message: textContent } = extractToolCalls(response);

    this.messages = this.messages.map((msg, index, all) => {
      if (index === all.length - 1) {
        // Update last message (assistant) with content and tool_calls
        const updated: any = {
          ...msg,
          content: textContent,
        };
        if (toolCalls.length > 0) {
          updated.tool_calls = toolCalls.map((tc) => ({
            function: {
              name: tc.name,
              arguments: tc.arguments,
            },
          }));
        }
        return updated;
      }
      return msg;
    });

    return response;
  };

  public runAgent = async (prompt: string): Promise<void> => {
    this.chatMessages = [
      ...this.chatMessages,
      { role: "user", content: prompt },
    ];
    const prevChatMessages = this.chatMessages;
    const assistantMessage: ChatMessageAssistant = {
      role: "assistant",
      content: "",
      tools: [],
    };

    this.chatMessages = [...prevChatMessages, assistantMessage];

    let messageInThisAgentRun = "";
    const updateAssistantMessage = (response: string) => {
      const { toolCalls, message } = extractToolCalls(response);

      toolCalls.map((tool) => {
        if (!Boolean(assistantMessage.tools.find(({ id }) => tool.id === id))) {
          assistantMessage.tools = [
            ...assistantMessage.tools,
            {
              name: tool.name,
              functionSignature: `${tool.name}(${JSON.stringify(
                tool.arguments
              )})`,
              id: tool.id,
              result: "",
            },
          ];
        }
      });

      assistantMessage.content = messageInThisAgentRun + message;

      this.chatMessages = [...prevChatMessages, assistantMessage];
    };

    let input: string | Array<{ name: string; content: string }> = prompt;

    while (input) {
      const finalResponse = await this.generateText(
        input,
        updateAssistantMessage
      );

      const { toolCalls, message } = extractToolCalls(finalResponse);
      messageInThisAgentRun = message;

      if (toolCalls.length === 0) {
        input = null;
        continue;
      }

      console.log("toolCalls", toolCalls);

      const toolResponses = await Promise.all(
        toolCalls.map(this.executeToolCall)
      );

      assistantMessage.tools = assistantMessage.tools.map((tool) => ({
        ...tool,
        result:
          toolResponses.find(({ id }) => id === tool.id)?.result || tool.result,
      }));

      this.chatMessages = [...prevChatMessages, assistantMessage];

      input = toolResponses.map((response) => {
        const toolCall = toolCalls.find((tc) => tc.id === response.id);
        return {
          name: toolCall!.name,
          content: response.result,
        };
      });
    }
  };

  private executeToolCall = async (
    toolCall: ToolCallPayload
  ): Promise<{ id: string; result: string }> => {
    const toolToUse = this.tools.find((t) => t.name === toolCall.name);
    if (!toolToUse)
      throw new Error(`Tool '${toolCall.name}' not found or is disabled.`);

    return {
      id: toolCall.id,
      result: await executeWebMCPTool(toolToUse, toolCall.arguments),
    };
  };

  public clear() {
    this.messages = [SYSTEM];
    this.pastKeyValues = null;
    this.chatMessages = [];
  }
}

export default Agent;
