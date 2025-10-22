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
  const canvasRef = useRef<HTMLCanvasElement>(null) as React.RefObject<HTMLCanvasElement>;
  usePoseDetection({ videoRef: usedRef, enabled: true, repsTarget, setRepsCount, exercise, overlayRef: canvasRef });
  const [showOverlay, setShowOverlay] = React.useState(false);

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
        exercise === 'knee_raises' ? 'knee raises' :
        exercise === 'bicep_curls' ? 'bicep curls' :
        exercise === 'band_pull_aparts' ? 'band pull-aparts' : 'reps'
      }</p>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          Show Form Overlay
          <span className="toggle-switch">
            <input
              type="checkbox"
              checked={showOverlay}
              onChange={e => setShowOverlay(e.target.checked)}
            />
            <span className="toggle-slider" />
          </span>
        </label>
      </div>
      <div className="webcam-section">
        <WebcamFeed
          show={true}
          videoRef={usedRef}
          // Force the widest/tallest (shoulder press) area for best pose detection across exercises
          aspect={'wide'}
          overlayRef={canvasRef}
          showOverlay={showOverlay}
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
