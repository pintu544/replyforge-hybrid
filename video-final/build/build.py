#!/usr/bin/env python3
"""Assemble the ReplyForge Hybrid demo: per-beat segments timed to the VO."""
import subprocess, os, sys

B = "/tmp/rf-build"
SEG = f"{B}/seg"; os.makedirs(SEG, exist_ok=True)
WS = "/home/hatch/workspace/replyforge-hybrid"
CARDS = f"{B}/cards"
ENC = ["-c:v", "libx264", "-crf", "20", "-preset", "medium", "-pix_fmt", "yuv420p",
       "-r", "30", "-video_track_timescale", "30000"]

def run(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        print("FAILED:", " ".join(cmd)); print(r.stderr[-2500:]); sys.exit(1)

def dur(path):
    return float(subprocess.run(["ffprobe", "-v", "error", "-show_entries",
                    "format=duration", "-of", "csv=p=0", path],
                   capture_output=True, text=True).stdout.strip())

def still(img, out, d, zmax):
    n = int(d * 30)
    vf = (f"scale=2560:1440,zoompan=z='1+{zmax-1:.3f}*on/{n}'"
          f":x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=1280x720:fps=30")
    run(["ffmpeg", "-y", "-v", "error", "-loop", "1", "-framerate", "30",
         "-i", img, "-vf", vf, "-t", str(d), "-an"] + ENC + [out])

def clip(src, ss, to, speed, out, d):
    vf = (f"setpts={1/speed:.4f}*PTS,scale=1280:720,setsar=1,"
          f"tpad=stop_mode=clone:stop_duration=3,fps=30")
    run(["ffmpeg", "-y", "-v", "error", "-ss", str(ss), "-to", str(to),
         "-i", src, "-vf", vf, "-t", str(d), "-an"] + ENC + [out])

def concat(parts, out):
    lst = f"{out}.txt"
    with open(lst, "w") as f:
        for p in parts:
            f.write(f"file '{p}'\n")
    run(["ffmpeg", "-y", "-v", "error", "-f", "concat", "-safe", "0",
         "-i", lst, "-c", "copy", out])

def beat(name, parts, vo, total):
    v = f"{SEG}/{name}-v.mp4"
    concat(parts, v)
    wav = f"{SEG}/{name}-vo.wav"
    run(["ffmpeg", "-y", "-v", "error", "-i", vo, "-af", "aresample=48000,apad",
         "-ac", "2", "-t", str(total), wav])
    out = f"{SEG}/{name}.mp4"
    run(["ffmpeg", "-y", "-v", "error", "-i", v, "-i", wav, "-map", "0:v",
         "-map", "1:a", "-c:v", "copy", "-c:a", "aac", "-b:a", "160k",
         "-t", str(total), out])
    d = dur(out)
    print(f"{name}: {d:.2f}s (target {total})")
    return out

B1 = f"{WS}/video-scratch/beat1-inbox-load.webm"
B3B = f"{WS}/video-scratch/beat3b-privacy-escalation-refusal.webm"
B4A = f"{WS}/video-scratch/beat4a-rf001-triage-cloud.webm"
B4B = f"{WS}/video-scratch/beat4b-rf021-escalation.webm"

# last frame of beat4b for the Beat 4 hold
run(["ffmpeg", "-y", "-v", "error", "-ss", "40.9", "-i", B4B,
     "-frames:v", "1", f"{SEG}/b4last.png"])

jobs = [
    ("s1a", lambda o: still(f"{CARDS}/title.png", o, 3.00, 1.03)),
    ("s1b", lambda o: clip(B1, 6.0, 21.4, 1/1.087, o, 16.90)),
    ("s2a", lambda o: still(f"{CARDS}/routing.png", o, 7.00, 1.02)),
    ("s2b", lambda o: still(f"{CARDS}/b2score.png", o, 13.00, 1.05)),
    ("s2c", lambda o: still(f"{CARDS}/rf003.png", o, 8.63, 1.04)),
    ("s3a", lambda o: still(f"{CARDS}/rf003.png", o, 6.00, 1.03)),
    ("s3b", lambda o: clip(B4B, 25.0, 32.0, 0.72, o, 9.72)),
    ("s3c", lambda o: clip(B3B, 24.0, 32.64, 0.85, o, 14.35)),
    ("s4a", lambda o: clip(B4B, 32.3, 41.04, 0.70, o, 12.49)),
    ("s4b", lambda o: still(f"{SEG}/b4last.png", o, 14.98, 1.10)),
    ("s5a", lambda o: still(f"{CARDS}/scorecard.png", o, 33.00, 1.03)),
    ("s5b", lambda o: clip(B4A, 17.0, 20.5, 1.0, o, 3.50)),
    ("s5c", lambda o: still(f"{CARDS}/end.png", o, 12.94, 1.03)),
]
paths = {}
for name, fn in jobs:
    out = f"{SEG}/{name}.mp4"
    fn(out)
    paths[name] = out
    print(f"{name}: {dur(out):.2f}s")

beats = [
    beat("beat1", [paths["s1a"], paths["s1b"]], f"{B}/vo/b1.mp3", 19.90),
    beat("beat2", [paths["s2a"], paths["s2b"], paths["s2c"]], f"{B}/vo/b2.mp3", 28.63),
    beat("beat3", [paths["s3a"], paths["s3b"], paths["s3c"]], f"{B}/vo/b3.mp3", 30.07),
    beat("beat4", [paths["s4a"], paths["s4b"]], f"{B}/vo/b4.mp3", 27.47),
    beat("beat5", [paths["s5a"], paths["s5b"], paths["s5c"]], f"{B}/vo/b5.mp3", 49.44),
]
final = f"{WS}/video-final/replyforge-hybrid-demo.mp4"
concat(beats, final)
print(f"FINAL: {dur(final):.2f}s -> {final}")
