import math

import numpy as np
import pytest

from src.services import dsp

SAMPLE_RATE = 24000
TONE_HZ = 200.0


def _tone(seconds: float = 1.0, hz: float = TONE_HZ) -> np.ndarray:
    t = np.arange(int(SAMPLE_RATE * seconds)) / SAMPLE_RATE
    return (0.5 * np.sin(2 * np.pi * hz * t)).astype(np.float32)


# argmax lands on a bin and hides a shift of a fraction of a semitone, which is exactly
# the size of the error this file exists to catch; a parabolic fit reads between bins.
def _fundamental(audio: np.ndarray) -> float:
    spectrum = np.abs(np.fft.rfft(audio * np.hanning(len(audio))))
    peak = int(np.argmax(spectrum))
    left, mid, right = (np.log(spectrum[peak + o] + 1e-20) for o in (-1, 0, 1))
    offset = 0.5 * (left - right) / (left - 2 * mid + right)
    return (peak + offset) * SAMPLE_RATE / len(audio)


# Frequency and amplitude of the peak nearest `hz`, so a test can check a harmonic that
# is not the strongest component.
def _peak_near(audio: np.ndarray, hz: float, window_hz: float = 80.0):
    spectrum = np.abs(np.fft.rfft(audio * np.hanning(len(audio))))
    freqs = np.fft.rfftfreq(len(audio), 1 / SAMPLE_RATE)
    lo, hi = np.searchsorted(freqs, [hz - window_hz, hz + window_hz])
    peak = lo + int(np.argmax(spectrum[lo:hi]))
    left, mid, right = (np.log(spectrum[peak + o] + 1e-20) for o in (-1, 0, 1))
    offset = 0.5 * (left - right) / (left - 2 * mid + right)
    return (peak + offset) * SAMPLE_RATE / len(audio), spectrum[peak] / (len(audio) / 4)


def _rms(audio: np.ndarray) -> float:
    return float(np.sqrt((audio**2).mean()))


@pytest.mark.parametrize("factor", [0.5, 0.75, 1.1892, 1.5, 2.0])
def test_time_stretch_returns_the_requested_duration(factor):
    audio = _tone()
    assert len(dsp.time_stretch(audio, factor)) == round(len(audio) * factor)


@pytest.mark.parametrize("semitones", [-12, -3, -2, -1, 1, 2, 3, 12])
def test_pitch_shift_lands_on_the_requested_interval(semitones):
    audio = _tone()
    shifted = dsp.pitch_shift(audio, semitones)
    measured = 12 * np.log2(_fundamental(shifted) / TONE_HZ)
    assert measured == pytest.approx(semitones, abs=0.02)


@pytest.mark.parametrize("semitones", [-3, 3])
def test_pitch_shift_keeps_the_duration(semitones):
    audio = _tone()
    assert len(dsp.pitch_shift(audio, semitones)) == len(audio)


@pytest.mark.parametrize("semitones", [-3, 3])
def test_pitch_shift_preserves_energy(semitones):
    audio = _tone()
    # Advancing each bin's phase on its own lets a partial cancel itself on overlap-add,
    # which cost up to 64% of the signal before peak locking.
    assert _rms(dsp.pitch_shift(audio, semitones)) == pytest.approx(
        _rms(audio), rel=0.05
    )


def test_a_harmonic_signal_keeps_its_harmonic_ratios():
    t = np.arange(SAMPLE_RATE) / SAMPLE_RATE
    audio = (
        0.5 * np.sin(2 * np.pi * 150 * t) + 0.25 * np.sin(2 * np.pi * 300 * t)
    ).astype(np.float32)
    shifted = dsp.pitch_shift(audio, 3)
    ratio = 2 ** (3 / 12)

    # Both partials, not just the loudest: checking the fundamental alone would pass with
    # the harmonic detuned or gone, which is what a broken phase lock does to a voice.
    first, first_amplitude = _peak_near(shifted, 150 * ratio)
    second, second_amplitude = _peak_near(shifted, 300 * ratio)
    assert first == pytest.approx(150 * ratio, rel=0.002)
    assert second == pytest.approx(300 * ratio, rel=0.002)
    assert second / first == pytest.approx(2.0, rel=0.005)
    assert second_amplitude / first_amplitude == pytest.approx(0.5, rel=0.15)


def test_an_upward_shift_does_not_fold_content_past_nyquist():
    # 11 kHz shifted up three semitones lands at 13.1 kHz, past the 12 kHz Nyquist, so it
    # has to disappear rather than come back at 10.9 kHz. Interpolating instead of
    # band-limiting returned it at nearly half its amplitude.
    audio = _tone(hz=11000)
    shifted = dsp.pitch_shift(audio, 3)
    folded = SAMPLE_RATE - 11000 * 2 ** (3 / 12)
    _, amplitude = _peak_near(shifted, folded)
    assert amplitude < 0.01


@pytest.mark.parametrize(
    ("semitones", "factor"),
    [(0.0, 1.0), (0.0005, 1.0), (0.0, 1.0001)],
)
def test_changes_below_the_threshold_are_left_alone(semitones, factor):
    audio = _tone()
    assert dsp.pitch_shift(audio, semitones) is audio
    assert dsp.time_stretch(audio, factor) is audio
    assert not dsp.shifts_pitch(semitones)


def test_the_pitch_threshold_is_the_one_the_stretch_will_honour():
    audio = _tone()
    # A semitone offset only counts once the ratio it derives clears MIN_CHANGE; asking in
    # semitones instead leaves a band that buffers the take to change nothing.
    assert not dsp.shifts_pitch(dsp.MIN_CHANGE)
    assert dsp.pitch_shift(audio, dsp.MIN_CHANGE) is audio

    boundary = 12 * math.log2(1 + dsp.MIN_CHANGE)
    assert not dsp.shifts_pitch(boundary * 0.99)
    assert dsp.shifts_pitch(boundary * 1.01)
    assert dsp.pitch_shift(audio, boundary * 1.01) is not audio


# _resample is exercised through pitch_shift everywhere else, where no real signal carries
# energy at exactly Nyquist. These two drive it directly, because that is the only place the
# bin's changing role shows up.
def test_resampling_up_keeps_a_nyquist_component_at_its_amplitude():
    # Alternating +1/-1 is the Nyquist frequency itself. Upsampling makes its bin an
    # ordinary one, reconstructed as a conjugate pair, which would double it.
    nyquist = np.cos(np.pi * np.arange(64)).astype(np.float32)
    assert np.abs(dsp._resample(nyquist, 96)).max() == pytest.approx(1.0, rel=0.01)


def test_resampling_down_keeps_a_component_at_the_new_cutoff():
    # A component landing exactly on the output Nyquist stops being a conjugate pair and
    # would come back at half its amplitude.
    samples = 64
    cutoff_bin = 16
    at_cutoff = np.cos(2 * np.pi * cutoff_bin * np.arange(samples) / samples).astype(
        np.float32
    )
    assert np.abs(dsp._resample(at_cutoff, 2 * cutoff_bin)).max() == pytest.approx(
        1.0, rel=0.01
    )


def test_audio_shorter_than_a_frame_is_returned_unchanged():
    audio = np.zeros(16, dtype=np.float32)
    assert dsp.pitch_shift(audio, 3) is audio
    assert dsp.time_stretch(audio, 2.0) is audio
