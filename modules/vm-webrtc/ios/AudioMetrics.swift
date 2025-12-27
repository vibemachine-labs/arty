import AVFoundation
import Accelerate
import Foundation

struct AudioMetrics {
    let timestamp: Date
    let fftMagnitudes: [Float]  // FFT spectrum in dB
    let fftBinCount: Int  // Number of FFT bins

    /// Format metrics as metadata dictionary for logging
    func toMetadata() -> [String: Any] {
        // Log summary statistics for FFT
        let maxMagnitude = fftMagnitudes.max() ?? 0
        let avgMagnitude = fftMagnitudes.reduce(0, +) / Float(fftMagnitudes.count)

        var metadata: [String: Any] = [
            "timestampMs": Int(timestamp.timeIntervalSince1970 * 1000),
            "fftBinCount": fftBinCount,
            "fftMaxDb": (Double(maxMagnitude) * 100).rounded() / 100,
            "fftAvgDb": (Double(avgMagnitude) * 100).rounded() / 100,
        ]

        // Log all bins (for 8-bin downsampled spectrum, send all of them)
        metadata["fftBins"] = fftMagnitudes.map { (Double($0) * 100).rounded() / 100 }

        return metadata
    }
}

// MARK: - FFT Computation

/// Compute FFT spectrum from audio samples using Accelerate framework
/// - Parameter samples: Array of PCM audio samples (Float, normalized -1.0 to 1.0)
/// - Returns: Array of magnitude values in dB, or nil if input is invalid
func computeFFT(samples: [Float]) -> [Float]? {
    // 1️⃣ Ensure power-of-two length
    let n = samples.count
    guard n > 0, (n & (n - 1)) == 0 else {
        return nil  // Sample count must be a power of 2 (e.g., 512, 1024, 2048)
    }

    // 2️⃣ Create Hann window to reduce spectral leakage
    var window = [Float](repeating: 0, count: n)
    vDSP_hann_window(&window, vDSP_Length(n), Int32(vDSP_HANN_NORM))
    var windowed = [Float](repeating: 0, count: n)
    vDSP_vmul(samples, 1, window, 1, &windowed, 1, vDSP_Length(n))

    // 3️⃣ Prepare FFT setup object (log2(n))
    let log2n = vDSP_Length(log2(Float(n)))
    guard let fftSetup = vDSP_create_fftsetup(log2n, Int32(kFFTRadix2)) else {
        return nil
    }
    defer { vDSP_destroy_fftsetup(fftSetup) }

    // 4️⃣ Split complex buffer (real + imag)
    let halfCount = n / 2
    var real = [Float](repeating: 0, count: halfCount)
    var imag = [Float](repeating: 0, count: halfCount)
    var magnitudes = [Float](repeating: 0, count: halfCount)

    // 5️⃣ Convert real samples to split complex format, then perform FFT safely
    real.withUnsafeMutableBufferPointer { realPtr in
        guard let realBase = realPtr.baseAddress else { return }
        imag.withUnsafeMutableBufferPointer { imagPtr in
            guard let imagBase = imagPtr.baseAddress else { return }
            magnitudes.withUnsafeMutableBufferPointer { magnitudesPtr in
                guard let magnitudesBase = magnitudesPtr.baseAddress else { return }

                var splitComplex = DSPSplitComplex(realp: realBase, imagp: imagBase)

                windowed.withUnsafeBufferPointer { bufferPtr in
                    guard let baseAddress = bufferPtr.baseAddress else { return }
                    baseAddress.withMemoryRebound(to: DSPComplex.self, capacity: halfCount) {
                        complexBuf in
                        vDSP_ctoz(complexBuf, 2, &splitComplex, 1, vDSP_Length(halfCount))
                    }
                }

                vDSP_fft_zrip(fftSetup, &splitComplex, 1, log2n, FFTDirection(FFT_FORWARD))
                vDSP_zvmags(&splitComplex, 1, magnitudesBase, 1, vDSP_Length(halfCount))
            }
        }
    }

    // 8️⃣ Convert to dB (with protection against log(0))
    var zeroDB: Float = 1.0
    vDSP_vdbcon(magnitudes, 1, &zeroDB, &magnitudes, 1, vDSP_Length(halfCount), 1)

    return magnitudes
}

// MARK: - Spectrum Downsampling

enum BandScale { case linear, log }

/// Downsample a dB spectrum into fewer visual bars.
/// - Parameters:
///   - dbBins: Magnitude spectrum in dB, length ≈ N/2 (e.g., 512)
///   - sampleRate: e.g., 48000
///   - targetBars: e.g., 8
///   - scale: .log for perceptual spacing, .linear for equal-sized buckets
///   - fMin: lowest freq to visualize (ignored for .linear)
///   - fMax: highest freq to visualize (defaults to Nyquist)
/// - Returns: [Float] length == targetBars, in dB
func downsampleSpectrum(
    dbBins: [Float],
    sampleRate: Float,
    targetBars: Int,
    scale: BandScale = .log,
    fMin: Float = 50,
    fMax: Float? = nil
) -> [Float] {
    let bins = dbBins
    let nb = bins.count
    guard nb > 0, targetBars > 0 else { return Array(repeating: -120, count: max(targetBars, 1)) }

    // Convert dB → linear power (clamp -Inf)
    let eps: Float = 1e-12
    var power = [Float](repeating: 0, count: nb)
    for i in 0..<nb {
        let db = bins[i].isFinite ? bins[i] : -120
        power[i] = powf(10, db / 10.0)
    }

    // Frequency mapping: bin k ~ k * fs / N; here N = 2*nb (half-spectrum)
    let nyquist = (fMax ?? sampleRate / 2)
    let df = sampleRate / Float(2 * nb)

    // Build band boundaries as bin indices
    var edges: [Int] = []
    switch scale {
    case .linear:
        // Equal bin counts per band
        for b in 0...targetBars {
            let idx = Int(round(Float(b) * Float(nb) / Float(targetBars)))
            edges.append(min(max(idx, 0), nb))
        }
    case .log:
        // Log-spaced frequency bands between fMin..nyquist
        let lo = max(fMin, df)  // avoid sub-bin start
        let hi = max(lo, nyquist)
        // logspace over frequency, then map to bins
        func logspace(_ a: Float, _ b: Float, _ n: Int) -> [Float] {
            let la = log10f(a)
            let lb = log10f(b)
            return (0..<n).map { i in
                let t = Float(i) / Float(n - 1)
                return powf(10, la + (lb - la) * t)
            }
        }
        let freqs = logspace(lo, hi, targetBars + 1)
        edges = freqs.map { f in
            let k = Int(round(f / df))
            return min(max(k, 0), nb)
        }
        // Ensure strictly non-decreasing boundaries
        for i in 1..<edges.count { edges[i] = max(edges[i], edges[i - 1]) }
        edges[edges.count - 1] = nb
    }

    // Aggregate power per band, then convert back to dB
    var bars = [Float](repeating: -120, count: targetBars)
    for b in 0..<targetBars {
        let start = edges[b]
        let end = edges[b + 1]
        if end > start {
            // Average power (you could also use max(power[start..<end]) for a punchier look)
            var sum: Float = 0
            vDSP_sve(Array(power[start..<end]), 1, &sum, vDSP_Length(end - start))
            let avgP = sum / Float(end - start)
            let db = 10.0 * log10f(max(avgP, eps))
            bars[b] = db
        } else {
            bars[b] = -120
        }
    }
    return bars
}
