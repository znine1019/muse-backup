#!/bin/bash
# Launch WorkBuddy in Xvfb :99, detached so it survives the exec session.
if ! pgrep -x Xvfb > /dev/null; then
  setsid Xvfb :99 -screen 0 1280x800x24 > /tmp/xvfb.log 2>&1 < /dev/null &
  sleep 3
fi
if ! pgrep -f "WorkBuddy/workbuddy" > /dev/null; then
  setsid env DISPLAY=:99 /opt/WorkBuddy/workbuddy --no-sandbox --disable-gpu --disable-dev-shm-usage > /tmp/workbuddy.log 2>&1 < /dev/null &
  sleep 20
fi
export DISPLAY=:99
scrot /tmp/workbuddy-login.png
ls -lh /tmp/workbuddy-login.png /tmp/workbuddy.log
ps aux | grep -E "Xvfb|WorkBuddy/workbuddy" | grep -v grep
