import { GoogleGenAI } from "@google/genai";

export const generateDepthMap = async (imageBase64: string, apiKey?: string): Promise<string> => {
  const finalApiKey = apiKey || process.env.API_KEY;
  
  if (!finalApiKey) {
    throw new Error("API Key is missing. Please enter a valid API Key in the sidebar.");
  }

  const ai = new GoogleGenAI({ apiKey: finalApiKey });
  const prompt = `Generate a high-fidelity grayscale depth map image. White represents objects closest to the camera, and black represents the background. Prioritize extremely fine details, sharp edges, intricate textures, and subtle surface contours. Ensure a smooth, continuous gradient for depth layers. Output at maximum resolution.`;

  // Standard safety settings to minimize false positives for grayscale/depth images
  const safetySettings = [
    { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
    { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
    { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
    { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' }
  ];

  // Helper to extract image from response
  const extractImage = (response: any, modelName: string) => {
    const candidates = response.candidates;
    if (!candidates || candidates.length === 0) {
        // @ts-ignore
        const feedback = response.promptFeedback;
        if (feedback) {
             console.warn(`Safety Block (${modelName}):`, feedback);
             throw new Error(`Generation blocked by safety filters (${modelName}).`);
        }
        throw new Error(`No candidates returned from ${modelName}.`);
    }

    const parts = candidates[0].content?.parts || [];
    
    // Look for inline image data
    for (const part of parts) {
      if (part.inlineData && part.inlineData.data) {
        return part.inlineData.data;
      }
    }
    
    // Check if text was returned instead (usually an error or refusal)
    const textPart = parts.find((p: any) => p.text);
    if (textPart) {
       throw new Error(`${modelName} returned text: "${textPart.text}"`);
    }
    
    throw new Error(`No image data returned from ${modelName}.`);
  };

  try {
    // --- ATTEMPT 1: Gemini 3 Pro (High Quality) ---
    console.log("Attempting generation with Gemini 3 Pro...");
    const response = await ai.models.generateContent({
      model: 'gemini-3-pro-image-preview',
      contents: {
        parts: [
          { inlineData: { mimeType: 'image/jpeg', data: imageBase64 } },
          { text: prompt },
        ],
      },
      config: {
        responseModalities: ["IMAGE", "TEXT"],
        imageConfig: { imageSize: "4K" },
        safetySettings: safetySettings
      }
    });

    return extractImage(response, "Gemini 3 Pro");

  } catch (error) {
    console.warn("Gemini 3 Pro failed/blocked. Attempting fallback to Gemini 2.5 Flash...", error);

    // --- ATTEMPT 2: Gemini 2.5 Flash (Fallback) ---
    try {
        const responseFallback = await ai.models.generateContent({
            model: 'gemini-2.5-flash-image',
            contents: {
                parts: [
                    { inlineData: { mimeType: 'image/jpeg', data: imageBase64 } },
                    { text: prompt },
                ],
            },
            config: {
                // Gemini 2.5 Flash does not support imageSize or responseModalities
                // It generates images by default when queried with image generation prompts
                safetySettings: safetySettings
            }
        });

        return extractImage(responseFallback, "Gemini 2.5 Flash");
    } catch (fallbackError: any) {
        console.error("Gemini 2.5 Flash also failed:", fallbackError);
        const errMessage = error instanceof Error ? error.message : "Unknown error";
        const fbMessage = fallbackError instanceof Error ? fallbackError.message : "Unknown error";
        throw new Error(`Generation failed. Gemini 3: ${errMessage}. Fallback (2.5): ${fbMessage}`);
    }
  }
};