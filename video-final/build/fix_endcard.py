#!/usr/bin/env python3
"""Regenerate ONLY the end card (s5c) with the repo URL, rebuild beat5,
and re-splice the final cut. Functions replicate build.py exactly."""
import subprocess, os, sys

B = "/tmp/rf-build"
SEG = f"{B}/seg"
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

def concat(parts, out):
    lst = f"{out}.txt"
    with open(lst, "w") as f:
        for p in parts:
            f.write(f"file '{p}'\n")
    run(["ffmpeg", "-y", "-v", "error", "-f", "concat", "-safe", "0",
         "-i", lst, "-c", "copy", out])

# 1. Re-render only the end-card segment (same params as build.py job s5c)
still(f"{CARDS}/end.png", f"{SEG}/s5c.mp4", 12.94, 1.03)
print(f"s5c: {dur(f'{SEG}/s5c.mp4'):.2f}s")

# 2. Rebuild beat5 video from the untouched s5a/s5b + new s5c (stream copy)
concat([f"{SEG}/s5a.mp4", f"{SEG}/s5b.mp4", f"{SEG}/s5c.mp4"], f"{SEG}/beat5-v.mp4")
print(f"beat5-v: {dur(f'{SEG}/beat5-v.mp4'):.2f}s")

# 3. Mux beat5 with its existing VO wav — same command as build.py beat()
run(["ffmpeg", "-y", "-v", "error", "-i", f"{SEG}/beat5-v.mp4",
     "-i", f"{SEG}/beat5-vo.wav", "-map", "0:v", "-map", "1:a",
     "-c:v", "copy", "-c:a", "aac", "-b:a", "160k", "-t", "49.44",
     f"{SEG}/beat5.mp4"])
print(f"beat5: {dur(f'{SEG}/beat5.mp4'):.2f}s (target 49.44)")

# 4. Re-splice the final from the untouched beat1-4 files + new beat5
final = f"{WS}/video-final/replyforge-hybrid-demo.mp4"
concat([f"{SEG}/beat1.mp4", f"{SEG}/beat2.mp4", f"{SEG}/beat3.mp4",
        f"{SEG}/beat4.mp4", f"{SEG}/beat5.mp4"], final)
print(f"FINAL: {dur(final):.2f}s -> {final}")
