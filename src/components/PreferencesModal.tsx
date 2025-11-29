import React from 'react';

interface PreferencesModalProps {
  open: boolean;
  onClose: () => void;
  prefsTimer: number;
  setPrefsTimer: (n: number) => void;
  prefsReps: Record<string, number>;
  setPrefsReps: (r: Record<string, number> | ((r: Record<string, number>) => Record<string, number>)) => void;
  prefsGoal: Record<string, number>;
  setPrefsGoal: (g: Record<string, number> | ((g: Record<string, number>) => Record<string, number>)) => void;
  savePrefs: () => void;
  toProperCase: (s: string) => string;
  DEFAULT_REPS: Record<string, number>;
  prefsNotes: Record<string, string>;
  setPrefsNotes: (r: Record<string, string> | ((r: Record<string, string>) => Record<string, string>)) => void;
}

const WEEKDAYS = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];

const PreferencesModal: React.FC<PreferencesModalProps> = ({
  open, onClose, prefsTimer, setPrefsTimer, prefsReps, setPrefsReps, prefsGoal, setPrefsGoal, savePrefs, toProperCase, DEFAULT_REPS
  , prefsNotes, setPrefsNotes
}) => {
  if (!open) return null;
  return (
    <div
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh',
        background: 'rgba(0,0,0,0.3)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center'
      }}
    >
      <div style={{ background: '#fff', padding: 20, borderRadius: 12, minWidth: 420, maxWidth: 600, boxShadow: '0 2px 16px #0002', maxHeight: 480, overflowY: 'auto' }}>
        <h2 style={{ marginTop: 0 }}>Preferences</h2>
        <div style={{ display: 'flex', gap: 32 }}>
          <div style={{ flex: 1 }}>
            <div style={{ marginBottom: 12 }}>
              <label>Default Timer (seconds): </label>
              <input
                type="number"
                min={10}
                max={3600}
                value={prefsTimer}
                onChange={e => setPrefsTimer(Math.max(10, Math.min(3600, Number(e.target.value))))}
                style={{ width: 80 }}
              />
            </div>
            <div style={{ marginBottom: 12 }}>
              <label>Default Reps per Exercise:</label>
              <div style={{ marginLeft: 12 }}>
                {Object.keys(DEFAULT_REPS).map(ex => (
                  <div key={ex} style={{ marginBottom: 4 }}>
                    <span style={{ width: 140, display: 'inline-block' }}>{toProperCase(ex)}: </span>
                    <input
                      type="number"
                      min={1}
                      max={50}
                      value={prefsReps[ex] || 10}
                      onChange={e => setPrefsReps(r => ({ ...r, [ex]: Math.max(1, Math.min(50, Number(e.target.value))) }))}
                      style={{ width: 60 }}
                    />
                    <div style={{ display: 'inline-block', marginLeft: 12, verticalAlign: 'middle' }}>
                      <input
                        type="text"
                        placeholder="notes"
                        value={prefsNotes[ex] || ''}
                        onChange={e => setPrefsNotes(n => ({ ...n, [ex]: e.target.value }))}
                        style={{ width: 180 }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div style={{ flex: 1 }}>
            <label>Daily Task Goal (per weekday):</label>
            <div style={{ marginLeft: 12 }}>
              {WEEKDAYS.map(day => (
                <div key={day} style={{ marginBottom: 4 }}>
                  <span style={{ width: 60, display: 'inline-block' }}>{day}: </span>
                  <input
                    type="number"
                    min={1}
                    max={20}
                    value={prefsGoal[day] || 5}
                    onChange={e => setPrefsGoal(g => ({ ...g, [day]: Math.max(1, Math.min(20, Number(e.target.value))) }))}
                    style={{ width: 60 }}
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
        <div style={{ textAlign: 'right', marginTop: 18 }}>
          <button onClick={onClose} style={{ marginRight: 12 }}>Cancel</button>
          <button onClick={savePrefs} style={{ fontWeight: 'bold' }}>Save</button>
        </div>
      </div>
    </div>
  );
};

export default PreferencesModal;
