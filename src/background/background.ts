import {
  BackgroundMessages,
  BackgroundTasks,
  ResponseStatus,
} from "../shared/types.ts";
import Agent from "./agent/Agent.ts";
import {
  createAskWebsiteTool,
  highlightWebsiteElementTool,
} from "./tools/askWebsite.ts";
//import { googleSearchTool } from "./tools/search.ts";
import {
  closeTabTool,
  getOpenTabsTool,
  goToTabTool,
  openUrlTool,
} from "./tools/tabActions.ts";
import FeatureExtractor from "./utils/FeatureExtractor.ts";
import VectorHistory from "./vectorHistory/VectorHistory.ts";

import Tab = chrome.tabs.Tab;

let lastProgress: Record<string, number> = {};
const onModelDownloadProgress = (modelId: string, percentage: number) => {
  const rounded = Math.round(percentage * 100) / 100;
  if (rounded === lastProgress[modelId]) return;
  lastProgress[modelId] = rounded;

  chrome.runtime.sendMessage({
    type: BackgroundMessages.DOWNLOAD_PROGRESS,
    modelId,
    percentage: rounded,
  });
};

const agent = new Agent();
const featureExtractor = new FeatureExtractor();
const vectorHistory = new VectorHistory(featureExtractor);

// Register tab management tools
/*agent.setTool(getOpenTabsTool);
agent.setTool(goToTabTool);
agent.setTool(openUrlTool);
agent.setTool(closeTabTool);*/

// Register search tools
//agent.setTool(googleSearchTool);

// Register vector history tools
//agent.setTool(vectorHistory.findHistoryTool);

// Register website content tools
agent.setTool(createAskWebsiteTool(featureExtractor));
agent.setTool(highlightWebsiteElementTool);

agent.onChatMessageUpdate((messages) =>
  chrome.runtime.sendMessage({
    type: BackgroundMessages.MESSAGES_UPDATE,
    messages,
  })
);

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === BackgroundTasks.INITIALIZE_MODELS) {
    Promise.all([
      featureExtractor.getFeatureExtractionPipeline(onModelDownloadProgress),
      agent.getTextGenerationPipeline(onModelDownloadProgress),
    ])
      .then(() => {
        sendResponse({ status: ResponseStatus.SUCCESS });
      })
      .catch((error) => {
        console.error("INITIALIZE_MODELS failed:", error);
        sendResponse({ status: ResponseStatus.ERROR, error: error.message });
      });

    return true;
  }

  if (message.type === BackgroundTasks.AGENT_GENERATE_TEXT) {
    agent
      .runAgent(message.prompt)
      .then(() => {
        sendResponse({ status: ResponseStatus.SUCCESS });
      })
      .catch((error) => {
        console.error("GENERATE_TEXT failed:", error);
        sendResponse({ status: ResponseStatus.ERROR, error: error.message });
      });

    return true;
  }

  if (message.type === BackgroundTasks.AGENT_GET_MESSAGES) {
    sendResponse({
      status: ResponseStatus.SUCCESS,
      messages: agent.chatMessages,
    });
    return true;
  }

  if (message.type === BackgroundTasks.AGENT_CLEAR) {
    agent.clear();
    sendResponse({ status: ResponseStatus.SUCCESS });
    return true;
  }

  if (message.type === BackgroundTasks.EXTRACT_FEATURES) {
    featureExtractor
      .extractFeatures([message.text])
      .then((result) => {
        sendResponse({ status: ResponseStatus.SUCCESS, result: result[0] });
      })
      .catch((error) => {
        console.error("EXTRACT_FEATURES failed:", error);
        sendResponse({ status: ResponseStatus.ERROR, error: error.message });
      });

    return true;
  }

  return false;
});

chrome.action.onClicked.addListener(async (tab) => {
  if (tab.id) {
    await chrome.sidePanel.open({ tabId: tab.id });
  }
});

const addCurrentPageToVectorHistory = async (tabId: number, tab: Tab) => {
  const title = tab.title || "Untitled";
  let description = "";

  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const metaDescription = document.querySelector(
          'meta[name="description"]'
        );
        return metaDescription?.getAttribute("content") || "";
      },
    });
    description = results[0]?.result || "";
  } catch (error) {
    console.log(`Could not extract description from tab ${tabId}:`, error);
  }

  if (!description) {
    description = tab.url || "";
  }

  // Add to vector history
  try {
    const entryId = await vectorHistory.addEntry(title, description, tab.url);
    console.log(
      `Added page to vector history: "${title}" at ${tab.url} (ID: ${entryId})`
    );
  } catch (error) {
    console.error("Failed to add page to vector history:", error);
  }
};

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete") return;
  if (!tab.url?.startsWith("http")) return;

  // Add page to vector history for later retrieval
  addCurrentPageToVectorHistory(tabId, tab);
});
