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
        detectorRef.current = await poseDetection.createDetector(
          poseDetection.SupportedModels.MoveNet,
          { modelType: poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING }
        );
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
