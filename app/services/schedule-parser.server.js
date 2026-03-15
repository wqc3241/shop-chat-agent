/**
 * Schedule Parser Service
 * Parses natural language support hours into structured JSON using OpenAI.
 */
import "../env.server.js";
import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const SYSTEM_PROMPT = `You parse support-hours descriptions into structured JSON.

Output this exact JSON shape:
{
  "timezone": "IANA timezone string (e.g. America/New_York)",
  "windows": [
    { "days": ["Mon","Tue",...], "startTime": "HH:MM", "endTime": "HH:MM" }
  ],
  "overrides": [
    { "date": "YYYY-MM-DD", "closed": true, "reason": "Holiday name" }
    or
    { "date": "YYYY-MM-DD", "startTime": "HH:MM", "endTime": "HH:MM", "reason": "Early close reason" }
  ],
  "alwaysAvailable": false,
  "displayText": "Human-readable summary of the schedule"
}

Rules:
- Day abbreviations: Mon, Tue, Wed, Thu, Fri, Sat, Sun
- Times in 24-hour HH:MM format
- Timezone abbreviations: ET=America/New_York, CT=America/Chicago, MT=America/Denver, PT=America/Los_Angeles, PST/PDT=America/Los_Angeles, EST/EDT=America/New_York, CST/CDT=America/Chicago, MST/MDT=America/Denver, GMT=Europe/London, JST=Asia/Tokyo, AEST=Australia/Sydney
- If no timezone specified, default to America/New_York
- "24/7" or "always available" → set alwaysAvailable: true, empty windows/overrides
- For holiday overrides, use the next upcoming occurrence of the date
- displayText should be concise and human-friendly (e.g. "Monday-Friday 9am-5pm ET")
- Current year is ${new Date().getFullYear()}`;

/**
 * Parse natural language support hours into structured schedule JSON.
 * @param {string} text - Natural language description of support hours
 * @returns {Promise<Object|null>} Parsed schedule or null if empty input
 */
export async function parseSupportSchedule(text) {
  if (!text || !text.trim()) return null;

  const response = await client.chat.completions.create({
    model: "gpt-4o-mini",
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: text.trim() },
    ],
    temperature: 0,
    max_tokens: 800,
  });

  const content = response.choices?.[0]?.message?.content;
  if (!content) throw new Error("No response from schedule parser");

  const parsed = JSON.parse(content);

  // Validate required shape
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("Invalid schedule format: expected object");
  }
  if (!parsed.timezone || typeof parsed.timezone !== "string") {
    throw new Error("Invalid schedule format: missing timezone");
  }
  if (!Array.isArray(parsed.windows)) {
    throw new Error("Invalid schedule format: missing windows array");
  }
  if (!Array.isArray(parsed.overrides)) {
    parsed.overrides = [];
  }
  if (typeof parsed.alwaysAvailable !== "boolean") {
    parsed.alwaysAvailable = false;
  }
  if (!parsed.displayText) {
    parsed.displayText = text.trim();
  }

  return parsed;
}
