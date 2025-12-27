import React, { useEffect, useMemo, useRef, useState } from "react";
import { View } from "react-native";
import Svg, { Rect } from "react-native-svg";

// Optional live mic (comment out if not using):
// @ts-ignore
// import SoundLevel from "react-native-sound-level";

type Props = {
  active?: boolean;
  mode?: "user" | "ai";
  barCount?: number; // total bars INCLUDING both sides if mirror=false
  height?: number; // visual height in px
  width?: number; // if not given, stretches to parent width
  mirror?: boolean; // center-out mirrored layout (like screenshot)
  gap?: number; // px between bars
  radius?: number; // bar corner radius
  smooth?: number; // 0..1 EMA smoothing (e.g., 0.75)
  useMic?: boolean; // requires react-native-sound-level
  samples?: number[]; // external amplitudes (0..1)
};

const USER_COLORS = ["#C084FC", "#A855F7", "#7C3AED"]; // 🕺 purple vibes
const AI_COLORS = ["#34E4EA", "#4D9DE0", "#7B68EE"];

export const MiniVisualizer: React.FC<Props> = ({
  active = true,
  mode = "user",
  barCount = 24,
  height = 60,
  width, // undefined = 100% of container
  mirror = true,
  gap = 3,
  radius = 3,
  smooth = 0.7,
  useMic = false,
  samples,
}) => {
  const [level, setLevel] = useState(0); // mono level 0..1 (mic)
  const [bins, setBins] = useState<number[]>(() =>
    Array(Math.max(4, barCount)).fill(0),
  );
  const emaRef = useRef<number[]>(Array(Math.max(4, barCount)).fill(0));

  // Colors
  const palette = mode === "user" ? USER_COLORS : AI_COLORS;

  // If mirroring, we only compute half and mirror it
  const halfCount = mirror ? Math.floor(barCount / 2) : barCount;

  // Reset EMA when becoming inactive or samples are cleared
  useEffect(() => {
    if (!active || (samples && samples.length === 0)) {
      emaRef.current = Array(Math.max(4, barCount)).fill(0);
      setBins(Array(Math.max(4, barCount)).fill(0));
    }
  }, [active, samples, barCount]);

  // Generate bins from either external samples, mic level, or decorative idle
  useEffect(() => {
    let interval: any;

    // Optional live mic (comment/guard if not installed)
    // if (useMic) {
    //   SoundLevel.start();
    //   SoundLevel.onNewFrame = (data: { value: number }) => {
    //     // data.value ≈ dB; normalize to 0..1 roughly
    //     const db = Math.max(-50, Math.min(0, data.value || -50));
    //     const norm = (db + 50) / 50; // -50..0 -> 0..1
    //     setLevel(norm);
    //   };
    // }

    interval = setInterval(() => {
      let next: number[] = [];

      if (samples && samples.length) {
        // Use external amplitudes (0..1). Reduce/expand to halfCount.
        const step = samples.length / halfCount;
        for (let i = 0; i < halfCount; i++) {
          const idx = Math.floor(i * step);
          next.push(clamp(samples[idx] ?? 0, 0, 1));
        }
      } else if (useMic) {
        // Distribute mono level across bins with slight variance
        for (let i = 0; i < halfCount; i++) {
          const falloff =
            1 - Math.abs(i - (halfCount - 1) / 2) / ((halfCount - 1) / 2 || 1);
          const jitter = (Math.random() - 0.5) * 0.15;
          next.push(clamp(level * (0.6 + 0.4 * falloff) + jitter, 0, 1));
        }
      } else {
        // Decorative idle or "AI talking" drive if active
        for (let i = 0; i < halfCount; i++) {
          if (active) {
            // Active: animated wave
            const phase = (Date.now() / 220 + i * 0.22) % (2 * Math.PI);
            const wave = (Math.sin(phase) + 1) / 2; // 0..1
            next.push(wave * (0.7 + 0.3 * Math.random()));
          } else {
            // Idle: completely invisible (0 height)
            next.push(0);
          }
        }
      }

      // Smooth with EMA for analog feel
      const ema = emaRef.current;
      for (let i = 0; i < halfCount; i++) {
        ema[i] = smooth * (ema[i] ?? 0) + (1 - smooth) * (next[i] ?? 0);
      }
      emaRef.current = ema.slice(0, halfCount);
      setBins(emaRef.current);
    }, 50); // ~20 FPS

    return () => {
      clearInterval(interval);
      // if (useMic) SoundLevel.stop();
    };
  }, [active, samples, useMic, halfCount, smooth, level]);

  // Layout math
  const totalBars = mirror ? halfCount * 2 : halfCount;
  const W = width ?? undefined; // If undefined, View wraps it
  const barWidth = 4; // fixed thin bars (fits mobile)
  const totalGaps = (totalBars + 1) * gap;
  const neededWidth = totalBars * barWidth + totalGaps;

  // Build a mirrored array if needed
  const drawBins = useMemo(() => {
    if (!mirror) return bins;
    const right = bins.slice(); // right side
    const left = bins.slice().reverse(); // mirror on left
    return left.concat(right);
  }, [bins, mirror]);

  // Color per bar (warm gradient like your screenshot)
  const colorFor = (i: number) => palette[i % palette.length];

  return (
    <View
      style={{
        height,
        width: W,
        alignSelf: W ? "auto" : "stretch",
        justifyContent: "center",
      }}
    >
      <Svg height={height} width={neededWidth} style={{ alignSelf: "center" }}>
        {drawBins.map((v, i) => {
          // Don't render bars with no height (inactive state)
          if (v <= 0) return null;

          const h = Math.max(4, v * height);
          const x = gap + i * (barWidth + gap);
          const y = (height - h) / 2; // vertically centered
          return (
            <Rect
              key={i}
              x={x}
              y={y}
              width={barWidth}
              height={h}
              rx={radius}
              ry={radius}
              fill={active ? colorFor(i) : "#333"}
              opacity={active ? 1 : 0.35}
            />
          );
        })}
      </Svg>
    </View>
  );
};

function clamp(n: number, lo: number, hi: number) {
  "worklet"; // harmless hint if you later switch to Reanimated
  return Math.max(lo, Math.min(hi, n));
}
