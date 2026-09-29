import Groq from "groq-sdk";
import { env } from "./env";

/**
 * The SDK is constructed even without a key so the module graph stays static;
 * the AI controller checks `env.groqApiKey` before making any request.
 */
const groq = new Groq({ apiKey: env.groqApiKey ?? "missing-groq-api-key" });

export default groq;
