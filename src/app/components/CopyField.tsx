import { useState, useRef, useEffect } from 'react';

/** A value with a copy control. The whole point of the tool is getting text out. */
export function CopyField({
  label, value, meta, multiline, tone = 'default',
}: {
  label: string;
  value: string;
  meta?: string;
  multiline?: boolean;
  tone?: 'default' | 'heat' | 'code';
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number>();

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard is blocked in some embedded contexts; select the text instead
      // so the copy is still one keystroke away.
      const node = document.getElementById(`field-${label.replace(/\W/g, '')}`);
      if (node) {
        const range = document.createRange();
        range.selectNodeContents(node);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
      }
    }
  };

  return (
    <div className={`field field--${tone}${multiline ? ' field--multi' : ''}`}>
      <div className="field__head">
        <span className="label">{label}</span>
        <div className="field__meta">
          {meta && <span className="field__count num">{meta}</span>}
          <button type="button" className="field__copy" onClick={copy}>
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      </div>
      <p className="field__value" id={`field-${label.replace(/\W/g, '')}`}>{value}</p>
    </div>
  );
}
