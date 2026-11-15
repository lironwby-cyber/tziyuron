// Voice recording sheet with a live waveform. Resolves to {blob, duration, type} or null.
import { openSheet, esc, formatDuration, toast } from './ui.js';

const MAX_SECONDS = 180;

function pickMime() {
  if (!globalThis.MediaRecorder) return null;
  const options = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm', 'audio/ogg;codecs=opus'];
  for (const t of options) if (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t)) return t;
  return '';
}

export function recordAudio(title = 'הקלטת קול') {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || pickMime() === null) {
    toast('הדפדפן הזה לא תומך בהקלטה');
    return Promise.resolve(null);
  }
  let stream = null, recorder = null, audioCtx = null, raf = 0, timer = 0;
  let chunks = [], startedAt = 0, result = null;

  const cleanup = () => {
    cancelAnimationFrame(raf);
    clearInterval(timer);
    if (recorder && recorder.state !== 'inactive') { try { recorder.stop(); } catch { /* ignore */ } }
    if (stream) stream.getTracks().forEach((t) => t.stop());
    if (audioCtx) audioCtx.close().catch(() => {});
    stream = null; audioCtx = null;
  };

  return openSheet((body, close) => {
    body.innerHTML = `
      <h2>${esc(title)}</h2>
      <p class="muted small">אפשר לבקש מהילד לספר מה צייר, למי ולמה.</p>
      <div class="recorder">
        <canvas class="wave" width="600" height="80" aria-hidden="true"></canvas>
        <div class="rec-time" aria-live="polite">0:00</div>
        <button class="rec-btn" aria-label="התחלת הקלטה"></button>
        <audio controls hidden></audio>
        <div class="btn-row" style="justify-content:center">
          <button class="btn" data-act="cancel">ביטול</button>
          <button class="btn primary" data-act="save" disabled>שמירה</button>
        </div>
      </div>`;
    const canvas = body.querySelector('canvas');
    const g = canvas.getContext('2d');
    const timeEl = body.querySelector('.rec-time');
    const btn = body.querySelector('.rec-btn');
    const audio = body.querySelector('audio');
    const save = body.querySelector('[data-act="save"]');

    const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#e8664f';
    const drawIdle = () => {
      g.clearRect(0, 0, canvas.width, canvas.height);
      g.fillStyle = accent;
      g.fillRect(0, canvas.height / 2 - 1, canvas.width, 2);
    };
    drawIdle();

    const start = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch {
        toast('אין גישה למיקרופון. אפשר לאשר אותה בהגדרות הדפדפן.');
        return;
      }
      const mime = pickMime();
      recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      chunks = [];
      recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
      recorder.onstop = () => {
        const type = (recorder.mimeType || mime || 'audio/webm');
        const blob = new Blob(chunks, { type });
        const duration = (performance.now() - startedAt) / 1000;
        result = { blob, duration, type };
        audio.src = URL.createObjectURL(blob);
        audio.hidden = false;
        save.disabled = false;
        btn.hidden = true;
        cleanup();
        drawIdle();
      };
      recorder.start(250);
      startedAt = performance.now();
      btn.classList.add('recording');
      btn.setAttribute('aria-label', 'עצירת הקלטה');

      try {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 1024;
        audioCtx.createMediaStreamSource(stream).connect(analyser);
        const buf = new Uint8Array(analyser.fftSize);
        const draw = () => {
          analyser.getByteTimeDomainData(buf);
          g.clearRect(0, 0, canvas.width, canvas.height);
          g.lineWidth = 3;
          g.strokeStyle = accent;
          g.beginPath();
          for (let i = 0; i < buf.length; i++) {
            const x = (i / (buf.length - 1)) * canvas.width;
            const y = (buf[i] / 255) * canvas.height;
            if (i) g.lineTo(x, y); else g.moveTo(x, y);
          }
          g.stroke();
          raf = requestAnimationFrame(draw);
        };
        draw();
      } catch { /* waveform is optional */ }

      timer = setInterval(() => {
        const s = (performance.now() - startedAt) / 1000;
        timeEl.textContent = formatDuration(s);
        if (s >= MAX_SECONDS) stop();
      }, 250);
    };

    const stop = () => {
      if (recorder && recorder.state === 'recording') {
        btn.classList.remove('recording');
        recorder.stop();
      }
    };

    btn.addEventListener('click', () => (recorder && recorder.state === 'recording' ? stop() : start()));
    body.querySelector('[data-act="cancel"]').addEventListener('click', () => close(null));
    save.addEventListener('click', () => close(result));
  }, { label: title }).then((value) => {
    cleanup();
    return value || null;
  });
}
