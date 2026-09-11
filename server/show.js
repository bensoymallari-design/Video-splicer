export function createShow() {
  let playing = false;
  let loop = true;
  let offset = 0;
  let startedAt = 0;

  function mediaTime() {
    if (!playing) return offset;
    return Math.max(0, offset + (Date.now() - startedAt) / 1000);
  }

  function snapshot() {
    return { playing, loop, mediaTime: mediaTime() };
  }

  function play() {
    if (!playing) {
      startedAt = Date.now();
      playing = true;
    }
    return snapshot();
  }

  function pause() {
    offset = mediaTime();
    playing = false;
    return snapshot();
  }

  function stop() {
    playing = false;
    offset = 0;
    startedAt = 0;
    return snapshot();
  }

  function seek(seconds) {
    offset = Math.max(0, Number(seconds) || 0);
    startedAt = Date.now();
    return snapshot();
  }

  return { snapshot, play, pause, stop, seek, mediaTime };
}
