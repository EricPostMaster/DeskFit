import { useEffect, useRef } from 'react';
import * as poseDetection from '@tensorflow-models/pose-detection';

interface UsePoseDetectionProps {
  videoRef: React.RefObject<HTMLVideoElement>;
  enabled: boolean;
  repsTarget: number;
  setRepsCount: (val: number) => void;
  exercise: string; // 'squats' | 'jumping_jacks'
}

export function usePoseDetection({ videoRef, enabled, repsTarget, setRepsCount, exercise }: UsePoseDetectionProps) {
  const detectorRef = useRef<poseDetection.PoseDetector | null>(null);
  const lastArmUpRef = useRef(false);
  const lastRepTimeRef = useRef<number>(0);
  const REP_DEBOUNCE_MS = 800;
  const repsCountRef = useRef(0);

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
        const poses = await detectorRef.current.estimatePoses(videoRef.current);
        if (poses && poses[0]) {
          const keypoints = poses[0].keypoints;
          // --- Exercise-specific logic ---
          const now = Date.now();
          if (exercise === 'shoulder_presses') {
            // Detect both wrists above shoulders (shoulder press)
            const leftWrist = keypoints.find(k => k.name === 'left_wrist');
            const rightWrist = keypoints.find(k => k.name === 'right_wrist');
            const leftShoulder = keypoints.find(k => k.name === 'left_shoulder');
            const rightShoulder = keypoints.find(k => k.name === 'right_shoulder');
            const armsAboveShoulders =
              leftWrist && rightWrist && leftShoulder && rightShoulder &&
              leftWrist.y < leftShoulder.y && rightWrist.y < rightShoulder.y;
            if (
              armsAboveShoulders &&
              !lastArmUpRef.current &&
              now - lastRepTimeRef.current > REP_DEBOUNCE_MS
            ) {
              repsCountRef.current = Math.min(repsCountRef.current + 1, repsTarget);
              setRepsCount(repsCountRef.current);
              lastRepTimeRef.current = now;
            }
            lastArmUpRef.current = !!armsAboveShoulders;
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
              // Track state: standing -> squat -> standing
              if (
                isSquatting &&
                !lastArmUpRef.current &&
                now - lastRepTimeRef.current > REP_DEBOUNCE_MS
              ) {
                repsCountRef.current = Math.min(repsCountRef.current + 1, repsTarget);
                setRepsCount(repsCountRef.current);
                lastRepTimeRef.current = now;
              }
              lastArmUpRef.current = isSquatting;
            }
          } else if (exercise === 'jumping_jacks') {
            // Detect jumping jack by arms and legs spread
            const leftWrist = keypoints.find(k => k.name === 'left_wrist');
            const rightWrist = keypoints.find(k => k.name === 'right_wrist');
            const leftAnkle = keypoints.find(k => k.name === 'left_ankle');
            const rightAnkle = keypoints.find(k => k.name === 'right_ankle');
            const leftShoulder = keypoints.find(k => k.name === 'left_shoulder');
            const rightShoulder = keypoints.find(k => k.name === 'right_shoulder');
            const armsUp =
              leftWrist && rightWrist && leftShoulder && rightShoulder &&
              leftWrist.y < leftShoulder.y && rightWrist.y < rightShoulder.y;
            let legsApart = false;
            if (leftAnkle && rightAnkle && leftShoulder && rightShoulder) {
              legsApart = Math.abs(leftAnkle.x - rightAnkle.x) > 1.5 * Math.abs(leftShoulder.x - rightShoulder.x);
            }
            const jackPose = armsUp && legsApart;
            if (
              jackPose &&
              !lastArmUpRef.current &&
              now - lastRepTimeRef.current > REP_DEBOUNCE_MS
            ) {
              repsCountRef.current = Math.min(repsCountRef.current + 1, repsTarget);
              setRepsCount(repsCountRef.current);
              lastRepTimeRef.current = now;
            }
            lastArmUpRef.current = !!jackPose;
          }
          // --- End exercise-specific logic ---
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
  }, [enabled, repsTarget, setRepsCount, videoRef]);
}
