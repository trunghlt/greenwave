import { useEffect } from 'react';
import { useI18n, type MsgKey } from './i18n';

export function Tutorial({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="tutorial-backdrop" onClick={onClose} role="presentation">
      <div
        className="tutorial"
        role="dialog"
        aria-labelledby="tutorial-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="tutorial-head">
          <div>
            <h2 id="tutorial-title">{t('tut.title')}</h2>
            <p>{t('tut.lead')}</p>
          </div>
          <button className="btn secondary" onClick={onClose}>
            {t('tut.close')}
          </button>
        </header>

        <div className="tutorial-body">
          <section>
            <h3>{t('tut.s1.title')}</h3>
            <p>
              <Rich text={t('tut.s1.body')} />
            </p>
          </section>

          <section>
            <h3>{t('tut.s2.title')}</h3>
            <ol>
              {(['tut.s2.l1', 'tut.s2.l2', 'tut.s2.l3', 'tut.s2.l4', 'tut.s2.l5'] as MsgKey[]).map(
                (key) => (
                  <li key={key}>
                    <Rich text={t(key)} />
                  </li>
                ),
              )}
            </ol>
            <p className="hint">
              <Rich text={t('tut.s2.hint')} />
            </p>
          </section>

          <section>
            <h3>{t('tut.s3.title')}</h3>
            <p>
              <Rich text={t('tut.s3.body')} />
            </p>
            <ul>
              <li>
                <Rich text={t('tut.s3.cycle')} />
              </li>
              <li>
                <Rich text={t('tut.s3.split')} />
              </li>
              <li>
                <Rich text={t('tut.s3.offset')} />
              </li>
            </ul>
            <p>
              <Rich text={t('tut.s3.note')} />
            </p>
          </section>

          <section>
            <h3>{t('tut.s4.title')}</h3>
            <ul>
              {(['tut.s4.fixed', 'tut.s4.adaptive', 'tut.s4.coord', 'tut.s4.opt'] as MsgKey[]).map(
                (key) => (
                  <li key={key}>
                    <Rich text={t(key)} />
                  </li>
                ),
              )}
            </ul>
          </section>

          <section>
            <h3>{t('tut.s5.title')}</h3>
            <p>
              <Rich text={t('tut.s5.body')} />
            </p>
          </section>

          <section>
            <h3>{t('tut.s6.title')}</h3>
            <p>
              <Rich text={t('tut.s6.body')} />
            </p>
            <p>
              <kbd>space</kbd> {t('hotkey.play')} &nbsp; <kbd>1–5</kbd> {t('hotkey.speed')} &nbsp;{' '}
              <kbd>R</kbd> {t('hotkey.reset')} &nbsp; <kbd>esc</kbd> {t('tut.s6.keysClose')}
            </p>
          </section>

          <section>
            <h3>{t('tut.s7.title')}</h3>
            <p>
              <Rich text={t('tut.s7.body')} />
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}

function Rich({ text }: { text: string }) {
  const parts = text.split(/(<b>.*?<\/b>|<kbd>.*?<\/kbd>)/g);
  return (
    <>
      {parts.map((p, i) => {
        if (p.startsWith('<b>') && p.endsWith('</b>')) return <b key={i}>{p.slice(3, -4)}</b>;
        if (p.startsWith('<kbd>') && p.endsWith('</kbd>')) return <kbd key={i}>{p.slice(5, -6)}</kbd>;
        return p ? <span key={i}>{p}</span> : null;
      })}
    </>
  );
}
