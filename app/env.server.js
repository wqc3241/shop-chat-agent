/**
 * Environment Variables Loader
 * Ensures .env file is loaded before any service uses environment variables
 */
import { config } from "dotenv";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import { existsSync } from "fs";

// Get the directory of the current file
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Resolve .env file path relative to project root (go up from app/ to root)
const envPath = resolve(__dirname, "..", ".env");

// Try multiple possible locations for .env file
const possiblePaths = [
  envPath, // app/../.env (project root)
  resolve(process.cwd(), ".env"), // Current working directory
  resolve(__dirname, ".env"), // app/.env
];

let loaded = false;
let loadedPath = null;

// Try to load from each possible path
for (const path of possiblePaths) {
  if (existsSync(path)) {
    const result = config({ path: path });
    if (!result.error) {
      loaded = true;
      loadedPath = path;
      break;
    }
  }
}

// If no .env found, try default behavior (searches from process.cwd())
if (!loaded) {
  const result = config();
  if (!result.error) {
    loaded = true;
    loadedPath = "default (process.cwd())";
  }
}

// Export a function to verify environment variables are loaded
export function verifyEnvVars() {
  return {
    hasOpenAIApiKey: !!process.env.OPENAI_API_KEY,
    hasShopifyApiKey: !!process.env.SHOPIFY_API_KEY,
    envPath: loadedPath,
    loaded: loaded,
  };
}
