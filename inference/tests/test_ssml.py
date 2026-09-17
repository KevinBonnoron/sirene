import pytest

from src.services.ssml import (
    PAUSE_DURATIONS,
    _parse_rate,
    is_ssml,
    parse_ssml_segments,
    resolve_tone,
)


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("plain text", False),
        ("<prosody rate='slow'>hi</prosody>", True),
        ("<PROSODY RATE='slow'>hi</PROSODY>", True),
        ("wait [pause] then", True),
        ("a < b and c > d", False),
    ],
)
def test_is_ssml(text, expected):
    assert is_ssml(text) is expected


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("slow", 0.75),
        ("x-fast", 1.5),
        ("+50%", 1.5),
        ("-50%", 0.5),
        ("80%", 0.8),
        ("1.25", 1.25),
        ("nonsense", 1.0),
        ("-9999%", 0.1),
    ],
)
def test_parse_rate(value, expected):
    assert _parse_rate(value) == pytest.approx(expected)


def test_plain_text_is_one_segment_at_the_base_speed():
    segments = parse_ssml_segments("hello world", base_speed=1.3)
    assert [(s.text, s.rate) for s in segments] == [("hello world", 1.3)]


def test_text_around_a_prosody_tag_keeps_the_base_speed():
    segments = parse_ssml_segments(
        "before <prosody rate='slow'>middle</prosody> after", base_speed=1.2
    )
    assert [(s.text, s.rate) for s in segments] == [
        ("before", 1.2),
        ("middle", 0.75),
        ("after", 1.2),
    ]


def test_a_tone_attribute_resolves_to_an_instruction():
    (segment,) = parse_ssml_segments("<prosody tone='angry'>stop</prosody>")
    assert segment.tone == "angry"
    assert resolve_tone(segment.tone) == "Speak in an angry, furious tone."


def test_an_unknown_tone_passes_through_verbatim():
    assert resolve_tone("wistful") == "wistful"


def test_a_bracket_effect_becomes_its_own_segment():
    segments = parse_ssml_segments("one [pause] two")
    assert [(s.text, s.effect) for s in segments] == [
        ("one", None),
        ("", "pause"),
        ("two", None),
    ]
    assert PAUSE_DURATIONS["pause"] == 0.5


def test_empty_text_still_yields_a_segment():
    assert len(parse_ssml_segments("")) == 1
