// ElevenLabs text-to-speech. Optional: without a key the browser's own voice is
// used, which is free but robotic.
//
// The key stays on the server. The browser posts text to /api/speak and gets
// audio back, so the credential is never exposed to a page or a client's device.
//
// Cost note: ElevenLabs bills per character, so replies are capped before they
// are sent. A runaway answer cannot quietly burn the quota.

const API_BASE = "https://api.elevenlabs.io/v1";

// Flash is their low-latency model, which is what makes a voice assistant feel
// like a conversation rather than a form submission.
const DEFAULT_MODEL = "eleven_flash_v2_5";
export const MAX_SPEECH_CHARS = 600;

export function createVoice(env = process.env, fetchImpl = fetch) {
  const apiKey = env.ELEVENLABS_API_KEY;
  let voiceId = env.ELEVENLABS_VOICE_ID;
  const model = env.ELEVENLABS_MODEL ?? DEFAULT_MODEL;

  // Looked up once per instance when no voice is configured, so the key alone
  // is enough to get a working voice.
  let voiceLookup = null;

  async function resolveVoiceId() {
    if (voiceId) return voiceId;
    voiceLookup ??= (async () => {
      const res = await fetchImpl(`${API_BASE}/voices`, { headers: { "xi-api-key": apiKey } });
      if (!res.ok) throw new Error(`ElevenLabs voices ${res.status}: ${await res.text()}`);
      const body = await res.json();
      const first = body.voices?.[0]?.voice_id;
      if (!first) throw new Error("No ElevenLabs voices available on this account.");
      return first;
    })();
    voiceId = await voiceLookup;
    return voiceId;
  }

  return {
    get enabled() {
      return Boolean(apiKey);
    },

    describe() {
      return apiKey ? { provider: "elevenlabs", model } : { provider: "browser" };
    },

    // Returns { stream, contentType }. The caller pipes it to the response, so
    // audio starts playing before the whole clip is generated.
    async speak(text) {
      if (!apiKey) throw Object.assign(new Error("No ElevenLabs key configured."), { status: 503 });

      const trimmed = String(text ?? "").trim();
      if (!trimmed) throw Object.assign(new Error("Nothing to say."), { status: 400 });
      const capped = trimmed.slice(0, MAX_SPEECH_CHARS);

      const id = await resolveVoiceId();
      const res = await fetchImpl(`${API_BASE}/text-to-speech/${encodeURIComponent(id)}/stream`, {
        method: "POST",
        headers: {
          "xi-api-key": apiKey,
          "Content-Type": "application/json",
          Accept: "audio/mpeg",
        },
        body: JSON.stringify({
          text: capped,
          model_id: model,
          voice_settings: { stability: 0.4, similarity_boost: 0.8, speed: 1.0 },
        }),
      });

      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new Error(`ElevenLabs ${res.status}: ${detail.slice(0, 200)}`);
      }

      return { body: res.body, contentType: res.headers.get("content-type") ?? "audio/mpeg", chars: capped.length };
    },
  };
}
