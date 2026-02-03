type InsightResponse = {
  summary: string;
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
            "You are an operations analyst. Return a concise executive summary and actionable insights.",
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

  const responsePayload: InsightResponse = {
    summary: String(outputText || ""),
    generatedAt: new Date().toISOString(),
  };

  cache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, value: responsePayload });

  return res.status(200).json(responsePayload);

  const prompt = {
    role: "user",
    content:
      "Genera insights ejecutivos en español a partir del snapshot agregado. " +
      "Devuelve JSON con summary, insights, alerts, recommended_actions, evidence, confidence. " +
      "No incluyas datos personales ni nombres propios. Snapshot: " +
      JSON.stringify(snapshot),
  };

  const system = {
    role: "system",
    content:
      "Eres un analista de soporte. Responde solo JSON válido con el esquema solicitado. " +
      "Usa frases breves y accionables.",
  };

  const openaiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [system, prompt],
    }),
  });

  if (!openaiResponse.ok) {
    res.status(502).json({ error: "OpenAI request failed" });
    return;
  }

  const data = await openaiResponse.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content || typeof content !== "string") {
    res.status(502).json({ error: "Invalid OpenAI response" });
    return;
  }

  let parsed: any;
  try {
    parsed = JSON.parse(content);
  } catch {
    res.status(502).json({ error: "OpenAI response was not JSON" });
    return;
  }

  const response: InsightResponse = {
    summary: String(parsed?.summary || ""),
    insights: normalizeList(parsed?.insights),
    alerts: normalizeList(parsed?.alerts),
    recommended_actions: normalizeList(parsed?.recommended_actions),
    evidence: normalizeList(parsed?.evidence),
    confidence: clampConfidence(parsed?.confidence),
    generatedAt: new Date().toISOString(),
  };

  cache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, value: response });

  res.status(200).json(response);

}
