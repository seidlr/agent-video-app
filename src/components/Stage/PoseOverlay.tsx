import { memo } from 'react';
import type { ReactElement } from 'react';
import { useStudio } from '../../store/studio';

/** The standard MediaPipe Pose skeleton connections (a curated subset of the 33 landmarks --
 * torso, arms, legs -- omitting the finger/toe detail points, which don't read as a skeleton at
 * video-overlay scale). Index reference: 11/12 shoulders, 13/14 elbows, 15/16 wrists, 23/24 hips,
 * 25/26 knees, 27/28 ankles. */
const POSE_CONNECTIONS: [number, number][] = [
  [11, 12], // shoulder to shoulder
  [11, 13],
  [13, 15], // left arm
  [12, 14],
  [14, 16], // right arm
  [11, 23],
  [12, 24], // shoulders to hips
  [23, 24], // hip to hip
  [23, 25],
  [25, 27], // left leg
  [24, 26],
  [26, 28], // right leg
];

const MIN_VISIBILITY = 0.5;

/**
 * Renders `detect_pose`'s most recent result as a skeleton overlay -- reserved `--color-annotate`
 * (agent-drawn overlays), same convention as BoxOverlay/MaskOverlay. Landmarks below
 * MIN_VISIBILITY are skipped (both as joints and as connection endpoints) rather than drawn with
 * a misleadingly confident position.
 */
function PoseOverlayInner(): ReactElement | null {
  const landmarks = useStudio((s) => s.poseLandmarks);
  if (!landmarks || landmarks.length === 0) return null;

  const visible = landmarks.map((l) => l.visibility >= MIN_VISIBILITY);

  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full z-[9]"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {POSE_CONNECTIONS.map(([a, b]) => {
        const pa = landmarks[a];
        const pb = landmarks[b];
        if (!pa || !pb || !visible[a] || !visible[b]) return null;
        return (
          <line
            key={`${a}-${b}`}
            x1={pa.x * 100}
            y1={pa.y * 100}
            x2={pb.x * 100}
            y2={pb.y * 100}
            stroke="var(--color-annotate)"
            strokeWidth={0.5}
            vectorEffect="non-scaling-stroke"
          />
        );
      })}
      {landmarks.map(
        (l, i) =>
          visible[i] && <circle key={i} cx={l.x * 100} cy={l.y * 100} r={0.7} fill="var(--color-annotate)" vectorEffect="non-scaling-stroke" />,
      )}
    </svg>
  );
}

export const PoseOverlay = memo(PoseOverlayInner);
