import numpy as np

_N_FFT = 1024
_HOP = 256
_EPS = 1e-8

# Below this, either transform is a no-op. Callers ask before buffering a take and running
# the vocoder for a change nobody could hear.
MIN_CHANGE = 1e-3


def stretches(factor: float) -> bool:
    return abs(factor - 1.0) >= MIN_CHANGE


def shifts_pitch(semitones: float) -> bool:
    # Asked of the stretch the shift derives, not of the interval: a hundredth of a
    # semitone is a ratio of 1.00006, which time_stretch would rightly leave alone.
    return stretches(2.0 ** (semitones / 12.0))


def _window() -> np.ndarray:
    return np.hanning(_N_FFT).astype(np.float32)


def _stft(audio: np.ndarray, window: np.ndarray) -> np.ndarray:
    pad = _N_FFT // 2
    padded = np.pad(audio, pad, mode="reflect")
    frame_count = 1 + (len(padded) - _N_FFT) // _HOP
    if frame_count < 1:
        return np.zeros((0, _N_FFT // 2 + 1), dtype=np.complex64)
    frames = np.lib.stride_tricks.sliding_window_view(padded, _N_FFT)[::_HOP][
        :frame_count
    ]
    return np.fft.rfft(frames * window, axis=1)


def _istft(spectrum: np.ndarray, window: np.ndarray) -> np.ndarray:
    frames = np.fft.irfft(spectrum, n=_N_FFT, axis=1) * window
    length = _N_FFT + _HOP * (len(frames) - 1)
    out = np.zeros(length, dtype=np.float32)
    weight = np.zeros(length, dtype=np.float32)
    squared = window * window
    for i, frame in enumerate(frames):
        start = i * _HOP
        out[start : start + _N_FFT] += frame
        weight[start : start + _N_FFT] += squared
    voiced = weight > _EPS
    out[voiced] /= weight[voiced]
    pad = _N_FFT // 2
    return out[pad:-pad] if length > 2 * pad else out


# Advancing every bin's phase independently lets the bins of one partial drift apart, and
# the partial then cancels itself on overlap-add. Each bin instead follows the nearest
# spectral peak and keeps its original offset from it, which holds a partial together.
def _peak_owners(magnitude: np.ndarray) -> np.ndarray:
    is_peak = np.ones(len(magnitude), dtype=bool)
    for offset in (1, 2):
        is_peak[:-offset] &= magnitude[:-offset] >= magnitude[offset:]
        is_peak[offset:] &= magnitude[offset:] >= magnitude[:-offset]
    peaks = np.flatnonzero(is_peak)
    if peaks.size == 0:
        return np.zeros(len(magnitude), dtype=np.intp)
    midpoints = (peaks[:-1] + peaks[1:] + 1) // 2
    return peaks[np.searchsorted(midpoints, np.arange(len(magnitude)), side="right")]


def time_stretch(audio: np.ndarray, factor: float) -> np.ndarray:
    """Stretch audio by `factor` (>1 is longer) without changing its pitch."""
    audio = np.asarray(audio, dtype=np.float32)
    if audio.size < _N_FFT or not stretches(factor):
        return audio

    window = _window()
    spectrum = _stft(audio, window)
    if len(spectrum) < 2:
        return audio

    magnitude = np.abs(spectrum)
    phase = np.angle(spectrum)
    # Phase each bin would advance on its own over one hop; what a frame adds beyond it
    # is the bin's true deviation, and that is what carries over to the stretched frames.
    expected = 2 * np.pi * _HOP * np.arange(spectrum.shape[1]) / _N_FFT

    # Synthesise for the duration that was asked for. Deriving the frame count from the
    # spectrum instead leaves the result short of len(audio) * factor, and pitch_shift
    # resamples that deficit straight into a flat tuning error.
    target = int(round(len(audio) * factor))
    steps = np.arange(target // _HOP + 2) / factor
    out = np.empty((len(steps), spectrum.shape[1]), dtype=np.complex64)
    accumulated = phase[0].copy()
    last = len(spectrum) - 2
    for i, step in enumerate(steps):
        left = min(int(step), last)
        frac = min(step - left, 1.0)
        interpolated = (1.0 - frac) * magnitude[left] + frac * magnitude[left + 1]
        owners = _peak_owners(interpolated)
        locked = accumulated[owners] + phase[left] - phase[left][owners]
        out[i] = interpolated * np.exp(1j * locked)
        deviation = phase[left + 1] - phase[left] - expected
        deviation -= 2 * np.pi * np.round(deviation / (2 * np.pi))
        accumulated = accumulated + expected + deviation

    return _istft(out, window)[:target]


# Fourier resampling rather than interpolation: compressing a signal discards everything
# above the new Nyquist, and linear interpolation folds it back into the audible band
# instead. An upward shift of three semitones put an 11 kHz tone back at 10.9 kHz with
# nearly half its amplitude, which on speech is the sibilants turning metallic.
def _resample(audio: np.ndarray, length: int) -> np.ndarray:
    if length < 1 or len(audio) < 2 or length == len(audio):
        return audio
    spectrum = np.fft.rfft(audio)
    resampled = np.zeros(length // 2 + 1, dtype=np.complex128)
    keep = min(len(spectrum), len(resampled))
    resampled[:keep] = spectrum[:keep]
    # A Nyquist bin stands alone while every other bin stands for a conjugate pair, so a
    # bin that crosses between the two roles changes weight: one that stops being Nyquist
    # would come back at twice its amplitude, one that becomes Nyquist at half.
    if length > len(audio) and len(audio) % 2 == 0:
        resampled[len(audio) // 2] *= 0.5
    elif length < len(audio) and length % 2 == 0:
        resampled[-1] = 2.0 * resampled[-1].real
    return (np.fft.irfft(resampled, n=length) * (length / len(audio))).astype(
        np.float32
    )


def pitch_shift(audio: np.ndarray, semitones: float) -> np.ndarray:
    """Shift pitch by `semitones` while keeping the original duration."""
    audio = np.asarray(audio, dtype=np.float32)
    if audio.size < _N_FFT or not shifts_pitch(semitones):
        return audio
    ratio = 2.0 ** (semitones / 12.0)
    return _resample(time_stretch(audio, ratio), len(audio))
