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
let loadError = null;

// Log BEFORE dotenv loading
// #region agent log
fetch('http://127.0.0.1:7244/ingest/ad0f175f-ba16-44b8-93b5-ae9594aeffc8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'env.server.js:28',message:'BEFORE dotenv loading',data:{hasOpenAIKeyBefore:!!process.env.OPENAI_API_KEY,currentWorkingDir:process.cwd(),possiblePaths},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
// #endregion

// Try to load from each possible path
for (const path of possiblePaths) {
  // #region agent log
  fetch('http://127.0.0.1:7244/ingest/ad0f175f-ba16-44b8-93b5-ae9594aeffc8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'env.server.js:30',message:'Checking path',data:{path,exists:existsSync(path)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
  // #endregion
  if (existsSync(path)) {
    const result = config({ path: path });
    // #region agent log
    fetch('http://127.0.0.1:7244/ingest/ad0f175f-ba16-44b8-93b5-ae9594aeffc8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'env.server.js:32',message:'After config() call',data:{path,hasError:!!result.error,errorMessage:result.error?.message,hasOpenAIKey:!!process.env.OPENAI_API_KEY},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
    // #endregion
    if (!result.error) {
      loaded = true;
      loadedPath = path;
      break;
    } else {
      loadError = result.error.message;
    }
  }
}

// If no .env found, try default behavior (searches from process.cwd())
if (!loaded) {
  // #region agent log
  fetch('http://127.0.0.1:7244/ingest/ad0f175f-ba16-44b8-93b5-ae9594aeffc8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'env.server.js:43',message:'Trying default config()',data:{currentWorkingDir:process.cwd()},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
  // #endregion
  const result = config();
  // #region agent log
  fetch('http://127.0.0.1:7244/ingest/ad0f175f-ba16-44b8-93b5-ae9594aeffc8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'env.server.js:45',message:'After default config()',data:{hasError:!!result.error,errorMessage:result.error?.message,hasOpenAIKey:!!process.env.OPENAI_API_KEY},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
  // #endregion
  if (!result.error) {
    loaded = true;
    loadedPath = "default (process.cwd())";
  } else {
    loadError = result.error.message;
  }
}

// Log all environment variables that start with OPENAI or SHOPIFY (for debugging)
const relevantEnvVars = Object.keys(process.env)
  .filter(key => key.includes('OPENAI') || key.includes('SHOPIFY'))
  .reduce((acc, key) => {
    acc[key] = process.env[key] ? `${process.env[key].substring(0, 10)}...` : 'undefined';
    return acc;
  }, {});

// #region agent log
fetch('http://127.0.0.1:7244/ingest/ad0f175f-ba16-44b8-93b5-ae9594aeffc8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'env.server.js:53',message:'FINAL dotenv.config result',data:{loaded,loadedPath,loadError,hasOpenAIKey:!!process.env.OPENAI_API_KEY,possiblePaths,currentWorkingDir:process.cwd(),relevantEnvVars,allEnvKeysCount:Object.keys(process.env).length,openAIKeyValue:process.env.OPENAI_API_KEY?.substring(0,15)||'undefined'},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
// #endregion

// Export a function to verify environment variables are loaded
export function verifyEnvVars() {
  return {
    hasOpenAIApiKey: !!process.env.OPENAI_API_KEY,
    hasShopifyApiKey: !!process.env.SHOPIFY_API_KEY,
    envPath: loadedPath,
    loaded: loaded,
  };
}

