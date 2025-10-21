import { useEffect, useRef } from 'react';
import * as poseDetection from '@tensorflow-models/pose-detection';

interface UsePoseDetectionProps {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  enabled: boolean;
  repsTarget: number;
  setRepsCount: (val: number) => void;
  exercise: string; // 'squats' | 'jumping_jacks' | 'shoulder_presses' | 'lateral_raise' | 'knee_raises'
}

export function usePoseDetection({ videoRef, enabled, repsTarget, setRepsCount, exercise }: UsePoseDetectionProps) {
  const detectorRef = useRef<poseDetection.PoseDetector | null>(null);
  const lastArmUpRef = useRef(false);
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
