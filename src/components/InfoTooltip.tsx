import React from 'react';
import styles from './InfoTooltip.module.css';

interface InfoTooltipProps {
  content: string;
  children?: React.ReactNode;
}

// Minimal accessible tooltip: shows popup on hover and focus. Uses title for
// fallback and a visible popup element for styling and keyboard focus.
const InfoTooltip: React.FC<InfoTooltipProps> = ({ content, children }) => {
  const id = React.useId();
  const [visible, setVisible] = React.useState(false);

  return (
    <span className={styles.tooltipRoot}>
      <button
        aria-describedby={id}
        onMouseEnter={() => setVisible(true)}
        onMouseLeave={() => setVisible(false)}
        onFocus={() => setVisible(true)}
        onBlur={() => setVisible(false)}
        onClick={e => e.preventDefault()}
        title={content}
        className={styles.infoButton}
      >
        i
      </button>

      {visible && (
        <div id={id} role="tooltip" className={styles.tooltipPopup}>
          {content}
        </div>
      )}
    </span>
  );
};

export default InfoTooltip;
