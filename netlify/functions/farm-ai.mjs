import { json, preflight, readBody, requireActiveAccess, fail, env } from "./_shared.mjs";
import { KENYA_SOURCES, FARM_SAFETY_RULES } from "./_farm-knowledge.mjs";

const MAX_TEXT = 6000;
const MAX_IMAGE_CHARS = 4_500_000;

export default async event => {
  const pf = preflight(event);
  if (pf) return pf;
  if (event.httpMethod !== "POST") return json(405, { error: "Use POST to ask the farm assistant." });

  try {
    await requireActiveAccess(event);
    const body = await readBody(event);
    const question = String(body.question || "").trim();
    const image = body.image == null ? "" : String(body.image);
    const language = body.language === "sw" ? "Kiswahili" : "English";
    if (!question && !image) throw new Error("Enter a farm question or attach a crop/livestock photo.");
    if (question.length > MAX_TEXT) throw new Error("Keep your question under 6,000 characters.");
    if (image && (image.length > MAX_IMAGE_CHARS || !/^data:image\/(jpeg|jpg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(image))) {
      throw new Error("Image must be a JPEG, PNG or WebP photo under about 3 MB.");
    }

    const model = process.env.OPENAI_MODEL || "gpt-4.1-mini";
    const inputContent = [{
      type: "input_text",
      text: [
        "You are MKULIMA, a Kenya-focused agricultural information assistant for smallholder farmers.",
        "Reply in " + language + ". Be practical, clear, concise, and culturally appropriate for Kenya.",
        "For crops, ask about crop/variety, growth stage, county, weather, field pattern, and recent inputs when relevant.",
        "For livestock, ask about species, age, signs, duration, number affected, feed/water, vaccination and treatment history when relevant.",
        "Do not claim certainty from a photo. Explain plausible causes and what observations could distinguish them.",
        "Never prescribe antibiotics, pesticides, veterinary medicines, or exact chemical dosages. Encourage label-compliant use and qualified local advice.",
        "For breathing difficulty, collapse, inability to stand, suspected poisoning, severe bleeding, suspected notifiable disease, or sudden/multiple animal deaths, advise urgent contact with a qualified veterinarian/county veterinary officer and safe isolation/movement restriction.",
        "Never invent a current Kenyan outbreak, weather reading, market price, official notice, or source. State when a fact needs local verification.",
        "Follow these additional safety rules: " + FARM_SAFETY_RULES.join(" "),
        "Kenya resource directory (static links, not live-checked during this request): " + JSON.stringify(KENYA_SOURCES),
        "Recommend only a relevant source from this directory when useful. Do not claim you opened it or verified current content unless that actually occurred.",
        "Offer a short actionable plan, prevention steps, and which Kenyan extension/official service to consult.",
        "This is educational guidance, not a confirmed diagnosis. Do not ask for passwords, payment details, or personal identifiers.",
        "Farmer question: " + question
      ].join("\n")
    }];
    if (image) inputContent.push({ type: "input_image", image_url: image, detail: "auto" });

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: "Bearer " + env("OPENAI_API_KEY"), "Content-Type": "application/json" },
      body: JSON.stringify({ model, store: false, max_output_tokens: 900, input: [{ role: "user", content: inputContent }] })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = result?.error?.message || "AI provider request failed.";
      if (response.status === 401 || response.status === 403) throw new Error("The AI provider key or project permissions need to be checked by the site owner.");
      if (response.status === 429) throw new Error("The AI service is at its usage limit. Please try later.");
      console.error("MKULIMA AI provider error:", response.status, message.slice(0, 300));
      throw new Error("The AI service could not complete this request. Check provider setup and try again.");
    }
    const answer = String(result.output_text || "").trim();
    if (!answer) throw new Error("The AI service returned no guidance. Please try again.");
    return json(200, { ok: true, answer, model, disclaimer: "AI-generated first guidance only; not a diagnosis or prescription. Verify locally before acting." });
  } catch (e) {
    return fail(e);
  }
};
