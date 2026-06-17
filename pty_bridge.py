#!/usr/bin/env python3
import fcntl
import json
import os
import pty
import select
import signal
import struct
import sys
import termios


def set_size(fd, rows, cols):
    packed = struct.pack("HHHH", rows, cols, 0, 0)
    fcntl.ioctl(fd, termios.TIOCSWINSZ, packed)


def main():
    shell = os.environ.get("TERMINAL_SHELL") or "/bin/zsh"
    startup_command = os.environ.get("STARTUP_COMMAND", "")

    pid, fd = pty.fork()
    if pid == 0:
      os.environ["TERM"] = "xterm-256color"
      os.environ.setdefault("LANG", "en_US.UTF-8")
      os.environ.setdefault("LC_CTYPE", "en_US.UTF-8")
      os.execl(shell, shell)

    set_size(fd, 24, 80)

    if startup_command:
        os.write(fd, (startup_command + "\r").encode("utf-8"))

    stdin_fd = sys.stdin.fileno()
    stdout_fd = sys.stdout.buffer

    while True:
        readable, _, _ = select.select([fd, stdin_fd], [], [])

        if fd in readable:
            try:
                data = os.read(fd, 4096)
            except OSError:
                break
            if not data:
                break
            stdout_fd.write(data)
            stdout_fd.flush()

        if stdin_fd in readable:
            line = sys.stdin.readline()
            if not line:
                break
            try:
                message = json.loads(line)
            except json.JSONDecodeError:
                continue

            if message.get("type") == "input":
                data = message.get("data", "")
                os.write(fd, data.encode("utf-8"))

            if message.get("type") == "resize":
                rows = int(message.get("rows", 24))
                cols = int(message.get("cols", 80))
                set_size(fd, rows, cols)

    try:
        os.kill(pid, signal.SIGHUP)
    except ProcessLookupError:
        pass


if __name__ == "__main__":
    main()
