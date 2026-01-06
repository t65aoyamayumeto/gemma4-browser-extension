import { useEffect, useState } from "react";

import {
  MODELS,
  REQUIRED_MODEL_IDS,
  STORAGE_KEYS,
} from "../shared/constants.ts";
import { BackgroundMessages, BackgroundTasks } from "../shared/types.ts";
import Chat from "./chat/Chat.tsx";
import SettingsHeader from "./components/SettingsHeader.tsx";
import { Button, Slider } from "./theme";
import { formatBytes } from "./utils/format.ts";

export default function App() {
  const [downloadedModels, setDownloadedModels] = useState<Array<string>>([]);
  const [downloadingModels, setDownloadingModels] = useState<
    Record<string, number>
  >({});
  const [initialDownload, setInitialDownload] = useState<boolean>(false);

  useEffect(() => {
    const messageListener = (message: any) => {
      if (message.type === BackgroundMessages.DOWNLOAD_PROGRESS) {
        console.log(message.modelId, message.percentage);
        setDownloadingModels((prev) => ({
          ...prev,
          [message.modelId]: message.percentage,
        }));
      }
    };

    chrome.runtime.onMessage.addListener(messageListener);

    chrome.storage.local.get([STORAGE_KEYS.DOWNLOADED_MODELS], (result) => {
      setDownloadedModels(result.downloadedModels || []);
    });

    return () => {
      chrome.runtime.onMessage.removeListener(messageListener);
    };
  }, []);

  const needsDownload =
    REQUIRED_MODEL_IDS.filter((id) => !downloadedModels.includes(id)).length !==
    0;

  if (needsDownload) {
    return (
      <div className="flex items-center justify-center h-full w-full flex-col gap-8 px-6">
        <div className="text-center max-w-md">
          <h1 className="text-3xl font-normal text-chrome-text-primary mb-2">
            Welcome to FunctionGemma
          </h1>
          <p className="text-sm text-chrome-text-secondary mb-6">
            Download the required AI models to get started. This is a one-time
            setup.
          </p>
          <Button
            loading={initialDownload}
            onClick={() => {
              setInitialDownload(true);
              chrome.runtime.sendMessage(
                { type: BackgroundTasks.INITIALIZE_MODELS },
                () => {
                  chrome.storage.local.set({
                    [STORAGE_KEYS.DOWNLOADED_MODELS]: REQUIRED_MODEL_IDS,
                  });
                  setDownloadedModels(REQUIRED_MODEL_IDS);
                  setInitialDownload(false);
                }
              );
            }}
            className="w-full"
          >
            Download Models (
            {formatBytes(
              REQUIRED_MODEL_IDS.reduce(
                (acc, id) =>
                  acc +
                  (Object.values(MODELS).find(
                    ({ modelId, dtype }) => modelId + dtype === id
                  )?.size || 0),
                0
              )
            )}
            )
          </Button>
        </div>
        <div className="w-full max-w-md flex flex-col gap-2">
          {Object.entries(downloadingModels).map(([id, progress]) => (
            <Slider
              key={id}
              text={`${id} (${progress.toFixed(2)}%)`}
              width={progress}
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="h-full w-full flex flex-col">
      <SettingsHeader />
      <main className="flex-1 overflow-y-auto bg-chrome-bg-primary">
        <Chat />
      </main>
    </div>
  );
}
