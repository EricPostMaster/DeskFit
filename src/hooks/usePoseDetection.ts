import { useEffect, useRef } from 'react';
import * as poseDetection from '@tensorflow-models/pose-detection';

interface UsePoseDetectionProps {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  enabled: boolean;
  repsTarget: number;
  setRepsCount: (val: number) => void;
  exercise: string; // 'squats' | 'jumping_jacks' | 'shoulder_presses' | 'lateral_raise' | 'knee_raises' | 'bicep_curls' | 'band_pull_aparts'
  overlayRef?: React.RefObject<HTMLCanvasElement | null>;
}

export function usePoseDetection({ videoRef, enabled, repsTarget, setRepsCount, exercise, overlayRef }: UsePoseDetectionProps) {
  const detectorRef = useRef<poseDetection.PoseDetector | null>(null);
  const lastArmUpRef = useRef(false);
  // For per-arm bicep curl detection
  const lastLeftCurlUpRef = useRef(false);
  const lastRightCurlUpRef = useRef(false);
  // Track band pull-apart wide state (both arms moved outward)
  const bandWideRef = useRef(false);
  const lastRepTimeRef = useRef<number>(0);
  const REP_DEBOUNCE_MS = 800;
  const repsCountRef = useRef(0);
  // Keep the maximum webcam dimensions observed during shoulder presses
  const maxVideoSizeRef = useRef<{ width: number; height: number } | null>(null);

  useEffect(() => {
    let animationId: number;

    async function runPoseDetection() {
      if (!videoRef.current) return;
      if (!detectorRef.current) {
        // Try to load MoveNet (default). In some environments TF Hub blocks direct
        // browser access and returns 403 (see runtime error). If that happens,
        // fall back to MediaPipe's BlazePose implementation which is bundled and
        // served from the jsdelivr CDN.
        try {
          // Prefer a locally-hosted MoveNet TFJS model if the developer has placed
          // model files under `public/models/movenet/` (model.json + shards).
          // This avoids remote fetches to tfhub/kaggle and keeps the app
          // deterministic and privacy-friendly.
          // Resolve the local model path against the app base. Vite may serve
          // the app under a subpath (e.g. '/DeskFit/'), so using a root-absolute
          // URL ('/models/...') can return 404. Use import.meta.env.BASE_URL when
          // available to build the correct path.
          const viteBase = (typeof import.meta !== 'undefined' && (import.meta as any).env && (import.meta as any).env.BASE_URL) ? (import.meta as any).env.BASE_URL : '/';
          const baseNoSlash = viteBase.endsWith('/') ? viteBase.slice(0, -1) : viteBase;
          const localModelUrl = `${baseNoSlash}/models/movenet/model.json`;

          const tryLocal = async () => {
            try {
              // createDetector accepts an optional `modelUrl` override via
              // `config.modelUrl` for some backends. The pose-detection API
              // doesn't document every backend's config shape, so we attempt
              // to fetch the local model.json first as a sanity check.
              const res = await fetch(localModelUrl, { method: 'HEAD' });
              if (res.ok) {
                return await poseDetection.createDetector(
                  poseDetection.SupportedModels.MoveNet,
                  { modelUrl: localModelUrl, modelType: poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING }
                );
              }
            } catch (e) {
              // ignore and let fallback happen
            }
            return null;
          };

          // 1) try local
          detectorRef.current = await tryLocal();
          if (!detectorRef.current) {
            // 2) try the canonical MoveNet entry (TF Hub / Kaggle). Recent
            // redirects have moved some TF Hub assets to Kaggle; the pose
            // detection loader will still try TF Hub by default. We attempt
            // to explicitly point at the Kaggle-hosted TFJS model if needed.
            // NOTE: Kaggle pages are HTML, not direct model.json, so the URL
            // below is only useful if the TFJS artifacts are directly hosted
            // at a stable URL. Many Kaggle model pages are not raw file hosts.
            // We'll attempt the default loader first (which may fetch from
            // tfhub) and only fall back to BlazePose on failure.
            detectorRef.current = await poseDetection.createDetector(
              poseDetection.SupportedModels.MoveNet,
              { modelType: poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING }
            );
          }
        } catch (err) {
          // MoveNet failed to load (e.g. 403 from tfhub). Attempt a graceful
          // fallback to BlazePose using the MediaPipe runtime.
          // This keeps pose detection working locally without depending on TF Hub.
          // Note: BlazePose has slightly different characteristics but exposes
          // compatible keypoint names for our usage.
          // Log the original error to help debugging.
          // eslint-disable-next-line no-console
          console.warn('MoveNet model failed to load, falling back to BlazePose (MediaPipe).', err);
          try {
            detectorRef.current = await poseDetection.createDetector(
              poseDetection.SupportedModels.BlazePose,
              { runtime: 'mediapipe', solutionPath: 'https://cdn.jsdelivr.net/npm/@mediapipe/pose' }
            );
          } catch (err2) {
            // Final failure: no detector available. Log and stop.
            // eslint-disable-next-line no-console
            console.error('Failed to initialize any pose detector:', err2);
            return;
          }
        }
      }

      const detect = async () => {
        if (!videoRef.current || videoRef.current.readyState < 2) {
          animationId = requestAnimationFrame(detect);
          return;
        }
        if (!detectorRef.current) {
          animationId = requestAnimationFrame(detect);
          return;
        }

        // Observe intrinsic video dimensions
        const intrinsicW = videoRef.current.videoWidth || videoRef.current.width || 640;
        const intrinsicH = videoRef.current.videoHeight || videoRef.current.height || 480;
        // If we're running shoulder_presses, update the max dimensions
        if (exercise === 'shoulder_presses') {
          if (!maxVideoSizeRef.current) {
            maxVideoSizeRef.current = { width: intrinsicW, height: intrinsicH };
          } else {
            maxVideoSizeRef.current = {
              width: Math.max(maxVideoSizeRef.current.width, intrinsicW),
              height: Math.max(maxVideoSizeRef.current.height, intrinsicH),
            };
          }
        }
        // Apply max size (so all exercises use the shoulder-press webcam area when available)
        if (maxVideoSizeRef.current && videoRef.current) {
          videoRef.current.width = maxVideoSizeRef.current.width;
          videoRef.current.height = maxVideoSizeRef.current.height;
        }

        const poses = await detectorRef.current.estimatePoses(videoRef.current);
        if (poses && poses[0]) {
          const keypoints = poses[0].keypoints;
          const now = Date.now();

          // helper: detect both wrists above respective shoulders
          const armsAboveShoulders = (() => {
            const leftWrist = keypoints.find(k => k.name === 'left_wrist');
            const rightWrist = keypoints.find(k => k.name === 'right_wrist');
            const leftShoulder = keypoints.find(k => k.name === 'left_shoulder');
            const rightShoulder = keypoints.find(k => k.name === 'right_shoulder');
            return !!(leftWrist && rightWrist && leftShoulder && rightShoulder && leftWrist.y < leftShoulder.y && rightWrist.y < rightShoulder.y);
          })();

          if (exercise === 'shoulder_presses' || exercise === 'lateral_raise' || exercise === 'jumping_jacks') {
            // All three use same arms-above-shoulders detection per request
            if (armsAboveShoulders && !lastArmUpRef.current && now - lastRepTimeRef.current > REP_DEBOUNCE_MS) {
              repsCountRef.current = Math.min(repsCountRef.current + 1, repsTarget);
              setRepsCount(repsCountRef.current);
              lastRepTimeRef.current = now;
            }
            lastArmUpRef.current = armsAboveShoulders;
          } else if (exercise === 'squats') {
            // Improved squat detection: average hip at least 0.25x torso length below average shoulder
            const leftHip = keypoints.find(k => k.name === 'left_hip');
            const rightHip = keypoints.find(k => k.name === 'right_hip');
            const leftShoulder = keypoints.find(k => k.name === 'left_shoulder');
            const rightShoulder = keypoints.find(k => k.name === 'right_shoulder');
            if (leftHip && rightHip && leftShoulder && rightShoulder) {
              const avgHipY = (leftHip.y + rightHip.y) / 2;
              const avgShoulderY = (leftShoulder.y + rightShoulder.y) / 2;
              const torsoLength = Math.abs(avgShoulderY - avgHipY);
              const squatThreshold = avgShoulderY + 0.25 * torsoLength;
              const isSquatting = avgHipY > squatThreshold;
              if (isSquatting && !lastArmUpRef.current && now - lastRepTimeRef.current > REP_DEBOUNCE_MS) {
                repsCountRef.current = Math.min(repsCountRef.current + 1, repsTarget);
                setRepsCount(repsCountRef.current);
                lastRepTimeRef.current = now;
              }
              lastArmUpRef.current = isSquatting;
            }
          } else if (exercise === 'knee_raises') {
            // Detect single knee raised to hip level or above (one knee at a time). Count when a knee goes up.
            const leftKnee = keypoints.find(k => k.name === 'left_knee');
            const rightKnee = keypoints.find(k => k.name === 'right_knee');
            const leftHip = keypoints.find(k => k.name === 'left_hip');
            const rightHip = keypoints.find(k => k.name === 'right_hip');
            if (leftKnee && rightKnee && leftHip && rightHip) {
              const leftKneeUp = leftKnee.y < leftHip.y;
              const rightKneeUp = rightKnee.y < rightHip.y;
              const singleKneeUp = (leftKneeUp && !rightKneeUp) || (rightKneeUp && !leftKneeUp);
              if (singleKneeUp && !lastArmUpRef.current && now - lastRepTimeRef.current > REP_DEBOUNCE_MS) {
                repsCountRef.current = Math.min(repsCountRef.current + 1, repsTarget);
                setRepsCount(repsCountRef.current);
                lastRepTimeRef.current = now;
              }
              lastArmUpRef.current = singleKneeUp;
            }
          } else if (exercise === 'bicep_curls') {
            // Bicep curls: detect curls per arm independently. We count a rep when
            // an individual wrist goes from above the elbow (curl up) back down below the elbow.
            const leftWrist = keypoints.find(k => k.name === 'left_wrist');
            const rightWrist = keypoints.find(k => k.name === 'right_wrist');
            const leftElbow = keypoints.find(k => k.name === 'left_elbow');
            const rightElbow = keypoints.find(k => k.name === 'right_elbow');
            if (leftWrist && leftElbow) {
              const leftCurled = leftWrist.y < leftElbow.y;
              if (leftCurled && !lastLeftCurlUpRef.current) {
                lastLeftCurlUpRef.current = true;
              } else if (!leftCurled && lastLeftCurlUpRef.current && now - lastRepTimeRef.current > REP_DEBOUNCE_MS) {
                repsCountRef.current = Math.min(repsCountRef.current + 1, repsTarget);
                setRepsCount(repsCountRef.current);
                lastRepTimeRef.current = now;
                lastLeftCurlUpRef.current = false;
              }
            }
            if (rightWrist && rightElbow) {
              const rightCurled = rightWrist.y < rightElbow.y;
              if (rightCurled && !lastRightCurlUpRef.current) {
                lastRightCurlUpRef.current = true;
              } else if (!rightCurled && lastRightCurlUpRef.current && now - lastRepTimeRef.current > REP_DEBOUNCE_MS) {
                repsCountRef.current = Math.min(repsCountRef.current + 1, repsTarget);
                setRepsCount(repsCountRef.current);
                lastRepTimeRef.current = now;
                lastRightCurlUpRef.current = false;
              }
            }
          } else if (exercise === 'band_pull_aparts') {
            // Band pull-aparts (rear delt): start with hands roughly shoulder-width and in front,
            // then move them outward to the sides. We'll measure horizontal wrist separation
            // relative to shoulder width. Count when the user returns from the wide position
            // back to the starting (narrow) position after a successful outward movement.
            const leftWrist = keypoints.find(k => k.name === 'left_wrist');
            const rightWrist = keypoints.find(k => k.name === 'right_wrist');
            const leftShoulder = keypoints.find(k => k.name === 'left_shoulder');
            const rightShoulder = keypoints.find(k => k.name === 'right_shoulder');
            const leftHip = keypoints.find(k => k.name === 'left_hip');
            const rightHip = keypoints.find(k => k.name === 'right_hip');
            if (leftWrist && rightWrist && leftShoulder && rightShoulder && leftHip && rightHip) {
              const shoulderWidth = Math.abs(leftShoulder.x - rightShoulder.x);
              const wristDistance = Math.abs(leftWrist.x - rightWrist.x);
              const avgShoulderY = (leftShoulder.y + rightShoulder.y) / 2;
              const avgHipY = (leftHip.y + rightHip.y) / 2;
              const torsoLength = Math.abs(avgShoulderY - avgHipY) || 1;
              // Ensure wrists are approximately at shoulder height (horizontal movement)
              const wristsAtShoulderHeight = Math.abs(leftWrist.y - avgShoulderY) < 0.5 * torsoLength && Math.abs(rightWrist.y - avgShoulderY) < 0.5 * torsoLength;
              // Revised per-arm radial logic:
              // - Use each shoulder as the local origin and compute euclidean distance
              //   from shoulder to corresponding wrist. Define a shoulder "radius"
              //   as half the shoulder-to-shoulder distance.
              // - A hand is considered "narrow" when it returns within a fraction
              //   (e.g., 50%) of that radius around its shoulder. We require both
              //   hands to reach the wide state and then both to return to narrow
              //   to count a rep.
              const shoulderRadius = shoulderWidth / 2;
              const NARROW_RADIUS_FRAC = 2.0; // 150% of shoulder radius
              const WIDE_MULTIPLIER = 1.9; // overall separation multiplier to qualify as wide

              const leftDist = Math.hypot(leftWrist.x - leftShoulder.x, leftWrist.y - leftShoulder.y);
              const rightDist = Math.hypot(rightWrist.x - rightShoulder.x, rightWrist.y - rightShoulder.y);

              const leftNarrow = leftDist < NARROW_RADIUS_FRAC * shoulderRadius;
              const rightNarrow = rightDist < NARROW_RADIUS_FRAC * shoulderRadius;
              const narrowBoth = leftNarrow && rightNarrow;

              const wideBoth = wristDistance > WIDE_MULTIPLIER * shoulderWidth && wristsAtShoulderHeight;

              // Cycle detection: require wide -> narrow (both arms) to count.
              // Only enter the "wide" state if both hands are currently outside
              // the narrow radius (prevents immediate count when thresholds overlap)
              // and we respect the debounce window after the last counted rep.
              const nowSinceLast = now - lastRepTimeRef.current;
              const canEnterWide = wideBoth && !bandWideRef.current && !leftNarrow && !rightNarrow && nowSinceLast > REP_DEBOUNCE_MS;
              if (canEnterWide) {
                bandWideRef.current = true;
              } else if (bandWideRef.current && narrowBoth && nowSinceLast > REP_DEBOUNCE_MS) {
                repsCountRef.current = Math.min(repsCountRef.current + 1, repsTarget);
                setRepsCount(repsCountRef.current);
                lastRepTimeRef.current = now;
                bandWideRef.current = false;
              }

              // Draw overlay if provided: show shoulder radius and wrist positions.
              try {
                const canvas = (arguments && arguments.length && (arguments as any)[0]) ? null : null; // noop to keep TS happy
              } catch {}
              if (typeof overlayRef !== 'undefined' && overlayRef && overlayRef.current) {
                const canvas = overlayRef.current;
                const ctx = canvas.getContext('2d');
                if (ctx && videoRef.current) {
                  // video intrinsic (natural) size
                  const intrinsicW = videoRef.current.videoWidth || videoRef.current.width || 640;
                  const intrinsicH = videoRef.current.videoHeight || videoRef.current.height || 480;
                  // the displayed (CSS) size of the canvas
                  const clientW = canvas.clientWidth || intrinsicW;
                  const clientH = canvas.clientHeight || intrinsicH;
                  const dpr = window.devicePixelRatio || 1;
                  const targetW = Math.max(1, Math.round(clientW * dpr));
                  const targetH = Math.max(1, Math.round(clientH * dpr));
                  if (canvas.width !== targetW || canvas.height !== targetH) {
                    canvas.width = targetW;
                    canvas.height = targetH;
                  }
                  // Use a device-pixel-ratio aware transform so drawing uses client pixels
                  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
                  ctx.clearRect(0, 0, clientW, clientH);

                  // Map a point from video intrinsic space -> canvas client space
                  const mapX = (x: number) => (x / intrinsicW) * clientW;
                  const mapY = (y: number) => (y / intrinsicH) * clientH;
                  const mapLen = (l: number) => (l / intrinsicW) * clientW; // approximate scale for radii

                  // Draw shoulder radius circles (orange)
                  ctx.lineWidth = 1;
                  ctx.strokeStyle = 'rgba(255,165,0,0.1)';
                  ctx.beginPath();
                  ctx.arc(mapX(leftShoulder.x), mapY(leftShoulder.y), mapLen(shoulderRadius), 0, Math.PI * 2);
                  ctx.stroke();
                  ctx.beginPath();
                  ctx.arc(mapX(rightShoulder.x), mapY(rightShoulder.y), mapLen(shoulderRadius), 0, Math.PI * 2);
                  ctx.stroke();

                  // Draw narrow inner circle (dashed, green) — thicker for visibility
                  ctx.setLineDash([6, 4]);
                  // preserve previous line width and increase for the dashed circle
                  const prevLineWidth = ctx.lineWidth;
                  ctx.lineWidth = Math.max(6, prevLineWidth * 1.8); // thicker (DPR-aware since transform is set)
                  ctx.strokeStyle = 'rgba(76,175,80,0.95)';
                  ctx.beginPath();
                  ctx.arc(mapX(leftShoulder.x), mapY(leftShoulder.y), mapLen(shoulderRadius * NARROW_RADIUS_FRAC), 0, Math.PI * 2);
                  ctx.stroke();
                  ctx.beginPath();
                  ctx.arc(mapX(rightShoulder.x), mapY(rightShoulder.y), mapLen(shoulderRadius * NARROW_RADIUS_FRAC), 0, Math.PI * 2);
                  ctx.stroke();
                  ctx.setLineDash([]);
                  // restore previous line width
                  ctx.lineWidth = prevLineWidth;

                  // Draw wrists
                  ctx.fillStyle = 'rgba(33,150,243,0.95)';
                  ctx.beginPath(); ctx.arc(mapX(leftWrist.x), mapY(leftWrist.y), 6, 0, Math.PI * 2); ctx.fill();
                  ctx.beginPath(); ctx.arc(mapX(rightWrist.x), mapY(rightWrist.y), 6, 0, Math.PI * 2); ctx.fill();

                  // Draw line between wrists
                  ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 2;
                  ctx.beginPath(); ctx.moveTo(mapX(leftWrist.x), mapY(leftWrist.y)); ctx.lineTo(mapX(rightWrist.x), mapY(rightWrist.y)); ctx.stroke();
                }
              }
            }
          }
        }

        animationId = requestAnimationFrame(detect);
      };

      detect();
    }

    if (enabled && videoRef.current) {
      repsCountRef.current = 0;
      runPoseDetection();
    }

    return () => {
      if (animationId) cancelAnimationFrame(animationId);
      if (detectorRef.current) {
        detectorRef.current.dispose();
        detectorRef.current = null;
      }
      lastArmUpRef.current = false;
      repsCountRef.current = 0;
    };
  }, [enabled, repsTarget, setRepsCount, videoRef, exercise]);
}
