import React, { useRef, useEffect } from 'react';
import WebcamFeed from './WebcamFeed';
import ProgressBar from './ProgressBar';
import { usePoseDetection } from '../hooks/usePoseDetection';

interface ExercisePromptProps {
  repsTarget: number;
  repsCount: number;
  setRepsCount: (val: number) => void;
  onDone: () => void;
  exercise: string; // 'squats' | 'jumping_jacks' | 'shoulder_presses'
  onCancel?: () => void;
  videoRef?: React.RefObject<HTMLVideoElement | null>;
}

const ExercisePrompt: React.FC<ExercisePromptProps> = ({ repsTarget, repsCount, setRepsCount, onDone, exercise, onCancel, videoRef }) => {
  const innerRef = useRef<HTMLVideoElement>(null) as React.RefObject<HTMLVideoElement>;
  const usedRef = videoRef || innerRef;
  usePoseDetection({ videoRef: usedRef, enabled: true, repsTarget, setRepsCount, exercise });

  // Listen for Enter key to trigger Done when rep target is reached
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && repsCount >= repsTarget) {
        onDone();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [repsCount, repsTarget, onDone]);

  return (
    <div className="exercise-prompt">
      <h2>Time to Move!</h2>
      <p>Do {repsTarget} {
        exercise === 'squats' ? 'squats' :
        exercise === 'jumping_jacks' ? 'jumping jacks' :
        exercise === 'shoulder_presses' ? 'shoulder presses' :
        exercise === 'lateral_raise' ? 'lateral raises' :
        exercise === 'knee_raises' ? 'knee raises' : 'reps'
      }</p>
      <div className="webcam-section">
        <WebcamFeed
          show={true}
          videoRef={usedRef}
          // Force the widest/tallest (shoulder press) area for best pose detection across exercises
          aspect={'wide'}
        />
      </div>
      <div className="rep-counter">
        Reps: {repsCount} / {repsTarget}
        <ProgressBar value={repsCount} max={repsTarget} />
      </div>
      <div style={{ display: 'flex', gap: 16, justifyContent: 'center', marginTop: 16 }}>
        <button onClick={onDone} disabled={repsCount < repsTarget}>
          Done
        </button>
        <button onClick={onCancel} style={{ background: '#e0e7ef', color: '#3a5ba0' }}>
          Cancel
        </button>
      </div>
    </div>
  );
};

export default ExercisePrompt;
