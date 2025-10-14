import React, { useState } from 'react';

interface TimerControlsProps {
  timer: number;
  setTimer: (val: number) => void;
  isRunning: boolean;
  onStartPause: () => void;
  autoRestart: boolean;
  setAutoRestart: (val: boolean) => void;
  startLabel?: string;
  hideStartButton?: boolean;
  hideAutoRestart?: boolean;
}

const TimerControls: React.FC<TimerControlsProps> = ({
  timer,
  setTimer,
  isRunning,
  onStartPause,
  autoRestart,
  setAutoRestart,
  startLabel = 'Start',
  hideStartButton = false,
  hideAutoRestart = false,
}) => {
  const [inputValue, setInputValue] = useState(timer === 0 ? '' : String(timer));

  // Keep inputValue in sync with timer prop
  React.useEffect(() => {
    setInputValue(timer === 0 ? '' : String(timer));
  }, [timer]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    // Allow empty string for clearing
    if (/^\d*$/.test(val)) {
      setInputValue(val);
      setTimer(val === '' ? 0 : Number(val));
    }
  };

  const handleInputBlur = () => {
    // If input is empty or invalid, set to default (10)
    if (inputValue === '' || Number(inputValue) < 1) {
      setInputValue('10');
      setTimer(10);
    }
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !isRunning) {
      if (inputValue === '' || Number(inputValue) < 1) {
        setInputValue('10');
        setTimer(10);
      }
      onStartPause();
    }
  };

  return (
    <div className="timer-section">
      <label style={{ display: 'flex', alignItems: 'center' }}>
        {/* Set Timer (seconds): */}
        <input
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          value={inputValue}
          onChange={handleInputChange}
          onBlur={handleInputBlur}
          onKeyDown={handleInputKeyDown}
          disabled={isRunning}
        />
      </label>
      {!hideStartButton && (
        <button onClick={onStartPause}>
          {isRunning ? 'Pause' : startLabel}
        </button>
      )}
      {!hideAutoRestart && (
        <label style={{ marginLeft: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
          Auto-restart timer after exercise
          <span className="toggle-switch">
            <input
              type="checkbox"
              checked={autoRestart}
              onChange={e => setAutoRestart(e.target.checked)}
            />
            <span className="toggle-slider" />
          </span>
        </label>
      )}
    </div>
  );
};

export default TimerControls;
