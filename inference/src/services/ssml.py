import re
from dataclasses import dataclass

# ---------------------------------------------------------------------------
# Pause durations (seconds) for [effect] tokens
# ---------------------------------------------------------------------------

PAUSE_DURATIONS: dict[str, float] = {
    'pause': 0.5,
    'long pause': 1.0,
}

# ---------------------------------------------------------------------------
# Tone → instruct_text mapping
# Maps short tone keys to natural language instructions understood by
# instruct-capable backends (CosyVoice, Qwen, HiggsAudio, …).
# ---------------------------------------------------------------------------

TONE_INSTRUCTIONS: dict[str, str] = {
    'angry': 'Speak in an angry, furious tone.',
    'sad': 'Speak in a sad, sorrowful tone.',
    'happy': 'Speak in a happy, cheerful tone.',
    'excited': 'Speak in an excited, enthusiastic tone.',
    'embarrassed': 'Speak in an embarrassed, flustered tone.',
    'whispering': 'Speak in a soft whisper.',
    'soft': 'Speak in a soft, gentle tone.',
    'breathy': 'Speak in a breathy, airy tone.',
}


def resolve_tone(tone: str) -> str:
    """Return the instruct_text for a tone key, falling back to the raw value."""
    return TONE_INSTRUCTIONS.get(tone.lower(), tone)

_RATE_MAP = {
    'x-slow': 0.5,
    'slow': 0.75,
    'medium': 1.0,
    'fast': 1.25,
    'x-fast': 1.5,
}


@dataclass
class SSMLSegment:
    text: str = ''
    rate: float = 1.0
    tone: str | None = None
    # Non-None means this is an atomic effect (pause, laughing, …) rather than text
    effect: str | None = None


def _parse_rate(rate_str: str) -> float:
    """Convert an SSML rate value to a speed multiplier."""
    s = rate_str.strip()
    if s in _RATE_MAP:
        return _RATE_MAP[s]

    m = re.match(r'^([+-])(\d+(?:\.\d+)?)%$', s)
    if m:
        sign = 1.0 if m.group(1) == '+' else -1.0
        return max(0.1, 1.0 + sign * float(m.group(2)) / 100.0)

    m = re.match(r'^(\d+(?:\.\d+)?)%$', s)
    if m:
        return max(0.1, float(m.group(1)) / 100.0)

    try:
        return max(0.1, float(s))
    except ValueError:
        return 1.0


def is_ssml(text: str) -> bool:
    """Return True if the text contains prosody tags or effect markers."""
    return bool(
        re.search(r'<prosody\b', text, re.IGNORECASE)
        or re.search(r'\[[^\]]+\]', text)
    )


def parse_ssml_segments(text: str, base_speed: float = 1.0) -> list[SSMLSegment]:
    """Parse text into segments with per-segment rate, tone, and effect fields.

    Recognised syntax:
      <prosody rate="X">text</prosody>          — speed only
      <prosody tone="Y">text</prosody>          — tone only
      <prosody rate="X" tone="Y">text</prosody> — combined
      [pause] / [long pause]                    — silence effect
      [laughing] / [sighing] / …               — sound effect
    """
    segments: list[SSMLSegment] = []

    # Matches <prosody …>…</prosody>  OR  [effect-token]
    pattern = re.compile(
        r'<prosody\b([^>]*)>(.*?)</prosody>|\[([^\]]+)\]',
        re.IGNORECASE | re.DOTALL,
    )

    last_end = 0
    for match in pattern.finditer(text):
        before = text[last_end : match.start()].strip()
        if before:
            segments.append(SSMLSegment(text=before, rate=base_speed))

        if match.group(0).startswith('<'):
            # <prosody …>content</prosody>
            attrs_str = match.group(1)
            content = match.group(2).strip()

            rate = base_speed
            tone: str | None = None

            rate_m = re.search(r'\brate=["\']([^"\']+)["\']', attrs_str)
            if rate_m:
                rate = _parse_rate(rate_m.group(1))

            tone_m = re.search(r'\btone=["\']([^"\']+)["\']', attrs_str)
            if tone_m:
                tone = tone_m.group(1)

            if content:
                segments.append(SSMLSegment(text=content, rate=rate, tone=tone))
        else:
            # [effect]
            effect = match.group(3).strip()
            segments.append(SSMLSegment(effect=effect))

        last_end = match.end()

    after = text[last_end:].strip()
    if after:
        segments.append(SSMLSegment(text=after, rate=base_speed))

    if not segments:
        segments.append(SSMLSegment(text=text, rate=base_speed))

    return segments
