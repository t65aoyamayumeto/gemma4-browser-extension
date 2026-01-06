import { FeatureExtractionPipeline, pipeline } from "@huggingface/transformers";

import { FEATURE_EXTRACTION_MODEL, MODELS } from "../../shared/constants.ts";
import { calculateDownloadProgress } from "./calculateDownloadProgress.ts";

class FeatureExtractor {
  private pipeline: FeatureExtractionPipeline = null;

  public getFeatureExtractionPipeline = async (
    onDownloadProgress: (id: string, percentage: number) => void = () => {}
  ): Promise<FeatureExtractionPipeline> => {
    if (this.pipeline) return this.pipeline;

    try {
      const pipe = await pipeline(
        "feature-extraction",
        MODELS[FEATURE_EXTRACTION_MODEL].modelId,
        {
          dtype: MODELS[FEATURE_EXTRACTION_MODEL].dtype,
          device: "webgpu",
          progress_callback: calculateDownloadProgress(({ percentage }) =>
            onDownloadProgress(
              MODELS[FEATURE_EXTRACTION_MODEL].modelId,
              percentage >= 99.9 ? 99.9 : percentage
            )
          ),
        }
      );

      onDownloadProgress(MODELS[FEATURE_EXTRACTION_MODEL].modelId, 100);
      this.pipeline = pipe as FeatureExtractionPipeline;
      return this.pipeline;
    } catch (error) {
      console.error("Failed to initialize feature extraction pipeline:", error);
      throw error;
    }
  };

  public extractFeatures = async (
    input: Array<string>
  ): Promise<Array<Array<number>>> => {
    const pipe = await this.getFeatureExtractionPipeline();
    const result = await pipe(input, { normalize: true, pooling: "mean" });
    return result.tolist();
  };
}

export default FeatureExtractor;
