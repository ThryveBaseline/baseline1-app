# ElevenLabs Conversational AI Migration Plan

## Current Architecture

- **TTS proxy only**: `netlify/functions/elevenlabs-tts.js` accepts text and returns audio from ElevenLabs TTS API. No conversation state.
- **Separate AI layer**: `carlos-chat.js` Netlify Function handles all reasoning via Anthropic Claude, passing the Carlos system prompt and conversation history on every request.
- **Client-side state machine**: Voice mode is managed in the frontend (`null` / `single` / `conversation`), with the client orchestrating the text-to-TTS pipeline manually.

## Target Architecture

- **ElevenLabs Conversational AI agent**: Replace the two-function chain with a single ElevenLabs agent that owns conversation state, turn management, and audio output.
- **Agent-side persona**: Carlos system prompt and personality injected at agent configuration time, not per-request from the client.
- **WebSocket or streaming session**: Client opens a session with the ElevenLabs agent; the agent handles STT, LLM reasoning, and TTS internally, returning audio directly.

## Migration Options

### Option A: Full Replacement
Remove `carlos-chat.js` and `elevenlabs-tts.js`. Point the client at the ElevenLabs agent session endpoint. One integration surface.

**Pro**: Lowest latency, simplest client code, single vendor for voice pipeline.
**Con**: Persona fidelity depends on ElevenLabs agent LLM quality; no fallback if agent API has issues.

### Option B: Parallel Deployment with Feature Flag
Keep existing functions live. Add a `VOICE_AGENT_ENABLED` flag. When enabled, route conversation-mode requests to the new ElevenLabs agent; keep TTS-only path for single-utterance mode.

**Pro**: Zero downtime cutover, easy rollback, A/B testable.
**Con**: Two codepaths to maintain during transition; feature flag debt if not cleaned up.

## Key Risks

- **Persona fidelity**: ElevenLabs agent LLM may not match Claude's instruction-following depth. Carlos prompt must be tested for consistency before cutover.
- **Memory injection**: Current setup passes full conversation history per request. ElevenLabs agent manages its own context window; no guaranteed parity on how long Carlos "remembers" within a session.
- **Latency tradeoffs**: Conversational AI agent eliminates the text-to-Claude-to-TTS chain but introduces WebSocket session overhead. Measure round-trip before declaring it faster.
- **API cost**: ElevenLabs Conversational AI is billed per character or per minute of audio; compare against current Anthropic + TTS cost at actual usage volume.

## Recommendation

**Start with Option B.** Validate persona fidelity and latency with the feature flag off in production. Run both paths in staging until Carlos behavior is confirmed equivalent. Once validated, remove the old functions and the flag. Full replacement is the right end state; parallel deployment is the right path to get there safely.

## Open Questions

1. Does ElevenLabs Conversational AI support custom LLM backends, or is the reasoning layer locked to their model? If locked, what is the model and context limit?
2. What is the agent session timeout? Does the client need to re-authenticate mid-conversation?
3. How is the Carlos voice ID specified in the new agent config vs. the current TTS function parameter?
4. What are actual per-minute costs at current baseline1-app usage levels compared to Anthropic + TTS spend?
5. Does the agent API support injecting dynamic context (user name, session data) at session start without baking it into the static system prompt?
