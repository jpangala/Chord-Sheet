// Play-along mixer. The bass <audio> (masterRef) stays the transport; each extra
// track is a hidden <audio> that follows it (play, pause, seek, speed) with a
// small drift correction. Extra tracks are never analyzed. The master element
// is the source of truth for the bass volume/mute, so its native controls and
// the sliders here agree.
import { useEffect, useRef, useState } from 'react';

const DRIFT_LIMIT = 0.15; // s of allowed difference before re-seeking a track
const DRIFT_CHECK_MS = 300;

export const trackName = (file) => file.name.replace(/\.[^.]+$/, '') || 'Track';

export function BackingTracks({ masterRef, tracks, setTracks, ui, onRemove }) {
  const { pill, caption, row } = ui;
  const elsRef = useRef(new Map()); // track id -> <audio>
  const [bass, setBass] = useState({ volume: 1, muted: false });

  const eachTrack = (fn) => elsRef.current.forEach(fn);

  // Follow the master transport.
  useEffect(() => {
    const master = masterRef.current;
    if (!master) return undefined;
    const syncOne = (el) => {
      el.playbackRate = master.playbackRate;
      if (Math.abs(el.currentTime - master.currentTime) > 0.02) el.currentTime = master.currentTime;
      if (!master.paused && el.paused) el.play().catch(() => {});
    };
    const onPlay = () => eachTrack(syncOne);
    const onPause = () => eachTrack((el) => el.pause());
    const onSeeked = () => eachTrack(syncOne);
    const onRate = () => eachTrack((el) => { el.playbackRate = master.playbackRate; });
    const onVolume = () => setBass({ volume: master.volume, muted: master.muted });
    master.addEventListener('play', onPlay);
    master.addEventListener('pause', onPause);
    master.addEventListener('seeked', onSeeked);
    master.addEventListener('ratechange', onRate);
    master.addEventListener('volumechange', onVolume);
    onVolume();
    const timer = setInterval(() => {
      if (master.paused) return;
      eachTrack((el) => {
        if (Math.abs(el.currentTime - master.currentTime) > DRIFT_LIMIT) el.currentTime = master.currentTime;
        if (el.paused && !el.ended) el.play().catch(() => {});
      });
    }, DRIFT_CHECK_MS);
    return () => {
      master.removeEventListener('play', onPlay);
      master.removeEventListener('pause', onPause);
      master.removeEventListener('seeked', onSeeked);
      master.removeEventListener('ratechange', onRate);
      master.removeEventListener('volumechange', onVolume);
      clearInterval(timer);
    };
  }, [masterRef]);

  const setTrack = (id, patch) => setTracks((ts) => ts.map((t) => (t.id === id ? { ...t, ...patch } : t)));

  const slider = (value, onChange, label) => (
    <input type="range" min={0} max={1} step={0.01} value={value} aria-label={label}
      onChange={(e) => onChange(Number(e.target.value))} style={{ width: 110 }} />
  );
  const name = { fontSize: 13, color: 'var(--color-text)', minWidth: 90, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <span style={caption}>Mixer (extra tracks are for playing along, they are not analyzed)</span>

      <div style={row}>
        <span style={name}>Bass</span>
        {slider(bass.volume, (v) => { if (masterRef.current) masterRef.current.volume = v; }, 'Bass volume')}
        <button style={pill(bass.muted)} onClick={() => { if (masterRef.current) masterRef.current.muted = !bass.muted; }}>
          {bass.muted ? 'Muted' : 'Mute'}
        </button>
      </div>

      {tracks.map((t) => (
        <div key={t.id} style={row}>
          <span style={name} title={t.name}>{t.name}</span>
          {slider(t.volume, (v) => setTrack(t.id, { volume: v }), `${t.name} volume`)}
          <button style={pill(t.muted)} onClick={() => setTrack(t.id, { muted: !t.muted })}>{t.muted ? 'Muted' : 'Mute'}</button>
          <button style={pill(false)} onClick={() => onRemove(t.id)} aria-label={`Remove ${t.name}`}>Remove</button>
          <TrackAudio track={t} masterRef={masterRef} register={(el) => { if (el) elsRef.current.set(t.id, el); else elsRef.current.delete(t.id); }} />
        </div>
      ))}

      <div style={row}>
        <label style={{ ...pill(false), display: 'inline-block' }}>
          + Add backing track (vocals, drums, other…)
          <input
            type="file" accept="audio/*" multiple style={{ display: 'none' }}
            onChange={(e) => {
              const files = [...(e.target.files ?? [])];
              e.target.value = '';
              setTracks((ts) => [...ts, ...files.map((f) => ({
                id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
                name: trackName(f), url: URL.createObjectURL(f), volume: 1, muted: false,
              }))]);
            }}
          />
        </label>
      </div>
    </div>
  );
}

// One hidden element per extra track; catches up to the master once on mount.
function TrackAudio({ track, masterRef, register }) {
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    const master = masterRef.current;
    register(el);
    if (master) {
      el.playbackRate = master.playbackRate;
      el.currentTime = master.currentTime;
      if (!master.paused) el.play().catch(() => {});
    }
    return () => register(null);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    ref.current.volume = track.volume;
    ref.current.muted = track.muted;
  }, [track.volume, track.muted]);

  return <audio ref={ref} src={track.url} preload="auto" style={{ display: 'none' }} />;
}
