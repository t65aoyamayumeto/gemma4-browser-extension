import { Dtype } from "./types.ts";

export const MODELS: Record<
  string,
  { modelId: string; title: string; size: number; dtype: Dtype }
> = {
  allMiniLM: {
    modelId: "onnx-community/all-MiniLM-L6-v2-ONNX",
    title: "all-MiniLM-L6-v2",
    size: 90318300,
    dtype: "fp32",
  },
  granite350m: {
    modelId: "onnx-community/granite-4.0-350m-ONNX-web",
    title: "Granite-4.0 350M (fp16)",
    size: 0,
    dtype: "fp16",
  },
  granite1B: {
    modelId: "onnx-community/granite-4.0-1b-ONNX-web",
    title: "Granite-4.0 1B (q4)",
    size: 0,
    dtype: "q4",
  },
  granite3B: {
    modelId: "onnx-community/granite-4.0-micro-ONNX-web",
    title: "Granite-4.0 3B (q4f16)",
    size: 2324038975,
    dtype: "q4f16",
  },
  functionGemma270mq4f16: {
    modelId: "gg-hf-gm/functiongemma-270m-it-ONNX",
    title: "FunctionGemma 270m (q4f16)",
    size: 426_045_769,
    dtype: "q4f16",
  },
  functionGemma270mfp16: {
    modelId: "gg-hf-gm/functiongemma-270m-it-ONNX",
    title: "FunctionGemma 270m (fp16)",
    size: 570_137_539,
    dtype: "fp16",
  },
  functionGemma270mfp32: {
    modelId: "gg-hf-gm/functiongemma-270m-it-ONNX",
    title: "FunctionGemma 270m (fp32)",
    size: 1_139_688_375,
    dtype: "fp32",
  },
} as const;

export const FEATURE_EXTRACTION_MODEL: keyof typeof MODELS = "allMiniLM";
export const TEXT_GENERATION_MODEL: keyof typeof MODELS =
  "functionGemma270mfp32";

export const REQUIRED_MODEL_IDS = [
  MODELS[FEATURE_EXTRACTION_MODEL].modelId +
    MODELS[FEATURE_EXTRACTION_MODEL].dtype,
  MODELS[TEXT_GENERATION_MODEL].modelId + MODELS[TEXT_GENERATION_MODEL].dtype,
];

export const STORAGE_KEYS = {
  IS_ACTIVE: "isActive",
  DOWNLOADED_MODELS: "downloadedModels",
};
