import { GoogleGenAI } from "@google/genai";
import { fileToBase64 } from "../utils";
import { ProcessingConfig } from "../types";

// Using the Fast Preview model for optimal production cost and speed
const MODEL_NAME = 'veo-3.1-fast-generate-preview';

// Helper to wait with abort support
const wait = (ms: number, signal?: AbortSignal) => {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      return reject(new DOMException('Aborted', 'AbortError'));
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    }, { once: true });
  });
};

export const generateVideo = async (
  imageFile: File,
  config: ProcessingConfig,
  apiKey: string, // Accept key as parameter
  onProgress: (status: string) => void,
  signal?: AbortSignal
): Promise<Blob> => {
  
  if (signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }

  if (!apiKey) {
    throw new Error("API Key is missing. Please provide a valid key in settings.");
  }

  // 1. Initialize SDK with the provided key
  const ai = new GoogleGenAI({ apiKey });

  onProgress("Encoding image...");
  const base64Image = await fileToBase64(imageFile);

  onProgress("Initializing generation...");
  
  let operation;
  let startAttempt = 0;
  const MAX_START_RETRIES = 50; 
  let startBackoff = 20000; 

  // Construct prompt with strong silence enforcement
  const basePrompt = config.prompt || "Silent video, simple motion";
  const finalPrompt = `${basePrompt}. (Video must be completely silent, no sound, no music, no audio track)`;

  while (!operation) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

    try {
      operation = await ai.models.generateVideos({
        model: MODEL_NAME,
        prompt: finalPrompt,
        image: {
          imageBytes: base64Image,
          mimeType: imageFile.type,
        },
        config: {
          numberOfVideos: 1,
          resolution: config.resolution,
          aspectRatio: config.aspectRatio,
          durationSeconds: 4, 
        }
      });
    } catch (error: any) {
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

        const errorString = JSON.stringify(error, null, 2);
        if (startAttempt % 5 === 0) {
           console.warn(`Generation Start Attempt ${startAttempt + 1} result:`, errorString);
        }

        const isRateLimit = 
          error.status === 429 || 
          error.code === 429 || 
          errorString.includes('429') || 
          errorString.includes('RESOURCE_EXHAUSTED') ||
          errorString.includes('quota');
        
        const isTransient = error.status === 503 || error.status === 500;

        if (isRateLimit || isTransient) {
            startAttempt++;
            if (startAttempt > MAX_START_RETRIES) {
                throw new Error("Rate limit or server capacity exhausted after multiple retries. Please try again later.");
            }
            
            const waitTimeSeconds = Math.round(startBackoff/1000);
            const reason = isRateLimit ? "Rate limit (429)" : `Server error (${error.status})`;
            
            onProgress(`${reason}. Waiting ${waitTimeSeconds}s before retry (${startAttempt}/${MAX_START_RETRIES})...`);
            
            await wait(startBackoff, signal);
            startBackoff = Math.min(startBackoff * 1.5, 120000); 
        } else {
            throw new Error(error.message || "Failed to start generation");
        }
    }
  }

  if (!operation.name) {
    throw new Error("Failed to start video generation: No operation name returned.");
  }

  console.log("Operation started:", operation.name);

  onProgress("Generating video (this may take a minute)...");
  
  let updatedOperation = operation;
  let retryCount = 0;
  const MAX_POLLING_RETRIES = 120; 
  
  await wait(10000, signal);

  while (!updatedOperation.done) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

    await wait(10000, signal); 
    
    try {
      const result = await ai.operations.getVideosOperation({ 
        operation: updatedOperation
      });
      updatedOperation = result;
      retryCount = 0;
      
    } catch (error: any) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

      const errorString = JSON.stringify(error);
      const isNotFound = 
        errorString.includes('404') || 
        errorString.includes('NOT_FOUND') ||
        errorString.includes('Requested entity was not found') ||
        error.status === 404 ||
        error.code === 404;

      const isRateLimit = 
          error.status === 429 || 
          error.code === 429 || 
          errorString.includes('429') || 
          errorString.includes('RESOURCE_EXHAUSTED');

      if (isNotFound) {
        console.warn(`Operation status check failed (404). Retrying...`);
        retryCount++;
        if (retryCount >= MAX_POLLING_RETRIES) {
           throw new Error("Operation timed out: Resource not found after multiple retries.");
        }
        continue; 
      }

      if (isRateLimit) {
        console.warn(`Polling rate limit (429). Waiting...`);
        await wait(20000, signal);
        continue;
      }
      
      throw error;
    }
  }

  if (updatedOperation.error) {
    throw new Error(updatedOperation.error.message || "Unknown error during video generation");
  }

  const operationResponse = updatedOperation.response || (updatedOperation as any).result;

  if (operationResponse?.raiMediaFilteredReasons?.length > 0) {
    const reason = operationResponse.raiMediaFilteredReasons[0];
    throw new Error(`Content blocked by safety filter: ${reason}`);
  }
  
  const downloadLink = operationResponse?.generatedVideos?.[0]?.video?.uri;

  if (!downloadLink) {
    console.error("Operation completed but no video URI found.", JSON.stringify(updatedOperation, null, 2));
    throw new Error("No video URI returned. Check console for operation details.");
  }

  onProgress("Downloading result...");

  // 5. Fetch the actual video bytes using the passed API Key
  try {
    let finalUrl = downloadLink;
    const trimmedKey = apiKey.trim(); // Ensure no spaces
    
    // Robust URL construction
    try {
        const urlObj = new URL(finalUrl);
        urlObj.searchParams.append('key', trimmedKey);
        finalUrl = urlObj.toString();
    } catch (e) {
        // Fallback for simple string if URL parsing fails (unlikely for valid APIs)
        if (finalUrl.includes('?')) {
            finalUrl += `&key=${trimmedKey}`;
        } else {
            finalUrl += `?key=${trimmedKey}`;
        }
    }

    const response = await fetch(finalUrl, { signal });
    
    if (!response.ok) throw new Error(`Download failed: ${response.statusText}`);
    const blob = await response.blob();
    return blob;

  } catch (err: any) {
    throw new Error(`Video download error: ${err.message}`);
  }
};