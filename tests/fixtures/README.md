The MP4 fixtures are generated test patterns and tones, with no YouTube media.
They contain 30 seconds of fragmented media with approximately five-second
segments and a global SIDX index. Recreate them with FFmpeg:

```sh
ffmpeg -f lavfi -i testsrc2=size=160x90:rate=10 -t 30 -an -c:v libx264 -preset ultrafast -b:v 60k -g 50 -keyint_min 50 -sc_threshold 0 -movflags +dash+frag_keyframe+empty_moov+global_sidx sabr-video.mp4
ffmpeg -f lavfi -i sine=frequency=440:sample_rate=48000 -t 30 -vn -c:a aac -b:a 32k -frag_duration 5000000 -movflags +dash+empty_moov+global_sidx sabr-audio.mp4
```

`desktop-sabr.cjs` wraps their segments in real UMP responses and emulates a
server that honors the client's claimed buffered segments. It sends two media
segments together, reproducing the former mismatch between returned bytes and
delivery metadata. The player must keep a contiguous buffer, play through
multiple five-second boundaries, and rewind through them with ArrowLeft.
