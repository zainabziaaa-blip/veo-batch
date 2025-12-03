
import { GoogleGenAI } from "@google/genai";
import { fileToBase64 } from "../utils";
import { ProcessingConfig, VertexConfig } from "../types";

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

// Safely retrieve environment API key without crashing if process is undefined
const getEnvApiKey = (): string | undefined => {
  try {
    if (typeof process !== 'undefined' && process.env) {
      return process.env.API_KEY;
    }
  } catch (e) {
    // Ignore reference errors in strict browser environments
  }
  return undefined;
};

// Helper to sanitize API key (remove quotes and whitespace)
const sanitizeKey = (key: string | undefined): string | undefined => {
  if (!key) return undefined;
  let k = key.trim();
  // Remove surrounding quotes if present (common in .env files)
  if ((k.startsWith('"') && k.endsWith('"')) || (k.startsWith("'") && k.endsWith("'"))) {
    k = k.slice(1, -1);
  }
  return k;
};

export const generateVideo = async (
  imageFile: File,
  config: ProcessingConfig,
  onProgress: (status: string) => void,
  signal?: AbortSignal,
  customApiKey?: string,
  vertexConfig?: VertexConfig
): Promise<Blob> => {
  
  if (signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }

  let ai: GoogleGenAI;
  let usingVertex = false;

  // INITIALIZATION LOGIC
  if (vertexConfig && vertexConfig.projectId && vertexConfig.accessToken) {
    // Vertex AI Mode
    if (!vertexConfig.location) throw new Error("Vertex AI requires a Location (e.g., us-central1).");
    
    // Initialize for Vertex
    ai = new GoogleGenAI({
      vertexAI: true,
      project: vertexConfig.projectId,
      location: vertexConfig.location,
      accessToken: vertexConfig.accessToken.trim()
    });
    usingVertex = true;

  } else {
    // AI Studio Mode
    const rawKey = customApiKey?.trim() || getEnvApiKey();
    const apiKey = sanitizeKey(rawKey);

    if (!apiKey) {
      console.error("Credentials missing.");
      throw new Error("Missing Credentials. Please set an API Key (AI Studio) or Project/Token (Vertex AI) in Settings.");
    }
    ai = new GoogleGenAI({ apiKey });
  }

  onProgress("Encoding image...");
  // Use the utility function from utils.ts
  const base64Image = await fileToBase64(imageFile);

  onProgress("Initializing generation...");
  
  let operation;
  
  // Retry logic for starting generation (429/Quota limits)
  let startAttempt = 0;
  // Significantly increased retries for batch processing resilience
  const MAX_START_RETRIES = 50; 
  let startBackoff = 20000; // Start with 20s

  // Construct prompt with strong silence enforcement
  const basePrompt = config.prompt || "Silent video, simple motion";
  const finalPrompt = `${basePrompt}. (Video must be completely silent, no sound, no music, no audio track)`;

  while (!operation) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

    try {
      // 2. Start Video Generation Operation
      operation = await ai.models.generateVideos({
        model: MODEL_NAME,
        prompt: finalPrompt,
        image: {
          imageBytes: base64Image,
          mimeType: imageFile.type,
        },
        config: {
          numberOfVideos: 1,
          resolution: config.resolution, // Keeps 720p from config to save cost
          aspectRatio: config.aspectRatio,
          durationSeconds: 4, // Enforce 4s duration
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

  // 3. Polling Loop
  onProgress("Generating video (this may take a minute)...");
  
  let updatedOperation = operation;
  let retryCount = 0;
  const MAX_POLLING_RETRIES = 120; // 20 minutes max
  
  // Initial wait to allow propagation
  await wait(10000, signal);

  while (!updatedOperation.done) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

    await wait(10000, signal); // Poll every 10s
    
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
        console.warn(`Operation status check failed (404). Retrying... (${retryCount + 1}/${MAX_POLLING_RETRIES})`);
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

  // 4. Extract Result
  const operationResponse = updatedOperation.response || (updatedOperation as any).result;

  if (operationResponse?.raiMediaFilteredReasons?.length > 0) {
    const reason = operationResponse.raiMediaFilteredReasons[0];
    throw new Error(`Content blocked by safety filter: ${reason}`);
  }
  
  const downloadLink = operationResponse?.generatedVideos?.[0]?.video?.uri;

  if (!downloadLink) {
    console.error("Operation completed but no video URI found. Full Operation Dump:", JSON.stringify(updatedOperation, null, 2));
    throw new Error("No video URI returned. Check console for operation details.");
  }

  onProgress("Downloading result...");

  // 5. Fetch the actual video bytes
  try {
    const url = new URL(downloadLink);
    
    // AUTHENTICATION FOR DOWNLOAD
    if (usingVertex) {
      // Vertex AI typically uses the same Access Token as a Bearer header for GCS links
      // OR the link might be signed. If it's a raw gs:// or authenticated https link:
      // Note: The SDK returns a public-ish link usually, but sometimes it needs auth.
      // If using Vertex, we pass the token in headers, NOT query params.
      const headers: HeadersInit = {
        'Authorization': `Bearer ${vertexConfig?.accessToken.trim()}`
      };
      
      const response = await fetch(url.toString(), { 
        signal,
        headers
      });
      
      if (!response.ok) throw new Error(`Download failed: ${response.statusText}`);
      const blob = await response.blob();
      return blob;

    } else {
      // AI Studio Mode: API Key in Query Param
      const rawKey = customApiKey?.trim() || getEnvApiKey();
      const apiKey = sanitizeKey(rawKey);
      if (apiKey) {
          url.searchParams.set("key", apiKey);
      }
      
      const response = await fetch(url.toString(), { 
        signal,
        credentials: 'omit'
      });
      
      if (!response.ok) throw new Error(`Download failed: ${response.statusText}`);
      const blob = await response.blob();
      return blob;
    }

  } catch (err: any) {
    throw new Error(`Video download error: ${err.message}`);
  }
};
