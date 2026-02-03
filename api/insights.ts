type InsightResponse = {
  summary: string;
  insights: string[];
  alerts: string[];
  recommended_actions: string[];
  evidence: string[];
  confidence: number;
  generatedAt: string;
};

type CacheEntry = { expiresAt: number; value: InsightResponse };

type RateEntry = { count: number; resetAt: number };

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const RATE_LIMIT_MAX = 20;

const cache = new Map<string, CacheEntry>();
const rateLimit = new Map<string, RateEntry>();

function getIp(req: any) {
  const forwarded = req.headers["x-forwarded-for"];
  if (Array.isArray(forwarded)) return forwarded[0];
  if (typeof forwarded === "string") return forwarded.split(",")[0]?.trim();
  return req.socket?.remoteAddress || "unknown";
}

function getRateLimitEntry(ip: string) {
  const now = Date.now();
  const existing = rateLimit.get(ip);
  if (!existing || existing.resetAt <= now) {
    const entry = { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS };
    rateLimit.set(ip, entry);
    return entry;
  }
  return existing;
}

async function readBody(req: any) {
  if (req.body) return req.body;
  return new Promise<any>((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk: any) => {
      raw += chunk;
    });
    req.on("end", () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "Missing OPENAI_API_KEY" });
    return;
  }

  let body: any;
  try {
    body = await readBody(req);
  } catch {
    res.status(400).json({ error: "Invalid JSON body" });
    return;
  }

  const snapshot = body?.snapshot;
  const datasetHash = typeof body?.datasetHash === "string" ? body.datasetHash.trim() : "";
  const anonymize = Boolean(body?.anonymize);
  const force = Boolean(body?.force);

  if (!snapshot || typeof snapshot !== "object") {
    res.status(400).json({ error: "Missing snapshot" });
    return;
  }

  if (!datasetHash) {
    res.status(400).json({ error: "Missing datasetHash" });
    return;
  }

  const ip = getIp(req);
  const entry = getRateLimitEntry(ip);
  if (entry.count >= RATE_LIMIT_MAX) {
    res.status(429).json({ error: "Rate limit exceeded" });
    return;
  }
  entry.count += 1;

  const cacheKey = `${datasetHash}:${anonymize ? "anon" : "raw"}`;
  if (!force) {
    const cached = cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      res.status(200).json(cached.value);
      return;
    }
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: "gpt-4.1-mini",
      input: [
        {
          role: "system",
          content:
            "You are an operations analyst. Return only valid JSON with keys: summary, insights, alerts, recommended_actions, evidence, confidence (0-1). Keep summary concise and bullet lists short.",
        },
        {
          role: "user",
          content: JSON.stringify(snapshot),
        },
      ],
    }),
  });

  const text = await response.text();

  if (!response.ok) {
    console.error("OPENAI ERROR", response.status, text);
    return res.status(502).json({
      error: "OpenAI request failed",
      openaiStatus: response.status,
      openaiBody: text.slice(0, 500),
    });
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch (err) {
    console.error("Invalid JSON from OpenAI", text);
    return res.status(502).json({
      error: "Invalid OpenAI response format",
    });
  }

  const outputText = data.output_text ?? data.output?.[0]?.content?.[0]?.text ?? "";

  let parsed: any = null;
  if (outputText) {
    try {
      parsed = JSON.parse(outputText);
    } catch (err) {
      parsed = null;
    }
  }

  const responsePayload: InsightResponse = {
    summary: String(parsed?.summary || outputText || ""),
    insights: Array.isArray(parsed?.insights) ? parsed.insights.map((item: any) => String(item)) : [],
    alerts: Array.isArray(parsed?.alerts) ? parsed.alerts.map((item: any) => String(item)) : [],
    recommended_actions: Array.isArray(parsed?.recommended_actions)
      ? parsed.recommended_actions.map((item: any) => String(item))
      : [],
    evidence: Array.isArray(parsed?.evidence) ? parsed.evidence.map((item: any) => String(item)) : [],
    confidence:
      typeof parsed?.confidence === "number" && Number.isFinite(parsed.confidence)
        ? Math.max(0, Math.min(1, parsed.confidence))
        : 0.5,
    generatedAt: new Date().toISOString(),
  };

  cache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, value: responsePayload });

  return res.status(200).json(responsePayload);
}
