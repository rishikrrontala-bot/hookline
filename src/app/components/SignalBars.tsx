import type { SignalSet, SignalName } from '../../engine/types';
import { SIGNAL_LABELS, SIGNAL_DESCRIPTIONS } from '../../engine/signals';

const ORDER: SignalName[] = ['hook', 'curiosity', 'emotion', 'concrete', 'salience', 'payoff', 'pace', 'quotable'];

/**
 * The signal readout.
 *
 * Every bar is a number the engine actually computed, compared against the
 * recording's own average. A creator who disagrees with a clip can see exactly
 * which measurement produced it — which is the difference between a tool and
 * an oracle.
 */
export function SignalBars({
  signals, baseline, withheld,
}: { signals: SignalSet; baseline?: SignalSet; withheld?: SignalName[] }) {
  return (
    <dl className="signals">
      {ORDER.map((key) => {
        const value = signals[key];
        const base = baseline?.[key];
        const isWithheld = withheld?.includes(key);
        const lift = base !== undefined ? value - base : 0;

        return (
          <div className="signals__row" key={key} title={SIGNAL_DESCRIPTIONS[key]}>
            <dt className="signals__name">{SIGNAL_LABELS[key]}</dt>
            <dd className="signals__track">
              {isWithheld ? (
                <span className="signals__withheld">withheld — timings synthesized</span>
              ) : (
                <>
                  <span className="signals__fill" style={{ transform: `scaleX(${Math.max(0.015, value)})` }} />
                  {base !== undefined && (
                    <span
                      className="signals__baseline"
                      style={{ left: `${base * 100}%` }}
                      aria-label={`recording average ${(base * 100).toFixed(0)}`}
                    />
                  )}
                </>
              )}
            </dd>
            <dd className="signals__value num">
              {isWithheld ? '—' : (value * 100).toFixed(0)}
              {base !== undefined && !isWithheld && Math.abs(lift) > 0.06 && (
                <span className={`signals__lift${lift > 0 ? ' is-up' : ''}`}>
                  {lift > 0 ? '+' : '−'}{Math.abs(lift * 100).toFixed(0)}
                </span>
              )}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}
