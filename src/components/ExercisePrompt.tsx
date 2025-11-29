import React, { useRef, useEffect } from 'react';
import styles from './ExercisePrompt.module.css';
import WebcamFeed from './WebcamFeed';
import ProgressBar from './ProgressBar';
import { usePoseDetection } from '../hooks/usePoseDetection';
import InfoTooltip from './InfoTooltip';
import exerciseInstructions from '../utils/exerciseInstructions';

interface ExercisePromptProps {
  repsTarget: number;
  repsCount: number;
  setRepsCount: (val: number) => void;
  onDone: () => void;
  exercise: string; // 'squats' | 'jumping_jacks' | 'shoulder_presses'
  onCancel?: () => void;
  videoRef?: React.RefObject<HTMLVideoElement | null>;
  notes?: string;
  setNote?: (note: string) => void;
}

const ExercisePrompt: React.FC<ExercisePromptProps> = ({ repsTarget, repsCount, setRepsCount, onDone, exercise, onCancel, videoRef, notes, setNote }) => {
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
      <p style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span>Do {repsTarget}</span>
        <strong style={{ textTransform: 'none' }}>{
          exercise === 'squats' ? 'squats' :
          exercise === 'jumping_jacks' ? 'jumping jacks' :
          exercise === 'shoulder_presses' ? 'shoulder presses' :
          exercise === 'lateral_raise' ? 'lateral raises' :
          exercise === 'knee_raises' ? 'knee raises' :
          exercise === 'bicep_curls' ? 'bicep curls' :
          exercise === 'band_pull_aparts' ? 'band pull-aparts' :
          exercise === 'triceps_extensions' ? 'triceps extensions' :
          exercise === 'low_to_high_chest_flies' ? 'low-to-high chest flies' :
          exercise === 'svend_chest_press' ? 'Svend chest presses' : 'reps'
        }</strong>
        <InfoTooltip content={exerciseInstructions[exercise] ?? 'Perform the exercise with controlled motion and proper form.'} />
      </p>
      {exercise === 'svend_chest_press' && (
        <div style={{
          background: '#e3f2fd',
          color: '#1976d2',
          padding: '8px 12px',
          borderRadius: '6px',
          fontSize: '0.9rem',
          marginBottom: '12px',
          border: '1px solid #bbdefb',
          textAlign: 'center'
        }}>
          💡 Turn 90 degrees left or right to accurately track this exercise
        </div>
      )}
      <div className={styles.toggleRow}>
        <label className={styles.toggleLabel}>
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
          {/* Notes beneath the progress bar: inline editable textarea (max 300 chars) */}
          {typeof notes !== 'undefined' && (
            <div className={styles.notesContainer}>
              <label className={styles.notesLabel}>Notes</label>
              <textarea
                value={notes}
                onChange={e => {
                  const v = e.target.value.slice(0, 300);
                  if (setNote) setNote(v);
                }}
                placeholder="Add notes (e.g. 10lb dumbbells, blue resistance band)"
                maxLength={300}
                rows={3}
                className="notes-textarea"
              />
              <div className={styles.notesCounter}>{(notes || '').length}/300</div>
            </div>
          )}

      <div className={styles.buttonsRow}>
        <button className={styles.doneButton} onClick={onDone} disabled={repsCount < repsTarget}>
          Done
        </button>
        <button className={styles.cancelButton} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
};

export default ExercisePrompt;
