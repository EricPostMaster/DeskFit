import { useEffect, useRef } from 'react';
import * as poseDetection from '@tensorflow-models/pose-detection';

interface UsePoseDetectionProps {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  enabled: boolean;
  repsTarget: number;
  setRepsCount: (val: number) => void;
  exercise: string; // 'squats' | 'jumping_jacks' | 'shoulder_presses' | 'lateral_raise' | 'knee_raises' | 'bicep_curls' | 'band_pull_aparts' | 'triceps_extensions' | 'low_to_high_chest_flies' | 'svend_chest_press'
  overlayRef?: React.RefObject<HTMLCanvasElement | null>;
}

export function usePoseDetection({ videoRef, enabled, repsTarget, setRepsCount, exercise, overlayRef }: UsePoseDetectionProps) {
  // Simple One Euro filter implementation to reduce jitter in keypoint positions.
  // Based on "The One Euro Filter: A Simple Speed-based Low-pass Filter for
  // Noisy Input in Interactive Systems" by Géry Casiez et al. This is a
  // lightweight JS/TS port suitable for smoothing 2D keypoint coordinates.
  class OneEuroFilter {
    private freq: number; // sampling frequency (Hz)
    private minCutoff: number;
    private beta: number;
    private dCutoff: number;
    private lastTime: number | null = null;
    private xPrev: number | null = null;
    private dxPrev: number | null = null;

    constructor(freq = 30, minCutoff = 1.0, beta = 0.0, dCutoff = 1.0) {
      this.freq = freq;
      this.minCutoff = minCutoff;
      this.beta = beta;
      this.dCutoff = dCutoff;
    }

    // exponential smoothing helper
    private alpha(cutoff: number) {
      const tau = 1.0 / (2 * Math.PI * cutoff);
      const te = 1.0 / Math.max(1e-6, this.freq);
      return 1.0 / (1.0 + tau / te);
    }

    // call with (value, timestampMs)
    filter(value: number, timestampMs?: number) {
      const t = timestampMs != null ? timestampMs / 1000 : (this.lastTime != null ? this.lastTime + 1.0 / this.freq : 0);
      if (this.lastTime == null) {
        this.lastTime = t;
      } else if (t !== this.lastTime) {
        this.freq = 1.0 / Math.max(1e-6, t - this.lastTime);
        this.lastTime = t;
      }

      if (this.xPrev == null) {
        this.xPrev = value;
        this.dxPrev = 0;
        return value;
      }

      const dx = (value - this.xPrev) * this.freq;
      const edx = this.dxPrev == null ? dx : this.dxPrev + this.alpha(this.dCutoff) * (dx - this.dxPrev);
      const cutoff = this.minCutoff + this.beta * Math.abs(edx);
      const a = this.alpha(cutoff);
      const x = this.xPrev + a * (value - this.xPrev);

      this.xPrev = x;
      this.dxPrev = edx;
      return x;
    }
  }

  // Map of per-keypoint filters: `${name}.x` and `${name}.y` will be keys
  const kpFilterMapRef = useRef<Map<string, { x: OneEuroFilter; y: OneEuroFilter }>>(new Map());
  const detectorRef = useRef<poseDetection.PoseDetector | null>(null);
  const lastArmUpRef = useRef(false);
  // Track squat-specific baseline measurements captured when the exercise starts
  const squatBaselineCapturedRef = useRef(false);
  const squatBaselineShoulderYRef = useRef<number | null>(null);
  const squatBaselineTorsoLenRef = useRef<number | null>(null);
  // Rolling buffer to collect recent torso lengths & shoulder positions so we
  // can capture a baseline only when the user appears to be standing upright
  // (i.e., torso length is near the maximum observed in the short window).
  const squatRecentTorsoLensRef = useRef<number[]>([]);
  const SQUAT_BASELINE_WINDOW = 10; // number of frames to consider
  const SQUAT_BASELINE_MIN_REL_MAX = 0.92; // require torso >= 92% of window max
  const SQUAT_BASELINE_MAX_STDDEV = 6; // px-ish stability threshold
  // For per-arm bicep curl detection
  const lastLeftCurlUpRef = useRef(false);
  const lastRightCurlUpRef = useRef(false);
  // For per-arm triceps extension detection (wrist above elbow = extended)
  const lastLeftTricepsExtendedRef = useRef(false);
  const lastRightTricepsExtendedRef = useRef(false);
  // Track band pull-apart wide state (both arms moved outward)
  const bandWideRef = useRef(false);
  // Track Svend chest press extended state (either wrist extended outward)
  const svendExtendedRef = useRef(false);
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

            // Apply smoothing to each detected keypoint using per-keypoint OneEuro filters.
            // We produce a parallel array `smoothedKeypoints` with the same shape.
            const smoothedKeypoints = (keypoints as any).map((kp: any) => {
              // Initialize filters for this keypoint name if needed
              if (!kpFilterMapRef.current.has(kp.name)) {
                // Default parameters: assume ~30Hz input, mild smoothing
                kpFilterMapRef.current.set(kp.name, { x: new OneEuroFilter(30, 1.0, 0.007, 1.0), y: new OneEuroFilter(30, 1.0, 0.007, 1.0) });
              }
              const f = kpFilterMapRef.current.get(kp.name)!;
              const sx = f.x.filter(kp.x, now);
              const sy = f.y.filter(kp.y, now);
              return { ...kp, x: sx, y: sy };
            });


            // Draw overlay if provided: show keypoints and squat baseline/threshold
            if (typeof overlayRef !== 'undefined' && overlayRef && overlayRef.current && videoRef.current) {
              try {
                const canvas = overlayRef.current;
                const ctx = canvas.getContext('2d');
                if (ctx) {
                  const intrinsicW = videoRef.current.videoWidth || videoRef.current.width || 640;
                  const intrinsicH = videoRef.current.videoHeight || videoRef.current.height || 480;
                  const clientW = canvas.clientWidth || intrinsicW;
                  const clientH = canvas.clientHeight || intrinsicH;
                  const dpr = window.devicePixelRatio || 1;
                  const targetW = Math.max(1, Math.round(clientW * dpr));
                  const targetH = Math.max(1, Math.round(clientH * dpr));
                  if (canvas.width !== targetW || canvas.height !== targetH) {
                    canvas.width = targetW;
                    canvas.height = targetH;
                  }
                  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
                  ctx.clearRect(0, 0, clientW, clientH);

                  const mapX = (x: number) => (x / intrinsicW) * clientW;
                  const mapY = (y: number) => (y / intrinsicH) * clientH;

                  const drawCircle = (x: number, y: number, r: number, fill: string) => {
                    ctx.beginPath(); ctx.arc(mapX(x), mapY(y), r, 0, Math.PI * 2); ctx.fillStyle = fill; ctx.fill();
                  };

                  // Draw text labels in a way that remains readable even though
                  // the canvas element is visually mirrored with CSS
                  const drawLabel = (text: string, x: number, y: number, color = 'white') => {
                    try {
                      ctx.save();
                      // Pre-flip drawing so the CSS scaleX(-1) on the canvas
                      // double-flips the text and makes it readable.
                      ctx.translate(clientW, 0);
                      ctx.scale(-1, 1);
                      ctx.fillStyle = color;
                      ctx.font = '12px sans-serif';
                      ctx.fillText(text, x, y);
                    } finally {
                      ctx.restore();
                    }
                  };

                  const kpByName = (name: string) => (smoothedKeypoints as any).find((k: any) => k.name === name);
                  const leftShoulder = kpByName('left_shoulder');
                  const rightShoulder = kpByName('right_shoulder');
                  const leftHip = kpByName('left_hip');
                  const rightHip = kpByName('right_hip');
                  const leftWrist = kpByName('left_wrist');
                  const rightWrist = kpByName('right_wrist');
                  const leftKnee = kpByName('left_knee');
                  const rightKnee = kpByName('right_knee');
                  const leftElbow = kpByName('left_elbow');
                  const rightElbow = kpByName('right_elbow');

                  if (leftShoulder) drawCircle(leftShoulder.x, leftShoulder.y, 5, 'rgba(255,165,0,0.95)');
                  if (rightShoulder) drawCircle(rightShoulder.x, rightShoulder.y, 5, 'rgba(255,165,0,0.95)');
                  if (leftHip) drawCircle(leftHip.x, leftHip.y, 5, 'rgba(76,175,80,0.95)');
                  if (rightHip) drawCircle(rightHip.x, rightHip.y, 5, 'rgba(76,175,80,0.95)');
                  if (leftWrist) drawCircle(leftWrist.x, leftWrist.y, 4, 'rgba(33,150,243,0.95)');
                  if (rightWrist) drawCircle(rightWrist.x, rightWrist.y, 4, 'rgba(33,150,243,0.95)');
                  if (leftKnee) drawCircle(leftKnee.x, leftKnee.y, 3, 'rgba(200,200,200,0.95)');
                  if (rightKnee) drawCircle(rightKnee.x, rightKnee.y, 3, 'rgba(200,200,200,0.95)');

                  // Visual guidance for shoulder-presses, lateral-raises and jumping-jacks
                  // Show shoulder line, a target line above the head (arms-up), and
                  // color-coded wrist markers (green when above shoulder, red otherwise).
                  if (exercise === 'shoulder_presses' || exercise === 'lateral_raise' || exercise === 'jumping_jacks') {
                    if (leftShoulder && rightShoulder && leftHip && rightHip) {
                      const avgShoulderY = (leftShoulder.y + rightShoulder.y) / 2;
                      const avgHipY = (leftHip.y + rightHip.y) / 2;
                      const torsoLen = Math.max(1, Math.abs(avgShoulderY - avgHipY));

                      // Target line a bit above the shoulders (fraction of torso length).
                      // Lateral raises often target roughly shoulder height; for simplicity
                      // use slightly different targets per exercise.
                      const targetOffsetFrac = exercise === 'lateral_raise' ? 0.0 : 0.35; // lateral: target at shoulder, others: above
                      const targetY = avgShoulderY - targetOffsetFrac * torsoLen;

                      // Draw shoulder baseline (solid orange)
                      ctx.strokeStyle = 'rgba(255,165,0,0.9)'; ctx.lineWidth = 2; ctx.setLineDash([]);
                      ctx.beginPath(); ctx.moveTo(0, mapY(avgShoulderY)); ctx.lineTo(clientW, mapY(avgShoulderY)); ctx.stroke();
                      drawLabel('shoulder', 6, Math.max(12, mapY(avgShoulderY) - 6), 'rgba(255,165,0,0.9)');

                      // Draw target (dashed green)
                      ctx.strokeStyle = 'rgba(76,175,80,0.95)'; ctx.lineWidth = 2; ctx.setLineDash([6,4]);
                      ctx.beginPath(); ctx.moveTo(0, mapY(targetY)); ctx.lineTo(clientW, mapY(targetY)); ctx.stroke();
                      ctx.setLineDash([]);
                      drawLabel(exercise === 'lateral_raise' ? 'target (arm level)' : 'target (arms up)', 6, Math.max(12, mapY(targetY) - 6), 'rgba(76,175,80,0.95)');

                      // Color wrists by whether they meet the 'above shoulder' condition
                      const leftWristAbove = !!(leftWrist && leftShoulder && leftWrist.y < leftShoulder.y);
                      const rightWristAbove = !!(rightWrist && rightShoulder && rightWrist.y < rightShoulder.y);
                      const leftColor = leftWristAbove ? 'rgba(76,175,80,0.95)' : 'rgba(244,67,54,0.95)';
                      const rightColor = rightWristAbove ? 'rgba(76,175,80,0.95)' : 'rgba(244,67,54,0.95)';

                      if (leftWrist) drawCircle(leftWrist.x, leftWrist.y, 6, leftColor);
                      if (rightWrist) drawCircle(rightWrist.x, rightWrist.y, 6, rightColor);

                      // Connect shoulders to target positions for visual guidance
                      ctx.strokeStyle = 'rgba(255,255,255,0.45)'; ctx.lineWidth = 1;
                      ctx.beginPath(); ctx.moveTo(mapX(leftShoulder.x), mapY(leftShoulder.y)); ctx.lineTo(mapX(leftShoulder.x), mapY(targetY)); ctx.stroke();
                      ctx.beginPath(); ctx.moveTo(mapX(rightShoulder.x), mapY(rightShoulder.y)); ctx.lineTo(mapX(rightShoulder.x), mapY(targetY)); ctx.stroke();
                    }
                  }

                  if (exercise === 'squats' && leftHip && rightHip && leftShoulder && rightShoulder) {
                    const avgHipY = (leftHip.y + rightHip.y) / 2;
                    const avgShoulderY = (leftShoulder.y + rightShoulder.y) / 2;
                    const baselineShoulderY = squatBaselineShoulderYRef.current ?? avgShoulderY;
                    const baselineTorso = (squatBaselineTorsoLenRef.current ?? Math.abs(avgShoulderY - avgHipY)) || 1;
                    const waistY = baselineShoulderY + 0.5 * baselineTorso;
                    const squatThresholdHipY = waistY + 0.2 * baselineTorso;

                    const drawH = (y: number, color: string, label?: string, dash?: boolean) => {
                      ctx.strokeStyle = color; ctx.lineWidth = 2; if (dash) ctx.setLineDash([6,4]); else ctx.setLineDash([]);
                      ctx.beginPath(); ctx.moveTo(0, mapY(y)); ctx.lineTo(clientW, mapY(y)); ctx.stroke(); ctx.setLineDash([]);
                      if (label) {
                        drawLabel(label, 6, Math.max(12, mapY(y) - 6), color);
                      }
                    };

                    drawH(baselineShoulderY, 'rgba(255,165,0,0.9)', 'baseline shoulder', true);
                    drawH(waistY, 'rgba(255,206,84,0.9)', 'waist', true);
                    drawH(squatThresholdHipY, 'rgba(244,67,54,0.9)', 'squat threshold', false);

                    const isSquattingNow = avgHipY >= squatThresholdHipY;
                    ctx.beginPath(); ctx.arc(mapX((leftHip.x + rightHip.x)/2), mapY(avgHipY), 8, 0, Math.PI * 2);
                    ctx.fillStyle = isSquattingNow ? 'rgba(244,67,54,0.6)' : 'rgba(33,150,243,0.5)'; ctx.fill();
                  }

                  // Knee raise overlay: draw hip level and mark knee when raised
                  if (exercise === 'knee_raises' && leftHip && rightHip && leftShoulder && rightShoulder) {
                    const avgHipY = (leftHip.y + rightHip.y) / 2;
                    const avgShoulderY = (leftShoulder.y + rightShoulder.y) / 2;
                    const torsoLen = Math.abs(avgShoulderY - avgHipY) || 1;
                    // Allow a small fraction below hip level so lower-mobility users
                    // can still be detected. This is scaled by torso length to be
                    // robust across different camera distances / user sizes.
                    const KNEE_RAISE_ALLOWANCE_FRAC = 0.08; // 8% of torso length below hip
                    const allowance = KNEE_RAISE_ALLOWANCE_FRAC * torsoLen;
                    const visualTargetY = avgHipY + allowance; // a little below hip

                    // hip+allowance line (dashed yellow)
                    ctx.strokeStyle = 'rgba(255,206,84,0.95)'; ctx.lineWidth = 2; ctx.setLineDash([6,4]);
                    ctx.beginPath(); ctx.moveTo(0, mapY(visualTargetY)); ctx.lineTo(clientW, mapY(visualTargetY)); ctx.stroke(); ctx.setLineDash([]);
                    drawLabel('hip level (target)', 6, Math.max(12, mapY(visualTargetY) - 6), 'rgba(255,206,84,0.95)');
                    // mark knees: green if above the (relaxed) target, orange otherwise
                    if (leftKnee) drawCircle(leftKnee.x, leftKnee.y, 6, leftKnee.y < (leftHip.y + allowance) ? 'rgba(76,175,80,0.95)' : 'rgba(255,165,0,0.95)');
                    if (rightKnee) drawCircle(rightKnee.x, rightKnee.y, 6, rightKnee.y < (rightHip.y + allowance) ? 'rgba(76,175,80,0.95)' : 'rgba(255,165,0,0.95)');
                  }

                  // Bicep curl overlay: draw elbow baseline and color wrists by curl state
                  if (exercise === 'bicep_curls' && (leftElbow || rightElbow) && (leftWrist || rightWrist)) {
                    // Draw a short, centered horizontal tick at each elbow x position
                    // so the marker stays aligned with the detected elbow regardless
                    // of canvas mirroring or intrinsic/client coordinate transforms.
                    const tickHalf = Math.max(10, clientW * 0.06); // half-width of tick in client pixels
                    ctx.strokeStyle = 'rgba(33,150,243,0.9)'; ctx.lineWidth = 2; ctx.setLineDash([]);
                    if (leftElbow) {
                      const cx = mapX(leftElbow.x);
                      ctx.beginPath(); ctx.moveTo(cx - tickHalf, mapY(leftElbow.y)); ctx.lineTo(cx + tickHalf, mapY(leftElbow.y)); ctx.stroke();
                    }
                    if (rightElbow) {
                      const cx = mapX(rightElbow.x);
                      ctx.beginPath(); ctx.moveTo(cx - tickHalf, mapY(rightElbow.y)); ctx.lineTo(cx + tickHalf, mapY(rightElbow.y)); ctx.stroke();
                    }

                    // color wrists: green when wrist above elbow (curl), orange otherwise
                    if (leftWrist && leftElbow) {
                      const curled = leftWrist.y < leftElbow.y;
                      drawCircle(leftWrist.x, leftWrist.y, 6, curled ? 'rgba(76,175,80,0.95)' : 'rgba(255,165,0,0.95)');
                    }
                    if (rightWrist && rightElbow) {
                      const curled = rightWrist.y < rightElbow.y;
                      drawCircle(rightWrist.x, rightWrist.y, 6, curled ? 'rgba(76,175,80,0.95)' : 'rgba(255,165,0,0.95)');
                    }
                  }

                  // Triceps extension overlay: draw eye level, elbow positions, and color wrists by extension state
                  if (exercise === 'triceps_extensions') {
                    const leftEye = kpByName('left_eye');
                    const rightEye = kpByName('right_eye');
                    
                    if (leftEye && rightEye) {
                      const avgEyeY = (leftEye.y + rightEye.y) / 2;
                      
                      // Draw eye level line (dashed purple)
                      ctx.strokeStyle = 'rgba(156,39,176,0.9)'; ctx.lineWidth = 2; ctx.setLineDash([6,4]);
                      ctx.beginPath(); ctx.moveTo(0, mapY(avgEyeY)); ctx.lineTo(clientW, mapY(avgEyeY)); ctx.stroke();
                      ctx.setLineDash([]);
                      drawLabel('eye level (elbow must be above)', 6, Math.max(12, mapY(avgEyeY) - 6), 'rgba(156,39,176,0.9)');
                      
                      // Draw elbow markers: green if above eye level, red if below
                      if (leftElbow) {
                        const elbowAboveEye = leftElbow.y < avgEyeY;
                        drawCircle(leftElbow.x, leftElbow.y, 6, elbowAboveEye ? 'rgba(76,175,80,0.95)' : 'rgba(244,67,54,0.95)');
                      }
                      if (rightElbow) {
                        const elbowAboveEye = rightElbow.y < avgEyeY;
                        drawCircle(rightElbow.x, rightElbow.y, 6, elbowAboveEye ? 'rgba(76,175,80,0.95)' : 'rgba(244,67,54,0.95)');
                      }
                      
                      // Color wrists: green when above elbow (extended), orange when below (flexed)
                      if (leftWrist && leftElbow) {
                        const elbowAboveEye = leftElbow.y < avgEyeY;
                        const extended = leftWrist.y < leftElbow.y;
                        let color = 'rgba(128,128,128,0.95)'; // gray if elbow not above eye
                        if (elbowAboveEye) {
                          color = extended ? 'rgba(76,175,80,0.95)' : 'rgba(255,165,0,0.95)'; // green=extended, orange=flexed
                        }
                        drawCircle(leftWrist.x, leftWrist.y, 6, color);
                      }
                      if (rightWrist && rightElbow) {
                        const elbowAboveEye = rightElbow.y < avgEyeY;
                        const extended = rightWrist.y < rightElbow.y;
                        let color = 'rgba(128,128,128,0.95)'; // gray if elbow not above eye
                        if (elbowAboveEye) {
                          color = extended ? 'rgba(76,175,80,0.95)' : 'rgba(255,165,0,0.95)'; // green=extended, orange=flexed
                        }
                        drawCircle(rightWrist.x, rightWrist.y, 6, color);
                      }
                    }
                  }
                }
              } catch (e) {
                // don't let overlay drawing break detection
              }
            }

          // helper: detect both wrists above respective shoulders (use smoothed points)
          const armsAboveShoulders = (() => {
            const leftWrist = smoothedKeypoints.find((k: any) => k.name === 'left_wrist');
            const rightWrist = smoothedKeypoints.find((k: any) => k.name === 'right_wrist');
            const leftShoulder = smoothedKeypoints.find((k: any) => k.name === 'left_shoulder');
            const rightShoulder = smoothedKeypoints.find((k: any) => k.name === 'right_shoulder');
            return !!(leftWrist && rightWrist && leftShoulder && rightShoulder && leftWrist.y < leftShoulder.y && rightWrist.y < rightShoulder.y);
          })();

          if (exercise === 'shoulder_presses' || exercise === 'lateral_raise' || exercise === 'jumping_jacks' || exercise === 'low_to_high_chest_flies') {
            // All four use same arms-above-shoulders detection per request
            if (armsAboveShoulders && !lastArmUpRef.current && now - lastRepTimeRef.current > REP_DEBOUNCE_MS) {
              repsCountRef.current = Math.min(repsCountRef.current + 1, repsTarget);
              setRepsCount(repsCountRef.current);
              lastRepTimeRef.current = now;
            }
            lastArmUpRef.current = armsAboveShoulders;
            
            // Draw overlay for chest flies: show shoulder height reference and wrist positions
            if (exercise === 'low_to_high_chest_flies' && typeof overlayRef !== 'undefined' && overlayRef && overlayRef.current) {
              const leftWrist = keypoints.find(k => k.name === 'left_wrist');
              const rightWrist = keypoints.find(k => k.name === 'right_wrist');
              const leftShoulder = keypoints.find(k => k.name === 'left_shoulder');
              const rightShoulder = keypoints.find(k => k.name === 'right_shoulder');
              if (leftWrist && rightWrist && leftShoulder && rightShoulder) {
                const canvas = overlayRef.current;
                const ctx = canvas.getContext('2d');
                if (ctx && videoRef.current) {
                  const intrinsicW = videoRef.current.videoWidth || videoRef.current.width || 640;
                  const intrinsicH = videoRef.current.videoHeight || videoRef.current.height || 480;
                  const clientW = canvas.clientWidth || intrinsicW;
                  const clientH = canvas.clientHeight || intrinsicH;
                  const dpr = window.devicePixelRatio || 1;
                  const targetW = Math.max(1, Math.round(clientW * dpr));
                  const targetH = Math.max(1, Math.round(clientH * dpr));
                  if (canvas.width !== targetW || canvas.height !== targetH) {
                    canvas.width = targetW;
                    canvas.height = targetH;
                  }
                  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
                  ctx.clearRect(0, 0, clientW, clientH);
                  
                  const mapX = (x: number) => (x / intrinsicW) * clientW;
                  const mapY = (y: number) => (y / intrinsicH) * clientH;
                  
                  // Draw shoulder height reference line (green when wrists above, orange when below)
                  const avgShoulderY = (leftShoulder.y + rightShoulder.y) / 2;
                  ctx.strokeStyle = armsAboveShoulders ? 'rgba(76,175,80,0.8)' : 'rgba(255,165,0,0.8)';
                  ctx.lineWidth = 3;
                  ctx.setLineDash([8, 4]);
                  ctx.beginPath();
                  ctx.moveTo(0, mapY(avgShoulderY));
                  ctx.lineTo(clientW, mapY(avgShoulderY));
                  ctx.stroke();
                  ctx.setLineDash([]);
                  
                  // Draw wrists
                  ctx.fillStyle = armsAboveShoulders ? 'rgba(76,175,80,0.9)' : 'rgba(255,165,0,0.9)';
                  ctx.beginPath(); ctx.arc(mapX(leftWrist.x), mapY(leftWrist.y), 8, 0, Math.PI * 2); ctx.fill();
                  ctx.beginPath(); ctx.arc(mapX(rightWrist.x), mapY(rightWrist.y), 8, 0, Math.PI * 2); ctx.fill();
                  
                  // Draw shoulders for reference
                  ctx.fillStyle = 'rgba(33,150,243,0.7)';
                  ctx.beginPath(); ctx.arc(mapX(leftShoulder.x), mapY(leftShoulder.y), 6, 0, Math.PI * 2); ctx.fill();
                  ctx.beginPath(); ctx.arc(mapX(rightShoulder.x), mapY(rightShoulder.y), 6, 0, Math.PI * 2); ctx.fill();
                }
              }
            }
          } else if (exercise === 'squats') {
            // Squat detection (revised): use a short "baseline" captured at the
            // start of the exercise (first good frame) to compute waist/torso
            // measurements. Count a squat when the average hips drop below
            // (waist + 20% of torso height) relative to that baseline. Using
            // hips (not shoulders) avoids false positives when the user leans
            // the torso forward.
            const leftHip = smoothedKeypoints.find((k: any) => k.name === 'left_hip');
            const rightHip = smoothedKeypoints.find((k: any) => k.name === 'right_hip');
            const leftShoulder = smoothedKeypoints.find((k: any) => k.name === 'left_shoulder');
            const rightShoulder = smoothedKeypoints.find((k: any) => k.name === 'right_shoulder');
            if (leftHip && rightHip && leftShoulder && rightShoulder) {
              const avgHipY = (leftHip.y + rightHip.y) / 2;
              const avgShoulderY = (leftShoulder.y + rightShoulder.y) / 2;

              // Maintain rolling window of torso lengths
              const currentTorsoLen = Math.abs(avgShoulderY - avgHipY) || 1;
              const arr = squatRecentTorsoLensRef.current;
              arr.push(currentTorsoLen);
              if (arr.length > SQUAT_BASELINE_WINDOW) arr.shift();

              // Compute simple statistics for the window (max and stddev)
              const windowMax = Math.max(...arr);
              const mean = arr.reduce((s, v) => s + v, 0) / arr.length;
              const variance = arr.reduce((s, v) => s + (v - mean) * (v - mean), 0) / arr.length;
              const stddev = Math.sqrt(variance);

              // Capture baseline only when we haven't captured one yet and the
              // recent torso lengths are stable (low stddev) and current torso
              // is near the window's maximum (user is likely standing tall).
              if (!squatBaselineCapturedRef.current && arr.length >= Math.min(SQUAT_BASELINE_WINDOW, 4)) {
                const relToMax = currentTorsoLen / (windowMax || 1);
                if (relToMax >= SQUAT_BASELINE_MIN_REL_MAX && stddev <= SQUAT_BASELINE_MAX_STDDEV) {
                  squatBaselineShoulderYRef.current = avgShoulderY;
                  squatBaselineTorsoLenRef.current = currentTorsoLen;
                  squatBaselineCapturedRef.current = true;
                }
              }

              const baselineShoulderY = squatBaselineShoulderYRef.current ?? avgShoulderY;
              const baselineTorso = (squatBaselineTorsoLenRef.current ?? currentTorsoLen) || 1;

              // Approximate waist as halfway between shoulder and hip in the
              // baseline pose. Require hips to drop to waist + 20% torso.
              const waistY = baselineShoulderY + 0.5 * baselineTorso;
              const squatThresholdHipY = waistY + 0.2 * baselineTorso;

              const isSquatting = avgHipY >= squatThresholdHipY;

              if (isSquatting && !lastArmUpRef.current && now - lastRepTimeRef.current > REP_DEBOUNCE_MS) {
                repsCountRef.current = Math.min(repsCountRef.current + 1, repsTarget);
                setRepsCount(repsCountRef.current);
                lastRepTimeRef.current = now;
              }
              lastArmUpRef.current = isSquatting;
            }
          } else if (exercise === 'knee_raises') {
            // Detect single knee raised to hip level or slightly below (one knee at a time).
            // We compute a torso-scaled allowance so the threshold adapts to user size
            // and camera distance. This mirrors the overlay's visual target.
            const leftKnee = smoothedKeypoints.find((k: any) => k.name === 'left_knee');
            const rightKnee = smoothedKeypoints.find((k: any) => k.name === 'right_knee');
            const leftHip = smoothedKeypoints.find((k: any) => k.name === 'left_hip');
            const rightHip = smoothedKeypoints.find((k: any) => k.name === 'right_hip');
            const leftShoulder = smoothedKeypoints.find((k: any) => k.name === 'left_shoulder');
            const rightShoulder = smoothedKeypoints.find((k: any) => k.name === 'right_shoulder');
            if (leftKnee && rightKnee && leftHip && rightHip && leftShoulder && rightShoulder) {
              const avgHipY = (leftHip.y + rightHip.y) / 2;
              const avgShoulderY = (leftShoulder.y + rightShoulder.y) / 2;
              const torsoLen = Math.abs(avgShoulderY - avgHipY) || 1;
              const KNEE_RAISE_ALLOWANCE_FRAC = 0.08; // must stay in sync with overlay
              const allowance = KNEE_RAISE_ALLOWANCE_FRAC * torsoLen;

              const leftKneeUp = leftKnee.y < (leftHip.y + allowance);
              const rightKneeUp = rightKnee.y < (rightHip.y + allowance);
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
            const leftWrist = smoothedKeypoints.find((k: any) => k.name === 'left_wrist');
            const rightWrist = smoothedKeypoints.find((k: any) => k.name === 'right_wrist');
            const leftElbow = smoothedKeypoints.find((k: any) => k.name === 'left_elbow');
            const rightElbow = smoothedKeypoints.find((k: any) => k.name === 'right_elbow');
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
          } else if (exercise === 'triceps_extensions') {
            // Triceps extensions: per-arm independent tracking similar to bicep curls but inverted.
            // Track when wrist goes from above elbow (extended) -> below elbow (flexed) -> back above (extended).
            // Require elbow to be above eye level for safety and proper form.
            const leftWrist = smoothedKeypoints.find((k: any) => k.name === 'left_wrist');
            const rightWrist = smoothedKeypoints.find((k: any) => k.name === 'right_wrist');
            const leftElbow = smoothedKeypoints.find((k: any) => k.name === 'left_elbow');
            const rightElbow = smoothedKeypoints.find((k: any) => k.name === 'right_elbow');
            const leftEye = smoothedKeypoints.find((k: any) => k.name === 'left_eye');
            const rightEye = smoothedKeypoints.find((k: any) => k.name === 'right_eye');
            
            // Average eye position for validation
            const avgEyeY = (leftEye && rightEye) ? (leftEye.y + rightEye.y) / 2 : null;
            
            // Left arm triceps extension detection
            if (leftWrist && leftElbow && avgEyeY !== null) {
              const elbowAboveEye = leftElbow.y < avgEyeY; // elbow must be above eye level
              const wristAboveElbow = leftWrist.y < leftElbow.y; // extended position
              
              if (elbowAboveEye) {
                if (!wristAboveElbow && !lastLeftTricepsExtendedRef.current) {
                  // Entering flexed position (wrist below elbow)
                  lastLeftTricepsExtendedRef.current = true;
                } else if (wristAboveElbow && lastLeftTricepsExtendedRef.current && now - lastRepTimeRef.current > REP_DEBOUNCE_MS) {
                  // Completing rep: went from extended -> flexed -> back to extended
                  repsCountRef.current = Math.min(repsCountRef.current + 1, repsTarget);
                  setRepsCount(repsCountRef.current);
                  lastRepTimeRef.current = now;
                  lastLeftTricepsExtendedRef.current = false;
                }
              }
            }
            
            // Right arm triceps extension detection
            if (rightWrist && rightElbow && avgEyeY !== null) {
              const elbowAboveEye = rightElbow.y < avgEyeY; // elbow must be above eye level
              const wristAboveElbow = rightWrist.y < rightElbow.y; // extended position
              
              if (elbowAboveEye) {
                if (!wristAboveElbow && !lastRightTricepsExtendedRef.current) {
                  // Entering flexed position (wrist below elbow)
                  lastRightTricepsExtendedRef.current = true;
                } else if (wristAboveElbow && lastRightTricepsExtendedRef.current && now - lastRepTimeRef.current > REP_DEBOUNCE_MS) {
                  // Completing rep: went from extended -> flexed -> back to extended
                  repsCountRef.current = Math.min(repsCountRef.current + 1, repsTarget);
                  setRepsCount(repsCountRef.current);
                  lastRepTimeRef.current = now;
                  lastRightTricepsExtendedRef.current = false;
                }
              }
            }
          } else if (exercise === 'band_pull_aparts') {
            // Band pull-aparts (rear delt): start with hands roughly shoulder-width and in front,
            // then move them outward to the sides. We'll measure horizontal wrist separation
            // relative to shoulder width. Count when the user returns from the wide position
            // back to the starting (narrow) position after a successful outward movement.
            const leftWrist = smoothedKeypoints.find((k: any) => k.name === 'left_wrist');
            const rightWrist = smoothedKeypoints.find((k: any) => k.name === 'right_wrist');
            const leftShoulder = smoothedKeypoints.find((k: any) => k.name === 'left_shoulder');
            const rightShoulder = smoothedKeypoints.find((k: any) => k.name === 'right_shoulder');
            const leftHip = smoothedKeypoints.find((k: any) => k.name === 'left_hip');
            const rightHip = smoothedKeypoints.find((k: any) => k.name === 'right_hip');
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
          } else if (exercise === 'svend_chest_press') {
            // Svend chest press: track both wrists with shoulder-to-elbow + 50% radius.
            // Count rep when either wrist extends beyond radius then returns (sideways positioning).
            const leftWrist = keypoints.find(k => k.name === 'left_wrist');
            const rightWrist = keypoints.find(k => k.name === 'right_wrist');
            const leftShoulder = keypoints.find(k => k.name === 'left_shoulder');
            const rightShoulder = keypoints.find(k => k.name === 'right_shoulder');
            const leftElbow = keypoints.find(k => k.name === 'left_elbow');
            const rightElbow = keypoints.find(k => k.name === 'right_elbow');
            if (leftWrist && rightWrist && leftShoulder && rightShoulder && leftElbow && rightElbow) {
              // Calculate shoulder-to-elbow distance + 50% as extension threshold for each arm
              const leftArmLength = Math.hypot(leftShoulder.x - leftElbow.x, leftShoulder.y - leftElbow.y);
              const rightArmLength = Math.hypot(rightShoulder.x - rightElbow.x, rightShoulder.y - rightElbow.y);
              const leftThreshold = leftArmLength * 1.5; // shoulder-to-elbow + 50%
              const rightThreshold = rightArmLength * 1.5;
              
              // Check if either wrist is extended beyond its threshold
              const leftDist = Math.hypot(leftWrist.x - leftShoulder.x, leftWrist.y - leftShoulder.y);
              const rightDist = Math.hypot(rightWrist.x - rightShoulder.x, rightWrist.y - rightShoulder.y);
              const leftExtended = leftDist > leftThreshold;
              const rightExtended = rightDist > rightThreshold;
              const eitherExtended = leftExtended || rightExtended;
              
              // Check if both wrists are back within their thresholds
              const bothRetracted = leftDist <= leftThreshold && rightDist <= rightThreshold;
              
              const nowSinceLast = now - lastRepTimeRef.current;
              
              // State machine: extended -> retracted cycle
              if (eitherExtended && !svendExtendedRef.current && nowSinceLast > REP_DEBOUNCE_MS) {
                svendExtendedRef.current = true;
              } else if (svendExtendedRef.current && bothRetracted && nowSinceLast > REP_DEBOUNCE_MS) {
                repsCountRef.current = Math.min(repsCountRef.current + 1, repsTarget);
                setRepsCount(repsCountRef.current);
                lastRepTimeRef.current = now;
                svendExtendedRef.current = false;
              }
              
              // Draw overlay: show threshold circles and wrist positions
              if (typeof overlayRef !== 'undefined' && overlayRef && overlayRef.current) {
                const canvas = overlayRef.current;
                const ctx = canvas.getContext('2d');
                if (ctx && videoRef.current) {
                  const intrinsicW = videoRef.current.videoWidth || videoRef.current.width || 640;
                  const intrinsicH = videoRef.current.videoHeight || videoRef.current.height || 480;
                  const clientW = canvas.clientWidth || intrinsicW;
                  const clientH = canvas.clientHeight || intrinsicH;
                  const dpr = window.devicePixelRatio || 1;
                  const targetW = Math.max(1, Math.round(clientW * dpr));
                  const targetH = Math.max(1, Math.round(clientH * dpr));
                  if (canvas.width !== targetW || canvas.height !== targetH) {
                    canvas.width = targetW;
                    canvas.height = targetH;
                  }
                  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
                  ctx.clearRect(0, 0, clientW, clientH);
                  
                  const mapX = (x: number) => (x / intrinsicW) * clientW;
                  const mapY = (y: number) => (y / intrinsicH) * clientH;
                  const mapLen = (l: number) => (l / intrinsicW) * clientW;
                  
                  // Draw threshold circles around shoulders (dashed, blue)
                  ctx.strokeStyle = 'rgba(33,150,243,0.6)';
                  ctx.lineWidth = 2;
                  ctx.setLineDash([6, 4]);
                  ctx.beginPath();
                  ctx.arc(mapX(leftShoulder.x), mapY(leftShoulder.y), mapLen(leftThreshold), 0, Math.PI * 2);
                  ctx.stroke();
                  ctx.beginPath();
                  ctx.arc(mapX(rightShoulder.x), mapY(rightShoulder.y), mapLen(rightThreshold), 0, Math.PI * 2);
                  ctx.stroke();
                  ctx.setLineDash([]);
                  
                  // Draw shoulders
                  ctx.fillStyle = 'rgba(33,150,243,0.8)';
                  ctx.beginPath(); ctx.arc(mapX(leftShoulder.x), mapY(leftShoulder.y), 6, 0, Math.PI * 2); ctx.fill();
                  ctx.beginPath(); ctx.arc(mapX(rightShoulder.x), mapY(rightShoulder.y), 6, 0, Math.PI * 2); ctx.fill();
                  
                  // Draw wrists (green when retracted, red when extended)
                  const leftColor = leftExtended ? 'rgba(244,67,54,0.9)' : 'rgba(76,175,80,0.9)';
                  const rightColor = rightExtended ? 'rgba(244,67,54,0.9)' : 'rgba(76,175,80,0.9)';
                  ctx.fillStyle = leftColor;
                  ctx.beginPath(); ctx.arc(mapX(leftWrist.x), mapY(leftWrist.y), 8, 0, Math.PI * 2); ctx.fill();
                  ctx.fillStyle = rightColor;
                  ctx.beginPath(); ctx.arc(mapX(rightWrist.x), mapY(rightWrist.y), 8, 0, Math.PI * 2); ctx.fill();
                  
                  // Draw connection lines from shoulders to wrists
                  ctx.strokeStyle = 'rgba(255,255,255,0.4)';
                  ctx.lineWidth = 2;
                  ctx.beginPath(); ctx.moveTo(mapX(leftShoulder.x), mapY(leftShoulder.y)); ctx.lineTo(mapX(leftWrist.x), mapY(leftWrist.y)); ctx.stroke();
                  ctx.beginPath(); ctx.moveTo(mapX(rightShoulder.x), mapY(rightShoulder.y)); ctx.lineTo(mapX(rightWrist.x), mapY(rightWrist.y)); ctx.stroke();
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
