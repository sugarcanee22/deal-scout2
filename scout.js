import { readFileSync, writeFileSync, existsSync } from "fs";
const config = JSON.parse(readFileSync("config.json", "utf8"));
const apiKey = process.env.GEMINI_API_KEY;
const today = new Date().toISOString().split("T")[0];
// STEP 1: Build a search query from your criteria
const searchQuery = `${config.product} ${config.brand} deal price under ${config.priceLimit} ${config.currency} ${config.vendorCountry}`;
// STEP 2: Search the web for free using DuckDuckGo (no API key, no account, no card needed)
const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(searchQuery)}`;
const searchResponse = await fetch(searchUrl, {
headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
});
const searchHtml = await searchResponse.text();
// STEP 3: Pull out titles, links, and snippets from the raw search results HTML
const results = [];
const linkRegex = /<a rel="nofollow" class="result__a" href="([^"]+)">([^<]+)<\/a>/g;
const snippetRegex = /<a class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
let linkMatch, snippetMatch;
const links = [];
const snippets = [];
// Unwraps DuckDuckGo's "uddg=" redirect links into the real destination URL,
// so links always point straight to the dealer's page (e.g. Amazon) instead of
// sometimes bouncing through duckduckgo.com/l/?uddg=...
function resolveUrl(rawUrl) {
const cleaned = rawUrl.replace(/&amp;/g, "&");
const match = cleaned.match(/uddg=([^&]+)/);
if (match) {
try {
return decodeURIComponent(match[1]);
} catch (e) {
return cleaned;
}
}
return cleaned;
}

while ((linkMatch = linkRegex.exec(searchHtml)) !== null) links.push({ url: resolveUrl(linkMatch[1]), title: linkMatch[2] });
while ((snippetMatch = snippetRegex.exec(searchHtml)) !== null) snippets.push(snippetMatch[1].replace(/<[^>]+>/g, ""));
for (let i = 0; i < Math.min(links.length, 8); i++) {
results.push({ title: links[i].title, url: links[i].url, snippet: snippets[i] || "" });
}
// STEP 4: Ask Gemini to pick the best matching deals from these real search results
const prompt = `
You are a shopping deal scout. Below are real web search results for a product search. Based ONLY on these results, identify up to ${config.maxResultsPerRun} deals that best match these criteria:
- Product: ${config.product}
- Brand preference: ${config.brand}
- Maximum price: ${config.priceLimit} ${config.currency}
- Vendor location/country: ${config.vendorCountry}
- Age group: ${config.ageGroup}
- Must-have characteristics: ${config.characteristics.join(", ")}
Search results:
${JSON.stringify(results, null, 2)}
For each matching deal, extract or estimate: title, price (number, or null if not stated), currency, vendor, url, whyGoodDeal (one sentence).
Only include results that are plausibly real product listings, not articles or unrelated pages.
IMPORTANT ACCURACY RULES:
- Only use a "url" value if it comes directly from the SAME search result entry as the title and vendor you are describing. Never mix a title from one result with a url from a different result.
- If you are not fully confident a url belongs to that exact listing, set "url" to the search result's own url field exactly as given, even if it looks like a generic search page rather than a specific product page.
- Do not invent, guess, or "clean up" any url.
Respond with ONLY a valid JSON array, no markdown fences, no explanation. Example:
[{"title":"...","price":199,"currency":"SGD","vendor":"...","url":"...","whyGoodDeal":"..."}]
`;
const response = await fetch(
"https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent",
{
method: "POST",
headers: {
"Content-Type": "application/json",
"x-goog-api-key": apiKey,
},
body: JSON.stringify({
contents: [{ parts: [{ text: prompt }] }],
}),
}
);
const data = await response.json();

3. Commit changes (commit directly to the main branch).
This script is the agent’s entire brain-to-action loop: read your wish list → search the web
for free via DuckDuckGo → hand those real results to Gemini to filter and format → save
results.
Note on model names: Google renames and retires Gemini models fairly often. If a
scheduled run ever fails with a 404 error mentioning the model is “no longer available,”
open scout.js , find the model name in the fetch URL (currently gemini-3.5-flash ),
and swap in whatever the current free-tier Flash model is listed as at ai.google.dev.
Note on URLs in results: The script automatically unwraps any DuckDuckGo redirect
links ( duckduckgo.com/l/?uddg=... ) into the real destination URL, so deal links should
always lead straight to the dealer’s page (e.g. Amazon) rather than bouncing through
DuckDuckGo first.

PART 6 — Schedule the Agent to Run Daily (10 min)
1. Add file → Create new file.

2. For the filename, type exactly: .github/workflows/daily-scout.yml (GitHub will auto-
create the folders).

3. Paste:
let text = data.candidates?.[0]?.content?.parts?.map(p => p.text).join("") || "[]";
text = text.replace(/```json|```/g, "").trim();
let deals = [];
try {
deals = JSON.parse(text);
} catch (e) {
console.error("Could not parse Gemini response:", text);
}
const existing = existsSync("results.json")
? JSON.parse(readFileSync("results.json", "utf8"))
: [];
existing.push({ date: today, deals });
writeFileSync("results.json", JSON.stringify(existing, null, 2));
console.log(`Saved ${deals.length} deals for ${today}`);
